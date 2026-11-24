// ALTEGO necesita resolver la navegación y la estructura principal de la aplicación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {LiveAvatar} from "./shared/profile/live-avatar";
import {ShoppingBagPanel} from "./shared/commerce/shopping-bag-panel";
import {ShoppingBagState} from "./core/commerce/shopping-bag-state";
import {NotificationCenter} from "./features/notifications/notification-center";
import {Component,ElementRef,HostListener,ViewChild,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute,NavigationEnd,Router,RouterLink,RouterOutlet} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {AuthService} from "./core/auth/auth-service";
import {errorMessage} from "./core/http/api";
import {AmbientBackground} from "./shared/ui/ambient-background";
import {GlassPanel,VisualField,VisualModal} from "./shared/ui/visual-primitives";
import {Feedback,UiFeedback} from "./shared/ui/ui-feedback";
import {Icon} from "./shared/ui/icon";

@Component({selector:'app-root',imports:[LiveAvatar,ShoppingBagPanel,AmbientBackground,GlassPanel,VisualField,VisualModal,FormsModule,RouterLink,RouterOutlet,Feedback,Icon,NotificationCenter],template:`
 <app-ambient-background/><a class="skip-link" [attr.href]="skipTarget">Skip to content</a>
 @if(!workspace()){
 <header appGlass class="header shell-header">
   <a class="brand" routerLink="/" aria-label="ALTEGO, home"><span class="brand-word">ALTEGO<span class="brand-caption">Avatar Accessories</span></span></a>
   <div class="header-controls">
     <form #searchArea class="search-control" [class.search-open]="searchOpen()" role="search" (ngSubmit)="search(searchText)">
       <span class="search-field" [class.field-open]="searchOpen()"><input #searchInput [disabled]="!searchOpen()" [attr.tabindex]="searchOpen()?0:-1" appField type="search" name="search" aria-label="Search items" placeholder="Search items…" [ngModel]="searchText" (ngModelChange)="search($event)" autocomplete="off"></span>
       <button #searchButton type="button" class="icon-control" [attr.aria-label]="searchOpen()?'Close search':'Open search'" [attr.aria-expanded]="searchOpen()" (click)="toggleSearch()"><app-icon [name]="searchOpen()?'close':'search'"/></button>
     </form>
     <button #bagButton class="icon-control shopping-bag-trigger" aria-label="Open shopping bag" [attr.aria-description]="shoppingBag.items().length+' items'" aria-haspopup="dialog" (click)="openBag()"><app-icon name="bag"/>@if(shoppingBag.items().length){<span class="bag-count" aria-hidden="true">{{shoppingBag.items().length>99?'99+':shoppingBag.items().length}}</span>}</button>
     @if(auth.user()){<app-notification-center/>}
     <div #avatarArea class="avatar-area">
       <button #avatarButton class="icon-control avatar-control" aria-label="Open account menu" [attr.aria-expanded]="menuOpen()" aria-controls="account-menu" (click)="toggleMenu()">@if(auth.user();as user){<app-live-avatar [userId]="user.id" [label]="user.username"/>}@else{<app-icon/>}</button>
       @if(menuOpen()){<nav id="account-menu" appGlass class="account-menu" aria-label="Account navigation">
         @if(auth.user();as user){<div class="menu-identity"><span class="eyebrow">YOUR SPACE</span><strong class="account-handle">{{'@'+user.username}}</strong></div>
         <a [routerLink]="['/creators',user.id]" (click)="closeMenu()">My Account</a><a routerLink="/orders" (click)="closeMenu()">My Orders</a><a routerLink="/collection" (click)="closeMenu()">My Collection</a><a routerLink="/studio" (click)="closeMenu()">Creator Studio</a><a routerLink="/settings" (click)="closeMenu()">Settings</a>
         @if(user.role==='admin'||user.role==='moderator'){<hr><a routerLink="/admin" (click)="closeMenu()">Admin Workspace</a>}
         <hr><button [disabled]="loggingOut()" (click)="logout()">{{loggingOut()?'Signing out…':'Log Out'}}</button>
         }@else{<span class="eyebrow">YOUR SPACE</span><a routerLink="/login" (click)="closeMenu()">Log In</a><a routerLink="/signup" (click)="closeMenu()">Sign Up</a>}
       </nav>}
     </div>
   </div>
 </header>
 }
 <main id="content" [class.workspace-content]="workspace()"><router-outlet/></main>
 @if(!workspace()){
 <footer class="shell-footer"><a class="footer-brand" routerLink="/">ALTEGO</a><span>Your avatar. Your alter ego.</span><small>Shakiara Feliciano Navarro</small></footer>
 <dialog #bag appModal class="bag-drawer" aria-labelledby="bag-title" (click)="backdropClick($event)" (close)="bagClosed()"><div class="drawer-heading"><span class="eyebrow">YOUR SELECTION</span><button class="icon-control" aria-label="Close shopping bag" (click)="bag.close()"><app-icon name="close"/></button></div><h2 id="bag-title">Shopping Bag</h2>@defer (when bag.open){<app-shopping-bag-panel/>}<button class="button" (click)="bag.close()">Continue exploring</button></dialog>
 }
 <app-feedback/>
`,styles:[`.shopping-bag-trigger{position:relative}.bag-count{position:absolute;inset-block-start:-4px;inset-inline-end:-5px;border-radius:999px;min-width:20px;padding:2px 4px;color:#fff;background:#806b98;font-size:11px;font-weight:650}main.workspace-content{max-width:none;width:100%;padding:0;margin:0;}`]})
export class App {
 shoppingBag=inject(ShoppingBagState);auth=inject(AuthService);private router=inject(Router);private route=inject(ActivatedRoute);private ui=inject(UiFeedback);
 workspace=signal(false);menuOpen=signal(false);searchOpen=signal(false);loggingOut=signal(false);searchText='';
 @ViewChild('searchButton') searchButton?:ElementRef<HTMLButtonElement>;
 @ViewChild('avatarArea') avatarArea?:ElementRef<HTMLElement>;
 @ViewChild('avatarButton') avatarButton?:ElementRef<HTMLButtonElement>;
 @ViewChild('bagButton') bagButton?:ElementRef<HTMLButtonElement>;
 @ViewChild('bag') bag?:ElementRef<HTMLDialogElement>;
 @ViewChild('searchInput') searchInput?:ElementRef<HTMLInputElement>;
 @ViewChild('searchArea') searchArea?:ElementRef<HTMLElement>;
 get skipTarget(){return this.router.url.split('#')[0]+'#content';}
 constructor(){this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(p=>this.searchText=p.get('q')||'');this.router.events.pipe(takeUntilDestroyed()).subscribe(e=>{if(e instanceof NavigationEnd){this.bag?.nativeElement.close();this.menuOpen.set(false);if(/^\/(?:admin|studio)(?:[/?#]|$)/.test(e.urlAfterRedirects))this.searchOpen.set(false);this.workspace.set(/^\/(?:admin|studio)(?:[/?#]|$)/.test(e.urlAfterRedirects));}});}
 search(value:string){this.searchText=value;void this.router.navigate(['/'],{queryParams:value?{q:value}:{},replaceUrl:true});}
 toggleSearch(){this.searchOpen.update(v=>!v);this.menuOpen.set(false);if(this.searchOpen())setTimeout(()=>this.searchInput?.nativeElement.focus());}
 toggleMenu(){this.menuOpen.update(v=>!v);}
 closeMenu(){this.menuOpen.set(false);}
 @HostListener('document:click',['$event']) outside(event:MouseEvent){if(this.searchOpen()&&!this.searchArea?.nativeElement.contains(event.target as Node))this.searchOpen.set(false);if(this.menuOpen()&&!this.avatarArea?.nativeElement.contains(event.target as Node))this.closeMenu();}
 @HostListener('document:keydown.escape') escape(){if(this.menuOpen()){this.closeMenu();this.avatarButton?.nativeElement.focus();}if(this.searchOpen()){this.searchOpen.set(false);this.searchButton?.nativeElement.focus();}}
 @HostListener('document:focusin',['$event']) focusOutside(event:FocusEvent){if(this.menuOpen()&&!this.avatarArea?.nativeElement.contains(event.target as Node))this.closeMenu();}
 openBag(){this.closeMenu();void this.shoppingBag.load();this.bagButton?.nativeElement.focus();this.bag?.nativeElement.showModal();document.documentElement.classList.add('shopping-bag-open');}
 bagClosed(){document.documentElement.classList.remove('shopping-bag-open');}
 backdropClick(event:MouseEvent){if(event.target===this.bag?.nativeElement){const r=this.bag!.nativeElement.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.bag!.nativeElement.close();}}
 logout(){if(this.loggingOut())return;this.loggingOut.set(true);this.auth.logout().subscribe({next:()=>{this.closeMenu();this.loggingOut.set(false);this.ui.notify('You have been signed out.');void this.router.navigateByUrl('/');},error:e=>{this.loggingOut.set(false);this.ui.notify(errorMessage(e),'error');}});}
}
