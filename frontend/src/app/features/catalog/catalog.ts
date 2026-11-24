// ALTEGO necesita resolver la exploración y búsqueda del catálogo de accesorios.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {StorefrontFilterState} from "../../shared/navigation/storefront-filter-state";
import {StorefrontSidebar} from "../../shared/navigation/storefront-sidebar";


import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import {pageNumbers} from "../../shared/ui/pagination";
import { Api, Product, Category, errorMessage } from "../../core/http/api";
import { ProductCard } from "../../shared/products/product-card";
import { GlassPanel, VisualButton } from "../../shared/ui/visual-primitives";

@Component({
  selector: 'app-catalog', imports: [StorefrontSidebar, RouterLink, ProductCard, GlassPanel, VisualButton],
  styleUrl: './catalog.css',
  template: `
    <div class="catalog-layout">
<app-storefront-sidebar [filters]="true" [categories]="visibleCategories()" [counts]="counts()" [activeCategory]="category()" (categorySelected)="selectCategory($event)"/>

      <section [attr.aria-busy]="loading()" class="collection" id="collection" aria-labelledby="catalog-title">
        <div class="collection-intro"><h1 id="catalog-title">Discover your <em>style.</em></h1></div>
        @if(query()) { <p class="search-summary">Results for <strong>“{{query()}}”</strong></p> }
        @if(error()) { <div appGlass class="notice error" role="alert">{{error()}}<button appButton class="button" (click)="load()">Try again</button></div> }
        @else if(!products().length && loaded()) {
          <div appGlass class="empty"><h2>{{catalogTotal() ? 'A style waiting to be discovered' : 'Your collection starts here'}}</h2><p>{{catalogTotal() ? 'No items match these filters. Try another category or search.' : 'Add the first item to your store.'}}</p>@if(!catalogTotal()){<a routerLink="/products/new" class="button dark">Create item</a>}</div>
        } @else {
          <div class="product-grid">@for(p of products();track p.id) {
            <app-product-card [product]="p" />
          }</div>
        }
        @if(loaded() && !error()) {
          @if(totalPages()>1){<nav class="pagination" aria-label="Catalog pages"><button appButton [disabled]="loading()||page()===1" (click)="goPage(page()-1)">Previous</button>@for(n of numbers();track $index){@if(n===0){<span aria-hidden="true">…</span>}@else{<button appButton [disabled]="loading()" [attr.aria-label]="'Page '+n" [attr.aria-current]="page()===n?'page':null" (click)="goPage(n)">{{n}}</button>}}<button appButton [disabled]="loading()||page()===totalPages()" (click)="goPage(page()+1)">Next</button></nav>}
          <div class="collection-caption" role="status">{{counter()}}</div>
        }
      </section>
    </div>
  `
})
export class Catalog {
 private filters=inject(StorefrontFilterState);private router=inject(Router);private categoriesLoaded=false;private api=inject(Api);private route=inject(ActivatedRoute);private destroy=inject(DestroyRef);private request?:Subscription;private requestId=0;
 products=signal<Product[]>([]);categories=signal<Category[]>([]);loaded=signal(false);loading=signal(true);error=signal('');query=signal('');category=this.filters.collection;
 visibleCategories=computed(()=>this.categories().filter(c=>c.active!==false&&c.filter_visible!==false));
 page=signal(1);total=signal(0);totalPages=signal(0);counts=signal<{category_id:number;total:number}[]>([]);
 catalogTotal=computed(()=>this.counts().reduce((n,c)=>n+c.total,0));numbers=computed(()=>pageNumbers(this.page(),this.totalPages()));
 counter=computed(()=>this.totalPages()>1?'Showing '+((this.page()-1)*25+1)+'–'+Math.min(this.page()*25,this.total())+' of '+this.total()+' items':this.total()+' of '+this.total()+' '+(this.total()===1?'item':'items'));
 constructor(){this.api.categories().pipe(takeUntilDestroyed()).subscribe({next:c=>{this.categories.set(c);this.categoriesLoaded=true;if(this.category()&&!this.visibleCategories().some(c=>c.id===this.category()))this.selectCategory(0);},error:e=>this.error.set(errorMessage(e))});this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params=>{this.query.set(params.get('q')||'');const raw=params.get('category');if(raw!==null){const id=Number(raw);this.category.set(Number.isSafeInteger(id)&&id>=0?id:0);}if(this.categoriesLoaded&&this.category()&&!this.visibleCategories().some(c=>c.id===this.category()))this.category.set(0);this.load(false,1);});this.destroy.onDestroy(()=>this.request?.unsubscribe());}
 categoryCount(id:number){return this.counts().find(c=>Number(c.category_id)===id)?.total||0;}
 selectCategory(id:number){if(id===this.category())return;this.category.set(id);void this.router.navigate([],{relativeTo:this.route,queryParams:{category:id||null},queryParamsHandling:'merge',replaceUrl:true}).then(navigated=>{if(!navigated&&this.category()===id&&!this.destroy.destroyed)this.load(false,1);});}
 goPage(page:number){if(page<1||page>this.totalPages()||page===this.page()||this.loading())return;this.load(true,page);}
 load(scroll=false,requestedPage=this.page()){this.request?.unsubscribe();const request=++this.requestId;this.loading.set(true);this.error.set('');this.request=this.api.catalog(requestedPage,this.category(),this.query()).subscribe({next:r=>{if(request!==this.requestId)return;this.products.set(r.items);this.page.set(r.page);this.total.set(r.total);this.totalPages.set(r.total_pages);this.counts.set(r.category_counts);this.loaded.set(true);this.loading.set(false);if(scroll)requestAnimationFrame(()=>document.getElementById('catalog-title')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));},error:e=>{if(request!==this.requestId)return;this.error.set(errorMessage(e));this.loading.set(false);}});}
}
