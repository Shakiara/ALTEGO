// ALTEGO necesita resolver la selección de contenido fijado en el perfil.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Icon} from "../ui/icon";
import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Product } from "../../core/http/api";
import { Model } from "../model-viewer/model";
import { ProfileEditState } from './profile-edit-state';
import { VisualButton, VisualField, VisualModal } from "../ui/visual-primitives";
@Component({ selector: 'app-profile-pin-selector', imports: [Icon, FormsModule, Model, VisualButton, VisualField, VisualModal], template: `
 @if(opened()){<dialog #pinDialog appModal class="profile-pin-dialog" aria-labelledby="pin-selector-title" (cancel)="close($event)"><div class="pin-dialog-heading"><h2 id="pin-selector-title">Choose a pinned item</h2><button type="button" class="icon-control" aria-label="Close pinned item selector" (click)="close()"><app-icon name="close"/></button></div><label class="pin-search">Search your published items<input appField type="search" [ngModel]="query()" (ngModelChange)="query.set($event)"/></label>
 <div class="pin-candidates">@for(product of candidates();track product.id){<article class="pin-candidate" [class.pin-selected]="state.draft()?.pinned_product_id===product.id"><div class="pin-thumbnail">@if(thumbnails().has(product.id)){<img [src]="thumbnails().get(product.id)!.url" [alt]="product.name"/>}@else{<app-model #itemModel [src]="product.model_url" [name]="product.name" [texture]="defaultTexture(product)" (previewReady)="capture($event,product,itemModel)"/>}</div><div><h3>{{product.name}}</h3>@if(state.draft()?.pinned_product_id===product.id){<p class="field-help">Selected</p>}<button appButton type="button" [disabled]="!thumbnails().has(product.id)" (click)="choose(product)">{{thumbnails().has(product.id)?'Pin Item':'Preparing thumbnail…'}}</button></div></article>}@empty{<p>No matching published items.</p>}</div>
 @if(error()){<p class="notice error" role="alert">{{error()}}</p>}<div class="pin-dialog-actions"><button appButton type="button" (click)="remove()">Remove Pin</button><button appButton type="button" (click)="close()">Close</button></div></dialog>}
`, styles: `:host{display:contents}.profile-pin-dialog{width:min(680px,calc(100vw - 24px));padding:24px!important;max-height:calc(100dvh - 24px);overflow:auto}.pin-dialog-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}.pin-dialog-heading h2{font-family:var(--font-display);font-size:28px;color:var(--color-brand);margin:0}.pin-search{display:grid;gap:8px;margin:18px 0}.pin-candidates{display:grid;gap:12px}.pin-candidate{display:grid;grid-template-columns:110px minmax(0,1fr);gap:16px;align-items:center;border:1px solid #fff9;border-radius:18px;padding:12px;background:#fff3}.pin-selected{outline:2px solid var(--color-brand)}.pin-candidate h3{font-size:17px;font-weight:500;overflow-wrap:anywhere}.pin-thumbnail{width:110px;height:110px;overflow:hidden;border-radius:14px;background:var(--gradient-active)}.pin-thumbnail app-model{display:block;width:110px;height:110px}.pin-thumbnail img{width:100%;height:100%;object-fit:contain}.pin-candidate button,.pin-dialog-actions button{padding:9px 12px;min-height:44px}.pin-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}@media(max-width:420px){.profile-pin-dialog{padding:18px!important}.pin-candidate{grid-template-columns:80px minmax(0,1fr);gap:10px;padding:10px}.pin-thumbnail,.pin-thumbnail app-model{width:80px;height:80px}.pin-candidate h3{font-size:15px}.pin-candidate button{font-size:12px}}
` })
export class ProfilePinSelector {
    state = inject(ProfileEditState);
    opened = signal(false);
    query = signal('');
    error = signal('');
    thumbnails = signal(new Map<number, {
        file: File;
        url: string;
    }>());
    private pending = new Set<number>();
    candidates = computed(() => this.state.baseline()?.products.filter(p => p.name.toLowerCase().includes(this.query().trim().toLowerCase())) || []);
    @ViewChild('pinDialog')
    set dialog(ref: ElementRef<HTMLDialogElement> | undefined) { if (ref && !ref.nativeElement.open)
        ref.nativeElement.showModal(); }
    show() { this.query.set(''); this.error.set(''); this.opened.set(true); }
    defaultTexture(p: Product) { return (p.variants.find(v => v.is_default) || p.variants[0])?.texture_url || null; }
    async capture(ready: boolean, p: Product, model: Model) { if (!ready || this.pending.has(p.id) || this.thumbnails().has(p.id))
        return; this.pending.add(p.id); try {
        await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        const viewer = model.viewer()?.nativeElement;
        if (!viewer?.loaded)
            return;
        const blob = await viewer.toBlob({ mimeType: 'image/webp', qualityArgument: .85, idealAspect: false }) as Blob;
        if (!blob || blob.size > 1024 * 1024)
            throw Error();
        if (!this.opened() || !this.state.active())
            return;
        const file = new File([blob], 'pinned-item.webp', { type: 'image/webp' });
        this.thumbnails.update(map => new Map(map).set(p.id, { file, url: this.state.objectUrl(file) }));
    }
    catch {
        this.error.set('Could not prepare an item thumbnail. Reopen the selector to retry.');
    }
    finally {
        this.pending.delete(p.id);
    } }
    choose(p: Product) { const thumbnail = this.thumbnails().get(p.id); if (!thumbnail)
        return; this.state.selectPin(p, thumbnail.file); this.opened.set(false); }
    remove() { this.state.selectPin(null); this.opened.set(false); }
    close(event?: Event) { event?.preventDefault(); this.opened.set(false); }
}
