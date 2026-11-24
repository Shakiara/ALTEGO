// ALTEGO necesita resolver la edición y envío de comentarios y respuestas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {AccountBadges} from "../identity/account-badges";
import {Component,DestroyRef,ElementRef,inject,input,model,output,signal,viewChild} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {Api} from "../../core/http/api";
import {VisualButton,VisualField} from "../ui/visual-primitives";

@Component({
  selector:'app-comment-composer',imports:[AccountBadges,VisualButton,VisualField],
  template:`
    <form class="composer" (submit)="send($event)">
      <textarea #field appField [attr.aria-label]="label()" [placeholder]="label()" [rows]="open()||expanded()?4:1"
        [value]="body()" maxlength="1000" [readOnly]="busy()" (focus)="open.set(true)"
        (input)="change($event)" (click)="find()" (keyup)="refreshCaret($event)" (keydown)="keys($event)"></textarea>
      @if(matches().length){
        <div class="mention-options" role="group" aria-label="Eligible mentions">
          @for(user of matches();track user.id;let i=$index){
            <button type="button" [class.active]="selected()===i" (pointerdown)="$event.preventDefault()" (click)="insert(user.username)">
              <strong>{{user.display_name}} <app-account-badges [creatorId]="user.id" [verified]="user.verified_creator ?? false"/></strong><span>{{'@'+user.username}}</span>
            </button>
          }
        </div>
      }
      @if(open()||expanded()){
        <div class="composer-actions">
          <small aria-live="off">{{body().length}} / 1,000</small>
          <button appButton type="button" [disabled]="busy()" (click)="cancel()">Cancel</button>
          <button appButton type="submit" class="comment-primary" [disabled]="busy()||!body().trim()||body().length>1000">
            {{busy()?'Saving…':submitLabel()}}
          </button>
        </div>
      }
    </form>
  `,
  styles:`
    :host{display:block;min-width:0}.composer{position:relative;display:grid;gap:7px;min-width:0}
    textarea{padding:10px 12px;width:100%;min-width:0;resize:vertical;font:inherit;background:var(--conversation-surface,#fbf9fd)}
    textarea[rows="1"]{resize:none}
    .composer-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:7px}
    .composer-actions small{margin-inline-end:auto}.composer-actions button{min-height:36px;padding:4px 12px}
    .composer-actions .comment-primary{background:var(--conversation-primary,#806b98);color:white}
    .mention-options{position:absolute;z-index:5;top:calc(100% - 36px);inset-inline-start:0;min-width:min(230px,100%);
      max-width:100%;max-height:200px;overflow:auto;padding:4px;border:1px solid var(--conversation-border,#e9e1f0);
      border-radius:12px;background:var(--conversation-surface,#fbf9fd);box-shadow:0 3px 12px #51465c18}
    .mention-options button{display:grid;gap:2px;width:100%;min-height:38px;padding:6px 9px;border:0;border-radius:8px;
      background:transparent;color:inherit;text-align:start;overflow-wrap:anywhere}
    .mention-options button:is(:hover,.active){background:var(--conversation-active,#f0eaf6)}
    .mention-options span{font-size:12px;color:var(--conversation-control,#6b577e)}
  `,
})
export class CommentComposer {
  private api=inject(Api);
  private field=viewChild<ElementRef<HTMLTextAreaElement>>('field');
  body=model('');
  busy=input(false);
  expanded=input(false);
  label=input('Write a comment…');
  submitLabel=input('Post');
  submitted=output<string>();
  canceled=output<void>();
  open=signal(false);
  matches=signal<{id:number;username:string;display_name:string;verified_creator?:boolean}[]>([]);
  selected=signal(0);
  private request=0;
  private timer:ReturnType<typeof setTimeout>|undefined;

  constructor(){inject(DestroyRef).onDestroy(()=>this.clearSuggestions());}
  private active(){
    const field=this.field()?.nativeElement;
    if(!field)return null;
    const caret=field.selectionStart;
    if(caret!==field.selectionEnd)return null;
    const match=/(?<![\p{L}\p{N}_@])@([a-zA-Z0-9_]{0,30})$/u.exec(field.value.slice(0,caret));
    if(!match)return null;
    const rest=/^[a-zA-Z0-9_]*/.exec(field.value.slice(caret))?.[0].length ?? 0;
    return {query:match[1],start:match.index,end:caret+rest};
  }
  change(event:Event){this.body.set((event.target as HTMLTextAreaElement).value);this.find();}
  refreshCaret(event:KeyboardEvent){if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))this.find();}
  find(){
    this.clearSuggestions();
    const active=this.active();
    if(!active)return;
    const request=this.request;
    this.timer=setTimeout(async()=>{
      try{
        const result=await firstValueFrom(this.api.mentionCandidates(active.query));
        if(request===this.request){this.matches.set(result.items);this.selected.set(0);}
      }catch{if(request===this.request)this.matches.set([]);}
    },140);
  }
  keys(event:KeyboardEvent){
    const options=this.matches();
    if(!options.length)return;
    if(event.key==='Escape'){event.stopPropagation();this.clearSuggestions();return;}
    if(event.key==='Enter'&&!event.shiftKey){
      event.preventDefault();this.insert(options[this.selected()].username);return;
    }
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      this.selected.update(i=>(i+(event.key==='ArrowDown'?1:options.length-1))%options.length);
    }
  }
  insert(username:string){
    const token=this.active(),field=this.field()?.nativeElement;
    if(!token||!field)return;
    const before=field.value.slice(0,token.start),after=field.value.slice(token.end);
    const insertion='@'+username+(after&&!/^\s/.test(after)?' ':'');
    const value=before+insertion+(after||' ');
    if(value.length>1000)return;
    this.body.set(value);
    field.value=value;
    field.focus();field.setSelectionRange(before.length+insertion.length+(after?0:1),before.length+insertion.length+(after?0:1));
    this.clearSuggestions();
  }
  send(event:Event){
    event.preventDefault();
    if(!this.busy()&&this.body().trim()&&this.body().length<=1000){this.clearSuggestions();this.submitted.emit(this.body());}
  }
  cancel(){this.clearSuggestions();this.body.set('');this.open.set(false);this.canceled.emit();}
  private clearSuggestions(){this.request++;clearTimeout(this.timer);this.matches.set([]);}
}
