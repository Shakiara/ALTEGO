// ALTEGO necesita resolver las secciones y métricas de Creator Studio.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import type {StudioVerificationEntry} from "../../core/http/api";
import {Component,DestroyRef,ElementRef,ViewChild,computed,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {firstValueFrom} from 'rxjs';
import {DatePipe,CurrencyPipe} from '@angular/common';
import {RouterLink} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Api,CreatorProfile,StudioSummary,StudioAnalytics,StudioCommunityData,errorMessage} from "../../core/http/api";
import {AuthService} from "../../core/auth/auth-service";
import {GlassPanel,VisualButton,VisualField} from "../../shared/ui/visual-primitives";
import {Icon} from "../../shared/ui/icon";
import {VerificationSettings} from "../../shared/identity/verification-settings";
import {ProfileConversations} from "../../shared/profile/profile-conversations";
@Component({selector:'app-studio-dashboard',imports:[DatePipe,CurrencyPipe,RouterLink,GlassPanel,VisualButton,Icon],templateUrl:'./studio-dashboard.html',styleUrl:'./studio-pages.css'})
export class StudioDashboard{
 auth=inject(AuthService);private api=inject(Api);private destroy=inject(DestroyRef);data=signal<StudioSummary|null>(null);loading=signal(false);error=signal('');
 productMetrics=[{key:'published',label:'Published',icon:'cube'},{key:'pending',label:'Pending Approval',icon:'info'},{key:'rejected',label:'Rejected',icon:'flag'},{key:'removed',label:'Removed by Moderation',icon:'lock'}] as const;
 communityMetrics=[{key:'posts',label:'Posts'},{key:'comments',label:'Comments Written'},{key:'replies',label:'Replies Written'},{key:'followers',label:'Followers'}] as const;
 constructor(){this.load();}load(){this.loading.set(true);this.error.set('');this.api.studioSummary().pipe(takeUntilDestroyed(this.destroy)).subscribe({next:data=>{this.data.set(data);this.loading.set(false);},error:error=>{this.data.set(null);this.error.set(errorMessage(error));this.loading.set(false);}});}
}
@Component({selector:'app-studio-verification',imports:[DatePipe,GlassPanel,VisualButton,VerificationSettings],template:`<div class="verification-workspace"><section appGlass class="studio-panel"><app-verification-settings (statusChanged)="load()"/></section><section appGlass class="studio-panel"><h2>Verification History</h2>@if(error()){<p role="alert">{{error()}}</p><button appButton type="button" (click)="load()">Try Again</button>}@else if(history()===null){<p role="status">Loading history…</p>}@else{<ol class="studio-activity">@for(item of history()!;track item.id){<li><strong class="capitalize">{{item.status}}</strong><time>{{item.submitted_at|date:'medium'}}</time>@if(item.decided_at){<span>Decision · {{item.decided_at|date:'medium'}}</span>}@if(item.rejection_reason||item.revocation_reason){<span>{{(item.revocation_reason||item.rejection_reason)?.replaceAll('_',' ')}}</span>}</li>}@empty{<li class="studio-empty">No verification applications recorded.</li>}</ol>}</section></div>`,styleUrl:'./studio-pages.css'})
export class StudioVerification{private api=inject(Api);private destroy=inject(DestroyRef);history=signal<StudioVerificationEntry[]|null>(null);error=signal('');constructor(){this.load();}load(){this.error.set('');this.api.studioVerificationHistory().pipe(takeUntilDestroyed(this.destroy)).subscribe({next:result=>this.history.set(result.items),error:error=>this.error.set(errorMessage(error))});}}
@Component({selector:'app-studio-community',imports:[FormsModule,DatePipe,RouterLink,GlassPanel,VisualButton,VisualField,ProfileConversations,Icon],templateUrl:'./studio-community.html',styleUrls:['./studio-pages.css','./studio-community.css']})
export class StudioCommunity{
 private api=inject(Api);auth=inject(AuthService);private destroy=inject(DestroyRef);profile=signal<CreatorProfile|null>(null);data=signal<StudioCommunityData|null>(null);error=signal('');loading=signal(false);busy=signal(false);q=signal('');state=signal('all');tab=signal('posts');page=signal(1);@ViewChild(ProfileConversations)conversations?:ProfileConversations;
 rows=computed(()=>this.data()?.posts.filter(post=>post.title.toLowerCase().includes(this.q().toLowerCase())&&(this.state()==='all'||post.state===this.state()))||[]);pages=computed(()=>Math.max(1,Math.ceil(this.rows().length/8)));visible=computed(()=>this.rows().slice((Math.min(this.page(),this.pages())-1)*8,Math.min(this.page(),this.pages())*8));comments=computed(()=>this.data()?.posts.reduce((n,p)=>n+p.comments,0)||0);replies=computed(()=>this.data()?.posts.reduce((n,p)=>n+p.replies,0)||0);reactions=computed(()=>this.data()?.posts.reduce((n,p)=>n+p.reactions,0)||0);
 constructor(){const id=this.auth.user()?.id;if(id)this.api.creator(id).pipe(takeUntilDestroyed(this.destroy)).subscribe({next:profile=>this.profile.set(profile),error:error=>this.error.set(errorMessage(error))});this.load();}
 load(){this.loading.set(true);this.error.set('');this.api.studioCommunity().pipe(takeUntilDestroyed(this.destroy)).subscribe({next:data=>{this.data.set(data);this.loading.set(false);},error:error=>{this.error.set(errorMessage(error));this.loading.set(false);}});}
 async action(id:string,action:'edit'|'delete'|'pin'){if(this.busy())return;this.busy.set(true);try{const post=await firstValueFrom(this.api.conversationPost(this.auth.user()!.id,id).pipe(takeUntilDestroyed(this.destroy)));await this.conversations?.action(action,post);if(action!=='edit')this.load();}catch(error){if(!this.destroy.destroyed)this.error.set(errorMessage(error));}finally{this.busy.set(false);}}
 canLeave(){return this.conversations?.closeComposer()??true;}
}
@Component({selector:'app-studio-analytics',imports:[GlassPanel,VisualButton,RouterLink,Icon],templateUrl:'./studio-analytics.html',styleUrl:'./studio-pages.css'})
export class StudioAnalyticsPage{
 private api=inject(Api);private destroy=inject(DestroyRef);data=signal<StudioAnalytics|null>(null);error=signal('');loading=signal(false);periodOffset=signal(0);
 visibleHistory=computed(()=>{const rows=this.data()?.history||[],end=Math.max(0,rows.length-this.periodOffset()*12);return rows.slice(Math.max(0,end-12),end);});
 periodLabel=computed(()=>{const rows=this.visibleHistory();return rows.length?rows[0].month+' – '+rows.at(-1)!.month:'';});
 hasOlder=computed(()=>this.periodOffset()*12+12<(this.data()?.history.length||0));
 maximum=computed(()=>Math.max(1,...this.visibleHistory().flatMap(p=>[p.products,p.versions,p.posts])));
 @ViewChild('chartScroll')chartScroll?:ElementRef<HTMLElement>;@ViewChild('ledgerScroll')ledgerScroll?:ElementRef<HTMLElement>;
 changePeriod(direction:number){const max=Math.max(0,Math.ceil((this.data()?.history.length||0)/12)-1);this.periodOffset.update(value=>Math.max(0,Math.min(max,value+direction)));requestAnimationFrame(()=>{if(this.destroy.destroyed)return;this.chartScroll?.nativeElement.scrollTo({left:0,behavior:'instant'});this.ledgerScroll?.nativeElement.scrollTo({left:0,top:0,behavior:'instant'});});}
 latest=computed(()=>this.data()?.history.at(-1));
 comparison=computed(()=>{const rows=this.data()?.history||[];if(rows.length<2)return null;const last=rows.at(-1)!,prior=rows.at(-2)!;return {month:prior.month,delta:last.products+last.versions+last.posts-prior.products-prior.versions-prior.posts};});
 publishedShare=computed(()=>{const p=this.data()?.summary.products;return p?.total?Math.round(p.published/p.total*100):0;});
 constructor(){this.load();}load(){this.loading.set(true);this.error.set('');this.api.studioAnalytics().pipe(takeUntilDestroyed(this.destroy)).subscribe({next:data=>{this.periodOffset.set(0);this.data.set(data);this.loading.set(false);},error:error=>{this.error.set(errorMessage(error));this.loading.set(false);}});}
}
