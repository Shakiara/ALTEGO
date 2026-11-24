// ALTEGO necesita resolver la presentación de contenido administrativo en carruseles.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,ElementRef,ViewChild,input,output} from '@angular/core';
import {VisualButton} from "../ui/visual-primitives";
export interface AdminCarouselItem{id:string;label:string;subtitle?:string;hex?:string;}
@Component({selector:'app-admin-carousel',imports:[VisualButton],template:`
 <header><h4>{{label()}}</h4><div><button appButton type="button" [attr.aria-label]="'Previous '+label()" (click)="move(-1)">‹</button><button appButton type="button" [attr.aria-label]="'Next '+label()" (click)="move(1)">›</button></div></header>
 <div #track class="carousel-track" [class.two-rows]="twoRows()" role="group" [attr.aria-label]="label()">
 @for(item of items();track item.id){<button appButton type="button" [attr.aria-pressed]="selected()===item.id" (click)="chosen.emit(item.id)">@if(item.hex){<i [style.background]="item.hex" aria-hidden="true"></i>}<span>{{item.label}}@if(item.subtitle){<small>{{item.subtitle}}</small>}</span></button>}
 </div>`,styles:`:host{display:block;min-width:0}header{display:flex;align-items:center;justify-content:space-between;gap:10px}h4{font-size:13px;margin:12px 0}header>div{display:flex;gap:6px}header button{width:32px;height:32px;padding:0}.carousel-track{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(120px,42%);gap:8px;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x proximity;padding:4px 3px 10px}.two-rows{grid-template-rows:repeat(2,auto)}.carousel-track button{min-width:0;display:flex;align-items:center;gap:7px;padding:10px;font-size:11px;scroll-snap-align:start;text-align:left;white-space:normal;overflow-wrap:anywhere}.carousel-track button[aria-pressed=true]{background:#e8dcf0;border-color:#a47da8;box-shadow:inset 0 0 0 1px #a47da8}.carousel-track i{width:15px;height:15px;aspect-ratio:1;flex-shrink:0;border-radius:50%;border:1px solid #0003}.carousel-track span{min-width:0}.carousel-track small{display:block;font-size:10px;margin-top:5px;color:var(--color-muted)}@media(prefers-reduced-motion:reduce){.carousel-track{scroll-behavior:auto}}`})
export class AdminCarousel{
 label=input.required<string>();items=input<AdminCarouselItem[]>([]);selected=input<string|null>(null);twoRows=input(false);chosen=output<string>();@ViewChild('track',{static:true})track!:ElementRef<HTMLElement>;
 move(direction:number){this.track.nativeElement.scrollBy({left:direction*this.track.nativeElement.clientWidth*.8,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
}
