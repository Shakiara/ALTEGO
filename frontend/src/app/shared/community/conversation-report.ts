// ALTEGO necesita resolver el formulario de reporte de contenido.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component, DestroyRef, ElementRef, inject, output, signal, viewChild} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {Api,errorMessage} from "../../core/http/api";
import {UiFeedback} from "../ui/ui-feedback";
import {Icon} from "../ui/icon";
import {VisualButton,VisualModal,VisualField} from "../ui/visual-primitives";
import {reportReasons,type ReportReason} from './community-types';

type Target = {creatorId:number;postId:string;commentId?:string;reporterId:number;productId?:number;reviewId?:string;promotionId?:string};

@Component({
  selector:'app-conversation-report',
  imports:[Icon,VisualButton,VisualModal,VisualField],
  template:`
    <dialog appModal #dialog aria-labelledby="report-content-title" aria-describedby="report-content-question" (cancel)="cancel($event)">
      <form (submit)="submit($event)">
        <header class="report-heading">
          <span class="report-emblem"><app-icon name="flag"/></span>
          <div><h2 id="report-content-title">Report Content</h2>
            <p id="report-content-question">Why are you reporting this content?</p></div>
        </header>
        <div class="report-body">
          <fieldset [disabled]="busy()">
            <legend class="report-sr">Choose a report reason</legend>
            @for(reason of reasons;track reason.id;let first=$first){
              <label class="report-reason">
                <input type="radio" name="report-reason" [value]="reason.id" [attr.autofocus]="first?'':null"
                  [checked]="selected()===reason.id" (change)="selected.set(reason.id)">
                <span class="reason-label">{{reason.label}}</span>
                <span class="reason-indicator" aria-hidden="true"></span>
              </label>
            }
          </fieldset>
          @if(targetIsReview()){<label class="review-report-details">Details (optional)<textarea appField maxlength="500" rows="3" [value]="description()" (input)="description.set($any($event.target).value)" [disabled]="busy()"></textarea></label>}
          @if(error()){<p class="notice error" role="alert">{{error()}}</p>}
        </div>
        <div class="report-actions" role="group" aria-label="Report actions">
          <button appButton type="button" [disabled]="busy()" (click)="cancel()">Cancel</button>
          <button appButton type="submit" [disabled]="busy() || !selected()">{{busy() ? 'Submitting…' : 'Submit Report'}}</button>
        </div>
      </form>
    </dialog>
  `,
  styles:[`
    dialog.glass-panel.ui-modal{position:fixed;inset:0;margin:auto;width:min(26rem,calc(100vw - 1.5rem));max-height:calc(100dvh - 1.5rem);padding:clamp(.75rem,3vw,1.1rem);box-sizing:border-box;overflow:hidden;border:1px solid #dfc7dd;border-radius:1.1rem;background:#faf1f8;box-shadow:0 16px 38px #51354b29}
    dialog[open]{display:flex;flex-direction:column}
    form{display:flex;flex-direction:column;gap:.65rem;min-height:0}
    .report-heading{display:flex;gap:.6rem;align-items:center;flex:none}
    .report-emblem{display:grid;place-items:center;flex:0 0 2rem;height:2rem;border-radius:.65rem;background:#eed8e9;color:var(--color-brand)}
    h2{margin:0;font:500 1.5rem var(--font-display);color:var(--color-brand)}
    .report-heading p{margin:.15rem 0 0;font-size:.83rem;color:var(--color-muted)}
    .report-body{min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px}
    fieldset{display:grid;gap:.25rem;border:0;margin:0;padding:0;min-width:0}
    .report-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .report-reason{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:.5rem;min-height:36px;padding:.28rem .6rem;border:1px solid #e0cbdc;border-radius:.55rem;background:#fff9;cursor:pointer;box-sizing:border-box}
    .report-reason:hover,.report-reason:has(input:checked){background:#f3deee;border-color:#ae77a2}
    .report-reason:has(input:focus-visible){outline:2px solid var(--color-brand);outline-offset:-2px}
    .report-reason input{position:absolute;width:1px;height:1px;opacity:0}
    .reason-label{min-width:0;font-size:.86rem;line-height:1.25;overflow-wrap:anywhere}
    .reason-indicator{display:grid;place-items:center;width:15px;height:15px;border:1px solid #a87b9e;border-radius:50%}
    input:checked~.reason-indicator::after{content:'';width:8px;height:8px;border-radius:50%;background:var(--color-brand)}
    .report-body .notice{margin:.45rem 0 0}
    .report-actions{display:flex;justify-content:flex-end;gap:.45rem;flex:none}
    .report-actions button{min-height:38px;padding:.35rem .65rem}
    .report-actions button[type=submit]:not(:disabled){color:#fff;background:var(--color-brand);border-color:var(--color-brand)}
    .review-report-details{display:grid;gap:6px;margin-top:12px;font-size:13px;color:var(--color-muted)}.review-report-details textarea{resize:vertical;min-height:65px;max-height:140px;width:100%;box-sizing:border-box}
    @media(max-width:360px){.report-actions button{flex:1;font-size:.86rem;white-space:nowrap}}
  `],
})
export class ConversationReport {
  private readonly api=inject(Api);
  private readonly ui=inject(UiFeedback);
  private readonly dialog=viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private target:Target|null=null;
  private trigger:HTMLElement|null=null;
  private scrollState?:{root:HTMLElement;overflow:string};
  readonly submitted=output<Target>();
  readonly reasons=reportReasons;
  readonly selected=signal<ReportReason|null>(null);
  readonly busy=signal(false);readonly description=signal('');readonly targetIsReview=signal(false);
  readonly error=signal('');

