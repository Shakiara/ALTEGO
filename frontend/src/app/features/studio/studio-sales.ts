// ALTEGO necesita resolver las métricas y el historial de Sales & Revenue.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,DestroyRef,ElementRef,ViewChild,computed,inject,signal} from '@angular/core';
import {CurrencyPipe,DatePipe} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute} from '@angular/router';
import {forkJoin,Subscription} from 'rxjs';
import {Api,errorMessage} from "../../core/http/api";
import {GlassPanel,VisualButton,VisualField} from "../../shared/ui/visual-primitives";
import {Icon} from "../../shared/ui/icon";
import type {SalesOverview,SalesPerformance,SaleHistory,SalesPage,SalesFilters} from "../../shared/commerce/sales-types";
@Component({selector:'app-studio-sales',imports:[CurrencyPipe,DatePipe,FormsModule,GlassPanel,VisualButton,VisualField,Icon],templateUrl:'./studio-sales.html',styleUrl:'./studio-sales.css'})
export class StudioSales {
 private api=inject(Api);private destroy=inject(DestroyRef);private route=inject(ActivatedRoute);private request?:Subscription;private variantRequest?:Subscription;
 period=['7','30','90','all'].includes(this.route.snapshot.queryParamMap.get('period')||'')?this.route.snapshot.queryParamMap.get('period')!:'30';product='';kind='all';tab=signal<'products'|'history'>('products');
 loading=signal(false);error=signal('');optionsError=signal('');overview=signal<SalesOverview|null>(null);products=signal<SalesPage<SalesPerformance>|null>(null);history=signal<SalesPage<SaleHistory>|null>(null);options=signal<{product_id:number;product_name:string}[]>([]);
 expanded=signal<number|null>(null);variants=signal<SalesPage<SalesPerformance>|null>(null);variantLoading=signal(false);variantError=signal('');private productPage=1;private historyPage=1;
 @ViewChild('revenueTooltip')private tooltipPanel?:ElementRef<HTMLElement>;
 tooltip=signal<{date:string;through:string;revenue_cents:number}|null>(null);private tooltipAnchor?:HTMLElement;private tooltipFrame=0;
 private closeOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')this.hideTooltip();};
 private closeOnViewportChange=()=>{if(this.tooltipAnchor&&this.tooltip())this.positionTooltip();};
 showTooltip(event:Event,point:{date:string;through:string;revenue_cents:number}){
  this.tooltipAnchor=event.currentTarget as HTMLElement;this.tooltip.set(point);this.positionTooltip();
 }
 private positionTooltip(){cancelAnimationFrame(this.tooltipFrame);
  this.tooltipFrame=requestAnimationFrame(()=>{this.tooltipFrame=0;const panel=this.tooltipPanel?.nativeElement,anchor=this.tooltipAnchor;if(!panel||!anchor?.isConnected)return;
   panel.style.visibility='hidden';if(!panel.matches(':popover-open'))panel.showPopover();
   const rect=(anchor.querySelector('.bar-fill')||anchor).getBoundingClientRect(),gap=10,edge=12,vw=document.documentElement.clientWidth,vh=window.innerHeight;
   if(rect.bottom<0||rect.top>vh||rect.right<0||rect.left>vw){this.hideTooltip();return;}
   panel.style.maxWidth=Math.max(0,vw-edge*2)+'px';const box=panel.getBoundingClientRect();
   const above=rect.top-gap-box.height,below=rect.bottom+gap;
   const top=above>=edge?above:below+box.height<=vh-edge?below:Math.max(edge,Math.min(above,vh-box.height-edge));
   panel.style.left=Math.max(edge,Math.min(rect.left+rect.width/2-box.width/2,vw-box.width-edge))+'px';panel.style.top=top+'px';panel.style.visibility='visible';
  });
 }
 hideTooltip(){cancelAnimationFrame(this.tooltipFrame);this.tooltipFrame=0;const panel=this.tooltipPanel?.nativeElement;if(panel?.matches(':popover-open'))panel.hidePopover();this.tooltip.set(null);this.tooltipAnchor=undefined;}
 leaveTooltip(event:MouseEvent){if(document.activeElement!==event.currentTarget)this.hideTooltip();}
 maximum=computed(()=>Math.max(1,...(this.overview()?.timeline.map(point=>point.revenue_cents)||[])));
 constructor(){this.loadOptions();this.load();document.addEventListener('scroll',this.closeOnViewportChange,true);document.addEventListener('keydown',this.closeOnEscape);window.addEventListener('resize',this.closeOnViewportChange);this.destroy.onDestroy(()=>{this.hideTooltip();document.removeEventListener('scroll',this.closeOnViewportChange,true);document.removeEventListener('keydown',this.closeOnEscape);window.removeEventListener('resize',this.closeOnViewportChange);this.request?.unsubscribe();this.variantRequest?.unsubscribe();});}
 private filters():SalesFilters{return {period:this.period,...(this.product?{product:Number(this.product)}:{})};}
 loadOptions(){this.optionsError.set('');const sub=this.api.salesProductOptions().subscribe({next:r=>this.options.set(r.items),error:error=>this.optionsError.set(errorMessage(error))});this.destroy.onDestroy(()=>sub.unsubscribe());}
 changeFilters(){this.productPage=1;this.historyPage=1;this.closeVariant();this.load();}
 changeKind(){this.historyPage=1;this.load();}
 load(){this.hideTooltip();this.request?.unsubscribe();this.loading.set(true);this.error.set('');this.request=forkJoin({overview:this.api.salesOverview(this.filters()),products:this.api.salesProducts(this.filters(),this.productPage),history:this.api.salesHistory(this.filters(),this.historyPage,this.kind)}).subscribe({next:r=>{this.overview.set(r.overview);this.products.set(r.products);this.history.set(r.history);this.productPage=r.products.page;this.historyPage=r.history.page;this.loading.set(false);},error:error=>{this.overview.set(null);this.products.set(null);this.history.set(null);this.error.set(errorMessage(error));this.loading.set(false);}});}
 movePage(delta:number){if(this.tab()==='products')this.productPage+=delta;else this.historyPage+=delta;this.closeVariant();this.load();}
 closeVariant(){this.variantRequest?.unsubscribe();this.expanded.set(null);this.variants.set(null);this.variantError.set('');this.variantLoading.set(false);}
 expand(product:number){if(this.expanded()===product){this.closeVariant();return;}this.closeVariant();this.expanded.set(product);this.loadVariants(1);}
 loadVariants(page:number){const product=this.expanded();if(product===null)return;this.variantRequest?.unsubscribe();this.variantLoading.set(true);this.variantError.set('');this.variantRequest=this.api.salesVariants(product,this.filters(),page).subscribe({next:r=>{this.variants.set(r);this.variantLoading.set(false);},error:error=>{this.variantError.set(errorMessage(error));this.variantLoading.set(false);}});}
 pointLabel(date:string){return new Date(date+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',...(this.overview()?.interval==='year'?{year:'numeric'}:{}),timeZone:'UTC'});}
}
