// ALTEGO necesita resolver los datos, privacidad y seguridad de Settings.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {VerificationSettings} from "../../shared/identity/verification-settings";
import {SocialPreferenceControls} from "../../shared/social/social-preference-controls";
import {BlockedUsers} from './blocked-users';
import {Component,ElementRef,ViewChild,HostListener,inject,signal} from '@angular/core';
import {DatePipe,NgTemplateOutlet} from '@angular/common';
import {ActivatedRoute,Router,RouterLink} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Api,AccountSettings,ActiveSession} from "../../core/http/api";
import {AuthService} from "../../core/auth/auth-service";
import {GlassPanel,VisualButton,VisualField,VisualModal} from "../../shared/ui/visual-primitives";
import {Icon} from "../../shared/ui/icon";
import {UiFeedback} from "../../shared/ui/ui-feedback";

type SettingsSection='account'|'security'|'blocked-users'|'activity'|'notifications'|'verification';
type ActivityTab='overview'|'content'|'interactions'|'changes';
type SettingsActivity=import("../../core/http/api").AccountActivity;
@Component({selector:'app-settings-page',imports:[VerificationSettings,SocialPreferenceControls,BlockedUsers,DatePipe,NgTemplateOutlet,RouterLink,GlassPanel,VisualButton,VisualField,VisualModal,Icon],template:`
 <div class="settings-page">
  <header class="settings-heading"><h1>Settings</h1>
   <button #menuButton appButton type="button" class="settings-menu-button" aria-label="Open settings navigation" aria-controls="settings-mobile-navigation" [attr.aria-expanded]="menuOpen()" (click)="openMenu()"><app-icon name="grid"/>Sections</button>
  </header>
  <ng-template #navigation>
   <nav aria-label="Settings sections">@for(item of sections;track item.id){<button type="button" class="settings-nav-link" [attr.aria-current]="selected()===item.id?'page':null" (click)="select(item.id)"><app-icon [name]="item.icon"/><span>{{item.label}}</span><app-icon class="settings-nav-arrow" name="chevron-right"/></button>}</nav>
  </ng-template>
  <div class="settings-layout">
   <aside appGlass class="settings-sidebar"><ng-container [ngTemplateOutlet]="navigation"/></aside>
   <section appGlass class="settings-content" aria-labelledby="settings-section-title" [attr.aria-busy]="loading()">
    <div class="settings-section-heading"><span class="settings-section-icon"><app-icon [name]="activeSection().icon"/></span><div><h2 #sectionHeading id="settings-section-title" tabindex="-1">{{activeSection().label}}</h2></div></div>
    @if(loading()){
     <p role="status" class="settings-status">Loading your settings…</p><div class="settings-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
    }@else if(expired()){
     <div class="settings-state"><app-icon name="lock"/><h3>Your session has expired</h3><p>Log in again to view your account settings.</p><a appButton class="button dark" routerLink="/login" [queryParams]="{returnUrl:returnUrl()}">Log In</a></div>
    }@else if(error()){
     <div class="settings-state" role="alert"><app-icon name="warning"/><h3>Settings are unavailable</h3><p>{{error()}}</p><button appButton class="button" type="button" (click)="load()">Try Again</button></div>
    }@else if(settings();as data){
     @switch(selected()){
      @case('account'){
       
       <div class="settings-account-grid">
         <form appGlass class="settings-card" aria-labelledby="display-name-title" novalidate (submit)="saveDisplayName($event)"><div class="settings-card-heading"><h3 id="display-name-title">Display Name</h3><span class="settings-current">{{data.account.display_name||data.account.username}}</span></div>
          <label>New display name<input appField maxlength="30" [disabled]="!displayNameAllowed()||displayNameSaving()" [value]="displayNameInput()" (input)="displayNameInput.set($any($event.target).value);displayNameError.set('');displayNameSaved.set(false)" autocomplete="off" placeholder="Enter a display name"/></label>
          <label>Current password<input appField type="password" [disabled]="!displayNameAllowed()||displayNameSaving()" [value]="displayNamePassword()" (input)="displayNamePassword.set($any($event.target).value)" autocomplete="current-password" placeholder="Enter your current password"/></label>
          @if(!displayNameAllowed()&&data.account.display_name_change?.next_change_at){<p class="settings-context">Next change available {{data.account.display_name_change.next_change_at|date:'medium'}}.</p>}
          <button appButton class="button" type="submit" [disabled]="saving()||!displayNameAllowed()">Change Display Name</button>
         <div class="settings-form-feedback" aria-live="polite">@if(displayNameError()){<p class="settings-inline-error" role="alert">{{displayNameError()}}</p>}@else if(displayNameSaving()){<span role="status">Saving…</span>}@else if(displayNameSaved()){<span role="status">Display Name updated.</span>}</div></form>
        <form appGlass class="settings-card" aria-labelledby="email-title" novalidate (submit)="saveEmail($event)"><div class="settings-card-heading"><h3 id="email-title">Email</h3><span class="settings-current">{{data.account.email}}</span></div>
         <label>New email<input appField type="email" [disabled]="emailSaving()" [value]="emailInput()" (input)="emailInput.set($any($event.target).value);emailError.set('');emailSaved.set(false)" autocomplete="off" placeholder="Enter a new email"/></label>
         <label>Current password<input appField type="password" [disabled]="emailSaving()" [value]="emailPassword()" (input)="emailPassword.set($any($event.target).value)" autocomplete="current-password" placeholder="Enter your current password"/></label>
         <button appButton class="button" type="submit" [disabled]="saving()">Change Email</button>
        <div class="settings-form-feedback" aria-live="polite">@if(emailError()){<p class="settings-inline-error" role="alert">{{emailError()}}</p>}@else if(emailSaving()){<span role="status">Saving…</span>}@else if(emailSaved()){<span role="status">Email updated.</span>}</div></form>
        <section appGlass class="settings-card settings-privacy" aria-labelledby="privacy-title"><h3 id="privacy-title">Privacy</h3>
         <div class="settings-privacy-grid">
          <label>Followers list<select appField aria-label="Followers list" aria-describedby="followers-privacy-status" [value]="privacyValues().followers_list" (change)="changePrivacy('followers_list',$any($event.target).value)"><option value="public">Public</option><option value="private">Private</option></select><span id="followers-privacy-status" class="settings-save-status" role="status">{{privacyMessages().followers_list}}</span></label>
          <label>Following list<select appField aria-label="Following list" aria-describedby="following-privacy-status" [value]="privacyValues().following_list" (change)="changePrivacy('following_list',$any($event.target).value)"><option value="public">Public</option><option value="private">Private</option></select><span id="following-privacy-status" class="settings-save-status" role="status">{{privacyMessages().following_list}}</span></label>
          <app-social-preferences mode="mentions"/>
         </div>
        </section>
       </div>
      }
      @case('notifications'){<app-social-preferences mode="notifications"/>}
      @case('verification'){<app-verification-settings/>}
      @case('security'){
       <div class="settings-security-grid">
        <form appGlass class="settings-card" aria-labelledby="password-title" novalidate (submit)="savePassword($event)"><h3 id="password-title">Change Password</h3>
         
         <label>Current password<input appField type="password" [disabled]="passwordSaving()||revokeSaving()" [value]="securityCurrentPassword()" (input)="securityCurrentPassword.set($any($event.target).value);securityDraftChanged()" autocomplete="current-password" placeholder="Enter your current password"/></label>
         <label>New password<input appField type="password" [disabled]="passwordSaving()||revokeSaving()" [value]="securityNewPassword()" (input)="securityNewPassword.set($any($event.target).value);securityDraftChanged()" autocomplete="new-password" placeholder="Enter a new password"/></label>
         <label>Confirm new password<input appField type="password" [disabled]="passwordSaving()||revokeSaving()" [value]="securityConfirmPassword()" (input)="securityConfirmPassword.set($any($event.target).value);securityDraftChanged()" autocomplete="new-password" placeholder="Confirm your new password"/></label>
         <div class="settings-form-feedback" aria-live="polite">@if(passwordError()){<p class="settings-inline-error" role="alert">{{passwordError()}}</p>}@else if(passwordSaving()){<span role="status">Updating password…</span>}@else if(passwordSaved()){<span role="status">Password updated.</span>}</div>
         <button appButton type="submit" class="button" [disabled]="saving()">Update Password</button>
        </form>
        <section appGlass class="settings-card settings-sessions" aria-labelledby="sessions-title">
         <h3 #sessionsHeading id="sessions-title" tabindex="-1">Active Sessions</h3>
         @if(sessionsLoading()){<p class="settings-session-status" role="status">Loading sessions…</p>}
         @if(sessionsError()){<div class="settings-session-status" role="alert"><p>{{sessionsError()}}</p><button appButton type="button" [disabled]="sessionsLoading()" (click)="loadSessions()">Try Again</button></div>}
         @if(sessions();as items){<ul class="settings-session-list" [attr.aria-busy]="sessionsLoading()">@for(session of items;track session.id){
          <li class="settings-session-row"><span class="settings-session-icon"><app-icon [name]="session.device_type==='unknown'?'unknown':session.device_type"/></span><div class="settings-session-identity"><strong>{{session.device}} · {{session.browser}}</strong>@if(session.current){<span class="settings-session-current">Current session</span>}@else if(session.last_active_at){<span>Last active: <time [attr.datetime]="session.last_active_at">{{session.last_active_at|date:'medium'}}</time></span>}@else{<span>Last activity unavailable</span>}</div>
           @if(!session.current){<button appButton type="button" class="settings-session-signout" [attr.aria-label]="'Sign out '+session.device+' · '+session.browser" [disabled]="saving()||sessionsLoading()" (click)="signOutSession(session,$event)">{{remoteSaving()===session.id?'Signing out…':'Sign Out'}}</button>}
          </li>
         }</ul>}
         <div class="settings-form-feedback" aria-live="polite">@if(remoteError()){<p class="settings-inline-error" role="alert">{{remoteError()}}</p>}@else if(remoteStatus()){<span role="status">{{remoteStatus()}}</span>}</div>
         <div class="settings-session-global"><p class="settings-card-description">End all your sessions, including this device.</p><button #revokeButton appButton type="button" class="button danger" [disabled]="saving()" (click)="signOutEverywhere()">Sign Out Everywhere</button><div class="settings-form-feedback" aria-live="polite">@if(revokeError()){<p class="settings-inline-error" role="alert">{{revokeError()}}</p>}@else if(revokeSaving()){<span role="status">Signing out…</span>}</div></div>
        </section>
       </div>
      }
      @case('blocked-users'){<app-blocked-users/>}
      @case('activity'){
       
       <div class="settings-activity-tabs" role="tablist" aria-label="Activity categories">@for(tab of activityTabs;track tab.id){<button appButton type="button" role="tab" [id]="'activity-tab-'+tab.id" aria-controls="activity-panel" [attr.aria-selected]="activityTab()===tab.id" [attr.tabindex]="activityTab()===tab.id?0:-1" (click)="selectActivityTab(tab.id)" (keydown)="activityKey($event)">{{tab.label}}</button>}</div>
       <section id="activity-panel" role="tabpanel" [attr.aria-labelledby]="'activity-tab-'+activityTab()" tabindex="0">
        <div class="settings-activity-tools"><label class="settings-search">Search activity<input appField type="search" maxlength="120" [value]="activitySearch()" (input)="searchActivity($any($event.target).value)" placeholder="Search your history"/></label><label>Category<select appField [value]="activityCategory()" (change)="activityCategory.set($any($event.target).value);loadActivity()"><option value="all">All categories</option><option value="content">Content</option><option value="interactions">Interactions</option><option value="changes">Changes</option></select></label><label>Date range<select appField [value]="activityRange()" (change)="activityRange.set($any($event.target).value);loadActivity()"><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select></label></div>
        <section appGlass class="settings-history" aria-labelledby="recent-activity-title" [attr.aria-busy]="activityLoading()||activityMoreLoading()"><div class="settings-history-heading"><h3 id="recent-activity-title">Recent activity</h3><span><app-icon name="arrow-down"/>Newest first</span></div>
         @if(activityLoading()){<p role="status" class="settings-status">Loading activity…</p><div class="settings-skeleton" aria-hidden="true"><span></span><span></span></div>}
         @if(activityError()){<div class="settings-form-feedback" role="alert"><p>{{activityError()}}</p><button appButton type="button" (click)="retryActivity()">Try Again</button></div>}
         @if(activities();as events){
          @if(events.length){<ol #activityList class="settings-event-list">@for(event of events;track event.id){<li><button type="button" class="settings-event" (click)="openActivity(event,$event)"><app-icon [name]="event.category==='content'?'cube':event.category==='interactions'?'user':'edit'"/><span><strong>{{event.action}}</strong><span>{{event.reference}}</span><time [attr.datetime]="event.occurred_at">{{event.occurred_at|date:'medium'}}</time></span><app-icon name="chevron-right"/></button></li>}</ol>}
          @else if(!activityLoading()&&!activityError()){<div class="settings-empty settings-history-empty"><span class="settings-empty-symbol"><app-icon name="restore"/></span><h4>{{activityFiltered()?'No matching activity.':'No activity yet.'}}</h4></div>}
          @if(activityHasMore()){<button appButton class="button settings-load-more" type="button" [disabled]="activityMoreLoading()" (click)="loadActivity(true)">{{activityMoreLoading()?'Loading…':'Load More'}}</button>}
         }
        </section>
       </section>
      }
     }
    }
   </section>
  </div>
  <dialog #activityDialog appModal class="settings-activity-drawer" aria-labelledby="activity-detail-title" (cancel)="closeActivity($event)" (keydown)="activityDialogKey($event)" (click)="activityBackdrop($event)">
   <div class="settings-drawer-heading"><h2 id="activity-detail-title">{{selectedActivity()?.action ?? "Activity details"}}</h2><button appButton type="button" class="icon-control" aria-label="Close activity details" (click)="closeActivity()"><app-icon name="close"/></button></div>
   @if(selectedActivity();as event){<div class="settings-event-detail">@if(event.category!=="changes" && event.reference){<p>{{event.reference}}</p>}<time [attr.datetime]="event.occurred_at">{{event.occurred_at|date:'full'}}</time>@if(activityDetailLoading()){<p role="status">Loading details…</p>}@if(activityDetailError()){<div role="alert"><p>{{activityDetailError()}}</p><button appButton type="button" (click)="loadActivityDetail()">Try Again</button></div>}@if(event.description){<p>{{event.description}}</p>}@if(event.fields?.length){<dl class="settings-activity-fields">@for(field of event.fields;track field.label){<div><dt>{{field.label}}</dt><dd>{{field.value}}</dd></div>}</dl>}@if(event.resource_available===false){<p>Resource unavailable.</p>}@if(event.related_path){<a appButton class="button" [routerLink]="event.related_path" (click)="closeActivity()">View resource<app-icon name="arrow-right"/></a>}</div>}
  </dialog>
  <dialog #navigationDialog appModal class="settings-navigation-dialog" id="settings-mobile-navigation" aria-labelledby="settings-navigation-title" (cancel)="closeMenu($event)" (keydown)="menuKey($event)" (click)="backdrop($event)">
   <div class="settings-drawer-heading"><h2 id="settings-navigation-title">Settings</h2><button appButton type="button" class="icon-control" aria-label="Close settings navigation" (click)="closeMenu()"><app-icon name="close"/></button></div><ng-container [ngTemplateOutlet]="navigation"/>
  </dialog>
 </div>
 `,styleUrl:'./settings-page.css'})
