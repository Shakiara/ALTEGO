// ALTEGO necesita resolver la presentación de avisos y preferencias de notificación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {DatePipe} from '@angular/common';
import {Component,ElementRef,HostListener,computed,effect,inject,signal,untracked,viewChild} from '@angular/core';
import {RouterLink} from '@angular/router';
import {firstValueFrom} from 'rxjs';
import {Api} from "../../core/http/api";
import {AuthService} from "../../core/auth/auth-service";
import {Icon} from "../../shared/ui/icon";
import {SocialNotification} from "../../shared/social/social-types";
import {UiFeedback} from "../../shared/ui/ui-feedback";
import {GlassPanel} from "../../shared/ui/visual-primitives";

@Component({
  selector:'app-notification-center',imports:[DatePipe,RouterLink,Icon,GlassPanel],
  template:`
    <button #bell class="icon-control notification-bell" type="button" [attr.aria-expanded]="open()"
      aria-controls="notification-center" [attr.aria-label]="unread()?'Notifications, '+unread()+' unread':'Notifications'"
      title="Notifications" (click)="toggle()">
      <app-icon name="bell"/>
      @if(unread()){<span class="notification-count" aria-hidden="true">{{unread()>99?'99+':unread()}}</span>}
    </button>
    <dialog #panel appGlass id="notification-center" class="notification-panel" aria-labelledby="notification-heading"
      (close)="closed()" (click)="backdrop($event)">
      <header><h2 id="notification-heading" tabindex="-1">Notifications</h2>
        <button type="button" class="icon-control" aria-label="Close notifications" (click)="close()"><app-icon name="close"/></button>
      </header>
      <div class="notification-scroll" [attr.aria-busy]="loading()">
        @if(loading()&&!items().length){<p role="status">Loading notifications…</p>}
        @if(error()){<p role="alert">{{error()}} <button type="button" (click)="refresh(true)">Retry</button></p>}
        @if(!loading()&&!error()&&!items().length){<p>No notifications yet.</p>}
        @for(item of items();track item.id){
          <article class="notification">
            <app-icon [name]="categoryIcon(item.category)"/>
            <div class="notification-copy">
              <strong>{{item.title}} @if(item.count>1){<span aria-label="Grouped events">· {{item.count}}</span>}</strong>
              <p>{{item.description}}</p><time [attr.datetime]="item.created_at">{{item.created_at|date:'medium'}}</time>
            </div>
            <div class="notification-actions">
              @if(item.destination){
                <a [routerLink]="path(item.destination)" [queryParams]="params(item.destination)" (click)="close(false)">{{action(item)}}</a>
              }
              @if(item.category!=='storage'){<button type="button" class="dismiss" [disabled]="loading()||!!dismissing()"
                [attr.aria-label]="(item.count>1?'Dismiss group: ':'Dismiss ')+item.title"
                (click)="dismiss(item)">{{item.count>1?'Dismiss group':'Dismiss'}}</button>}
            </div>
          </article>
        }
      </div>
    </dialog>
  `,
  styles:`
    :host{display:block;position:relative;flex:none}
    .notification-bell{position:relative}.notification-count{position:absolute;inset-block-start:-4px;inset-inline-end:-5px;
      border-radius:999px;min-width:20px;padding:2px 4px;color:#fff;background:#806b98;font-size:11px;font-weight:650}
    dialog.notification-panel.glass-panel{position:absolute;inset:calc(100% + 7px) -50px auto auto;margin:0;
      width:min(380px,calc(100vw - 24px));max-height:min(540px,calc(100dvh - 90px));
      padding:0;border:1px solid #e9e1f0;border-radius:16px;background:#fbf9fd;color:#51465c;overflow:hidden}
    dialog.notification-panel[open]{display:flex;flex-direction:column}
    .notification-panel header{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-bottom:1px solid #e9e1f0}
    .notification-panel h2{margin:0;font:650 18px var(--font-body)}.notification-panel header button{min-width:38px;width:38px;height:38px}
    .notification-scroll{overflow-y:auto;overscroll-behavior:contain;min-height:0;padding:7px 12px}
    .notification-scroll>p{padding:12px 0;margin:0}.notification{display:grid;grid-template-columns:auto minmax(0,1fr) auto;
      gap:8px;align-items:start;padding:11px 0;border-bottom:1px solid #e9e1f0}
    .notification:last-child{border:0}.notification-copy{overflow-wrap:anywhere;display:grid;gap:4px;font-size:13px}
    .notification-copy p{margin:0}.notification-copy time{font-size:12px;color:var(--color-muted)}
    .notification a,.notification button,.notification-scroll>p button{color:#6b577e}
    .notification-actions{display:flex;flex-direction:column;align-items:flex-start;gap:2px;max-width:104px}
    .notification-actions a{display:inline-flex;align-items:center;min-height:34px;font-size:12px}
    .notification-actions .dismiss{text-align:start}
    @media(pointer:coarse){.notification-actions a,.notification-actions .dismiss{min-height:44px}}
    .dismiss,.notification-scroll>p button{background:none;border:0;padding:4px 2px;min-height:34px;cursor:pointer;font-size:12px}
    @media(max-width:650px){
      .notification-bell.icon-control{width:40px;height:40px;min-width:40px}
      dialog.notification-panel.glass-panel{position:fixed;inset:0 0 0 auto;width:min(390px,100%);height:100dvh;
        max-height:100dvh;max-width:100%;border-radius:16px 0 0 16px}
      dialog.notification-panel::backdrop{background:#51465c40}
    }
    @media(max-width:650px) and (prefers-reduced-motion:no-preference){
      dialog.notification-panel[open]{animation:notification-slide .2s ease-out}
      @keyframes notification-slide{from{clip-path:inset(0 0 0 100%)}to{clip-path:inset(0)}}
    }
  `,
})
export class NotificationCenter {
  private api=inject(Api);
  private auth=inject(AuthService);
  private ui=inject(UiFeedback);
  private actorId=computed(()=>this.auth.user()?.id);
  private host=inject(ElementRef<HTMLElement>);
  private bell=viewChild<ElementRef<HTMLButtonElement>>('bell');
  private panel=viewChild<ElementRef<HTMLDialogElement>>('panel');
  open=signal(false);
  unread=signal(0);
  items=signal<SocialNotification[]>([]);
  loading=signal(false);
  error=signal('');
  dismissing=signal<string|null>(null);
  private generation=0;
  private polling=false;
  private restoreFocus=true;

