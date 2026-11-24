// ALTEGO necesita resolver la presentación individual de productos y variantes.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {ActionMenu} from "../../shared/ui/action-menu";
import {AddToBagButton} from "../../shared/commerce/add-to-bag-button";
import {ConversationReport} from "../../shared/community/conversation-report";
import {ViewChild} from '@angular/core';
import {AccountBadges} from "../../shared/identity/account-badges";
import {Icon} from "../../shared/ui/icon";
import {HttpErrorResponse} from '@angular/common/http';
import {UiFeedback} from "../../shared/ui/ui-feedback";
import {FavoriteButton} from "../../shared/favorites/favorite-button";
import { AuthService } from "../../core/auth/auth-service";
import { GlassPanel, VisualButton, VisualField } from "../../shared/ui/visual-primitives";
import { Component, inject, signal, computed } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, Product, Review, errorMessage } from "../../core/http/api";
import { Model } from "../../shared/model-viewer/model";
@Component({
  selector: 'app-product-detail',styleUrl:'./product-detail.css', imports: [ActionMenu,AddToBagButton,ConversationReport,AccountBadges, Icon, GlassPanel, VisualButton, VisualField, CurrencyPipe, DatePipe, FormsModule, RouterLink, Model, FavoriteButton],
  template: `
    <app-conversation-report/>
    <a class="back-link" routerLink="/"><app-icon name="arrow-left"/> Back to the collection</a>

    @if(notFound()){<section appGlass class="access-state"><h1>Item Not Found</h1><p>This item is unavailable or no longer exists.</p><a class="button" routerLink="/">Back to Catalog</a></section>}
    @else if(error()) { <div appGlass class="notice error" role="alert">{{error()}}<button appButton class="button" (click)="load()">Try again</button></div> }
    @if(loading()) { <div appGlass class="empty" role="status">Loading item…</div> }
    @if(product(); as p) {
      <section class="detail-grid"><div appGlass class="detail-art"><app-model [src]="p.model_url" [texture]="p.variants[selectedVariant()]?.texture_url||null" [name]="p.name" [detail]="true" /></div>
        <div appGlass class="detail-copy"><div class="detail-heading-row"><span class="eyebrow">{{p.category}} / DIGITAL ITEM</span><div class="detail-toolbar">@if(auth.user();as actor){@if(p.owner_id!==actor.id){<button class="icon-control detail-report" type="button" title="Report" aria-label="Report this item" (click)="report.openProduct(p.id,actor.id)"><app-icon name="flag"/></button>}}<app-favorite-button class="detail-favorite" [productId]="p.id" [variantId]="p.variants[selectedVariant()]?.id||''" [variantName]="p.variants[selectedVariant()]?.name||'color'"/></div></div><h1>{{p.name}}</h1>@if(p.creator_name){<a class="creator-link" [routerLink]="['/creators',p.owner_id]">by {{p.creator_name}} <app-account-badges [creatorId]="p.owner_id ?? 0" [verified]="p.verified_creator ?? false"/></a>}<div class="detail-price">{{p.price===0?'FREE':(p.price | currency:'USD')}} <small>{{p.price===0?'':'USD'}}</small></div><p class="item-description">{{p.description}}</p><div class="swatches">@for(v of p.variants;track v.id;let i=$index){<button [style.background]="v.hex" [attr.aria-label]="v.name" [attr.aria-pressed]="selectedVariant()===i" (click)="selectedVariant.set(i)"></button>}</div><p class="variant-caption">{{p.variants[selectedVariant()]?.name}}@if(p.status!=='Published'){<span class="status-caption">{{p.status}}</span>}</p>
          <div class="specs"><div><span>Category</span><b>{{p.category}}</b></div><div><span>Rating</span><b>{{reviews().length ? average() + ' / 5' : 'No reviews yet'}}</b></div></div>@if(!ownProduct()){<app-add-to-bag [product]="p" [variant]="p.variants[selectedVariant()]"/>}
          @if(ownProduct()){<div class="detail-actions"><a appButton class="button dark" [routerLink]="['/products',p.id,'edit']">Edit Item <app-icon name="edit"/></a><button appButton class="button danger" (click)="askRemove()" [disabled]="deleting()">Move to Trash</button></div>
          }
          @if(actionError()) { <p appGlass class="notice error" role="alert">{{actionError()}}</p> }

        </div>
      </section>
      <section id="reviews" tabindex="-1" class="review-section" aria-labelledby="community-title"><h2 id="community-title" class="community-heading"><span class="eyebrow">FROM THE COMMUNITY</span><span class="count" [attr.aria-label]="reviews().length+' reviews'">{{reviews().length}}</span></h2><div class="community-column">
        @if(reviewLoading()) { <p role="status">Loading reviews…</p> }
        @if(reviewError()) { <div appGlass class="notice error" role="alert">{{reviewError()}}<button appButton (click)="loadReviews()" class="button">Try again</button></div> }
        <div class="review-scroll" role="region" aria-label="Community reviews" tabindex="0">@for(r of reviews(); track r._id) { <article appGlass class="review"><div class="review-top"><div class="review-author">@if(!r.is_anonymous&&r.author_id){<a class="review-avatar" [routerLink]="['/creators',r.author_id]" [attr.aria-label]="'View '+r.author+' profile'">{{r.author.slice(0,1).toUpperCase()}}</a><a class="review-handle" [routerLink]="['/creators',r.author_id]">{{'@'+r.author}}</a><app-account-badges [creatorId]="r.author_id" [verified]="false"/>}@else{<span class="review-avatar generic-avatar" aria-hidden="true"><app-icon name="user"/></span><strong>{{r.is_anonymous?'Anonymous':r.author}}</strong>@if(r.is_anonymous&&r.author_identity){<span class="anonymous-identity">({{'@'+r.author_identity.username}})</span>}}</div>@if(r.verified_purchase){<span class="verified-purchase"><app-icon name="success"/>Verified Purchase</span>}<span class="stars" role="img" [attr.aria-label]="r.rating + ' out of 5 stars'">@for(star of [1,2,3,4,5];track star){<app-icon [name]="star<=r.rating?'star':'star-outline'"/>}</span>@if(auth.user()&&(r.permissions?.can_edit||r.permissions?.can_delete||r.permissions?.can_report)){<app-action-menu [compact]="true" label="Review actions" [disabled]="saving()||reviewBusy()">@if(r.permissions!.can_edit){<button type="button" role="menuitem" (click)="editReview(r)"><app-icon name="edit"/>Edit Review</button>}@if(r.permissions!.can_report){<button type="button" role="menuitem" (click)="report.openReview(r._id,auth.user()!.id)"><app-icon name="flag"/>Report Review</button>}@if(r.permissions!.can_delete){<button type="button" role="menuitem" class="menu-danger" (click)="deleteReview(r)"><app-icon name="trash"/>Delete Review</button>}</app-action-menu>}</div><p>{{r.comment}}</p><small>{{r.created_at | date:'dd/MM/yyyy'}}@if(r.edited_at){<span class="edited-review" [title]="r.edited_at|date:'medium'"> · Edited</span>}</small></article> }
        @if(!reviewLoading() && !reviewError() && !reviews().length) { <p class="muted">Be the first to share your thoughts.</p> }
        </div>
      </div>@if(auth.user() && (p.status==='Published'||editingReview())){<form appGlass #form="ngForm" class="review-form" (ngSubmit)="submitReview(form)"><h3>{{editingReview()?'Edit Review':'Your opinion matters'}}</h3>
        @if(!editingReview()){<fieldset class="identity-picker"><legend>Post as</legend><label [class.active]="!draft.is_anonymous"><input type="radio" name="identity" [value]="false" [(ngModel)]="draft.is_anonymous">Public</label><label [class.active]="draft.is_anonymous"><input type="radio" name="identity" [value]="true" [(ngModel)]="draft.is_anonymous">Anonymous</label></fieldset>}
        <label>Rating<select appField name="rating" [(ngModel)]="draft.rating" required><option [ngValue]="5">★★★★★ — 5 stars</option><option [ngValue]="4">★★★★☆ — 4 stars</option><option [ngValue]="3">★★★☆☆ — 3 stars</option><option [ngValue]="2">★★☆☆☆ — 2 stars</option><option [ngValue]="1">★☆☆☆☆ — 1 star</option></select></label>
        <label>Comment<textarea appField name="comment" [(ngModel)]="draft.comment" required maxlength="2000" rows="4" placeholder="Tell us what you like…"></textarea></label>
        @if(submitError()) { <p appGlass class="notice error" role="alert">{{submitError()}}</p> }

        <button appButton class="button dark" type="submit" [disabled]="saving() || form.invalid">{{saving() ? (editingReview()?'Saving…':'Publishing…') : (editingReview()?'Save Changes':'Post review')}} <app-icon name="arrow-right"/></button>
      @if(editingReview()){<button appButton type="button" [disabled]="saving()" (click)="cancelReviewEdit()">Cancel</button>}</form>}@else{<div appGlass class="review-form"><h3>{{p.status==='Published'?'Share your thoughts':'Reviews are closed for this item'}}</h3>@if(!auth.user()&&p.status==='Published'){<a class="button" routerLink="/login">Log In to write a review</a>}</div>}</section>
    }
  `
})
export class ProductDetail {
 @ViewChild(ConversationReport)report!:ConversationReport;
  private ui=inject(UiFeedback);
  selectedVariant=signal(0);notFound=signal(false);
  auth=inject(AuthService);
  ownProduct=computed(()=>!!this.auth.user()&&this.auth.user()!.id===this.product()?.owner_id);