export class SettingsPage {
 private api=inject(Api);private auth=inject(AuthService);private route=inject(ActivatedRoute);private router=inject(Router);private ui=inject(UiFeedback);
 readonly sections:readonly {id:SettingsSection;label:string;icon:string}[]=[{id:'account',label:'Account',icon:'user'},{id:'security',label:'Security',icon:'lock'},{id:'blocked-users',label:'Blocked Users',icon:'block'},{id:'activity',label:'Activity Center',icon:'restore'},{id:'notifications',label:'Notifications',icon:'bell'},{id:'verification',label:'Creator Verification',icon:'success'}];
 readonly activityTabs:readonly {id:ActivityTab;label:string}[]=[{id:'overview',label:'Overview'},{id:'content',label:'Content'},{id:'interactions',label:'Interactions'},{id:'changes',label:'Changes'}];
 activityTab=signal<ActivityTab>('overview');

 activities=signal<readonly SettingsActivity[]|null>(null);activityHasMore=signal(false);
 selectedActivity=signal<SettingsActivity|null>(null);
 @ViewChild('activityDialog') activityDialog?:ElementRef<HTMLDialogElement>;
 private activityTrigger?:HTMLElement;private activityScroll?:{element:HTMLElement;overflow:string};
 private scrollState?:{element:HTMLElement;overflow:string};
 selected=signal<SettingsSection>('account');settings=signal<AccountSettings|null>(null);loading=signal(false);error=signal('');expired=signal(false);menuOpen=signal(false);
 @ViewChild('navigationDialog') navigationDialog?:ElementRef<HTMLDialogElement>;
 @ViewChild('sectionHeading') sectionHeading?:ElementRef<HTMLElement>;
 @ViewChild('menuButton') menuButton?:ElementRef<HTMLButtonElement>;
 displayNameInput=signal('');displayNamePassword=signal('');emailInput=signal('');emailPassword=signal('');
 displayNameError=signal('');emailError=signal('');displayNameSaved=signal(false);emailSaved=signal(false);
 displayNameSaving=signal(false);emailSaving=signal(false);privacySaving=signal(false);
 privacyValues=signal<{followers_list:'public'|'private';following_list:'public'|'private'}>({followers_list:'public',following_list:'public'});
 privacyMessages=signal<{followers_list:string;following_list:string}>({followers_list:'',following_list:''});
 private pendingPrivacy=new Map<'followers_list'|'following_list','public'|'private'>();
 saving(){return this.displayNameSaving()||this.emailSaving()||this.privacySaving()||this.passwordSaving()||this.revokeConfirming()||this.revokeSaving()||this.remoteConfirming()||!!this.remoteSaving();}
 private currentMutation(epoch:number,id:number){return !this.destroyed&&epoch===this.request&&this.auth.user()?.id===id;}
 private mergePrivacy(){const data=this.settings();if(!data)return;const values={followers_list:data.privacy.followers_list,following_list:data.privacy.following_list};for(const [key,value]of this.pendingPrivacy)values[key]=value;this.privacyValues.set(values);}
 private acceptAccount(result:import("../../core/http/api").AccountSettingsResult){this.settings.set(result.settings);this.auth.user.set(result.user);this.mergePrivacy();}
 private expiredAccount(){this.activities.set(null);this.activityRequest++;this.closeActivity();this.sessions.set(null);this.sessionsRequest++;this.sessionsLoading.set(false);this.clearSecurityPasswords();this.expired.set(true);this.settings.set(null);this.auth.user.set(null);this.pendingPrivacy.clear();this.displayNamePassword.set('');this.emailPassword.set('');this.ui.notify('Your session has expired. Please log in again.','info');}
 private refreshAccount(epoch:number,id:number,done:()=>void){this.api.accountSettings().subscribe({next:data=>{if(!this.currentMutation(epoch,id))return;this.settings.set(data);this.mergePrivacy();done();},error:error=>{if(!this.currentMutation(epoch,id))return;if(error.status===401)this.expiredAccount();const messages={...this.privacyMessages()};for(const key of this.pendingPrivacy.keys())messages[key]='Could not save. Please try again.';this.privacyMessages.set(messages);this.pendingPrivacy.clear();this.mergePrivacy();done();}});}
 saveDisplayName(event:Event){event.preventDefault();this.saveIdentity('display-name');}
 saveEmail(event:Event){event.preventDefault();this.saveIdentity('email');}
 displayNameAllowed(){const rule=this.settings()?.account.display_name_change;return !!rule&&(rule.allowed||!!rule.next_change_at&&Date.parse(rule.next_change_at)<=this.identityNow());}
 private identityNow=signal(Date.now());private identityTimer=setInterval(()=>this.identityNow.set(Date.now()),30000);
 private saveIdentity(kind:'display-name'|'email'){
  const data=this.settings();if(!data||this.saving()||this.expired()||kind==='display-name'&&!this.displayNameAllowed())return;
  const input=kind==='display-name'?this.displayNameInput():this.emailInput().trim().toLowerCase(),password=kind==='display-name'?this.displayNamePassword():this.emailPassword(),errorSignal=kind==='display-name'?this.displayNameError:this.emailError;
  errorSignal.set('');(kind==='display-name'?this.displayNameSaved:this.emailSaved).set(false);
  if(kind==='display-name'&&(!input.trim()||[...input.trim()].length>30)){errorSignal.set('Use 1–30 characters for your Display Name.');return;}
  if(kind==='email'&&(input.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(input))){errorSignal.set('Enter a valid email address.');return;}
  if(!password||password.length>128){errorSignal.set('Enter your current password.');return;}
  const epoch=this.request,id=data.account.id,busy=kind==='display-name'?this.displayNameSaving:this.emailSaving;busy.set(true);
  const request=kind==='display-name'?this.api.updateDisplayName({display_name:input,current_password:password,revision:data.revision}):this.api.updateEmail({email:input,current_password:password,revision:data.revision});
  const finish=()=>{busy.set(false);this.pumpPrivacy();};
  request.subscribe({next:result=>{if(!this.currentMutation(epoch,id))return;this.acceptAccount(result);if(kind==='display-name'){if(this.displayNameInput()===input)this.displayNameInput.set('');this.displayNamePassword.set('');this.displayNameSaved.set(true);}else{if(this.emailInput().trim().toLowerCase()===input)this.emailInput.set('');this.emailPassword.set('');this.emailSaved.set(true);}finish();},error:error=>{
   if(!this.currentMutation(epoch,id))return;(kind==='display-name'?this.displayNamePassword:this.emailPassword).set('');
   if(error.status===401){this.expiredAccount();finish();return;}
   const messages:Record<string,string>={INVALID_PASSWORD:'Your current password is incorrect.',USERNAME_EXISTS:'This username is reserved or already in use.',EMAIL_EXISTS:'This email is already in use.',USERNAME_PROTECTED:'Admin’s username is reserved.',INVALID_USERNAME:'Use 3–30 letters, numbers or underscores.',INVALID_EMAIL:'Enter a valid email address.',SETTINGS_CHANGED:'Your settings changed. Review them and try again.'};
   let message=messages[error.error?.code]||'Could not save your changes. Please try again.';
   if(error.error?.code==='DISPLAY_NAME_COOLDOWN'){message='You can change your Display Name once every 168 hours.';this.refreshAccount(epoch,id,finish);}
   errorSignal.set(message);
   if(error.status===0||error.status>=500||error.error?.code==='SETTINGS_CHANGED')this.refreshAccount(epoch,id,finish);else finish();
  }});
 }
 changePrivacy(key:'followers_list'|'following_list',value:string){if(!this.settings()||this.expired()||!['public','private'].includes(value))return;this.privacyValues.set({...this.privacyValues(),[key]:value as 'public'|'private'});this.pendingPrivacy.set(key,value as 'public'|'private');this.privacyMessages.set({...this.privacyMessages(),[key]:'Saving…'});this.pumpPrivacy();}
 private pumpPrivacy(){
  const data=this.settings();if(!data||this.saving()||this.destroyed||this.expired()||!this.pendingPrivacy.size)return;
  const [key,value]=this.pendingPrivacy.entries().next().value!;this.pendingPrivacy.delete(key);const epoch=this.request,id=data.account.id;this.privacySaving.set(true);
  const finish=(message:string)=>{this.privacySaving.set(false);this.mergePrivacy();this.privacyMessages.set({...this.privacyMessages(),[key]:this.pendingPrivacy.has(key)?'Saving…':message});this.pumpPrivacy();};
  this.api.updatePrivacy({revision:data.revision,[key]:value}).subscribe({next:result=>{if(!this.currentMutation(epoch,id))return;this.acceptAccount(result);finish('Saved');},error:error=>{if(!this.currentMutation(epoch,id))return;if(error.status===401){this.expiredAccount();finish('');return;}const message='Could not save. Please try again.';if(error.status===0||error.status>=500||error.status===409)this.refreshAccount(epoch,id,()=>finish(message));else finish(message);}});
 }

