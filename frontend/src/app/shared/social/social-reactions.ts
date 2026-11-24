// ALTEGO necesita resolver las reacciones y su estado compartido.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {CreatorBadges} from "../identity/verified-creator-badge";
import {Component,ElementRef,computed,effect,inject,input,output,signal,viewChild} from '@angular/core';
import {Router} from '@angular/router';
import {firstValueFrom,Observable} from 'rxjs';
import {Api} from "../../core/http/api";
import {AuthService} from "../../core/auth/auth-service";
import {Reaction,ReactionSummary,reactions} from './social-types';
import {UiFeedback} from "../ui/ui-feedback";

@Component({
  selector:'app-social-reactions',host:{'[class.compact-reactions]':'compactPicker()'},
  template:`
    <div class="reaction-actions" (keydown.escape)="escape($event)">
      <div class="reaction-picker" (pointerenter)="enter($event)" (pointerleave)="leave($event)">
        <button #picker type="button" class="emoji-control" [attr.aria-label]="compactPicker()?'Choose reaction':'Quick Like; press Arrow Down to choose a reaction'"
          [attr.title]="compactPicker()?'Reactions':'Quick Like · Arrow Down for reactions'" aria-keyshortcuts="ArrowDown"
          [attr.aria-pressed]="display().mine==='like'" [attr.aria-expanded]="panel()==='pick'" [attr.aria-disabled]="busy()"
          (keydown)="pickerKey($event)" (pointerdown)="startPress($event)" (pointermove)="movePress($event)"
          (pointerup)="cancelPress()" (pointercancel)="cancelPress()"
          (contextmenu)="preventLongPressMenu($event)" (click)="primaryClick()">
          <span aria-hidden="true">{{currentEmoji()}}</span>
        </button>
        @if(panel()==='pick'){
          <div #choices class="reaction-popover picker-panel" role="group" aria-label="Choose reaction">
            <div class="reaction-options">
              @for(option of selectableOptions();track option[0]){
                <button type="button" [title]="option[2]" [attr.aria-label]="option[2]"
                  [attr.aria-pressed]="display().mine===option[0]" [disabled]="busy()"
                  (click)="choose(option[0])"><span aria-hidden="true">{{option[1]}}</span></button>
              }
            </div>
            @if(notice()){<p role="status">{{notice()}}</p>}
          </div>
        }
      </div>
      <div class="reaction-extra"><ng-content/></div>
      <div class="reaction-summary">
        <button #summaryButton type="button" [attr.aria-expanded]="panel()==='breakdown'"
          [attr.aria-label]="display().total+' reactions, view breakdown'" (click)="toggleBreakdown($event)">
          @for(option of top();track option[0]){<span class="summary-emoji" aria-hidden="true">{{option[1]}}</span>}
          <span>{{display().total}}</span>
        </button>
        @if(panel()==='breakdown'){
          <div #choices class="reaction-popover breakdown" tabindex="-1" role="group" aria-label="Reaction counts">
            @for(option of options;track option[0]){
              <div><span aria-hidden="true">{{option[1]}}</span> {{option[2]}} <strong>{{display().counts[option[0]]}}</strong></div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles:`
    :host{display:block;min-width:0;--social-ink:var(--conversation-text,#51465c);--social-surface:var(--conversation-surface,#fbf9fd);
      --social-edge:var(--conversation-border,#e9e1f0);--social-focus:var(--conversation-control,#6b577e)}
    .reaction-actions,.reaction-picker{display:flex;align-items:center;gap:3px;min-width:0}
    .reaction-picker,.reaction-summary{position:relative}
    button{cursor:pointer;background:transparent;border:0;color:var(--social-focus);border-radius:8px;padding:4px 5px;min-height:36px}
    button:focus-visible{outline:2px solid var(--social-focus);outline-offset:-2px}
    .emoji-control{min-width:34px;font-size:16px}
    .emoji-control[aria-pressed=true],.reaction-options button[aria-pressed=true],button:hover:not(:disabled){background:var(--conversation-active,#f0eaf6)}
    .reaction-extra{display:contents}
    :host(.compact-reactions) .reaction-extra{display:flex;align-items:center;gap:3px;margin-left:auto;order:2}
    :host(.compact-reactions) .reaction-summary{order:1;margin-inline-start:0}
    :host(.compact-reactions) .summary-emoji{display:none}
    .reaction-summary{margin-inline-start:auto}
    .reaction-summary button{display:flex;align-items:center;gap:3px;white-space:nowrap;font-size:13px}
    .reaction-popover{position:absolute;z-index:4;bottom:100%;min-width:170px;padding:7px;border:1px solid var(--social-edge);
      border-radius:12px;background:var(--social-surface);color:var(--social-ink);box-shadow:var(--conversation-shadow,0 3px 12px #51465c18)}
    .reaction-popover.below{bottom:auto;top:100%}
    .picker-panel{inset-inline-start:0;width:max-content;max-width:min(310px,calc(100vw - 76px))}
    .reaction-options{display:grid;grid-template-columns:repeat(8,minmax(31px,1fr));gap:2px}
    .reaction-options button{font-size:19px;padding:4px}
    .reaction-popover p{font-size:12px;margin:4px 3px 2px;max-width:230px}
    .breakdown{inset-inline-end:0;display:grid;gap:4px;font-size:13px}
    .breakdown div{display:flex;gap:6px}.breakdown strong{margin-inline-start:auto}
    @media(max-width:520px){.reaction-options{grid-template-columns:repeat(4,minmax(34px,1fr))}.emoji-control{min-width:38px;min-height:40px}}
    @media(prefers-reduced-motion:no-preference){.reaction-options button[aria-pressed=true]{animation:soft-pop .2s ease-out}}
    @keyframes soft-pop{50%{transform:scale(1.12)}}
  `,
})
export class SocialReactions {
  private api=inject(Api);
  private auth=inject(AuthService);
  private router=inject(Router);
  private ui=inject(UiFeedback);
  private host=inject(ElementRef<HTMLElement>);
  private picker=viewChild<ElementRef<HTMLButtonElement>>('picker');
  private summaryButton=viewChild<ElementRef<HTMLButtonElement>>('summaryButton');
  private choices=viewChild<ElementRef<HTMLElement>>('choices');
  compactPicker=input(false);
  saveReaction=input<((reaction:Reaction|null)=>Observable<ReactionSummary>)|null>(null);
  creatorId=input.required<number>();
  postId=input.required<string>();
  commentId=input<string|null>(null);
  summary=input.required<ReactionSummary>();
  updated=output<ReactionSummary>();
  private badges=inject(CreatorBadges);
  options=reactions;
  selectableOptions=computed(()=>this.badges.read(this.auth.user()?.id ?? 0)===true ? reactions : reactions.slice(0,6));
  panel=signal<'pick'|'breakdown'|null>(null);
  busy=signal(false);
  notice=signal('');
  private optimistic=signal<ReactionSummary|null>(null);
  display=computed(()=>this.optimistic() ?? this.summary());
  currentEmoji=computed(()=>reactions.find(option=>option[0]===this.display().mine)?.[1] ?? '👍');
  top=computed(()=>reactions.filter(item=>this.display().counts[item[0]]>0)
    .sort((a,b)=>this.display().counts[b[0]]-this.display().counts[a[0]]).slice(0,3));
  private hoverTimer:ReturnType<typeof setTimeout>|undefined;
  private pressTimer:ReturnType<typeof setTimeout>|undefined;
  private pressOrigin:{id:number;x:number;y:number}|undefined;
  private held=false;
  private hover=false;
  private focusPanel=false;

  constructor(){
    effect(cleanup=>cleanup(this.badges.watch(this.auth.user()?.id ?? 0)));
    effect(cleanup=>{
      if (!this.panel()) return;
      const node=this.choices()?.nativeElement;
      if (!node) return;
      node.classList.toggle('below',(node.parentElement?.getBoundingClientRect().top ?? 0)<node.offsetHeight);
      if (this.focusPanel) {
        (node.querySelector('button') ?? node).focus({preventScroll:true});
        this.focusPanel=false;
      }
      const doc=node.ownerDocument;
      const outside=(event:Event)=>{if (!event.composedPath().includes(this.host.nativeElement)) this.close();};
      doc.addEventListener('click',outside);
      cleanup(()=>doc.removeEventListener('click',outside));
    });
    effect(cleanup=>cleanup(()=>{clearTimeout(this.hoverTimer);clearTimeout(this.pressTimer);}));
  }

  toggleBreakdown(event:MouseEvent){
    if(this.panel()==='breakdown'){this.close();return;}
    this.close();
    this.focusPanel=event.detail===0;
    this.panel.set('breakdown');
  }
  primaryClick(){if(this.compactPicker()){if(this.panel()==='pick'){this.close();return;}this.focusPanel=true;this.panel.set('pick');}else this.quickLike();}
  pickerKey(event:KeyboardEvent){
    if(event.key==='Enter'||event.key===' ')this.held=false;
    if(event.key!=='ArrowDown')return;
    event.preventDefault();
    clearTimeout(this.hoverTimer);
    this.hover=false;
    if(this.panel()==='pick'){
      this.choices()?.nativeElement.querySelector('button')?.focus({preventScroll:true});
    }else{
      this.focusPanel=true;
      this.notice.set('');
      this.panel.set('pick');
    }
  }
  enter(event:PointerEvent){
    if(this.compactPicker())return;
    if (event.pointerType!=='mouse'||!matchMedia('(hover:hover)').matches) return;
    clearTimeout(this.hoverTimer);
    if (!this.panel()){this.hover=true;this.panel.set('pick');}
  }
  leave(event:PointerEvent){
    if(event.pointerType==='mouse'&&this.hover)this.hoverTimer=setTimeout(()=>this.close(),150);
  }
  startPress(event:PointerEvent){
    if(this.compactPicker())return;
    if(!event.isPrimary)return;
    this.held=false;
    this.cancelPress();
    if(event.pointerType==='mouse')return;
    this.pressOrigin={id:event.pointerId,x:event.clientX,y:event.clientY};
    this.pressTimer=setTimeout(()=>{
      this.held=true;
      clearTimeout(this.hoverTimer);
      this.hover=false;
      this.notice.set('');
      this.panel.set('pick');
    },450);
  }
  movePress(event:PointerEvent){
    const origin=this.pressOrigin;
    if(origin&&event.pointerId===origin.id&&Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>12)this.cancelPress();
  }
  cancelPress(){
    clearTimeout(this.pressTimer);
    this.pressTimer=undefined;
    this.pressOrigin=undefined;
  }
  preventLongPressMenu(event:Event){if(this.held||this.pressTimer)event.preventDefault();}
  escape(event:Event){
    if(!this.panel())return;
    event.preventDefault();event.stopPropagation();
    const button=this.panel()==='pick'?this.picker():this.summaryButton();
    this.close();button?.nativeElement.focus({preventScroll:true});
  }
  private close(){clearTimeout(this.hoverTimer);this.hover=false;this.focusPanel=false;this.panel.set(null);this.notice.set('');}
  quickLike(){if(this.held){this.held=false;return;}void this.set('like',false);}
  choose(reaction:Reaction){void this.set(this.display().mine===reaction?null:reaction,true);}
  private async set(reaction:Reaction|null,fromPicker:boolean){
    if (!this.auth.user()){void this.router.navigate(['/login'],{queryParams:{returnUrl:this.router.url}});return;}
    if(this.busy() || reaction===this.display().mine)return;
    const before=this.display(),next={counts:{...before.counts},total:before.total,mine:reaction};
    if(before.mine){next.counts[before.mine]--;next.total--;}
    if(reaction){next.counts[reaction]++;next.total++;}
    if(reaction!=='adore'&&reaction!=='fire')this.optimistic.set(next);
    this.busy.set(true);this.notice.set('');
    try{
      const saved=await firstValueFrom(this.saveReaction()?.(reaction)??this.api.setReaction(this.creatorId(),this.postId(),this.commentId(),reaction));
      this.updated.emit(saved);
      if(fromPicker){this.close();this.picker()?.nativeElement.focus({preventScroll:true});}
    }catch(error){
      if((error as {error?:{code?:string}}).error?.code==='VERIFIED_REACTION_REQUIRED'){
        clearTimeout(this.hoverTimer);this.hover=false;this.panel.set('pick');
        this.notice.set('Adore and Fire reactions are exclusive to Verified accounts.');
      } else this.ui.notify("Couldn't update your reaction. Please try again.",'error');
    }finally{this.optimistic.set(null);this.busy.set(false);}
  }
}
