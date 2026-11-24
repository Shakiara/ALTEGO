// ALTEGO necesita resolver los iconos de categorías del catálogo.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,computed,input} from '@angular/core';
import {Icon} from "../ui/icon";
@Component({selector:'app-category-icon',imports:[Icon],host:{'aria-hidden':'true'},template:`@if(svg()){<span [style.mask-image]="mask()" [style.-webkit-mask-image]="mask()"></span>}@else{<app-icon name="grid"/>}`,styles:`:host{display:inline-flex;width:24px;height:24px;flex:0 0 24px;align-items:center;justify-content:center}span{display:block;width:100%;height:100%;background:currentColor;mask-size:contain;mask-position:center;mask-repeat:no-repeat;-webkit-mask-size:contain;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat}`})
export class CategoryIcon{svg=input<string|null|undefined>(null);mask=computed(()=>`url("data:image/svg+xml,${encodeURIComponent(this.svg()||'')}")`);}