 securityCurrentPassword=signal('');securityNewPassword=signal('');securityConfirmPassword=signal('');
 passwordSaving=signal(false);passwordSaved=signal(false);passwordError=signal('');
 @ViewChild('revokeButton') revokeButton?:ElementRef<HTMLButtonElement>;
 revokeConfirming=signal(false);revokeSaving=signal(false);revokeError=signal('');
 clearSecurityPasswords(){this.securityCurrentPassword.set('');this.securityNewPassword.set('');this.securityConfirmPassword.set('');}
 securityDraftChanged(){this.passwordError.set('');this.passwordSaved.set(false);}
 savePassword(event:Event){
  event.preventDefault();const data=this.settings();if(!data||this.saving()||this.expired())return;this.securityDraftChanged();
  const current=this.securityCurrentPassword(),next=this.securityNewPassword(),confirmation=this.securityConfirmPassword();let message='';
  if(!current||current.length>128)message='Enter your current password.';
  else if(next.length<8)message='Use at least 8 characters.';
  else if(next.length>128)message='Use no more than 128 characters.';
  else if(!/[A-Z]/.test(next))message='Include an uppercase letter.';
  else if(!/[a-z]/.test(next))message='Include a lowercase letter.';
  else if(!/[0-9]/.test(next))message='Include a number.';
  else if(!/[\W_]/.test(next))message='Include a symbol.';
  else if(next===current)message='Choose a different password.';
  else if(next!==confirmation)message='Passwords do not match.';
  if(message){this.passwordError.set(message);return;}
  const epoch=this.request,id=data.account.id;this.passwordSaving.set(true);
  this.api.updatePassword({current_password:current,new_password:next,confirm_password:confirmation}).subscribe({next:result=>{
   if(!this.currentMutation(epoch,id))return;this.passwordSaving.set(false);
   if(result?.changed===true){this.clearSecurityPasswords();this.passwordSaved.set(true);this.loadSessions();}else this.passwordError.set('Could not confirm the password change.');this.pumpPrivacy();
  },error:error=>{
   if(!this.currentMutation(epoch,id))return;this.passwordSaving.set(false);
   if(error.status===401){this.clearSecurityPasswords();this.expiredAccount();return;}
   const messages:Record<string,string>={INVALID_PASSWORD:'Your current password is incorrect.',INVALID_CURRENT_PASSWORD:'Enter your current password.',PASSWORD_TOO_SHORT:'Use at least 8 characters.',PASSWORD_TOO_LONG:'Use no more than 128 characters.',PASSWORD_UPPERCASE:'Include an uppercase letter.',PASSWORD_LOWERCASE:'Include a lowercase letter.',PASSWORD_NUMBER:'Include a number.',PASSWORD_SYMBOL:'Include a symbol.',PASSWORD_UNCHANGED:'Choose a different password.',PASSWORD_CONFIRMATION:'Passwords do not match.'};
   this.passwordError.set(messages[error.error?.code]||'Could not confirm the password change. Please try again.');this.pumpPrivacy();
  }});
 }
 async signOutEverywhere(){
  const data=this.settings();if(!data||this.saving()||this.expired())return;const epoch=this.request,id=data.account.id;
  const actor=this.auth.user();this.revokeError.set('');this.revokeConfirming.set(true);let confirmed=false;
  try{confirmed=await this.ui.confirm({title:'Sign out everywhere?',description:'All sessions, including this device, will be signed out.',danger:true,confirmLabel:'Sign Out Everywhere'});}
  catch{if(this.currentMutation(epoch,id))this.revokeError.set('Could not open confirmation. Please try again.');}
  this.revokeConfirming.set(false);
  if(!this.currentMutation(epoch,id))return;if(!confirmed){setTimeout(()=>{if(this.currentMutation(epoch,id))this.revokeButton?.nativeElement.focus();});this.pumpPrivacy();return;}
  this.revokeSaving.set(true);
  this.api.revokeAllSessions().subscribe({next:()=>{

   if(this.auth.user()!==actor)return;this.revokeSaving.set(false);this.pendingPrivacy.clear();this.clearSecurityPasswords();this.displayNamePassword.set('');this.emailPassword.set('');this.settings.set(null);this.auth.user.set(null);
   void this.router.navigate(['/login'],{queryParams:{returnUrl:'/settings?section=security'}});
  },error:error=>{
   if(!this.currentMutation(epoch,id))return;this.revokeSaving.set(false);
   if(error.status===401){this.clearSecurityPasswords();this.expiredAccount();return;}
   this.revokeError.set('Could not confirm sign-out. Please try again.');this.pumpPrivacy();
  }});
 }

