// ALTEGO necesita resolver la selección de variantes en carrusel.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Icon} from "../ui/icon";
import {AfterViewInit,Component,ElementRef,OnDestroy,ViewChild,input,output,signal} from '@angular/core';
import {Variant} from "../../core/http/api";
@Component({selector:'app-variant-carousel',imports:[Icon],template:`
 <div class="variant-carousel" aria-label="Color variants">
  <button type="button" class="variant-arrow" [class.arrow-hidden]="!left()" [disabled]="!left()" [attr.aria-hidden]="!left()" aria-label="Previous colors" (click)="move(-1)"><app-icon name="chevron-left"/></button>
  <div #track class="variant-track" (scroll)="measure()" (keydown)="keyboard($event)">
   <div #strip class="variant-strip">@for(v of variants();track v.id;let i=$index){<button type="button" class="variant-dot" [style.--variant-color]="v.hex" [attr.aria-label]="v.name" [title]="v.name" [class.unavailable-color]="v.available===false" [attr.aria-pressed]="selected()===v.id" (click)="choose(v)" (focus)="reveal($event)"></button>}</div>
  </div>
  <button type="button" class="variant-arrow" [class.arrow-hidden]="!right()" [disabled]="!right()" [attr.aria-hidden]="!right()" aria-label="Next colors" (click)="move(1)"><app-icon name="chevron-right"/></button>
 </div>`,styles:`
 :host{display:block;min-width:0;height:44px;margin:8px 0}
 .variant-carousel{display:flex;align-items:center;gap:3px;height:44px;min-width:0}
 .variant-track{flex:1;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;scroll-snap-type:x proximity;overscroll-behavior-x:contain}
 .variant-track::-webkit-scrollbar{display:none}
 .variant-strip{display:flex;gap:9px;padding:5px 3px;width:max-content;height:42px;align-items:center}
 .variant-dot{position:relative;flex:0 0 30px;width:30px;height:30px;padding:0;border:3px solid transparent;border-radius:50%;background:var(--variant-color);background-clip:padding-box;box-shadow:inset 0 0 0 1px #ffffff80;scroll-snap-align:center}
 .unavailable-color::after{content:'';position:absolute;inset:45% -1px auto;height:2px;background:#6f6578;transform:rotate(-40deg);pointer-events:none}.variant-dot[aria-pressed=true]{outline:1.5px solid #9c6489;outline-offset:1px}
 .variant-dot:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}
 .variant-arrow{flex:0 0 22px;width:22px;height:32px;padding:0;border:1px solid #ffffffb0;background:#fff4;border-radius:12px;font-size:22px;color:#8a607d}
 .variant-arrow{display:grid;place-items:center}.variant-arrow app-icon{width:10px;height:10px}.arrow-hidden{visibility:hidden;pointer-events:none}
 `})
export class VariantCarousel implements AfterViewInit,OnDestroy {
 variants=input.required<Variant[]>();selected=input<string|undefined>();selection=output<string>();left=signal(false);right=signal(false);
 @ViewChild('track') track!:ElementRef<HTMLDivElement>;@ViewChild('strip') strip!:ElementRef<HTMLDivElement>;
 private observer?:ResizeObserver;
 ngAfterViewInit(){this.observer=new ResizeObserver(()=>this.measure());this.observer.observe(this.track.nativeElement);this.observer.observe(this.strip.nativeElement);queueMicrotask(()=>this.measure());}
 measure(){const e=this.track?.nativeElement;if(!e)return;this.left.set(e.scrollLeft>2);this.right.set(e.scrollWidth-e.clientWidth-e.scrollLeft>2);}
 move(direction:number){const e=this.track.nativeElement;e.scrollBy({left:direction*Math.max(70,e.clientWidth*.75),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 choose(v:Variant){if(v.id)this.selection.emit(v.id);}
 reveal(event:FocusEvent){const b=event.target as HTMLElement;const e=this.track.nativeElement;const delta=b.getBoundingClientRect().left-e.getBoundingClientRect().left;if(delta<3)e.scrollLeft+=delta-5;else if(delta+b.offsetWidth>e.clientWidth-3)e.scrollLeft+=delta+b.offsetWidth-e.clientWidth+5;}
 keyboard(event:KeyboardEvent){const buttons=Array.from(this.strip.nativeElement.querySelectorAll('button'));let n=buttons.indexOf(event.target as HTMLButtonElement);if(n<0)return;if(event.key==='ArrowRight')n=Math.min(buttons.length-1,n+1);else if(event.key==='ArrowLeft')n=Math.max(0,n-1);else if(event.key==='Home')n=0;else if(event.key==='End')n=buttons.length-1;else return;event.preventDefault();buttons[n]?.focus();}
 ngOnDestroy(){this.observer?.disconnect();}
}
