// ALTEGO necesita resolver los comentarios y respuestas de una conversación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {LiveAvatar} from "../profile/live-avatar";
import {AccountBadges} from "../identity/account-badges";
import {DatePipe,NgTemplateOutlet} from '@angular/common';
import {afterNextRender,Component,DestroyRef,ElementRef,Injector,computed,effect,inject,input,output,signal,untracked} from '@angular/core';
import {ActivatedRoute,Router,RouterLink} from '@angular/router';
import {toSignal} from '@angular/core/rxjs-interop';
import {firstValueFrom} from 'rxjs';
import {Api,assetUrl} from "../../core/http/api";
import {AuthService} from "../../core/auth/auth-service";
import {CommentComposer} from './comment-composer';
import {CommentText,hybridTime} from './comment-text';
import {Icon} from "../ui/icon";
import {CommentOrder,CommentPage,ReactionSummary,SocialComment} from "../social/social-types";
import {SocialReactions} from "../social/social-reactions";
import {UiFeedback} from "../ui/ui-feedback";
import {VisualButton,VisualField} from "../ui/visual-primitives";

const errorMessage=(error:unknown,fallback:string)=>(error as {error?:{error?:string}})?.error?.error ?? fallback;
const emptyPage=():CommentPage=>({items:[],next_cursor:null});
const merge=(current:SocialComment[],incoming:SocialComment[])=>[...new Map([...current,...incoming].map(item=>[item.id,item])).values()];
const chronological=(a:SocialComment,b:SocialComment)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id);
@Component({
  selector:'app-conversation-thread',
  imports:[LiveAvatar,AccountBadges,DatePipe,NgTemplateOutlet,RouterLink,CommentComposer,CommentText,Icon,SocialReactions,VisualButton,VisualField],
  templateUrl:'./conversation-thread.html',styleUrl:'./conversation-thread.css',
})
export class ConversationThread {
  private api=inject(Api);
  private ui=inject(UiFeedback);
  private host=inject(ElementRef<HTMLElement>);
  private injector=inject(Injector);
  private route=inject(ActivatedRoute);
  private query=toSignal(this.route.queryParamMap);
  auth=inject(AuthService);
  router=inject(Router);
  creatorId=input.required<number>();
  postId=input.required<string>();
  commentCount=input.required<number>();
  countChange=output<number>();
  readonly mayReport=input(false);
  readonly reportRequested=output<string>();
  ready=output<void>();
  comments=signal<SocialComment[]>([]);
  cursor=signal<string|null>(null);
  order=signal<CommentOrder>('oldest');
  loading=signal(false);
  error=signal('');
  replyLoading=signal<string|null>(null);
  working=signal<string|null>(null);
  editing=signal<string|null>(null);
  replying=signal<string|null>(null);
  draft=signal('');
  editDraft=signal('');
  replyDraft=signal('');
  highlight=signal<string|null>(null);
  private context=signal<SocialComment[]>([]);
  private confirmedRoots=signal<SocialComment[]>([]);
  private links=signal<Record<string,CommentPage>>({});
  private generation=0;
  private highlightTimer:ReturnType<typeof setTimeout>|undefined;
  private jumpGeneration=0;
  private keys=new Map<string,string>();
  private destroyed=false;
  avatar=assetUrl;
  when=hybridTime;
  visibleRoots=computed(()=>{
    const order=this.order();
    const local=merge(this.context().filter(item=>item.root_id===null),this.confirmedRoots());

    const loaded=this.comments(),ids=new Set(loaded.map(item=>item.id));
    const items=merge(loaded,local.filter(item=>!ids.has(item.id)));
    return items.sort((a,b)=>order==='newest'?b.created_at.localeCompare(a.created_at):
      (order==='popular'?b.reactions.total-a.reactions.total:0)||a.created_at.localeCompare(b.created_at));
  });

