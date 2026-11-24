// ALTEGO necesita resolver los diálogos compartidos del espacio administrativo.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Directive,ElementRef,HostListener,inject,input} from '@angular/core';
import {UiFeedback} from "../ui/ui-feedback";
@Directive({selector:'dialog[appAdminDialog]',exportAs:'adminDialog'})
export class AdminDialog{
 private element=inject(ElementRef<HTMLDialogElement>);private ui=inject(UiFeedback);adminDirty=input<()=>boolean>(()=>false);adminBusy=input<()=>boolean>(()=>false);private opener?:HTMLElement;private asking=false;private outside=false;
 @HostListener('beforetoggle',['$event'])before(event:Event){if((event as Event&{newState:string}).newState==='open')this.opener=document.activeElement as HTMLElement;}
 @HostListener('close')closed(){if(this.opener?.isConnected)this.opener.focus();}
 @HostListener('cancel',['$event'])cancel(event:Event){event.preventDefault();void this.requestClose();}
 private isOutside(event:PointerEvent|MouseEvent){const r=this.element.nativeElement.getBoundingClientRect();return event.target===this.element.nativeElement&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);}
 @HostListener('pointerdown',['$event'])down(event:PointerEvent){this.outside=this.isOutside(event);}
 @HostListener('click',['$event'])click(event:MouseEvent){if(this.outside&&this.isOutside(event)){event.preventDefault();void this.requestClose();}this.outside=false;}
 async requestClose(){if(this.asking||this.adminBusy()())return;this.asking=true;try{if(this.adminDirty()()&&!await this.ui.confirm({dismissOnBackdrop:true,title:'Discard Unsaved Changes?',description:'Your administrative form changes have not been submitted.',confirmLabel:'Discard Changes',danger:true}))return;this.element.nativeElement.close();}finally{this.asking=false;}}
}
