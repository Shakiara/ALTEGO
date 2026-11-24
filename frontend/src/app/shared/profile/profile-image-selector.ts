// ALTEGO necesita resolver la selección y previsualización de imágenes de perfil.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Icon} from "../ui/icon";
import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Api, assetUrl, errorMessage } from "../../core/http/api";
import { VisualButton, VisualField, VisualModal } from "../ui/visual-primitives";
import { ProfileEditState } from './profile-edit-state';
import { ProfileImage, Framing, bannerPresets, defaultFraming } from './profile-types';
@Component({ selector: 'app-profile-image-selector', imports: [Icon, FormsModule, VisualButton, VisualField, VisualModal], template: `
 @if(opened()){
 <dialog #mediaDialog appModal class="profile-image-dialog" [style.--banner-ratio]="bannerRatio()" aria-labelledby="image-selector-title" (cancel)="close($event)">
  <div class="media-dialog-heading"><h2 id="image-selector-title">{{slot()==='avatar'?'Choose avatar':'Choose banner'}}</h2><button type="button" class="icon-control" aria-label="Close image selector" (click)="close()"><app-icon name="close"/></button></div>
  <div class="media-source-tabs" aria-label="Image source"><button appButton type="button" [attr.aria-pressed]="tab()==='upload'" (click)="tab.set('upload')">Upload Image</button><button appButton type="button" [attr.aria-pressed]="tab()==='other'" (click)="tab.set('other')">{{slot()==='avatar'?'Roblox Avatar':'Presets'}}</button></div>
  @if(tab()==='upload'){<label class="media-upload-label">{{slot()==='avatar'?'PNG, JPEG or WebP · up to 10 MB':'PNG, JPEG or WebP · up to 20 MB'}}<input appField type="file" accept="image/png,image/jpeg,image/webp" (change)="upload($event)"/></label>}
  @else if(slot()==='avatar'){<div class="roblox-lookup"><form class="roblox-search" (ngSubmit)="lookup()"><label>Roblox username or User ID<input appField name="robloxQuery" [(ngModel)]="query" (ngModelChange)="invalidateLookup()" maxlength="30" autocomplete="off"/></label><button appButton type="submit" [disabled]="busy()||!query.trim()">{{busy()?'Searching…':'Find Headshot'}}</button></form><div class="roblox-lookup-feedback" aria-live="polite">@if(error()){<p class="notice error" role="alert">{{error()}}</p>}@else{<p class="roblox-result">{{busy()?'Searching…':robloxName()}}</p>}</div></div>}
  @else{<div class="banner-presets">@for(preset of presets;track preset.id){<button type="button" [style.background]="preset.background" [attr.aria-pressed]="choice().kind==='preset'&&choice().preset===preset.id" (click)="choosePreset(preset.id)">{{preset.label}}</button>}</div>}
  @if(error()&&!(slot()==='avatar'&&tab()==='other')){<p class="notice error" role="alert">{{error()}}</p>}
  @if(source()){
   <div class="crop-frame" [class.avatar-frame]="slot()==='avatar'" [class.banner-frame]="slot()==='banner'" [style.aspect-ratio]="slot()==='avatar'?'1':bannerRatio()" (pointerdown)="startDrag($event)" (pointermove)="drag($event)" (pointerup)="stopDrag()" (pointercancel)="stopDrag()">
    <img [src]="source()" alt="Image framing preview" draggable="false" [style.object-position]="framing().x+'% '+framing().y+'%'" [style.transform]="'scale('+framing().zoom+')'" [style.transform-origin]="framing().x+'% '+framing().y+'%'"/>
   </div>
   <p class="field-help">Drag the image, or use the controls to adjust its framing.</p>
   <div class="crop-controls"><label>Zoom <output>{{framing().zoom.toFixed(2)}}×</output><input type="range" min="1" max="4" step="0.01" [ngModel]="framing().zoom" (ngModelChange)="frame('zoom',$event)"/></label><label>Horizontal position<input type="range" min="0" max="100" step="1" [ngModel]="framing().x" (ngModelChange)="frame('x',$event)"/></label><label>Vertical position<input type="range" min="0" max="100" step="1" [ngModel]="framing().y" (ngModelChange)="frame('y',$event)"/></label></div>
  }@else if(choice().kind==='preset'){<div class="preset-preview" [style.background]="presetBackground()" [style.aspect-ratio]="bannerRatio()" aria-label="Selected banner preview"></div>}
  <div class="media-dialog-actions"><button appButton type="button" (click)="useDefault()">Use Default</button><span></span><button appButton type="button" (click)="close()">Cancel</button><button appButton type="button" class="dark" [disabled]="busy()||!validChoice()" (click)="confirm()">Use {{slot()==='avatar'?'Avatar':'Banner'}}</button></div>
 </dialog>}
`, styleUrl: './profile-image-selector.css' })
export class ProfileImageSelector {
    state = inject(ProfileEditState);
    private api = inject(Api);
    opened = signal(false);
    validChoice = signal(true);
    slot = signal<'avatar' | 'banner'>('avatar');
    tab = signal<'upload' | 'other'>('upload');
    source = signal<string | null>(null);
    framing = signal<Framing>(defaultFraming());
    choice = signal<ProfileImage>({ kind: 'default' });
    busy = signal(false);
    error = signal('');
    robloxName = signal('');
    bannerRatio = signal('5');
    query = '';
    presets = bannerPresets;
    private selectedFile?: File;
    private image?: HTMLImageElement;
    private request = 0;
    private panelObserver?: ResizeObserver;
    private gesture: {
        x: number;
        y: number;
        fx: number;
        fy: number;
        width: number;
        height: number;
    } | null = null;
    presetBackground = computed(() => this.presets.find(p => p.id === this.choice().preset)?.background || '');
    @ViewChild('mediaDialog')
    set modal(ref: ElementRef<HTMLDialogElement> | undefined) { if (ref && !ref.nativeElement.open)
        ref.nativeElement.showModal(); }
    async show(slot: 'avatar' | 'banner', ratio = 5) { this.request++; this.busy.set(false); this.validChoice.set(true); this.slot.set(slot); this.bannerRatio.set(String(Math.max(1, ratio))); this.tab.set('upload'); this.error.set(''); this.query = ''; this.robloxName.set(''); this.source.set(null); this.image = undefined; const choice = structuredClone(this.state.draft()![slot]); this.choice.set(choice); this.framing.set(choice.crop || defaultFraming()); this.selectedFile = this.state.files[slot]; this.opened.set(true); this.panelObserver?.disconnect(); const panel = document.querySelector('.profile-panel'); if (panel) {
        const update = () => { const r = panel.getBoundingClientRect(); this.bannerRatio.set(String(Math.max(1, r.width / Math.max(1, r.height)))); };
        this.panelObserver = new ResizeObserver(update);
        this.panelObserver.observe(panel);
        update();
    } const request = this.request; try {
        let blob: Blob | null = null;
        if (this.selectedFile)
            blob = this.selectedFile;
        else if (choice.media_id)
            blob = await this.state.original(choice);
        else if (choice.roblox_token) {
            blob = await firstValueFrom(this.api.imageBlob(assetUrl('/api/profile/roblox/previews/' + choice.roblox_token)!));
        }
        if (blob && request === this.request)
            await this.load(blob, request);
    }
    catch (e) {
        if (request === this.request) this.error.set(errorMessage(e));
    } }
    async load(blob: Blob, request = this.request) { const url = this.state.objectUrl(blob), image = new Image(); image.src = url; await image.decode(); if (image.naturalWidth * image.naturalHeight > 40000000)
        throw Error('Use an image with at most 40 million pixels.'); if (request !== this.request || !this.opened())
        return false; this.image = image; this.source.set(url); return true; }
    async upload(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file)
        return; const request = ++this.request; this.validChoice.set(false); this.error.set(''); if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > (this.slot() === 'avatar' ? 10 : 20) * 1024 * 1024) {
        this.error.set('Choose a PNG, JPEG or WebP within the size limit.');
        return;
    } try {
        if (!await this.load(file, request))
            return;
        this.validChoice.set(true);
        this.selectedFile = file;
        this.choice.set({ kind: 'upload' });
        this.framing.set(defaultFraming());
        this.state.pendingMedia.set(true);
    }
    catch {
        this.error.set('This image could not be decoded.');
    } }
    frame(key: keyof Framing, value: number) { this.framing.update(c => ({ ...c, [key]: Number(value) })); this.state.pendingMedia.set(true); }
    startDrag(event: PointerEvent) { if (!this.image)
        return; const target = event.currentTarget as HTMLElement, r = target.getBoundingClientRect(), scale = Math.max(r.width / this.image.naturalWidth, r.height / this.image.naturalHeight) * this.framing().zoom; this.gesture = { x: event.clientX, y: event.clientY, fx: this.framing().x, fy: this.framing().y, width: Math.max(0, this.image.naturalWidth * scale - r.width), height: Math.max(0, this.image.naturalHeight * scale - r.height) }; target.setPointerCapture(event.pointerId); }
    drag(event: PointerEvent) { const g = this.gesture; if (!g)
        return; this.framing.update(c => ({ ...c, x: g.width ? Math.max(0, Math.min(100, g.fx - (event.clientX - g.x) / g.width * 100)) : c.x, y: g.height ? Math.max(0, Math.min(100, g.fy - (event.clientY - g.y) / g.height * 100)) : c.y })); this.state.pendingMedia.set(true); }
    stopDrag() { this.gesture = null; }
    invalidateLookup() { this.request++; this.busy.set(false); this.robloxName.set(''); this.validChoice.set(false); }
    async lookup() { const request = ++this.request; this.busy.set(true); this.validChoice.set(false); this.error.set(''); try {
        const found = await firstValueFrom(this.api.robloxAvatar(this.query));
        const blob = await firstValueFrom(this.api.imageBlob(assetUrl(found.preview_url)!));
        if (request !== this.request)
            return;
        if (!await this.load(blob, request))
            return;
        this.validChoice.set(true);
        this.selectedFile = undefined;
        this.choice.set({ kind: 'roblox', roblox_token: found.token, roblox_user_id: found.id, roblox_username: found.username });
        this.robloxName.set(found.display_name + ' (@' + found.username + ')');
        this.framing.set(defaultFraming());
        this.state.pendingMedia.set(true);
    }
    catch (e) {
        if (request === this.request)
            this.error.set(errorMessage(e));
    }
    finally {
        if (request === this.request)
            this.busy.set(false);
    } }
    choosePreset(preset: string) { this.request++; this.busy.set(false); this.validChoice.set(true); this.choice.set({ kind: 'preset', preset }); this.source.set(null); this.selectedFile = undefined; this.state.pendingMedia.set(true); }
    useDefault() { this.request++; this.busy.set(false); this.validChoice.set(true); this.choice.set({ kind: 'default' }); this.source.set(null); this.selectedFile = undefined; this.state.pendingMedia.set(true); }
    async confirm() {
        if (this.busy() || !this.validChoice())
            return;
        const request = this.request;
        this.error.set('');
        let preview: string | null = null;
        const choice = this.choice();
        if (['upload', 'roblox'].includes(choice.kind)) {
            if (!this.image || !this.source()) {
                this.error.set('Choose an image first.');
                return;
            }
            if (this.slot() === 'avatar') {
                const c = this.framing(), side = Math.max(1, Math.floor(Math.min(this.image.naturalWidth, this.image.naturalHeight) / c.zoom)), canvas = document.createElement('canvas');
                canvas.width = 512;
                canvas.height = 512;
                canvas.getContext('2d')!.drawImage(this.image, Math.round((this.image.naturalWidth - side) * c.x / 100), Math.round((this.image.naturalHeight - side) * c.y / 100), side, side, 0, 0, 512, 512);
                const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/webp', .9));
                if (!blob) {
                    this.error.set('Could not prepare the avatar preview.');
                    return;
                }
                preview = this.state.objectUrl(blob);
            }
            else
                preview = this.source();
        }
        if (request !== this.request || !this.opened() || !this.state.active())
            return;
        this.state.selectImage(this.slot(), { ...choice, ...(['upload', 'roblox'].includes(choice.kind) ? { crop: this.framing() } : {}) }, this.selectedFile, preview);
        this.opened.set(false);
        this.panelObserver?.disconnect();
        this.request++;
    }
    ngOnDestroy() { this.panelObserver?.disconnect(); this.request++; }
    close(event?: Event) { event?.preventDefault(); this.opened.set(false); this.panelObserver?.disconnect(); this.request++; this.busy.set(false); this.state.pendingMedia.set(false); }
}
