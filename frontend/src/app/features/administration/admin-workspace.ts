// ALTEGO necesita resolver la estructura y navegación del espacio administrativo.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {AdminDialog} from "../../shared/administration/admin-dialog";
import {NgTemplateOutlet} from '@angular/common';
import {Component,ElementRef,ViewChild,inject,signal} from '@angular/core';
import {NavigationEnd,Router,RouterLink,RouterLinkActive,RouterOutlet} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {AuthService} from "../../core/auth/auth-service";
import {Icon} from "../../shared/ui/icon";
import {GlassPanel,VisualButton,VisualModal} from "../../shared/ui/visual-primitives";

@Component({selector:'app-admin-workspace',imports:[AdminDialog,NgTemplateOutlet,RouterLink,RouterLinkActive,RouterOutlet,Icon,GlassPanel,VisualButton,VisualModal],templateUrl:'./admin-workspace.html',styleUrl:'./admin-workspace.css'})
export class AdminWorkspace{
 auth=inject(AuthService);private router=inject(Router);
 pageTitle=signal('Dashboard');context=signal('Overview');
 isAdmin=()=>this.auth.user()?.role==='admin';
 @ViewChild('menu') menu?:ElementRef<HTMLDialogElement>;
 constructor(){
  this.updateContext();
  this.router.events.pipe(takeUntilDestroyed()).subscribe(event=>{if(event instanceof NavigationEnd)this.updateContext();});
 }
 private updateContext(){
  const path=this.router.url.split(/[?#]/)[0];
  const sections:Record<string,[string,string]>={'/admin':['Dashboard','Overview'],'/admin/accounts':['Accounts','Management'],'/admin/catalog-filters':['Catalog Filters','Management'],'/admin/conversations':['Conversation Moderation','Moderation'],'/admin/verification':['Creator Verification','System'],'/admin/feed-reports':['Feed Reports','Moderation'],'/admin/content':['Content Moderation','Moderation'],'/admin/account-moderation':['Account Moderation','Moderation'],'/admin/appeals':['Appeals','Moderation'],'/admin/removed':['Removed Content','Moderation'],'/admin/audit':['Audit Log','System'],'/admin/storage-quotas':['Storage Limits','System']};
  const [title,context]=sections[path]??['Admin Workspace','Administration'];
  this.pageTitle.set(title);this.context.set(context);
 }
 closeOnNavigation(event:MouseEvent){if(event.target instanceof Element&&event.target.closest('a'))this.menu?.nativeElement.close();}
}
