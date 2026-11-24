// ALTEGO necesita resolver el estado compartido de verificación de cuenta.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,DestroyRef,effect,inject,input,output,signal} from '@angular/core';
import {RouterLink} from '@angular/router';
import {DatePipe} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Api,errorMessage} from "../../core/http/api";
import {VerificationStatus,rejectionReasons,revocationReasons} from './verification-types';
import {CreatorBadges,VerifiedCreatorBadge} from './verified-creator-badge';
import {VerificationRequirements} from './verification-requirements';
import {UiFeedback} from "../ui/ui-feedback";
import {VisualButton,VisualField} from "../ui/visual-primitives";

@Component({selector:'app-account-verification',imports:[RouterLink,DatePipe,FormsModule,VisualButton,VisualField,VerifiedCreatorBadge,VerificationRequirements],template:`
 <section class="account-verification">
 @if(loading()){<p role="status">Loading verification…</p>}
 @if(error()){<p role="alert">{{error()}}</p>}
 @if(data();as details){
  <header class="verification-summary"><div class="verification-state"><app-verified-creator-badge [creatorId]="accountId()" [verified]="details.status.state==='verified'"/><strong>{{details.status.state==='verified'?'Verified':'Not Verified'}}</strong>@if(details.status.state==='pending'){<span class="state-tag">Application Pending</span>}</div>@if(details.status.approved_exception){<span class="exception-tag">Administrative Exception</span>}</header>
  @if(showIdentity()){<a class="verification-identity" [routerLink]="['/creators',accountId()]">{{'@'+details.status.profile.username}}</a>}
  @if(details.status.approved_exception;as exception){@if(exception.reason){<p class="exception-summary">{{exception.reason}}</p>}}
  <app-verification-requirements [compact]="true" [showNote]="false" [summarizeExceptions]="true" [metrics]="details.status.metrics" [permanent]="details.status.permanent===true" [exceptions]="details.status.approved_exception?.omitted_requirements||[]"/>
  @if((details.status.state!=='verified'&&(details.status.application?.status!=='pending'||requiresException(details.status)))||details.status.application?.status==='pending'||details.status.application?.status==='approved'){
  <section class="verification-controls" aria-label="Administrative verification actions"><h3>Administrative Actions</h3>
   @if(details.status.state!=='verified'&&(details.status.application?.status!=='pending'||requiresException(details.status))){
    @if(requiresException(details.status)){<label>Exception reason<textarea appField [(ngModel)]="exceptionReason" maxlength="500" rows="2" placeholder="Explain the exception"></textarea></label>}
    <button appButton type="button" [disabled]="busy()||!details.status.administrative_grants_available||(requiresException(details.status)&&!exceptionReason.trim())" (click)="grant()">{{requiresException(details.status)?'Grant Administrative Exception':'Grant Verification'}}</button>
    @if(!details.status.administrative_grants_available){<p>Administrative grants are currently unavailable.</p>}
   }
   @if(details.status.application;as application){@if(application.status==='pending'||application.status==='approved'){
    <label>Decision reason<select appField [(ngModel)]="reason"><option value="">Select a reason</option>@for(item of application.status==='pending'?rejections:revocations;track item[0]){<option [value]="item[0]">{{item[1]}}</option>}</select></label>
    <div class="verification-actions">@if(application.status==='pending'){<button appButton type="button" [disabled]="busy()||!details.status.eligible" (click)="decide('approve')">Approve Verification</button><button appButton type="button" [disabled]="busy()||!reason" (click)="decide('reject')">Reject Application</button>}@else{<button appButton type="button" [disabled]="busy()||!reason" (click)="decide('revoke')">Revoke Verification</button>}</div>
   }}
  </section>}
  @if(details.history.length){<details class="verification-history" open><summary>Verification History <span>{{details.history.length}}</span></summary><ol>@for(entry of details.history;track entry.id){<li><strong>{{entry.status}}</strong><time>{{entry.submitted_at|date:'medium'}}</time></li>}</ol></details>}
 }
 </section>`,styles:`
 :host([hidden]){display:none}:host{display:block;min-width:0}.account-verification{padding:16px;border:1px solid #e4d8e8;border-radius:14px;background:#fff8;min-width:0}.verification-summary{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px}.verification-state{display:flex;align-items:center;gap:8px;font-size:13px}.state-tag,.exception-tag{font-size:10px;line-height:1.5;padding:4px 7px;border-radius:6px;background:#eee6f5;color:#795a85}.exception-tag{background:#f7edda;color:#866b35}.verification-identity{display:inline-block;margin:0 0 12px;font-size:12px}.exception-summary{font-size:12px;line-height:1.6;margin:0 0 14px;color:var(--color-muted);overflow-wrap:anywhere}.verification-controls{display:grid;gap:12px;padding:16px;margin-top:18px;border:1px solid #ddcfe4;border-radius:12px;background:#f6f0f8}.verification-controls h3{font-size:12px;font-weight:600;margin:0}.verification-controls label{display:grid;gap:7px;min-width:0;font-size:11px}.verification-controls :is(select,textarea){margin:0;min-width:0;max-width:100%;font-size:12px;min-height:42px}.verification-controls textarea{height:auto;min-height:64px}.verification-controls button{justify-self:start;min-height:42px;max-width:100%;white-space:normal;font-size:11px;padding:10px 13px}.verification-controls p{font-size:11px;margin:0}.verification-actions{display:flex;gap:8px;flex-wrap:wrap}.verification-history{margin-top:18px;border-top:1px solid #e4d8e8;padding-top:14px;font-size:12px}.verification-history summary{cursor:pointer;font-weight:600}.verification-history summary span{margin-left:8px;font-size:10px;color:var(--color-muted)}.verification-history ol{list-style:none;padding:0;margin:10px 0 0}.verification-history li{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid #eee5f1;font-size:11px}.verification-history strong{text-transform:capitalize;font-weight:500}.verification-history time{color:var(--color-muted)}@media(max-width:400px){.account-verification{padding:12px}.verification-controls{padding:12px}}
 `})
