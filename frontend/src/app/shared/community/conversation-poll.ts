// ALTEGO necesita resolver la presentación y participación en encuestas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {DatePipe} from '@angular/common';
import {Component, computed, effect, inject, input, output, signal} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {Api,errorMessage} from "../../core/http/api";
import {AuthService} from "../../core/auth/auth-service";
import {UiFeedback} from "../ui/ui-feedback";
import {VisualButton} from "../ui/visual-primitives";
import type {ConversationPoll} from './community-types';

@Component({
  selector:'app-conversation-poll',
  imports:[DatePipe,VisualButton],
  template:`
    <section class="conversation-poll" aria-label="Poll">
      <header><strong>Poll</strong><span>{{poll().closed ? 'Closed' : 'Open'}}</span></header>
      <ul aria-label="Poll results">
        @for(option of poll().options; track option.position){
          <li>
            @if(canVote()){
              <button appButton type="button" [attr.aria-pressed]="poll().selected===option.position"
                [attr.aria-disabled]="working()" (click)="vote(option.position)">
                <span>{{option.label}} @if(poll().selected===option.position){<small>· Your vote</small>}</span>
                <span>{{option.votes}} · {{option.percentage}}%</span>
              </button>
            }@else{
              <div class="option-result">
                <span>{{option.label}} @if(poll().selected===option.position){<small>· Your vote</small>}</span>
                <span>{{option.votes}} · {{option.percentage}}%</span>
              </div>
            }
            <progress [value]="option.percentage" max="100" [attr.aria-label]="option.label+' vote percentage'"></progress>
          </li>
        }
      </ul>
      <footer>
        <span aria-live="polite">{{poll().total}} {{poll().total===1 ? 'vote' : 'votes'}}
          · {{poll().closed ? 'Closed' : 'Closes'}} <time [attr.datetime]="poll().ends_at">{{poll().ends_at | date:'medium'}}</time>
        </span>
        @if(owner() && !poll().closed){
          <button appButton type="button" [attr.aria-disabled]="working()" (click)="close()">Close Poll</button>
        }
      </footer>
      @if(error()){<p class="notice error" role="alert">{{error()}}</p>}
    </section>
  `,
  styles:[`
    :host{display:block;min-width:0}
    .conversation-poll{display:grid;gap:.6rem;padding:.75rem;border:1px solid var(--border,#e6ccd9);border-radius:1rem;background:#fff5;min-width:0}
    header,footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.4rem .8rem}
    header span,footer,small{font-size:.85rem}
    ul{list-style:none;display:grid;gap:.4rem;padding:0;margin:0}
    li{display:grid;gap:.2rem;min-width:0}
    button,.option-result{display:flex;justify-content:space-between;gap:.5rem;align-items:center;text-align:left;min-width:0}
    button[aria-pressed=true]{background:#f3d5e7;border-color:#a85a87}
    button span:first-child,.option-result span:first-child{min-width:0;overflow-wrap:anywhere}
    button span:last-child,.option-result span:last-child{white-space:nowrap}
    .option-result{padding:.38rem .65rem}
    progress{width:100%;height:.25rem;border:0;border-radius:1rem;overflow:hidden;appearance:none;color:#a85a87;background:#eedbe7}
    progress::-webkit-progress-bar{background:#eedbe7}
    progress::-webkit-progress-value{background:#a85a87}
    progress::-moz-progress-bar{background:#a85a87}
  `],
})
export class ConversationPollCard {
  readonly poll=input.required<ConversationPoll>();
  readonly creatorId=input.required<number>();
  readonly postId=input.required<string>();
  readonly updated=output<ConversationPoll>();
  private readonly api=inject(Api);
  private readonly auth=inject(AuthService);
  private readonly ui=inject(UiFeedback);
  readonly owner=computed(()=>this.auth.user()?.id===this.creatorId());
  readonly canVote=computed(()=>Boolean(this.auth.user()) && !this.poll().closed);
  readonly working=signal(false);
  readonly error=signal('');

  constructor(){
    effect(onCleanup=>{
      const {closed,remaining_seconds:seconds}=this.poll();
      const creator=this.creatorId(),post=this.postId();
      if (closed || !Number.isFinite(seconds)) return;

      const timer=setTimeout(()=>void this.refresh(creator,post),Math.min(2_147_000_000,Math.max(1200,seconds*1000+250)));
      onCleanup(()=>clearTimeout(timer));
    });
  }

  private async refresh(creator:number,post:string){
    if (this.working()) return;
    try{this.updated.emit(await firstValueFrom(this.api.conversationPoll(creator,post)));}
    catch(error){this.error.set(errorMessage(error));}
  }

  async vote(position:number){
    if (!this.canVote() || this.working() || this.poll().selected===position) return;
    await this.update(()=>firstValueFrom(this.api.voteConversationPoll(this.creatorId(),this.postId(),position)));
  }

  async close(){
    if (!this.owner() || this.poll().closed || this.working()) return;
    await this.update(async()=>{
      const confirmed=await this.ui.confirm({title:'Close poll?',description:'Voting will end immediately. The poll cannot be reopened.',confirmLabel:'Close Poll'});
      return confirmed ? firstValueFrom(this.api.closeConversationPoll(this.creatorId(),this.postId())) : null;
    });
  }

  private async update(run:()=>Promise<ConversationPoll|null>){
    this.working.set(true);
    this.error.set('');
    try{
      const poll=await run();
      if (poll) this.updated.emit(poll);
    }catch(error){
      this.error.set(errorMessage(error));
    }finally{
      this.working.set(false);
      if (this.error()) await this.refresh(this.creatorId(),this.postId());
    }
  }
}
