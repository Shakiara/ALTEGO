// ALTEGO necesita resolver la revisión administrativa de verificación de creadores.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {RouterLink} from '@angular/router';
import {AdminDialog} from "../../shared/administration/admin-dialog";
import {DatePipe} from '@angular/common';
import {Component,ElementRef,ViewChild,inject,signal} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {Api,errorMessage} from "../../core/http/api";
import {VerificationEntry,VerificationQueue} from "../../shared/identity/verification-types";
import {AccountVerification} from "../../shared/identity/account-verification";
import {GlassPanel,VisualButton,VisualModal} from "../../shared/ui/visual-primitives";
import {Icon} from "../../shared/ui/icon";

@Component({selector:'app-verification-admin',imports:[RouterLink,AdminDialog,DatePipe,AccountVerification,GlassPanel,VisualButton,VisualModal,Icon],template:`
 <section class="verification-admin"><nav aria-label="Verification queues">@for(item of sections;track item.id){<button appButton type="button" [attr.aria-pressed]="section()===item.id" (click)="select(item.id)">{{item.label}}</button>}</nav>
 @if(error()){<p role="alert">{{error()}}</p><button appButton type="button" (click)="load()">Try Again</button>}
 <section appGlass class="verification-panel"><h2>Creator Applications</h2>
 @if(loading()){<p role="status">Loading applications…</p>}
 @for(item of items();track item.id){<article><div><strong><a [routerLink]="['/creators',item.user_id]">{{item.display_name}} {{'@'+item.username}}</a></strong><p>{{item.status}} · {{item.submitted_at|date:'medium'}}</p></div><button appButton type="button" (click)="open(item.user_id)">Review Account</button></article>}@empty{@if(!loading()&&!error()){<p>No applications in this queue.</p>}}
 @if(cursor()){<button appButton type="button" [disabled]="loading()" (click)="load(true)">Load More</button>}
 </section></section>
 <dialog #drawer appModal appAdminDialog #closer="adminDialog" [adminDirty]="verificationDirty" [adminBusy]="isBusy" (close)="selected.set(null)" class="verification-drawer" aria-labelledby="verification-drawer-title"><header><h2 id="verification-drawer-title">Creator Verification</h2><button class="icon-control" autofocus type="button" aria-label="Close verification" (click)="closer.requestClose()"><app-icon name="close"/></button></header>
 @if(selected();as id){<div class="verification-inner"><app-account-verification [accountId]="id" (verifiedChange)="load()"/></div>}</dialog>
 `,styles:`
 .verification-drawer.ui-modal{overflow:hidden;display:none;flex-direction:column;max-height:calc(100dvh - 32px)}.verification-drawer[open]{display:flex}.verification-inner{overflow:auto;min-height:0;flex:1;overscroll-behavior:contain}.verification-drawer header{flex-shrink:0}:host{display:block;min-width:0}nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}nav button{padding:9px 13px;font-size:12px}nav button[aria-pressed=true]{background:#e9dcf1;border-color:#d5bedf}.verification-panel{padding:24px;border-radius:16px}.verification-panel h2{font-size:17px;letter-spacing:-.3px}.verification-panel article{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 0;border-top:1px solid #e4d7ea}.verification-panel strong{font-size:13px}.verification-panel strong span{font-weight:400;color:var(--color-muted)}p{font-size:12px;margin:6px 0 0}.verification-panel button{font-size:11px;padding:10px 14px}.verification-drawer.ui-modal{position:fixed;inset:16px 16px 16px auto;margin:0;width:min(700px,calc(100% - 32px));max-width:calc(100% - 32px);height:calc(100dvh - 32px);max-height:calc(100dvh - 32px);padding:22px}.verification-drawer header{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:20px}.verification-drawer h2{font-size:22px;letter-spacing:-.5px;margin:0}@media(max-width:520px){.verification-panel{padding:18px}.verification-panel article{flex-wrap:wrap;gap:12px}.verification-drawer.ui-modal{inset:8px;margin:0;width:calc(100% - 16px);max-width:calc(100% - 16px);height:calc(100dvh - 16px);max-height:calc(100dvh - 16px);padding:16px}}
 `})
export class VerificationAdmin{
 private api=inject(Api);section=signal<VerificationQueue>('pending');items=signal<VerificationEntry[]>([]);cursor=signal<number|null>(null);selected=signal<number|null>(null);loading=signal(false);error=signal('');private generation=0;
 @ViewChild(AccountVerification)verification?:AccountVerification;verificationDirty=()=>!!this.verification?.dirty();dirty=this.verificationDirty;isBusy=()=>this.verification?.busy()??false;
 @ViewChild('drawer',{static:true})drawer!:ElementRef<HTMLDialogElement>;
 sections:{id:VerificationQueue;label:string}[]=[{id:'pending',label:'Pending'},{id:'approved',label:'Approved'},{id:'rejected',label:'Rejected'},{id:'verified',label:'Verified Creators'},{id:'history',label:'History'}];
 constructor(){void this.load();}
 select(section:VerificationQueue){this.section.set(section);this.cursor.set(null);void this.load();}
 async load(append=false){const request=++this.generation;this.loading.set(true);this.error.set('');try{const page=await firstValueFrom(this.api.verificationQueue(this.section(),append?this.cursor():null));if(request===this.generation){this.items.update(items=>append?[...items,...page.items]:page.items);this.cursor.set(page.next);}}catch(error){if(request===this.generation)this.error.set(errorMessage(error));}finally{if(request===this.generation)this.loading.set(false);}}
 open(id:number){this.selected.set(id);this.drawer.nativeElement.showModal();}
}
