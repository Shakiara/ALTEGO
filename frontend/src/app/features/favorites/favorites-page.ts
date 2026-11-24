// ALTEGO necesita resolver la presentación de variantes guardadas en My Favorites.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {StorefrontFilterState} from "../../shared/navigation/storefront-filter-state";
import {StorefrontSidebar} from "../../shared/navigation/storefront-sidebar";

import {Component,DestroyRef,effect,inject,signal,computed,untracked} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {RouterLink} from '@angular/router';
import {AuthService,API_URL} from "../../core/auth/auth-service";
import {FavoritesState} from "../../core/favorites/favorites-state";
import {Category,Api,Product,Variant,errorMessage} from "../../core/http/api";
import {ProductCard} from "../../shared/products/product-card";
import {Icon} from "../../shared/ui/icon";
import {GlassPanel,VisualButton} from "../../shared/ui/visual-primitives";
interface FavoriteGroup{product:Product|null;product_id:number;variants:Variant[];initial_variant_id:string;}
interface FavoritesPageData{items:FavoriteGroup[];page:number;total_pages:number;total:number;total_colors:number;category_counts?:{category_id:number;total:number}[];}
@Component({selector:'app-favorites-page',imports:[StorefrontSidebar,RouterLink,ProductCard,Icon,GlassPanel,VisualButton],styleUrl:'./favorites-page.css',template:`
 <div class="store-page-layout"><app-storefront-sidebar [filters]="true" [categories]="categories()" [counts]="categoryCounts()" [activeCategory]="category()" (categorySelected)="selectCategory($event)"/><section class="favorites-page" aria-labelledby="favorites-title">
  <header class="favorites-heading"><h1 id="favorites-title">My Favorites</h1></header>
  @if(error()){<div appGlass class="notice error" role="alert">{{error()}}<button appButton (click)="load()">Try again</button></div>}
  <div [attr.aria-busy]="loading()">
   @if(loading()&&!data()){<div class="favorites-grid" aria-label="Loading favorites">@for(n of [1,2,3,4];track n){<div appGlass class="favorite-skeleton" role="status"><span>Loading favorites…</span></div>}</div>}
   @if(data();as result){
    @if(result.items.length){<div class="favorites-grid">@for(group of result.items;track group.product_id){<app-product-card [product]="card(group)" [favoriteMode]="true" [productUnavailable]="!group.product" [initialVariantId]="group.initial_variant_id"/>}</div>}
    @else if(!error()&&category()){<div appGlass class="favorites-empty"><app-icon name="heart"/><h2>No favorites in this category</h2><p>Choose another category or return to all your saved items.</p></div>}
    @else if(!error()){<div appGlass class="favorites-empty"><span class="empty-emblem"><app-icon name="heart"/></span><h2>A place for your favorite colors</h2><p>Find an accessory you love and save a color with its heart.</p><a appButton class="button dark" routerLink="/">Find your next favorite <app-icon name="arrow-right"/></a></div>}
    @if(result.total_pages>1){<nav class="favorites-pagination" aria-label="Favorites pages"><button appButton [disabled]="loading()||result.page===1" (click)="changePage(result.page-1)">Previous</button><span>Page {{result.page}} of {{result.total_pages}}</span><button appButton [disabled]="loading()||result.page===result.total_pages" (click)="changePage(result.page+1)">Next</button></nav>}
   }
  </div>
 </section></div>`})
export class FavoritesPage{
 private filters=inject(StorefrontFilterState);private http=inject(HttpClient);private state=inject(FavoritesState);private auth=inject(AuthService);private request=0;private page=1;private subscription?:{unsubscribe:()=>void};
 private api=inject(Api);categories=signal<Category[]>([]);category=this.filters.favorites;
 categoryCounts=computed(()=>this.data()?.category_counts||[]);
 data=signal<FavoritesPageData|null>(null);loading=signal(false);error=signal('');
 constructor(){this.api.categories().pipe(takeUntilDestroyed()).subscribe({next:categories=>{this.categories.set(categories);if(this.category()&&!categories.some(c=>c.id===this.category()&&c.active!==false&&c.filter_visible!==false))this.selectCategory(0);},error:()=>{}});effect(()=>{this.state.revision();const user=this.auth.user()?.id;if(!user){this.request++;this.subscription?.unsubscribe();this.data.set(null);return;}untracked(()=>this.load());});inject(DestroyRef).onDestroy(()=>{this.request++;this.subscription?.unsubscribe();});}
 card(group:FavoriteGroup):Product{return group.product||({id:group.product_id,name:'Unavailable item',category:'Saved item',price:0,variants:group.variants,model_url:null} as unknown as Product);}
 load(){const request=++this.request;this.subscription?.unsubscribe();this.loading.set(true);this.error.set('');this.subscription=this.http.get<FavoritesPageData>(API_URL+'/account/favorites',{params:{page:this.page,category:this.category()}}).subscribe({next:data=>{if(request!==this.request)return;this.data.set(data);this.page=data.page;this.loading.set(false);},error:error=>{if(request!==this.request)return;this.error.set(errorMessage(error));this.loading.set(false);}});}
 selectCategory(category:number){if(this.category()===category)return;this.category.set(category);this.page=1;this.load();}
 changePage(page:number){this.page=page;this.load();}
}