  constructor(){inject(DestroyRef).onDestroy(()=>this.unlockScroll());}

  private unlockScroll(){
    if (!this.scrollState) return;
    const {root,overflow}=this.scrollState;
    root.style.overflow=overflow;
    this.scrollState=undefined;
  }

  openReview(reviewId:string,reporterId:number){this.open({creatorId:0,postId:'',reviewId,reporterId});}
  openPromotion(promotionId:string,reporterId:number){this.open({creatorId:0,postId:'',reporterId,promotionId});}
  openProduct(productId:number,reporterId:number){this.open({creatorId:0,postId:'',reporterId,productId});}

  open(target:Target){
    const dialog=this.dialog().nativeElement;
    if (dialog.open) return;
    this.target=target;this.targetIsReview.set(!!target.reviewId);this.description.set('');
    const focused=dialog.ownerDocument.activeElement;
    this.trigger=focused instanceof HTMLElement ? (focused.closest('app-action-menu')?.querySelector<HTMLElement>('.floating-action-trigger')||focused) : null;
    this.selected.set(null);
    this.error.set('');
    dialog.showModal();
    const root=dialog.ownerDocument.documentElement;
    this.scrollState={root,overflow:root.style.overflow};
    root.style.overflow='hidden';
  }

  cancel(event?:Event){
    event?.preventDefault();
    if (this.busy()) return;
    this.dialog().nativeElement.close();
    this.unlockScroll();
    this.target=null;
    this.trigger?.focus({preventScroll:true});
    this.trigger=null;
  }

  async submit(event:Event){
    event.preventDefault();
    const target=this.target,reason=this.selected();
    if (!target || !reason || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try{
      await firstValueFrom(target.reviewId?this.api.reportReview(target.reviewId,reason,this.description()):target.promotionId?this.api.reportPromotion(target.promotionId,reason):target.productId?this.api.reportProduct(target.productId,reason):this.api.reportConversation(target.creatorId,target.postId,reason,target.commentId));
    }catch(error){
      this.error.set(errorMessage(error));
      return;
    }finally{this.busy.set(false);}
    const alternative=this.trigger?.classList.contains('post-report')
      ? this.trigger.closest('article')?.querySelector<HTMLButtonElement>('.copy-link') : null;
    this.cancel();
    alternative?.focus({preventScroll:true});
    this.submitted.emit(target);
    this.ui.notify('Report submitted.');
  }
}