  private api = inject(Api); private route = inject(ActivatedRoute); private router = inject(Router);
  private productId = Number(this.route.snapshot.paramMap.get('id'));
  product = signal<Product | null>(null); reviews = signal<Review[]>([]);
  loading = signal(true); error = signal(''); reviewLoading = signal(true); reviewError = signal('');
  confirmDelete = signal(false); deleting = signal(false); actionError = signal('');
  saving = signal(false); submitError = signal(''); success = signal(false);
  editingReview=signal<Review|null>(null);reviewBusy=signal(false);private previousDraft?:{is_anonymous:boolean;rating:number;comment:string};
  draft = { is_anonymous: false, rating: 5, comment: '' };
  average = computed(() => (this.reviews().reduce((total, r) => total + r.rating, 0) / this.reviews().length).toFixed(1));
  constructor() { this.load(); }
  load() { this.loading.set(true); this.error.set('');this.notFound.set(false);this.product.set(null); this.api.product(this.productId).subscribe({next:p=>{this.product.set(p);const color=this.route.snapshot.queryParamMap.get('variant');const selected=p.variants.findIndex(v=>v.id===color);this.selectedVariant.set(selected>=0?selected:Math.max(0,p.variants.findIndex(v=>v.is_default)));this.loading.set(false);this.loadReviews();},error:e=>{this.notFound.set(e instanceof HttpErrorResponse&&e.status===404);this.error.set(errorMessage(e));this.loading.set(false);}}); }
  loadReviews() { this.reviewLoading.set(true); this.reviewError.set(''); this.api.reviews(this.productId).subscribe({next:r=>{this.reviews.set(r);this.reviewLoading.set(false);if(this.route.snapshot.fragment==='reviews')requestAnimationFrame(()=>{const target=document.querySelector<HTMLElement>('.review-form textarea')||document.querySelector<HTMLElement>('#reviews');target?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});target?.focus({preventScroll:true});});},error:e=>{this.reviewError.set(errorMessage(e));this.reviewLoading.set(false);}}); }
  async askRemove(){if(await this.ui.confirm({title:'Move to Trash?',description:'This item will be hidden publicly. You can restore it as a Draft within 30 days.',danger:true}))this.remove();}
  remove() { if(this.deleting()) return; this.deleting.set(true); this.actionError.set(''); this.api.state(this.productId,'Trash').subscribe({next:()=>{this.ui.notify('Item moved to Trash.');void this.router.navigateByUrl('/my-items');},error:e=>{this.actionError.set(errorMessage(e));this.ui.notify(errorMessage(e),'error');this.deleting.set(false);}}); }
  async editReview(review:Review){if(this.saving()||!review.permissions?.can_edit)return;if(this.editingReview()&&!await this.ui.confirm({title:'Discard changes?',description:'Open another review without saving these changes?',confirmLabel:'Discard'}))return;if(!this.editingReview())this.previousDraft={...this.draft};this.editingReview.set(review);this.draft={is_anonymous:review.is_anonymous,rating:review.rating,comment:review.comment};this.submitError.set('');requestAnimationFrame(()=>{const field=document.querySelector<HTMLTextAreaElement>('.review-form textarea');field?.scrollIntoView({block:'center',behavior:'auto'});field?.focus({preventScroll:true});});}
  cancelReviewEdit(){this.editingReview.set(null);this.draft=this.previousDraft||{is_anonymous:false,rating:5,comment:''};this.previousDraft=undefined;this.submitError.set('');}
  async deleteReview(review:Review){if(this.reviewBusy()||!review.permissions?.can_delete)return;if(!await this.ui.confirm({title:'Delete Review?',description:'This review will no longer appear on the product.',confirmLabel:'Delete Review',danger:true,dismissOnBackdrop:true}))return;this.reviewBusy.set(true);this.api.deleteReview(review._id).subscribe({next:()=>{this.reviews.update(rows=>rows.filter(r=>r._id!==review._id));if(this.editingReview()?._id===review._id)this.cancelReviewEdit();this.reviewBusy.set(false);this.ui.notify('Review deleted.');},error:error=>{this.reviewBusy.set(false);this.ui.notify(errorMessage(error),'error');}});}
  private pendingReview?:{signature:string;key:string};
  submitReview(form: NgForm) {
    if(form.invalid || this.saving()) return;
    this.saving.set(true);this.submitError.set('');this.success.set(false);
    const editing=this.editingReview();if(editing){this.api.updateReview(editing._id,{rating:this.draft.rating,comment:this.draft.comment,revision:editing.revision??0}).subscribe({next:r=>{this.reviews.update(rows=>rows.map(row=>row._id===r._id?r:row));this.saving.set(false);this.cancelReviewEdit();this.ui.notify('Review updated.');},error:error=>{this.saving.set(false);this.submitError.set(errorMessage(error));this.ui.notify(errorMessage(error),'error');}});return;}
    const body={...this.draft,product_id:this.productId},signature=JSON.stringify([this.auth.user()?.id,body]);if(this.pendingReview?.signature!==signature)this.pendingReview={signature,key:crypto.randomUUID()};
    this.api.review(body,this.pendingReview!.key).subscribe({next:r=>{this.pendingReview=undefined;this.reviews.update(list=>[r,...list.filter(x=>x._id!==r._id)]);this.saving.set(false);form.resetForm({identity:this.draft.is_anonymous,rating:5,comment:''});this.success.set(true);this.ui.notify('Your review was posted successfully.');},error:e=>{this.submitError.set(errorMessage(e));this.ui.notify(errorMessage(e),'error');this.saving.set(false);}});
  }
}
