// ALTEGO necesita resolver el espacio de trabajo de los creadores.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {NotificationCenter} from "../notifications/notification-center";
import {Component,ElementRef,ViewChild,inject,signal} from '@angular/core';
import {NgTemplateOutlet} from '@angular/common';
import {NavigationEnd,Router,RouterLink,RouterLinkActive,RouterOutlet} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {AuthService} from "../../core/auth/auth-service";
import {AdminDialog} from "../../shared/administration/admin-dialog";
import {GlassPanel,VisualButton,VisualModal} from "../../shared/ui/visual-primitives";
import {Icon} from "../../shared/ui/icon";
@Component({selector:'app-creator-studio',imports:[NotificationCenter,NgTemplateOutlet,RouterLink,RouterLinkActive,RouterOutlet,AdminDialog,GlassPanel,VisualButton,VisualModal,Icon],templateUrl:'./creator-studio.html',styleUrls:["../administration/admin-workspace.css",'./creator-studio.css']})
export class CreatorStudio{
 auth=inject(AuthService);private router=inject(Router);title=signal('Dashboard');group=signal('Overview');
 @ViewChild('menu')menu?:ElementRef<HTMLDialogElement>;
 sections=[{name:'Overview',links:[{path:'/studio',label:'Dashboard',icon:'grid'}]},{name:'Management',links:[{path:'/studio/products',label:'My Products',icon:'cube'},{path:'/studio/community',label:'Community',icon:'comment'}]},{name:'Insights',links:[{path:'/studio/analytics',label:'Analytics',icon:'poll'},{path:'/studio/storage',label:'Product Storage',icon:'cube'},{path:'/studio/sales',label:'Sales & Revenue',icon:'bag'}]},{name:'Account',links:[{path:'/studio/status',label:'Account Status',icon:'lock'},{path:'/studio/verification',label:'Creator Verification',icon:'success'}]}];
 constructor(){this.update();this.router.events.pipe(takeUntilDestroyed()).subscribe(event=>{if(event instanceof NavigationEnd){this.update();this.menu?.nativeElement.close();}});}
 private update(){const path=this.router.url.split(/[?#]/)[0],section=this.sections.find(section=>section.links.some(link=>link.path===path)),link=section?.links.find(link=>link.path===path);this.title.set(link?.label||'Creator Studio');this.group.set(section?.name||'Your workspace');}
}
