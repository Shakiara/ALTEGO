// ALTEGO necesita resolver las acciones contextuales flotantes de productos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,DestroyRef,ElementRef,ViewChild,ViewEncapsulation,inject,input,signal} from '@angular/core';
import {VisualButton} from './visual-primitives';
import {Icon} from './icon';
let menuSequence=0;
@Component({selector:'app-action-menu',imports:[VisualButton,Icon],encapsulation:ViewEncapsulation.None,template:`
 <button #trigger appButton type="button" class="floating-action-trigger" [attr.id]="controlId()||null" [class.variant-action-trigger]="mode()==='variants'" [class.compact-action-trigger]="compact()" [disabled]="disabled()" [attr.aria-haspopup]="mode()==='variants'?'listbox':'menu'" [attr.aria-controls]="id" [attr.popovertarget]="id" [attr.aria-expanded]="opened()" [attr.aria-label]="label()" (keydown)="triggerKey($event)">@if(mode()==='variants'){<span class="variant-choice-dot" [style.backgroundColor]="color()"></span>}@if(compact()){<app-icon name="more"/>}@else{<span>{{text()}}</span><app-icon [name]="mode()==='variants'?'chevron-down':'chevron-left'"/>}</button>
 <div #panel [id]="id" class="floating-action-panel" popover="auto" [class.variant-action-panel]="mode()==='variants'" [attr.role]="mode()==='variants'?'listbox':'menu'" [attr.aria-orientation]="mode()==='variants'?'vertical':'horizontal'" [attr.aria-label]="label()" (toggle)="toggled($event)" (keydown)="menuKey($event)" (click)="selected($event)"><ng-content/></div>
 `,styleUrl:'./action-menu.css'})
export class ActionMenu{
 compact=input(false);controlId=input('');label=input('Manage item');mode=input<'actions'|'variants'>('actions');text=input('Manage');color=input('#d9c9d8');disabled=input(false);opened=signal(false);id='action-menu-'+(++menuSequence);private destroy=inject(DestroyRef);private frame=0;private focusLast=false;private observer?:ResizeObserver;
 @ViewChild('trigger',{static:true})trigger!:ElementRef<HTMLButtonElement>;@ViewChild('panel',{static:true})panel!:ElementRef<HTMLElement>;
 constructor(){this.destroy.onDestroy(()=>{this.stop();if(this.panel.nativeElement.matches(':popover-open'))this.panel.nativeElement.hidePopover();});}
 private items(){return [...this.panel.nativeElement.querySelectorAll<HTMLElement>('[role=menuitem],[role=option]')].filter(item=>!item.hasAttribute('disabled')&&item.getAttribute('aria-disabled')!=='true');}
 open(last=false){if(this.panel.nativeElement.matches(':popover-open'))return;this.focusLast=last;this.panel.nativeElement.showPopover();this.opened.set(true);this.position();}
 close(restore=true){if(!this.panel.nativeElement.matches(':popover-open'))return;this.panel.nativeElement.hidePopover();this.opened.set(false);this.stop();if(restore&&this.trigger.nativeElement.isConnected)this.trigger.nativeElement.focus({preventScroll:true});}
 toggled(event:Event){const open=this.panel.nativeElement.matches(':popover-open');this.opened.set(open);if(open){this.position();requestAnimationFrame(()=>{if(!this.destroy.destroyed&&this.opened()){this.focusItem(this.focusLast?this.items().at(-1):this.items()[0]);this.focusLast=false;}});window.addEventListener('resize',this.schedule);window.addEventListener('scroll',this.schedule,true);this.observer=new ResizeObserver(this.schedule);this.observer.observe(this.panel.nativeElement);this.schedule();}else this.stop();}
 private stop(){window.removeEventListener('resize',this.schedule);window.removeEventListener('scroll',this.schedule,true);this.observer?.disconnect();this.observer=undefined;cancelAnimationFrame(this.frame);this.frame=0;}
 private schedule=()=>{if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;if(this.opened())this.position();});};
 private position(){
  const p=this.panel.nativeElement,r=this.trigger.nativeElement.getBoundingClientRect(),gap=8,vw=document.documentElement.clientWidth,vh=window.innerHeight;
  if(r.bottom<0||r.top>vh){this.close(false);return;}
  p.style.maxWidth=Math.max(0,vw-gap*2)+'px';
  if(this.mode()==='variants'){p.style.width=Math.min(Math.max(r.width,200),vw-gap*2)+'px';const below=vh-r.bottom-gap,above=r.top-gap;const available=Math.max(below,above);p.style.maxHeight=Math.max(60,Math.min(300,available))+'px';const box=p.getBoundingClientRect();p.style.left=Math.max(gap,Math.min(r.left,vw-box.width-gap))+'px';p.style.top=(below>=box.height?r.bottom+gap:Math.max(gap,r.top-gap-box.height))+'px';return;}
  const box=p.getBoundingClientRect();let left=r.left-gap-box.width,top=r.top+(r.height-box.height)/2;

  if(left<gap){left=Math.max(gap,Math.min(r.right-box.width,vw-box.width-gap));const below=vh-r.bottom-gap,above=r.top-gap;top=above>=box.height||above>below?r.top-gap-box.height:r.bottom+gap;}
  p.style.left=Math.max(gap,Math.min(left,vw-box.width-gap))+'px';p.style.top=Math.max(gap,Math.min(top,vh-box.height-gap))+'px';
 }
 private focusItem(item?:HTMLElement){if(!item)return;item.focus({preventScroll:true});const p=this.panel.nativeElement,r=item.getBoundingClientRect(),box=p.getBoundingClientRect();if(r.left<box.left+8)p.scrollLeft-=box.left+8-r.left;else if(r.right>box.right-8)p.scrollLeft+=r.right-box.right+8;}

 triggerKey(event:KeyboardEvent){if(this.disabled())return;if(event.key==='Escape'&&this.opened()){event.preventDefault();event.stopPropagation();this.close();return;}if(['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();this.open(event.key==='ArrowUp'||event.key==='ArrowLeft');}}
 menuKey(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();return;}if(event.key==='Tab'){this.close();return;}const items=this.items(),index=items.indexOf(document.activeElement as HTMLElement);let target:number;if(event.key==='ArrowDown'||event.key==='ArrowRight')target=(index+1)%items.length;else if(event.key==='ArrowUp'||event.key==='ArrowLeft')target=(index-1+items.length)%items.length;else if(event.key==='Home')target=0;else if(event.key==='End')target=items.length-1;else return;event.preventDefault();this.focusItem(items[target]);}
 selected(event:MouseEvent){if((event.target as Element).closest('[role=menuitem],[role=option]'))this.close();}
}
