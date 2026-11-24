// ALTEGO necesita resolver los avisos, confirmaciones y mensajes de interfaz.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Icon} from './icon';
import {Component,ElementRef,Injectable,ViewChild,inject,signal} from '@angular/core';
import {GlassPanel,VisualButton,VisualModal} from './visual-primitives';

export interface Confirmation {dismissOnBackdrop?:boolean;title:string;description:string;danger?:boolean;confirmLabel?:string;cancelLabel?:string;}
@Injectable({providedIn:'root'})
export class UiFeedback {
  toasts=signal<{id:number;message:string;kind:'success'|'error'|'info';closing:boolean}[]>([]);
  confirmation=signal<Confirmation|null>(null);
  private sequence=0;
  private resolveConfirmation?: (result:boolean)=>void;
  notify(message:string,kind:'success'|'error'|'info'='success'){
    const id=++this.sequence;
    this.toasts.update(list=>[...list.slice(-3),{id,message,kind,closing:false}]);
    setTimeout(()=>this.dismiss(id),5000);
  }
  dismiss(id:number){this.toasts.update(list=>list.map(t=>t.id===id?{...t,closing:true}:t));setTimeout(()=>this.toasts.update(list=>list.filter(t=>t.id!==id)),200);}
  confirm(options:Confirmation){
    if(this.resolveConfirmation)return Promise.resolve(false);
    this.confirmation.set(options);
    return new Promise<boolean>(resolve=>this.resolveConfirmation=resolve);
  }
  answer(value:boolean){const resolve=this.resolveConfirmation;this.resolveConfirmation=undefined;this.confirmation.set(null);resolve?.(value);}
}

@Component({selector:'app-feedback',imports:[Icon,GlassPanel,VisualButton,VisualModal],template:`
  <div class="toast-stack" aria-label="Notifications">
    @for(t of ui.toasts();track t.id){<div appGlass class="toast" [class.toast-error]="t.kind==='error'" [class.toast-success]="t.kind==='success'" [class.toast-closing]="t.closing">
      <span class="toast-symbol" aria-hidden="true"><app-icon [name]="t.kind==='success'?'success':t.kind==='error'?'warning':'info'"/></span>
      <p [attr.role]="t.kind==='error'?'alert':'status'">{{t.message}}</p><button class="icon-control" aria-label="Dismiss notification" (click)="ui.dismiss(t.id)"><app-icon name="close"/></button>
    </div>}
  </div>
  @if(ui.confirmation();as c){<dialog #confirmationDialog appModal class="confirmation-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-description" (cancel)="cancel($event)" (click)="backdrop($event)">
    @if(c.dismissOnBackdrop){<button class="icon-control confirmation-close" style="position:absolute;top:12px;right:12px" type="button" aria-label="Close confirmation" (click)="answer(false)"><app-icon name="close"/></button>}
    <span class="dialog-symbol" [class.warning]="c.danger" aria-hidden="true"><app-icon [name]="c.danger?'warning':'info'"/></span><h2 id="confirm-title">{{c.title}}</h2><p id="confirm-description">{{c.description}}</p>
    <div class="actions"><button appButton autofocus (click)="answer(false)">{{c.cancelLabel||'Cancel'}}</button><button appButton [class.danger]="c.danger" [class.dark]="!c.danger" (click)="answer(true)">{{c.confirmLabel||'Confirm'}}</button></div>
  </dialog>}
`})
export class Feedback {
  ui=inject(UiFeedback);
  private dialog?:HTMLDialogElement;

  @ViewChild('confirmationDialog') set modal(ref:ElementRef<HTMLDialogElement>|undefined){this.dialog=ref?.nativeElement;if(this.dialog&&!this.dialog.open)this.dialog.showModal();}
  answer(value:boolean){this.dialog?.close();this.ui.answer(value);}
  backdrop(event:MouseEvent){if(!this.ui.confirmation()?.dismissOnBackdrop)return;const r=this.dialog?.getBoundingClientRect();if(event.target===this.dialog&&r&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))this.answer(false);}
  cancel(event:Event){event.preventDefault();this.answer(false);}
}
