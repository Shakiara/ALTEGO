// ALTEGO necesita resolver los paneles e interacciones compartidos del perfil.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {LiveAvatar} from './live-avatar';
import {bannerPresets} from './profile-types';
import {Component,ElementRef,ViewChild,effect,input,output,signal} from '@angular/core';
import {RouterLink} from '@angular/router';
import {CreatorProfile} from "../../core/http/api";
import {GlassPanel,VisualButton} from "../ui/visual-primitives";
import {Icon} from "../ui/icon";
import {AccountBadges} from "../identity/account-badges";
export type ProfileAction='edit'|'follow'|'report'|'block';
@Component({selector:'app-profile-panel',imports:[LiveAvatar,RouterLink,GlassPanel,VisualButton,Icon,AccountBadges],template:`
 <section appGlass class="creator-heading profile-panel" [class.profile-own]="own()" aria-labelledby="profile-name">
  <div class="profile-banner" aria-hidden="true" [style.background]="presetBackground()">@if(profile().banner_url){<img [src]="profile().banner_url" alt="" [style.object-position]="bannerPosition()" [style.transform]="'scale('+(profile().banner.crop?.zoom||1)+')'" [style.transform-origin]="bannerPosition()"/>}</div>
  <div class="profile-main">
   <div class="profile-avatar-slot"><span class="profile-avatar" role="img" [attr.aria-label]="profile().display_name+' avatar'"><app-live-avatar [userId]="profile().id" [src]="profile().avatar_url" [label]="profile().display_name" [live]="!editing()"/></span>@if(editing()){<button type="button" class="icon-control avatar-edit" aria-label="Change avatar" [disabled]="saving()" (click)="imageEdit.emit('avatar')"><app-icon name="camera"/></button>}</div>
   <div class="profile-identity"><span class="eyebrow">CREATOR PROFILE</span><div class="profile-name">
    <h1 id="profile-name" [class.inline-name-open]="editing()&&nameEditing()">@if(editing()&&nameEditing()){
      <span class="inline-name-measure" aria-hidden="true">{{profile().display_name||" "}}</span><input #nameInput class="inline-name-input" id="profile-name-input" required [attr.aria-invalid]="!profile().display_name.trim()" aria-label="Display Name" aria-describedby="display-name-count" [disabled]="saving()" [value]="profile().display_name" (input)="typeName($event)" (keydown)="nameKey($event)" (blur)="finishName()"/>
    }@else{<span>{{profile().display_name}}</span>@if(!editing()){&#8288;<app-account-badges [creatorId]="profile().id" [verified]="profile().verified_creator"/>}}</h1>
    @if(editing()){
      <button type="button" class="icon-control name-edit" aria-label="Edit Display Name" [disabled]="saving()" (click)="beginName()"><app-icon name="edit"/></button>
      @if(nameEditing()){<span id="display-name-count" class="inline-name-count" [class.error]="!profile().display_name.trim()" aria-live="polite">{{nameLength()}} / 30</span>}
    }
    @if(editing()){<app-account-badges [creatorId]="profile().id" [verified]="profile().verified_creator"/>}
   </div><p class="profile-handle">{{'@'+profile().username}}</p></div>
   <dl class="profile-stats"><div><dt>Published items</dt><dd>{{profile().stats.published_items}}</dd></div><div><dt>Followers</dt><dd><button type="button" class="profile-count" [disabled]="editing()||profile().stats.followers===null" aria-haspopup="dialog" [attr.aria-label]="'View Followers: '+(profile().stats.followers??'Unavailable')" (click)="listOpen.emit('followers')">{{profile().stats.followers??'—'}}</button></dd></div><div><dt>Following</dt><dd><button type="button" class="profile-count" [disabled]="editing()||profile().stats.following===null" aria-haspopup="dialog" [attr.aria-label]="'View Following: '+(profile().stats.following??'Unavailable')" (click)="listOpen.emit('following')">{{profile().stats.following??'—'}}</button></dd></div></dl>
  </div>
  @if(sessionReady()){
   @if(own()){
    <div class="profile-owner-actions">@if(editing()){<span class="profile-editing-label" aria-hidden="true"></span>}@else{<button appButton type="button" [disabled]="saving()" (click)="action.emit('edit')">Edit Profile</button><a appButton routerLink="/settings">Settings</a>}</div>
   }@else{
    <div class="profile-moderation-actions"><button class="icon-control" type="button" [attr.aria-disabled]="signedIn()?'true':null" aria-label="Report creator — coming soon" title="Reporting is coming soon" (click)="action.emit('report')"><app-icon name="flag"/></button><button class="icon-control profile-block-control" type="button" [class.is-blocked]="blocked()===true" [attr.aria-label]="blocked()?'Unblock User':'Block User'" [title]="blocked()?'Unblock User':'Block User'" [attr.aria-pressed]="blocked()===null?null:blocked()" [attr.aria-busy]="blockBusy()?'true':null" [attr.aria-disabled]="blockBusy()?'true':null" (click)="!blockBusy()&&action.emit('block')"><app-icon name="user-x"/></button></div>
    @if(profile().availability.following){
      <div class="profile-owner-actions">
        <button appButton type="button" [disabled]="followBusy()||blockBusy()||socialRestricted()||profile().follow_required" [title]="profile().follow_required?'Following Admin is required.':''" [attr.aria-busy]="followBusy()"
          [attr.aria-pressed]="profile().viewer_follows===true" (click)="action.emit('follow')">
          @if(profile().follow_required){<app-icon name="lock"/>}{{profile().follow_required?'Following':profile().viewer_follows?'Unfollow':'Follow'}}
        </button>
      </div>
    }
   }
  }
 @if(editing()){<button type="button" class="banner-edit" aria-label="Change Banner" [disabled]="saving()" (click)="imageEdit.emit('banner')"><app-icon name="camera"/><span>Change Banner</span></button>}
 </section>
`,styleUrl:'./profile-panel.css'})
export class ProfilePanel {profile=input.required<CreatorProfile>();blocked=input<boolean|null>(null);blockBusy=input(false);followBusy=input(false);socialRestricted=input(false);own=input(false);signedIn=input(false);sessionReady=input(false);action=output<ProfileAction>();editing=input(false);saving=input(false);nameEdit=output<string>();imageEdit=output<'avatar'|'banner'>();listOpen=output<'followers'|'following'>();nameEditing=signal(false);private nameBeforeEdit='';
 @ViewChild('nameInput')set inlineInput(ref:ElementRef<HTMLInputElement>|undefined){if(ref)queueMicrotask(()=>{ref.nativeElement.focus();ref.nativeElement.select();});}
 constructor(){effect(()=>{if(!this.editing())this.nameEditing.set(false);});}
 beginName(){if(this.saving()||this.nameEditing())return;this.nameBeforeEdit=this.profile().display_name;this.nameEditing.set(true);}
 typeName(event:Event){const input=event.target as HTMLInputElement,value=Array.from(input.value).slice(0,30).join('');if(input.value!==value)input.value=value;this.nameEdit.emit(value);}
 finishName(){if(this.profile().display_name.trim())this.nameEditing.set(false);}
 nameKey(event:KeyboardEvent){if(event.key==='Enter'){event.preventDefault();this.finishName();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.nameEdit.emit(this.nameBeforeEdit);this.nameEditing.set(false);}}
 nameLength(){return Array.from(this.profile().display_name).length;}bannerPosition(){const c=this.profile().banner?.crop;return (c?.x??50)+'% '+(c?.y??50)+'%';}presetBackground(){return this.profile().banner?.kind==='preset'?bannerPresets.find(p=>p.id===this.profile().banner.preset)?.background||null:null;}}