  constructor(){
    effect(cleanup=>{
      const user=this.actorId();
      this.generation++;this.polling=false;this.loading.set(false);this.dismissing.set(null);
      this.items.set([]);this.unread.set(0);this.error.set('');
      if(!user)return;
      untracked(()=>void this.refresh(false));
      const timer=setInterval(()=>void this.refresh(this.open()),25000);
      cleanup(()=>clearInterval(timer));
    });
  }
  toggle(){
    if(this.open()){this.close();return;}
    const panel=this.panel()?.nativeElement;
    if(!panel)return;
    if(matchMedia('(max-width:650px)').matches)panel.showModal();else panel.show();
    this.open.set(true);panel.querySelector<HTMLElement>('h2')?.focus({preventScroll:true});
    void this.refresh(true);
  }
  close(restoreFocus=true){
    const panel=this.panel()?.nativeElement;
    if(panel?.open){this.restoreFocus=restoreFocus;panel.close();}
  }
  closed(){
    this.open.set(false);
    if(this.restoreFocus)this.bell()?.nativeElement.focus({preventScroll:true});
    this.restoreFocus=true;
  }
  backdrop(event:MouseEvent){if(event.target===this.panel()?.nativeElement)this.close();}
  @HostListener('document:click',['$event'])
  outside(event:MouseEvent){if(this.open()&&!event.composedPath().includes(this.host.nativeElement))this.close(false);}
  @HostListener('document:keydown.escape',['$event'])
  escape(event:Event){if(this.open()){event.preventDefault();this.close();}}
  @HostListener('window:resize')
  resize(){const panel=this.panel()?.nativeElement;if(panel?.open&&panel.matches(':modal')!==matchMedia('(max-width:650px)').matches)this.close();}

  async refresh(panel:boolean){
    if(this.dismissing()||this.polling&&!panel)return;
    const actor=this.auth.user()?.id;
    if(!actor)return;
    const request=++this.generation;
    this.polling=true;
    if(panel){this.loading.set(true);this.error.set('');}
    try{
      const data=await firstValueFrom(panel?this.api.readNotifications():this.api.notificationCount());
      if(request!==this.generation||this.auth.user()?.id!==actor)return;
      this.unread.set(data.unread);
      if('items' in data&&Array.isArray(data.items))this.items.set(data.items);
    }catch{
      if(panel&&request===this.generation)this.error.set("Couldn't load notifications.");
    }finally{
      if(request===this.generation){this.polling=false;this.loading.set(false);}
    }
  }
  async dismiss(item:SocialNotification){
    const actor=this.auth.user()?.id;
    if(!actor||this.loading()||this.dismissing()||!this.items().some(entry=>entry.id===item.id))return;
    const request=++this.generation;
    const previous=this.items(),unread=this.unread();
    const current=()=>this.auth.user()?.id===actor&&request===this.generation;
    this.dismissing.set(item.id);
    this.items.set(previous.filter(entry=>entry.id!==item.id));
    if(item.unread)this.unread.set(Math.max(0,unread-1));
    try{
      const result=await firstValueFrom(this.api.dismissNotification(item.id));
      if(result.dismissed_id!==item.id)throw Error('Unexpected notification dismissal');
    }catch{
      if(current()){
        this.items.set(previous);
        this.unread.set(unread);
        this.ui.notify("Couldn't dismiss the notification.",'error');
      }
    }finally{
      if(current()){
        this.dismissing.set(null);
        this.polling=false;
        this.loading.set(false);
      }
    }
  }
  path(destination:string){return destination.split('?')[0];}
  params(destination:string){return Object.fromEntries(new URLSearchParams(destination.split('?')[1] ?? ''));}
  action(item:SocialNotification){
    if(item.category==='mentions'||item.category==='replies')return 'View Comment';
    if(item.category==='verification'){
      if(item.destination?.includes('apply=1'))return 'Apply for Verification';
      if(item.title==='Application Submitted')return 'View Status';
      if(item.title==='Verification Approved')return 'View Profile';
    }
    if(item.category==='orders')return 'View Order';
    if(item.category==='new_followers')return 'View Profile';
    if(item.category==='following_updates')return 'View Item';
    return 'View Details';
  }
  categoryIcon(category:SocialNotification['category']){
    return {mentions:'comment',replies:'reply',new_followers:'user',moderation:'flag',verification:'success',orders:'bag',storage:'cube',following_updates:'cube'}[category];
  }
}
