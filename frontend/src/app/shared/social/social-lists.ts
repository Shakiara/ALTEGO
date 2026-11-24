// ALTEGO necesita resolver las listas de seguidores y cuentas seguidas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {LiveAvatar} from "../profile/live-avatar";
import {Component,ElementRef,ViewChild,inject,signal,input,DestroyRef,HostListener} from '@angular/core';
import {Router,RouterLink} from '@angular/router';import {HttpClient,HttpErrorResponse} from '@angular/common/http';
import {AuthService,API_URL} from "../../core/auth/auth-service";import {FollowActions} from "./follow-actions";import {errorMessage} from "../../core/http/api";
import {AccountBadges} from "../identity/account-badges";import {Icon} from "../ui/icon";import {VisualModal,VisualButton} from "../ui/visual-primitives";import {UiFeedback} from "../ui/ui-feedback";
export type ConnectionList='followers'|'following';
interface ConnectionUser{id:number;username:string;display_name:string;avatar_url:string|null;verified_creator:boolean;viewer_follows:boolean;required:boolean;social_restricted:boolean;own_account:boolean;}
interface ConnectionPage{items:ConnectionUser[];next_cursor:string|null;}
@Component({selector:'app-social-lists',imports:[LiveAvatar,RouterLink,Icon,AccountBadges,VisualModal,VisualButton],styleUrl:'./social-lists.css',template:`
 <dialog #dialog appModal class="connections-dialog" aria-labelledby="connections-title" (click)="outside($event)" (close)="closed()">
  <header class="connections-heading"><div><h2 id="connections-title">{{kind()==='followers'?'Followers':'Following'}}</h2><p>{{'@'+ownerUsername()}}</p></div><button appButton class="icon-control" type="button" aria-label="Close connections" autofocus (click)="dismiss()"><app-icon name="close"/></button></header>
  <div class="connections-body" [attr.aria-busy]="loading()">
   @if(privateList()){<div class="connections-state" role="status"><app-icon name="lock"/><h3>This list is private</h3></div>}
   @else if(missing()){<div class="connections-state" role="status"><app-icon name="user"/><h3>Profile unavailable</h3></div>}
   @else{
    @if(error()){<div class="connections-error" role="alert"><p>{{error()}}</p><button appButton (click)="load(false)">Try again</button></div>}
    @if(loading()&&!items().length){<div class="connection-skeletons" role="status" aria-label="Loading connections">@for(i of [1,2,3];track i){<span class="connection-skeleton"></span>}</div>}
    @for(user of items();track user.id){<article class="connection-row">
     <a class="connection-identity" [routerLink]="['/creators',user.id]" (click)="dismiss()"><span class="connection-avatar"><app-live-avatar [userId]="user.id" [src]="user.avatar_url" [label]="user.display_name"/></span><span class="connection-names"><strong>{{user.display_name}}</strong><span>{{'@'+user.username}}</span></span></a><app-account-badges [creatorId]="user.id" [verified]="user.verified_creator"/>
     @if(user.own_account){<span class="connection-self">You</span>}@else{<button appButton class="connection-follow" [class.following]="user.viewer_follows" [disabled]="user.required||user.social_restricted||actions.pending().has(user.id)" [attr.aria-pressed]="user.viewer_follows" [attr.aria-busy]="actions.pending().has(user.id)" [attr.aria-label]="(user.required?'Following Admin is required':user.social_restricted?'Social interaction unavailable':user.viewer_follows?'Unfollow '+user.username:'Follow '+user.username)" [title]="user.required?'Following Admin is required.':user.social_restricted?'Social interactions are unavailable.':''" (click)="toggle(user)">@if(user.required){<app-icon name="lock"/>}{{user.required?'Following':user.viewer_follows?'Unfollow':'Follow'}}</button>}
    </article>}
    @if(!loading()&&!error()&&!items().length){<div class="connections-state" role="status"><app-icon name="user"/><h3>{{kind()==='followers'?'No followers yet':'Not following anyone yet'}}</h3></div>}
    @if(cursor()){<button appButton class="connections-more" [disabled]="loading()" (click)="load(true)">{{loading()?'Loading…':'Load More'}}</button>}
   }
  </div>
 </dialog>`})
export class SocialLists{
 ownerId=input.required<number>();ownerUsername=input.required<string>();auth=inject(AuthService);actions=inject(FollowActions);private http=inject(HttpClient);private router=inject(Router);private ui=inject(UiFeedback);
 @ViewChild('dialog')dialog!:ElementRef<HTMLDialogElement>;kind=signal<ConnectionList>('followers');items=signal<ConnectionUser[]>([]);cursor=signal<string|null>(null);loading=signal(false);privateList=signal(false);missing=signal(false);error=signal('');private request=0;private subscription?:{unsubscribe:()=>void};private opener?:HTMLElement;
 constructor(){inject(DestroyRef).onDestroy(()=>{this.request++;this.subscription?.unsubscribe();this.dialog?.nativeElement.close();});}
 show(kind:ConnectionList){this.opener=document.activeElement instanceof HTMLElement?document.activeElement:undefined;this.kind.set(kind);this.items.set([]);this.cursor.set(null);this.dialog.nativeElement.showModal();this.load(false);}
 dismiss(){this.dialog.nativeElement.close();}
 closed(){this.request++;this.subscription?.unsubscribe();this.items.set([]);this.cursor.set(null);this.loading.set(false);if(this.opener?.isConnected)this.opener.focus();}
 outside(event:MouseEvent){if(event.target!==this.dialog.nativeElement)return;const box=this.dialog.nativeElement.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)this.dismiss();}
 @HostListener('window:focus')refresh(){if(this.dialog?.nativeElement.open)this.load(false);}
 load(more:boolean){const request=++this.request,owner=this.ownerId(),actor=this.auth.user()?.id;this.subscription?.unsubscribe();this.loading.set(true);this.error.set('');this.privateList.set(false);this.missing.set(false);const params:{list:string;cursor?:string}={list:this.kind()};if(more&&this.cursor())params.cursor=this.cursor()!;
  this.subscription=this.http.get<ConnectionPage>(API_URL+'/creators/'+owner+'/connections',{params}).subscribe({next:page=>{if(request!==this.request||owner!==this.ownerId()||actor!==this.auth.user()?.id)return;this.items.update(items=>more?[...new Map([...items,...page.items].map(u=>[u.id,u])).values()]:page.items);this.cursor.set(page.next_cursor);this.loading.set(false);},error:(error:HttpErrorResponse)=>{if(request!==this.request)return;this.loading.set(false);if(error.status===403||error.status===404){this.items.set([]);this.cursor.set(null);this.privateList.set(error.status===403);this.missing.set(error.status===404);}else this.error.set(errorMessage(error));}});
 }
 async toggle(user:ConnectionUser){if(!this.auth.user()){this.dismiss();await this.router.navigate(['/login'],{queryParams:{returnUrl:this.router.url}});return;}if(user.required||user.social_restricted)return;
  const actor=this.auth.user()?.id,owner=this.ownerId();try{const result=await this.actions.change(user.id,!user.viewer_follows);if(result&&actor===this.auth.user()?.id&&owner===this.ownerId()&&this.dialog.nativeElement.open)this.load(false);}catch(error){if(actor===this.auth.user()?.id)this.ui.notify(errorMessage(error),'error');}
 }
}