  constructor(){
    inject(DestroyRef).onDestroy(()=>{this.destroyed=true;clearTimeout(this.highlightTimer);});
    effect(()=>{
      this.creatorId();this.postId();this.auth.user()?.id;
      this.context.set([]);this.confirmedRoots.set([]);this.links.set({});this.comments.set([]);this.cursor.set(null);
      untracked(()=>void this.load());
    });
    effect(()=>{
      const value=this.query()?.get('comment'),post=this.query()?.get('post');
      if(value&&post===this.postId())void this.jump(value);
    });
  }
  changeOrder(value:string){
    if(!['oldest','newest','popular'].includes(value)||value===this.order())return;
    this.order.set(value as CommentOrder);this.links.set({});this.comments.set([]);this.cursor.set(null);void this.load();
  }
  async load(append=false){
    if(append&&(this.loading()||!this.cursor()))return;
    const generation=++this.generation;
    this.loading.set(true);this.error.set('');
    try{
      const data=await firstValueFrom(this.api.comments(this.creatorId(),this.postId(),this.order(),append?this.cursor()??undefined:undefined));
      if(this.destroyed||generation!==this.generation)return;
      this.comments.update(current=>append?merge(current,data.items):data.items);this.cursor.set(data.next_cursor);
      if(!append&&this.route.snapshot.fragment==='conversation-comments'&&!this.query()?.get('comment'))this.ready.emit();
    }catch(error){
      if(this.destroyed||generation!==this.generation)return;
      if((error as {status?:number}).status===409)this.cursor.set(null);
      this.error.set(errorMessage(error,'Could not load comments.'));
    }finally{if(generation===this.generation)this.loading.set(false);}
  }
  retry(){void this.load(!!this.cursor());}
  repliesFor(root:SocialComment){
    const page=this.links()[root.id] ?? root.replies ?? emptyPage();
    const extra=this.context().filter(item=>item.root_id===root.id);
    return {...page,items:merge(page.items,extra).sort(chronological)};
  }
  async moreReplies(root:SocialComment){
    if(this.replyLoading())return;
    const generation=this.generation;
    this.replyLoading.set(root.id);
    try{
      const existing=this.links()[root.id]??root.replies??emptyPage();
      const data=await firstValueFrom(this.api.replies(this.creatorId(),this.postId(),root.id,existing.next_cursor??undefined));
      if(!this.destroyed&&generation===this.generation)this.links.update(pages=>({...pages,[root.id]:
        {items:merge(existing.items,data.items),next_cursor:data.next_cursor}}));
    }catch{this.ui.notify("Couldn't load replies. Please try again.",'error');}
    finally{this.replyLoading.set(null);}
  }
  async jump(id:string){
    if(!/^[\da-f-]{36}$/i.test(id))return;
    const request=++this.jumpGeneration;
    let target=this.host.nativeElement.ownerDocument.getElementById('comment-'+id);
    if(!target){
      try{
        const result=await firstValueFrom(this.api.commentContext(this.creatorId(),this.postId(),id));
        if(this.destroyed||request!==this.jumpGeneration)return;
        this.context.set(result.items);
        await new Promise<void>(resolve=>afterNextRender(resolve,{injector:this.injector}));
        target=this.host.nativeElement.ownerDocument.getElementById('comment-'+id);
      }catch{if(!this.destroyed)this.ui.notify('This comment is no longer available.','info');return;}
    }
    if(this.destroyed||request!==this.jumpGeneration||!target)return;
    this.highlight.set(id);target.scrollIntoView({block:'nearest'});target.focus({preventScroll:true});
    clearTimeout(this.highlightTimer);this.highlightTimer=setTimeout(()=>this.highlight.set(null),2400);
  }
  edit(comment:SocialComment){this.editDraft.set(comment.body);this.editing.set(comment.id);}
  reply(comment:SocialComment){if(this.replying()!==comment.id)this.replyDraft.set('');this.replying.set(comment.id);}
  mayDelete(comment:SocialComment){
    const user=this.auth.user();
    return !!user&&[comment.author.id,this.creatorId()].includes(user.id);
  }
  async create(value:string,target:SocialComment|null){
    if(this.working()||!value.trim()||value.length>1000)return;
    const fingerprint=(target?.id??'root')+'\n'+value;
    const key=this.keys.get(fingerprint)??crypto.randomUUID();
    this.keys.set(fingerprint,key);
    this.working.set(target?'reply':'new');
    try{
      const result=await firstValueFrom(this.api.createComment(this.creatorId(),this.postId(),value,target?.id??null,key));
      if(this.destroyed)return;
      this.keys.delete(fingerprint);
      if(!target){
        this.countChange.emit(result.post_comment_count);
        this.draft.set('');
        this.confirmedRoots.update(items=>merge(items,[result]));
      }else{
        const root=this.visibleRoots().find(item=>item.id===(target.root_id??target.id));
        if(root){
          const page=this.links()[root.id]??root.replies??emptyPage();
          if(!this.repliesFor(root).items.some(item=>item.id===result.id)){
            this.transform(root.id,item=>({...item,reply_count:item.reply_count+1}));
          }
          this.links.update(pages=>({...pages,[root.id]:{...page,items:merge(page.items,[result])}}));
        }
        this.replyDraft.set('');this.replying.set(null);
      }
      await new Promise<void>(resolve=>afterNextRender(resolve,{injector:this.injector}));
      if(!this.destroyed)await this.jump(result.id);
    }catch(error){this.ui.notify(errorMessage(error,"Couldn't post your comment. Please try again."),'error');}
    finally{this.working.set(null);}
  }
  async save(comment:SocialComment,value:string){
    if(this.working()||!value.trim()||value.length>1000)return;
    this.working.set(comment.id);
    try{
      const saved=await firstValueFrom(this.api.updateComment(this.creatorId(),this.postId(),comment.id,value,comment.revision));
      if(this.destroyed)return;
      this.transform(comment.id,item=>({...item,...saved}));this.editing.set(null);
    }catch(error){this.ui.notify(errorMessage(error,"Couldn't save your changes."),'error');}
    finally{this.working.set(null);}
  }
  async remove(comment:SocialComment){
    if(this.working())return;
    this.working.set(comment.id);
    try{
      const confirmed=await this.ui.confirm({title:comment.root_id?'Delete reply?':'Delete comment?',
        description:!comment.root_id&&comment.reply_count?'All replies will also be permanently deleted, including replies from other users.':'This message will be permanently deleted.',
        confirmLabel:'Delete',danger:true});
      if(!confirmed||this.destroyed)return;
      await firstValueFrom(this.api.deleteComment(this.creatorId(),this.postId(),comment.id));
      if(this.destroyed)return;
      this.comments.update(items=>items.filter(item=>item.id!==comment.id).map(item=>({...item,
        replies:item.replies?{...item.replies,items:this.cleanDeleted(item.replies.items,comment.id)}:undefined})));
      this.context.update(items=>this.cleanDeleted(items,comment.id));
      this.confirmedRoots.update(items=>this.cleanDeleted(items,comment.id));
      this.links.update(pages=>Object.fromEntries(Object.entries(pages).filter(([key])=>key!==comment.id)
        .map(([key,page])=>[key,{...page,items:this.cleanDeleted(page.items,comment.id)}])));
      if(comment.root_id)this.transform(comment.root_id,item=>({...item,reply_count:Math.max(0,item.reply_count-1)}));
      else this.countChange.emit(Math.max(0,this.commentCount()-1));
    }catch(error){this.ui.notify(errorMessage(error,"Couldn't delete the comment."),'error');}
    finally{this.working.set(null);}
  }
  private cleanDeleted(items:SocialComment[],id:string){
    return items.filter(item=>item.id!==id&&item.root_id!==id).map(item=>item.reply_to?.id===id?{...item,reply_to:null}:item);
  }
  updateReaction(comment:SocialComment,reactions:ReactionSummary){this.transform(comment.id,item=>({...item,reactions}));}
  private transform(id:string,update:(item:SocialComment)=>SocialComment){
    const apply=(item:SocialComment)=>item.id===id?update(item):item;
    this.comments.update(items=>items.map(item=>({...apply(item),replies:item.replies?
      {...item.replies,items:item.replies.items.map(apply)}:undefined})));
    this.context.update(items=>items.map(apply));
    this.confirmedRoots.update(items=>items.map(apply));
    this.links.update(pages=>Object.fromEntries(Object.entries(pages).map(([key,page])=>[key,{...page,items:page.items.map(apply)}])));
  }
}
