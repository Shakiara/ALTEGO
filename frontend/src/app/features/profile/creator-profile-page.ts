// ALTEGO necesita resolver las secciones e interacciones del perfil público.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {FollowActions} from "../../shared/social/follow-actions";
import {SocialLists} from "../../shared/social/social-lists";
import {BlockActions} from "../../shared/social/block-actions";
import {ProfileConversations} from "../../shared/profile/profile-conversations";
import {ProfileEditState} from "../../shared/profile/profile-edit-state";
import {ProfileAboutEditor} from "../../shared/profile/profile-about-editor";
import {ProfileImageSelector} from "../../shared/profile/profile-image-selector";
import {Icon} from "../../shared/ui/icon";
import {Component,HostListener,OnDestroy,ViewChild,computed,effect,inject,signal} from '@angular/core';
import {ActivatedRoute,Router,RouterLink} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {firstValueFrom,catchError,distinctUntilChanged,map,of,switchMap} from 'rxjs';
import {Api,CreatorProfile,errorMessage} from "../../core/http/api";
import {AuthService} from "../../core/auth/auth-service";
import {ProductCard} from "../../shared/products/product-card";
import {ProfileAction,ProfilePanel} from "../../shared/profile/profile-panel";
import {GlassPanel} from "../../shared/ui/visual-primitives";
import {UiFeedback} from "../../shared/ui/ui-feedback";
export type ProfileSection='collection'|'conversations'|'about';
@Component({selector:'app-creator-page',providers:[ProfileEditState],imports:[SocialLists,GlassPanel,ProductCard,ProfilePanel,ProfileAboutEditor,ProfileImageSelector,ProfileConversations,Icon,RouterLink],template:`
 @if(loading()){<section appGlass class="empty" role="status">Loading profile…</section>}@else if(error()){<section appGlass class="empty" role="alert"><h1>{{missingLinkedPost() ? "Post Not Found" : "Creator unavailable"}}</h1><p>{{error()}}</p><a class="button" routerLink="/">Back to the collection</a></section>}@else if(profile();as p){
  <app-profile-panel [profile]="displayProfile()!" [editing]="editor.active()" [saving]="editor.busy()||pinBusy()" (nameEdit)="editor.update({display_name:$event})" (imageEdit)="chooseImage($event)" (listOpen)="lists?.show($event)" [blocked]="blockingState()?.blocked??null" [blockBusy]="blockActions.busy()" [followBusy]="followBusy()" [socialRestricted]="blockingState()?.social_restricted===true" [own]="own()" [signedIn]="!!auth.user()" [sessionReady]="!auth.loading()" (action)="profileAction($event)"/>
  <app-social-lists [ownerId]="p.id" [ownerUsername]="p.username"/>
  <nav class="profile-navigation" role="tablist" aria-label="Profile sections">
   @for(item of sections;track item.id){<button type="button" role="tab" [id]="'profile-tab-'+item.id" [attr.data-profile-section]="item.id" [attr.aria-selected]="section()===item.id" [attr.aria-controls]="'profile-'+item.id" [attr.tabindex]="section()===item.id?0:-1" (click)="selectSection(item.id)" (keydown)="sectionKey($event,item.id)">{{item.label}}</button>}
  </nav>
  @for(item of sections;track item.id){<section [id]="'profile-'+item.id" role="tabpanel" [attr.aria-labelledby]="'profile-tab-'+item.id" [hidden]="section()!==item.id" tabindex="0" class="profile-content">
   @switch(item.id){
    @case('collection'){
     <h2 class="profile-title">The collection</h2><div class="product-grid">@for(product of displayProfile()!.products;track product.id){<app-product-card [product]="product" [pinned]="displayProfile()!.pinned_item?.id===product.id" [canPin]="own()&&!editor.active()" [pinBusy]="pinBusy()" (pinToggle)="togglePin(product.id)"/>}@empty{<div appGlass class="profile-placeholder"><h3>No published items yet.</h3><p>This creator's public collection will appear here.</p></div>}</div>
    }
    @case('conversations'){@if(section()==='conversations'){<app-profile-conversations [profile]="p"/>}}
    @case('about'){@if(editor.active()){<app-profile-about-editor (save)="saveProfile()" (cancel)="cancelEdit()"/>}@else{
     <div appGlass class="profile-about profile-about-surface"><div class="about-heading"><h2>About</h2></div><div class="about-content">
      <section class="about-bio"><h3>Bio</h3><p class="profile-about-bio">{{p.bio||'No bio yet.'}}</p></section>
      <section class="about-socials"><h3>Socials</h3>@if(p.public_links.length){<div class="profile-socials">@for(link of p.public_links;track link.id){<a [href]="link.url" target="_blank" rel="noopener noreferrer nofollow" [title]="link.label"><app-icon [name]="link.platform==='custom'?'link':link.platform"/><span>{{link.label}}</span></a>}</div>}@else{<p class="field-help">No social links yet.</p>}</section>
     </div></div>
    }}

   }
  </section>}
  @if(editor.active()){<app-profile-image-selector/>}
 }
`,styleUrls:['./creator-page.css',"../../shared/profile/profile-about-layout.css"]})
export class CreatorProfilePage implements OnDestroy {
 followActions=inject(FollowActions);@ViewChild(SocialLists)lists?:SocialLists;
 blockActions=inject(BlockActions);blockingState=signal<import("../../core/http/api").BlockState|null>(null);private blockRequest=0;
 private api=inject(Api);private route=inject(ActivatedRoute);private router=inject(Router);private ui=inject(UiFeedback);auth=inject(AuthService);editor=inject(ProfileEditState);
 @ViewChild(ProfileImageSelector)imageSelector?:ProfileImageSelector;
 @ViewChild(ProfileConversations)private conversations?:ProfileConversations;
 missingLinkedPost=signal(false);
 displayProfile=computed(()=>this.editor.active()?this.editor.preview():this.profile());
 pinBusy=signal(false);followBusy=signal(false);private pinRequest=0;private followRequest=0;
 loading=signal(true);error=signal('');profile=signal<CreatorProfile|null>(null);section=signal<ProfileSection>('collection');private profileId=computed(()=>this.profile()?.id);own=computed(()=>!!this.profile()&&this.auth.user()?.id===this.profile()!.id);
 readonly sections:{id:ProfileSection;label:string}[]=[{id:'collection',label:'Collection'},{id:'conversations',label:'Conversations'},{id:'about',label:'About'}];
 constructor(){
  this.followActions.changes.pipe(takeUntilDestroyed()).subscribe(change=>{const owner=this.profile()?.id,actor=this.auth.user()?.id;if(!owner||actor!==change.actor)return;this.api.creator(owner).subscribe({next:fresh=>{if(owner===this.profile()?.id&&actor===this.auth.user()?.id)this.profile.update(p=>p?{...p,stats:fresh.stats,viewer_follows:fresh.viewer_follows,follow_required:fresh.follow_required}:p);},error:()=>{}});});
  effect(()=>{const actor=this.auth.user()?.id,target=this.profileId();this.blockingState.set(null);const generation=++this.blockRequest;if(actor&&target&&actor!==target)this.api.blockState(target).subscribe({next:value=>{if(generation===this.blockRequest&&this.auth.user()?.id===actor)this.blockingState.set(value);},error:()=>{if(generation===this.blockRequest)this.blockingState.set(null);}});});
  this.blockActions.changes.pipe(takeUntilDestroyed()).subscribe(change=>{if(change.actor_id===this.auth.user()?.id&&change.user_id===this.profile()?.id)this.blockingState.set({...this.blockingState(),user_id:change.user_id,blocked:change.blocked,social_restricted:change.blocked||this.blockingState()?.social_restricted===true});});
  this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params=>{const value=params.get('section');this.section.set(this.sections.some(s=>s.id===value)?value as ProfileSection:'collection');});
  this.route.paramMap.pipe(map(params=>Number(params.get('id'))),distinctUntilChanged(),switchMap(id=>{this.pinRequest++;this.followRequest++;this.pinBusy.set(false);this.followBusy.set(false);this.loading.set(true);this.error.set('');this.missingLinkedPost.set(false);this.profile.set(null);return this.api.creator(id).pipe(catchError(error=>{this.missingLinkedPost.set(error.status===404&&this.route.snapshot.queryParamMap.has('post'));this.error.set(errorMessage(error));return of(null);}));}),takeUntilDestroyed()).subscribe(profile=>{if(this.editor.active())this.editor.clear();this.profile.set(profile);this.loading.set(false);});
 }
 async selectSection(section:ProfileSection){if(section!==this.section()&&this.editor.active()&&!await this.editor.confirmDiscard())return;void this.router.navigate([],{relativeTo:this.route,queryParams:{section:section==='collection'?null:section,post:null},queryParamsHandling:'merge'});}
 sectionKey(event:KeyboardEvent,current:ProfileSection){const index=this.sections.findIndex(s=>s.id===current);let next:number;if(event.key==='ArrowRight')next=(index+1)%3;else if(event.key==='ArrowLeft')next=(index+2)%3;else if(event.key==='Home')next=0;else if(event.key==='End')next=2;else return;event.preventDefault();const id=this.sections[next].id;this.selectSection(id);(event.currentTarget as HTMLElement)?.parentElement?.querySelector<HTMLButtonElement>('[data-profile-section="'+id+'"]')?.focus();}
 async profileAction(action:ProfileAction){if(!this.auth.user()){void this.router.navigate(['/login'],{queryParams:{returnUrl:this.router.url}});return;}if(action==='block'){const p=this.profile();if(!p||this.own()||this.blockActions.busy())return;const actor=this.auth.user()?.id,generation=++this.blockRequest,current=()=>generation===this.blockRequest&&this.profile()?.id===p.id&&this.auth.user()?.id===actor;try{const state=await firstValueFrom(this.api.blockState(p.id));if(!current())return;this.blockingState.set(state);const result=await this.blockActions.change({id:p.id,display_name:p.display_name,username:p.username,avatar_url:p.avatar_url},state.blocked);if(current()){if(result?.blocked){this.followRequest++;this.followBusy.set(false);}const fresh=await firstValueFrom(this.api.blockState(p.id));if(current()){this.blockingState.set(fresh);if(result?.blocked&&p.availability.following)await this.refreshFollowAfterBlock(p.id,current);}}}catch(error){if(current())this.ui.notify(errorMessage(error),'error');}return;}if(action==='edit'){if(this.pinBusy()||!this.own()||!this.profile())return;await this.router.navigate([],{relativeTo:this.route,queryParams:{section:'about'},queryParamsHandling:'merge'});this.editor.begin(this.profile()!);return;}if(action==='follow'){await this.toggleFollow();return;}this.ui.notify('Creator reports are not available yet. No report was sent.','info');}
 private async refreshFollowAfterBlock(id:number,current:()=>boolean){
  const fresh=await firstValueFrom(this.api.creator(id));
  if(current())this.profile.update(profile=>profile?{...profile,viewer_follows:fresh.viewer_follows,
    follow_required:fresh.follow_required,stats:{...profile.stats,followers:fresh.stats.followers,following:fresh.stats.following}}:profile);
 }
 private async toggleFollow(){
  const profile=this.profile(),actor=this.auth.user()?.id;
  if(!profile||!actor||profile.follow_required||profile.id===actor||this.followBusy()||this.blockActions.busy()||this.blockingState()?.social_restricted)return;
  if(!profile.availability.following){this.ui.notify('Following is unavailable. No follow was added.','info');return;}
  const request=++this.followRequest;
  const current=()=>request===this.followRequest&&this.auth.user()?.id===actor&&this.profile()?.id===profile.id;
  const update=(follows:boolean|undefined,followers:number|null,following:number|null)=>{
   if(current())this.profile.update(value=>value?{...value,viewer_follows:follows,
     stats:{...value.stats,followers,following}}:value);
  };
  const next=!profile.viewer_follows;
  this.followBusy.set(true);
  update(next,Math.max(0,(profile.stats.followers??0)+(next?1:-1)),profile.stats.following);
  try{
   const result=await this.followActions.change(profile.id,next);if(!result)return;
   update(result.viewer_follows,result.followers,result.following);
  }catch(error){
   if(current()){
    update(profile.viewer_follows,profile.stats.followers,profile.stats.following);
    this.ui.notify(errorMessage(error),'error');
   }
  }finally{if(request===this.followRequest)this.followBusy.set(false);}
 }
 @HostListener('window:beforeunload',['$event'])beforeUnload(event:BeforeUnloadEvent){if(this.editor.dirty()||this.editor.busy()||this.conversations?.hasDraft()){event.preventDefault();event.returnValue='';}}
 canLeave(){return this.editor.active()?this.editor.confirmDiscard():this.conversations?.closeComposer()??true;}
 async cancelEdit(){await this.editor.confirmDiscard();}
 async saveProfile(){const saved=await this.editor.save();if(saved)this.profile.set(saved);}
 chooseImage(slot:'avatar'|'banner'){const rectangle=document.querySelector('.profile-panel')?.getBoundingClientRect();void this.imageSelector?.show(slot,rectangle?rectangle.width/rectangle.height:5);}
 async togglePin(productId:number){
  const current=this.profile();
  if(!current||!this.own()||this.editor.active()||this.pinBusy()||!current.products.some(item=>item.id===productId))return;
  const request=++this.pinRequest,next=current.pinned_item?.id===productId?null:productId;
  const stillCurrent=()=>request===this.pinRequest&&this.profile()?.id===current.id&&this.auth.user()?.id===current.id;
  this.pinBusy.set(true);
  try{
   const saved=await firstValueFrom(this.api.pinProfileItem(next,current.revision));
   if(stillCurrent()){this.profile.set(saved);this.ui.notify(next===null?'Item unpinned.':'Item pinned.');}
  }catch(error){
   if(stillCurrent()){
    this.ui.notify(errorMessage(error),'error');

    try{const fresh=await firstValueFrom(this.api.creator(current.id));if(stillCurrent())this.profile.set(fresh);}catch{}
   }
  }finally{if(request===this.pinRequest)this.pinBusy.set(false);}
 }
 ngOnDestroy(){this.blockRequest++;this.pinRequest++;this.followRequest++;this.editor.clear();}
}


