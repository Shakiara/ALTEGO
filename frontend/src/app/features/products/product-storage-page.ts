// ALTEGO necesita resolver la consulta de recursos y uso de Storage del creador.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,DestroyRef,inject,signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {GlassPanel,VisualButton} from "../../shared/ui/visual-primitives";
import {Api,errorMessage,ProductStorageSummary} from "../../core/http/api";
export function storageBytes(value:number|null){if(value===null)return 'Unlimited';if(value<1024)return value+' B';if(value<1048576)return (value/1024).toFixed(1)+' KB';if(value<1073741824)return (value/1048576).toFixed(2)+' MB';return (value/1073741824).toFixed(2)+' GB';}
@Component({selector:'app-product-storage',imports:[GlassPanel,VisualButton],template:`
 <section class="storage-heading"><h2>Product Storage</h2><button appButton type="button" [disabled]="loading()" (click)="load()">Refresh</button></section>
 @if(error()){<p role="alert">{{error()}}</p>}
 @if(loading()&&!data()){<p role="status">Loading storage…</p>}
 @if(data();as storage){
 <section appGlass class="storage-overview" aria-label="Product storage usage">
  <div class="storage-plan">{{storage.plan}}<span>{{format(storage.used_bytes)}} used</span></div>
  <div class="storage-metrics"><div><span>Storage Used</span><strong>{{format(storage.used_bytes)}}</strong></div><div><span>Storage Available</span><strong>{{format(storage.available_bytes)}}</strong></div><div><span>Storage Limit</span><strong>{{format(storage.limit_bytes)}}</strong></div><div><span>Usage Percentage</span><strong>{{storage.usage_percentage===null?'—':storage.usage_percentage+'%'}}</strong></div></div>
  @if(storage.limit_bytes!==null){<div class="storage-meter" role="progressbar" aria-label="Storage used" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="percent(storage.usage_percentage)" [attr.aria-valuetext]="format(storage.used_bytes)+' of '+format(storage.limit_bytes)"><span [style.width.%]="percent(storage.usage_percentage)"></span></div>}
  @if(storage.limit_bytes!==null&&storage.used_bytes>storage.limit_bytes){<div class="storage-warning" role="status"><strong>Storage Limit Exceeded</strong><p>{{format(storage.used_bytes)}} used · {{format(storage.limit_bytes)}} allowed. Free {{format(storage.used_bytes-storage.limit_bytes)}} to upload more.</p></div>}@else if(storage.limit_bytes!==null&&storage.used_bytes>=storage.limit_bytes){<p class="storage-warning" role="status">Storage limit reached. Existing items remain available.</p>}@else if(storage.limit_bytes!==null&&storage.used_bytes*100>=storage.limit_bytes*80){<p class="storage-warning" role="status">Storage is almost full. {{format(storage.available_bytes)}} available.</p>}
 </section>
 <section class="storage-breakdown" aria-label="Storage breakdown">
  @for(group of groups;track group.key){<article appGlass><span class="storage-dot" [style.background]="group.color"></span><h3>{{group.label}}</h3><strong>{{format(storage.breakdown[group.key])}}</strong></article>}
 </section>
 
 }
 `,styleUrl:'./product-storage-page.css'})
export class ProductStoragePage{
 private api=inject(Api);private destroy=inject(DestroyRef);data=signal<ProductStorageSummary|null>(null);loading=signal(false);error=signal('');format=storageBytes;
 groups=[{key:'published',label:'Published Products',color:'#d8afc5'},{key:'drafts_unpublished',label:'Drafts & Unpublished',color:'#bdb3dc'},{key:'recoverable',label:'Recoverable Products',color:'#c9daca'}] as const;
 constructor(){this.load();}percent(value:number|null){return Math.max(0,Math.min(100,value||0));}
 load(){this.loading.set(true);this.error.set('');this.api.productStorage().pipe(takeUntilDestroyed(this.destroy)).subscribe({next:data=>{this.data.set(data);this.loading.set(false);},error:error=>{this.error.set(errorMessage(error));this.loading.set(false);}});}
}