 sessions=signal<ActiveSession[]|null>(null);sessionsLoading=signal(false);sessionsError=signal('');
 remoteConfirming=signal(false);remoteSaving=signal<string|null>(null);remoteError=signal('');remoteStatus=signal('');
 @ViewChild('sessionsHeading') sessionsHeading?:ElementRef<HTMLElement>;
 private sessionsRequest=0;
 loadSessions(){
  const data=this.settings();if(!data||this.expired()||this.destroyed)return;
  const generation=++this.sessionsRequest,epoch=this.request,id=data.account.id;
  this.sessionsLoading.set(true);this.sessionsError.set('');
  this.api.activeSessions().subscribe({next:result=>{
   if(generation!==this.sessionsRequest||!this.currentMutation(epoch,id))return;
   this.sessionsLoading.set(false);this.sessions.set(result.sessions);
  },error:error=>{
   if(generation!==this.sessionsRequest||!this.currentMutation(epoch,id))return;
   this.sessionsLoading.set(false);if(error.status===401){this.expiredAccount();return;}
   this.sessionsError.set('Could not load sessions. Please try again.');
  }});
 }
 async signOutSession(session:ActiveSession,event:Event){
  const data=this.settings();if(!data||session.current||this.saving()||this.sessionsLoading()||this.expired()||!this.sessions()?.includes(session))return;
  const epoch=this.request,id=data.account.id,trigger=event.currentTarget as HTMLElement;
  this.remoteError.set('');this.remoteStatus.set('');this.remoteConfirming.set(true);let confirmed=false;
  try{confirmed=await this.ui.confirm({title:'Sign out this session?',description:session.device+' · '+session.browser,danger:true,confirmLabel:'Sign Out'});}
  catch{if(this.currentMutation(epoch,id))this.remoteError.set('Could not open confirmation. Please try again.');}
  this.remoteConfirming.set(false);if(!this.currentMutation(epoch,id))return;
  if(!confirmed){setTimeout(()=>{if(this.currentMutation(epoch,id)&&trigger?.isConnected)trigger.focus();});this.pumpPrivacy();return;}
  this.remoteSaving.set(session.id);
  this.api.revokeSession(session.id).subscribe({next:()=>{
   if(!this.currentMutation(epoch,id))return;this.remoteSaving.set(null);this.remoteStatus.set('Session signed out.');this.loadSessions();this.focusSessions();this.pumpPrivacy();
  },error:error=>{
   if(!this.currentMutation(epoch,id))return;this.remoteSaving.set(null);
   if(error.status===401){this.expiredAccount();return;}
   if(error.status===404){this.remoteStatus.set('This session is no longer active.');this.loadSessions();}
   else{this.remoteError.set('Could not confirm sign-out. Please try again.');this.loadSessions();}
   this.focusSessions();this.pumpPrivacy();
  }});
 }
 private focusSessions(){setTimeout(()=>{if(!this.destroyed&&this.selected()==='security')this.sessionsHeading?.nativeElement.focus();});}
 activitySearch=signal('');activityCategory=signal('all');activityRange=signal('all');activityLoading=signal(false);activityMoreLoading=signal(false);activityError=signal('');activityDetailLoading=signal(false);activityDetailError=signal('');
 @ViewChild('activityList')activityList?:ElementRef<HTMLOListElement>;
 private activityCursor:string|null=null;private activityRequest=0;private activityDetailRequest=0;private activityFailedMore=false;private activityTimer?:ReturnType<typeof setTimeout>;
 activityFiltered(){return !!this.activitySearch().trim()||this.activityCategory()!=='all'||this.activityRange()!=='all'||this.activityTab()!=='overview';}
 selectActivityTab(tab:ActivityTab){if(tab===this.activityTab())return;this.activityTab.set(tab);this.loadActivity();}
 searchActivity(value:string){this.activitySearch.set(value);clearTimeout(this.activityTimer);this.activityRequest++;this.activityLoading.set(false);this.activityMoreLoading.set(false);this.activities.set(null);this.activityHasMore.set(false);this.activityTimer=setTimeout(()=>this.loadActivity(),300);}
 loadActivity(more=false){
  const data=this.settings();if(!data||this.expired()||this.destroyed||more&&(!this.activityCursor||this.activityMoreLoading()||this.activityLoading()))return;
  clearTimeout(this.activityTimer);const generation=++this.activityRequest,epoch=this.request,id=data.account.id;this.closeActivity();this.activityError.set('');this.activityFailedMore=more;
  if(more)this.activityMoreLoading.set(true);else{this.activityLoading.set(true);this.activityMoreLoading.set(false);this.activities.set(null);this.activityCursor=null;this.activityHasMore.set(false);}
  this.api.activity({tab:this.activityTab(),category:this.activityCategory(),range:this.activityRange(),q:this.activitySearch().trim()},more?this.activityCursor!:undefined).subscribe({next:page=>{
   if(generation!==this.activityRequest||!this.currentMutation(epoch,id))return;this.activityLoading.set(false);this.activityMoreLoading.set(false);const previousLength=more?(this.activities()?.length||0):0;const items=more?[...(this.activities()||[])]:[],seen=new Set(items.map(e=>e.id));for(const event of page.items)if(!seen.has(event.id)){items.push(event);seen.add(event.id);}this.activities.set(items);this.activityCursor=page.next_cursor;this.activityHasMore.set(!!page.next_cursor);if(more)setTimeout(()=>{if(generation===this.activityRequest&&this.currentMutation(epoch,id)&&this.selected()==='activity')this.activityList?.nativeElement.querySelectorAll<HTMLButtonElement>('button')[previousLength]?.focus();});
  },error:error=>{if(generation!==this.activityRequest||!this.currentMutation(epoch,id))return;this.activityLoading.set(false);this.activityMoreLoading.set(false);if(error.status===401){this.expiredAccount();return;}this.activityError.set('Could not load activity. Please try again.');}});
 }
 retryActivity(){this.loadActivity(this.activityFailedMore);}
 loadActivityDetail(){const event=this.selectedActivity(),data=this.settings();if(!event||!data)return;const generation=++this.activityDetailRequest,epoch=this.request,id=data.account.id;this.activityDetailLoading.set(true);this.activityDetailError.set('');this.api.activityDetail(event.id).subscribe({next:detail=>{if(generation!==this.activityDetailRequest||!this.currentMutation(epoch,id)||this.selectedActivity()?.id!==event.id)return;this.activityDetailLoading.set(false);this.selectedActivity.set(detail);},error:error=>{if(generation!==this.activityDetailRequest||!this.currentMutation(epoch,id))return;this.activityDetailLoading.set(false);if(error.status===401){this.expiredAccount();return;}this.activityDetailError.set(error.status===404?'Activity is unavailable.':'Could not load details. Please try again.');}});}
 private request=0;private destroyed=false;
 constructor(){this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params=>{const section=params.get('section');this.selected.set(this.sections.find(s=>s.id===section)?.id||'account');if(this.selected()!=='security')this.clearSecurityPasswords();else if(this.settings()&&!this.sessions()&&!this.sessionsLoading())this.loadSessions();this.closeMenu();this.closeActivity();if(this.selected()==='activity'&&this.settings()&&!this.activities()&&!this.activityLoading())this.loadActivity();});this.load();}
 openActivity(event:SettingsActivity,trigger:Event){
  if(!this.activities()?.some(item=>item===event)||!this.activityDialog?.nativeElement||this.expired())return;
  const dialog=this.activityDialog.nativeElement;
  if(dialog.open)return;
  this.closeMenu();
  this.selectedActivity.set(event);
  this.activityTrigger=trigger.currentTarget as HTMLElement;
  dialog.showModal();
  const element=dialog.ownerDocument?.documentElement;
  if(element){
   this.activityScroll={element,overflow:element.style.overflow};
   element.style.overflow='hidden';
  }
  this.loadActivityDetail();
 }
 closeActivity(event?:Event){this.activityDetailRequest++;this.activityDetailLoading.set(false);this.activityDetailError.set('');event?.preventDefault();if(this.activityDialog?.nativeElement.open)this.activityDialog.nativeElement.close();this.selectedActivity.set(null);if(this.activityScroll){this.activityScroll.element.style.overflow=this.activityScroll.overflow;this.activityScroll=undefined;}if(!this.destroyed&&this.activityTrigger?.isConnected)this.activityTrigger.focus();this.activityTrigger=undefined;}
 activityDialogKey(event:KeyboardEvent){this.trapFocus(event,this.activityDialog?.nativeElement);}
 private trapFocus(event:KeyboardEvent,dialog?:HTMLDialogElement){if(event.key!=='Tab'||!dialog?.open)return;const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]'));const first=controls[0],last=controls.at(-1),active=dialog.ownerDocument.activeElement;if(event.shiftKey&&active===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&active===last){event.preventDefault();first?.focus();}}
 activityKey(event:KeyboardEvent){const index=this.activityTabs.findIndex(t=>t.id===this.activityTab());const next=event.key==='ArrowRight'?(index+1)%4:event.key==='ArrowLeft'?(index+3)%4:event.key==='Home'?0:event.key==='End'?3:-1;if(next<0)return;event.preventDefault();this.selectActivityTab(this.activityTabs[next].id);const tabs=(event.currentTarget as HTMLElement)?.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');tabs?.[next]?.focus();}
 activeSection(){return this.sections.find(s=>s.id===this.selected())!;}
 returnUrl(){return '/settings'+(this.selected()==='account'?'':'?section='+this.selected());}
 select(section:SettingsSection){this.selected.set(section);if(section==='activity'&&this.settings())this.loadActivity();this.closeMenu();void this.router.navigate([],{relativeTo:this.route,queryParams:{section:section==='account'?null:section,apply:null},queryParamsHandling:'merge',fragment:undefined});setTimeout(()=>{if(!this.destroyed)this.sectionHeading?.nativeElement.focus();});}
 openMenu(){this.closeActivity();const dialog=this.navigationDialog?.nativeElement;if(dialog&&!dialog.open){dialog.showModal();this.menuOpen.set(true);const element=dialog.ownerDocument?.documentElement;if(element){this.scrollState={element,overflow:element.style.overflow};element.style.overflow='hidden';}}}
 closeMenu(event?:Event){event?.preventDefault();const dialog=this.navigationDialog?.nativeElement;if(dialog?.open)dialog.close();this.menuOpen.set(false);if(this.scrollState){this.scrollState.element.style.overflow=this.scrollState.overflow;this.scrollState=undefined;}}
 menuKey(event:KeyboardEvent){this.trapFocus(event,this.navigationDialog?.nativeElement);}
 backdrop(event:MouseEvent){
  if(this.isBackdropClick(event,this.navigationDialog?.nativeElement))this.closeMenu();
 }
 activityBackdrop(event:MouseEvent){
  if(this.isBackdropClick(event,this.activityDialog?.nativeElement))this.closeActivity();
 }
 private isBackdropClick(event:MouseEvent,dialog?:HTMLDialogElement){
  if(!dialog?.open || event.target!==dialog)return false;
  const {left,right,top,bottom}=dialog.getBoundingClientRect();
  return event.clientX<left || event.clientX>right || event.clientY<top || event.clientY>bottom;
 }
 load(){const request=++this.request;this.loading.set(true);this.error.set('');this.expired.set(false);this.settings.set(null);this.pendingPrivacy.clear();this.displayNameSaving.set(false);this.emailSaving.set(false);this.privacySaving.set(false);this.api.accountSettings().subscribe({next:data=>{if(request!==this.request||this.destroyed)return;this.settings.set(data);this.mergePrivacy();this.loading.set(false);if(this.selected()==='security')this.loadSessions();if(this.selected()==='activity')this.loadActivity();},error:err=>{if(request!==this.request||this.destroyed)return;this.loading.set(false);if(err.status===401){this.expired.set(true);this.closeActivity();this.auth.user.set(null);this.ui.notify('Your session has expired. Please log in again.','info');}else this.error.set(err.status===0?'Check your connection and try again.':'Your account settings could not be loaded. Please try again.');}});}
 @HostListener('window:resize') resize(){if(this.menuOpen()&&window.matchMedia('(min-width:901px)').matches){this.closeMenu();this.sectionHeading?.nativeElement.focus();}}
 ngOnDestroy(){clearInterval(this.identityTimer);clearTimeout(this.activityTimer);this.activityRequest++;this.activityDetailRequest++;this.clearSecurityPasswords();if(this.revokeConfirming()||this.remoteConfirming())this.ui.answer(false);this.displayNamePassword.set('');this.emailPassword.set('');this.pendingPrivacy.clear();this.destroyed=true;this.request++;this.closeMenu();this.closeActivity();}
}
