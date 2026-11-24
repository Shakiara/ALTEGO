// ALTEGO necesita resolver las tarjetas de productos y variantes.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {LiveAvatar} from "../profile/live-avatar";
import {AuthService} from "../../core/auth/auth-service";
import {AddToBagButton} from "../commerce/add-to-bag-button";
import {CreatorBadges} from "../identity/verified-creator-badge";
import {AccountBadges} from "../identity/account-badges";
import {Icon} from "../ui/icon";
import { Component, ChangeDetectionStrategy, input, signal, computed, output, effect, untracked, inject } from '@angular/core';
import {VariantCarousel} from './variant-carousel';
import {FavoriteButton} from "../favorites/favorite-button";
import { CurrencyPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Product, Variant } from "../../core/http/api";
import { Model } from "../model-viewer/model";
import { GlassPanel, VisualButton } from "../ui/visual-primitives";

@Component({
  selector: 'app-product-card',
  imports:[LiveAvatar,AddToBagButton,AccountBadges, Icon, CurrencyPipe, RouterLink, Model, GlassPanel, VisualButton, FavoriteButton, VariantCarousel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './product-card.css',
  template: `
    <article appGlass class="product-card" [attr.data-product-id]="product().id" [class.has-pin-control]="canPin()" [class.is-pinned]="pinned()" [attr.aria-label]="pinned()?'Pinned: '+product().name:null">
     @if(pinned()){<span class="pinned-outline" aria-hidden="true"></span>}
     @if(canPin()){<button type="button" class="pin-control" [class.pin-active]="pinned()" [attr.aria-label]="pinned()?'Unpin Item':'Pin Item'" [attr.aria-pressed]="pinned()" [disabled]="pinBusy()" (click)="pinToggle.emit()"><app-icon name="pin"/></button>}
              <div class="product-art"><div class="card-labels"><span class="badge">{{product().category}}</span>@if(pinned()){<span class="pinned-badge"><app-icon name="pin-solid"/><span>PINNED</span></span>}</div>@if(variant()?.available!==false&&product().model_url){<app-model [returnOnHoverEnd]="true" [src]="product().model_url" [texture]="variant()?.texture_url||null" [name]="product().name" />}@else{<div class="unavailable-art"><app-icon name="cube"/><span>{{favoriteMode()?'Preview unavailable':'No preview'}}</span></div>}<app-favorite-button class="card-favorite" [productId]="product().id" [variantId]="variant()?.id||''" [variantName]="variant()?.name||'color'"/></div>
              <div class="product-info">@if(!productUnavailable()){<a class="product-title" [routerLink]="['/products',product().id]">{{product().name}}</a>}@else{<span class="product-title">Unavailable item</span>}<app-variant-carousel [variants]="product().variants" [selected]="variant()?.id" (selection)="selected.set($event)"/>@if(favoriteMode()){<p class="favorite-color-caption" role="status">{{variant()?.name}}</p>}@if(product().creator_name){<a class="creator-link" [routerLink]="['/creators',product().owner_id]">@if(creatorHasBadge()){<span class="creator-avatar" aria-hidden="true"><app-live-avatar [userId]="product().owner_id||0" [src]="creatorIdentity()?.avatar_url" [label]="creatorName()" fallback="icon"/></span>}<span class="creator-display-name" [title]="creatorName()">{{creatorName()}}</span> <app-account-badges [creatorId]="product().owner_id ?? 0" [verified]="product().verified_creator ?? false"/></a>}<div class="product-bottom"><span class="price" [class.unavailable-price]="productUnavailable()">{{productUnavailable()?'Unavailable':product().price===0?'FREE':(product().price | currency:'USD')}} <small>{{productUnavailable()||product().price===0?'':'USD'}}</small></span>@if(!productUnavailable()){<a appButton class="card-link" [routerLink]="['/products',product().id]" [attr.aria-label]="'Explore ' + product().name"><span>Explore</span><app-icon name="explore"/></a>@if(!ownProduct()){<app-add-to-bag [product]="product()" [variant]="variant()"/>}}@else{<span class="muted">Saved reference</span>}</div></div>
            </article>
  `
})
export class ProductCard {
 auth=inject(AuthService);ownProduct=computed(()=>!!this.auth.user()&&this.auth.user()!.id===this.product().owner_id);
 private readonly creatorBadges=inject(CreatorBadges);
 creatorIdentity=computed(()=>this.creatorBadges.readIdentity(this.product().owner_id??0));
 creatorName=computed(()=>this.creatorIdentity()?.display_name||this.product().creator_name||'');
 creatorHasBadge=computed(()=>!!this.creatorBadges.readRole(this.product().owner_id??0)||(this.creatorBadges.read(this.product().owner_id??0)??this.product().verified_creator??false));
 favoriteMode=input(false);productUnavailable=input(false);initialVariantId=input<string>();
 constructor(){effect(()=>{const product=this.product(),initial=this.initialVariantId();untracked(()=>{if(!product.variants.some(v=>v.id===this.selected()))this.selected.set(initial||product.variants.find(v=>v.is_default)?.id||product.variants[0]?.id||null);});});}
 pinned=input(false);canPin=input(false);pinBusy=input(false);pinToggle=output<void>(); product = input.required<Product>(); selected=signal<string|null>(null); variant=computed<Variant|undefined>(()=>this.product().variants.find(v=>v.id===this.selected())||this.product().variants.find(v=>v.id===this.initialVariantId())||this.product().variants.find(v=>v.is_default)||this.product().variants[0]); }
