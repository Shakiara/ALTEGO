// ALTEGO necesita resolver la consulta de opciones de verificación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {DatePipe} from '@angular/common';
import {Component,DestroyRef,inject,output,signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {ActivatedRoute,Router} from '@angular/router';
import {firstValueFrom} from 'rxjs';
import {Api,errorMessage} from "../../core/http/api";
import {UiFeedback} from "../ui/ui-feedback";
import {VisualButton} from "../ui/visual-primitives";
import {VerifiedCreatorBadge} from './verified-creator-badge';
import {VerificationRequirements} from './verification-requirements';
import {decisionReason,type VerificationStatus} from './verification-types';

@Component({
  selector:'app-verification-settings',
  imports:[DatePipe,VisualButton,VerificationRequirements,VerifiedCreatorBadge],
  styles:`:host{display:block;min-width:0}.verification-benefits h3{font-size:calc(12px * var(--studio-type-scale,1));font-weight:600;margin:calc(14px * var(--studio-scale,1)) 0 calc(8px * var(--studio-scale,1))}.verification-privileges{display:flex;flex-wrap:wrap;gap:calc(6px * var(--studio-scale,1));padding:0;list-style:none;margin:calc(12px * var(--studio-scale,1)) 0 calc(18px * var(--studio-scale,1))}.verification-privileges li{font-size:calc(11px * var(--studio-type-scale,1));line-height:1.6;padding:calc(4px * var(--studio-scale,1)) calc(8px * var(--studio-scale,1));background:#ffffff70;border:1px solid #e4d8e8;border-radius:calc(7px * var(--studio-scale,1))}`,
  template:`
    @if(loading()){<p role="status">Loading verification…</p>}
    @if(error()){<p role="alert" class="notice error">{{error()}}</p><button appButton type="button" (click)="load()">Retry</button>}
    @if(status();as data){
      <div aria-live="polite">
        @switch(data.state){
          @case('verified'){<p><app-verified-creator-badge [creatorId]="data.profile.id" [verified]="true"/> <strong>You're a Verified Creator!</strong></p>}
          @case('pending'){<p><strong>Application Under Review</strong></p><button appButton disabled>Apply for Verification</button>}
          @case('eligible'){<p><strong>Eligible</strong></p><button appButton type="button" [disabled]="saving()" (click)="apply()">Apply for Verification</button>}
          @case('rejected'){<p><strong>Rejected</strong></p>}
          @case('revoked'){<p><strong>Revoked</strong></p>}
          @default{<p><strong>Not Eligible</strong></p>}
        }
      </div>
      <section class="verification-benefits" aria-label="Verified Creator benefits"><h3>Benefits</h3><ul class="verification-privileges"><li>Adore and Fire reactions.</li><li>Up to 8 images per post.</li><li>Direct publication when moderation rules allow.</li></ul></section>
      @if(data.approved_exception;as exception){<p class="notice">Approved administrative exception.</p>}
      <app-verification-requirements [metrics]="data.metrics" [permanent]="data.permanent===true" [exceptions]="data.approved_exception?.omitted_requirements||[]"/>
      @if(data.application;as item){
        <p>Last application · {{item.submitted_at | date:'medium'}}</p>
        @if(item.decided_at){<p>Decision · {{item.status}} · {{item.decided_at | date:'medium'}}</p>}
        @if(item.revoked_at){<p>Revoked · {{item.revoked_at | date:'medium'}}</p>}
        @if(reason(item);as detail){<p>{{detail}}</p>}
        @if(item.retry_at){<p>Eligible to reapply from {{item.retry_at | date:'medium'}} if you meet the requirements.</p>}
      }
    }
  `,
})
export class VerificationSettings {
  readonly statusChanged=output<void>();
  private readonly api=inject(Api);
  private readonly ui=inject(UiFeedback);
  private readonly route=inject(ActivatedRoute);
  private readonly router=inject(Router);
  private readonly destroy=inject(DestroyRef);
  private linkRequested=false;
  readonly reason=decisionReason;
  readonly status=signal<VerificationStatus|null>(null);
  readonly loading=signal(false);
  readonly saving=signal(false);
  readonly error=signal('');

  constructor(){
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params=>{
      if(params.get('apply')==='1'){
        this.linkRequested=true;
        this.openFromLink();
      }
    });
    void this.load();
    const refresh=setInterval(()=>{if(!this.saving()&&!document.hidden)void this.load(false);},30_000);
    this.destroy.onDestroy(()=>clearInterval(refresh));
  }

  async load(showProgress=true){
    if(this.loading())return;
    this.loading.set(true);
    if(showProgress)this.error.set('');
    try{
      const status=await firstValueFrom(this.api.verificationStatus());
      if(this.destroy.destroyed)return;
      this.status.set(status);
      this.statusChanged.emit();
      this.openFromLink();
    }catch(error){this.error.set(errorMessage(error));}
    finally{this.loading.set(false);}
  }

  private openFromLink(){
    const status=this.status();
    if(!this.linkRequested || !status)return;
    this.linkRequested=false;
    void this.router.navigate([], {relativeTo:this.route,queryParams:{apply:null},queryParamsHandling:'merge',replaceUrl:true});
    if(status.canApply)void this.apply();
  }

  async apply(){
    const status=this.status();
    if(!status?.canApply || this.saving())return;
    this.saving.set(true);
    try{
      const criterion=status.metrics.salesCents!>50000 ? 'simulated sales over $500' : 'at least 1,000 approved items';
      const confirmed=await this.ui.confirm({
        title:'Apply for Verification',
        description:'You are eligible with '+criterion+', an active account, a complete profile, at least 30 days on ALTEGO and no active sanctions. You cannot cancel after submitting.',
        cancelLabel:'Back',confirmLabel:'Submit Application',
      });
      if(!confirmed || this.destroy.destroyed)return;
      this.status.set(await firstValueFrom(this.api.applyForVerification()));
      this.statusChanged.emit();
      this.ui.notify('Application Submitted');
    }catch(error){
      await this.load();
      this.error.set(errorMessage(error));
    }finally{this.saving.set(false);}
  }
}