export class AccountVerification{
 ngOnDestroy(){this.data.set(null);}

 verifiedChange=output<boolean>();
 requiresException(status:VerificationStatus){return !status.eligible||!!status.application?.retry_at&&new Date(status.application.retry_at).getTime()>Date.now();}
 showIdentity=input(true);accountId=input.required<number>();private http=inject(HttpClient);private api=inject(Api);private ui=inject(UiFeedback);private badges=inject(CreatorBadges);private destroy=inject(DestroyRef);
 data=signal<{status:VerificationStatus;history:{id:number;status:string;submitted_at:string}[]}|null>(null);loading=signal(false);busy=signal(false);error=signal('');exceptionReason='';reason='';rejections=rejectionReasons;revocations=revocationReasons;
 constructor(){effect(()=>this.load(this.accountId()));}
 load(id:number){this.data.set(null);this.reason='';this.exceptionReason='';this.loading.set(true);this.error.set('');this.http.get<NonNullable<ReturnType<typeof this.data>>>('/api/admin/accounts/'+id+'/verification').pipe(takeUntilDestroyed(this.destroy)).subscribe({next:data=>{if(this.accountId()===id){this.data.set(data);this.loading.set(false);}},error:error=>{if(this.accountId()===id){this.error.set(errorMessage(error));this.loading.set(false);}}});}
 dirty=()=>!!this.reason||!!this.exceptionReason.trim();
 async grant(){const id=this.accountId(),status=this.data()?.status;if(!status||this.busy())return;
 const exception=this.requiresException(status)||!!this.exceptionReason.trim();
 if(!await this.ui.confirm({dismissOnBackdrop:true,title:exception?'Approve Administrative Exception':'Grant Verification',description:exception?'The unmet requirements will be explicitly bypassed and recorded with your reason. Other accounts keep the normal requirements.':'Approve this eligible creator using the standard verification system.',confirmLabel:'Grant Verification',danger:exception}))return;
 if(this.accountId()!==id)return;this.busy.set(true);try{await firstValueFrom(this.http.post('/api/admin/accounts/'+id+'/verification',{confirm:true,...(exception?{exception_reason:this.exceptionReason.trim()}: {})}));await this.badges.refresh();this.verifiedChange.emit(true);this.load(id);this.ui.notify('Verification granted.');}catch(error){this.error.set(errorMessage(error));}finally{this.busy.set(false);}}
 async decide(action:'approve'|'reject'|'revoke'){
  const id=this.accountId(),app=this.data()?.status.application;if(!app||this.busy())return;
  if(!await this.ui.confirm({dismissOnBackdrop:true,title:'Confirm Verification Decision',description:'This decision will update the creator verification history.',danger:true}))return;
  if(this.accountId()!==id||this.data()?.status.application?.id!==app.id)return;
  this.busy.set(true);try{await firstValueFrom(this.api.decideVerification(app.id,action,action==='approve'?undefined:this.reason));await this.badges.refresh();this.verifiedChange.emit(action==='approve');this.reason='';this.load(this.accountId());this.ui.notify('Verification updated.');}catch(error){this.error.set(errorMessage(error));}finally{this.busy.set(false);}
 }
}
