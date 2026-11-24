// ALTEGO necesita resolver la gestión de favoritos de la variante seleccionada.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,inject,input} from '@angular/core';
import {Icon} from "../ui/icon";
import {FavoritesState} from "../../core/favorites/favorites-state";
@Component({selector:'app-favorite-button',imports:[Icon],template:`<button type="button" class="icon-control favorite-control" [class.is-saved]="saved()" [attr.aria-pressed]="saved()" [attr.aria-label]="label()" [title]="label()" [disabled]="!variantId()||favorites.busy(productId(),variantId())" [attr.aria-busy]="favorites.busy(productId(),variantId())" (click)="favorites.toggle(productId(),variantId())"><app-icon name="heart"/></button>`,styles:`
 .favorite-control{transition:color .18s,background .18s,transform .18s}.is-saved{color:#ae4f7d!important;background:#f9dce9c9!important;box-shadow:inset 0 1px #fffd,0 2px 10px #bc729524}
 .is-saved app-icon{filter:drop-shadow(0 1px 2px #c3789740)}.is-saved{animation:favorite-set .28s ease-out}.favorite-control:active:not(:disabled){transform:scale(.94)}.favorite-control:focus-visible{outline:2px solid var(--color-focus);outline-offset:3px}.favorite-control:disabled{opacity:.55;cursor:wait}@keyframes favorite-set{50%{transform:scale(1.12)}}@media(prefers-reduced-motion:reduce){.favorite-control{animation:none;transition:none;transform:none!important}}`})
export class FavoriteButton{
 favorites=inject(FavoritesState);productId=input.required<number>();variantId=input.required<string>();variantName=input('color');
 saved(){return this.favorites.saved(this.productId(),this.variantId());}
 label(){return (this.saved()?'Remove ':'Save ')+this.variantName()+(this.saved()?' from favorites':' to favorites');}
}
