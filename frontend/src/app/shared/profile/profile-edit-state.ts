// ALTEGO necesita resolver el estado de edición y guardado del perfil.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api, CreatorProfile, Product, errorMessage } from "../../core/http/api";
import { UiFeedback } from "../ui/ui-feedback";
import { ProfileDraft, ProfileImage, SocialLink } from './profile-types';
@Injectable()
export class ProfileEditState {
    private api = inject(Api);
    private ui = inject(UiFeedback);
    active = signal(false);
    busy = signal(false);
    pendingMedia = signal(false);
    baseline = signal<CreatorProfile | null>(null);
    draft = signal<ProfileDraft | null>(null);
    files: {
        avatar?: File;
        banner?: File;
        pin_thumbnail?: File;
    } = {};
    avatarPreview = signal<string | null>(null);
    bannerPreview = signal<string | null>(null);
    pinPreview = signal<string | null>(null);
    error = signal('');
    private urls = new Set<string>();
    private baselineFingerprint = '';
    private fileVersion = signal(0);
    dirty = computed(() => this.active() && (this.pendingMedia() || this.fileVersion() > 0 || JSON.stringify(this.draft()) !== this.baselineFingerprint));
    preview = computed<CreatorProfile | null>(() => { const p = this.baseline(), d = this.draft(); if (!p || !d)
        return p; const sorted = [...p.products].sort((a, b) => (a.profile_order ?? 0) - (b.profile_order ?? 0)), pin = sorted.find(item => item.id === d.pinned_product_id) || null; if (pin)
        sorted.splice(sorted.indexOf(pin), 1), sorted.unshift(pin); return { ...p, display_name: d.display_name, bio: d.bio || null, public_links: d.socials, avatar: d.avatar, banner: d.banner, avatar_url: d.avatar.kind === 'default' ? null : this.avatarPreview() || p.avatar_url, banner_url: d.banner.kind === 'upload' ? this.bannerPreview() || p.banner_url : null, pinned_product_id: d.pinned_product_id, pinned_item: pin ? { ...pin, thumbnail_url: this.pinPreview() || p.pinned_item?.thumbnail_url || null } : null, products: sorted }; });
    begin(profile: CreatorProfile) { this.clear(); this.baseline.set(profile); const d = { revision: profile.revision || 0, display_name: profile.display_name, bio: profile.bio || '', socials: structuredClone(profile.public_links) as SocialLink[], avatar: structuredClone(profile.avatar || { kind: 'default' }) as ProfileImage, banner: structuredClone(profile.banner || { kind: 'default' }) as ProfileImage, pinned_product_id: profile.pinned_product_id || null }; this.draft.set(d); this.baselineFingerprint = JSON.stringify(d); this.active.set(true); }
    update(patch: Partial<ProfileDraft>) { this.draft.update(d => d ? { ...d, ...patch } : d); this.error.set(''); }
    objectUrl(blob: Blob) { const url = URL.createObjectURL(blob); this.urls.add(url); return url; }
    selectImage(slot: 'avatar' | 'banner', choice: ProfileImage, file: File | undefined, preview: string | null) { if (file)
        this.files[slot] = file;
    else
        delete this.files[slot]; this.update({ [slot]: choice }); (slot === 'avatar' ? this.avatarPreview : this.bannerPreview).set(preview); this.fileVersion.update(v => v + 1); this.pendingMedia.set(false); }
    selectPin(product: Product | null, file?: File) { this.update({ pinned_product_id: product?.id || null }); if (file) {
        this.files.pin_thumbnail = file;
        this.pinPreview.set(this.objectUrl(file));
        this.fileVersion.update(v => v + 1);
    }
    else {
        delete this.files.pin_thumbnail;
        this.pinPreview.set(null);
    } }
    async confirmDiscard() { if (this.busy())
        return false; if (this.dirty() && !await this.ui.confirm({ title: 'Discard profile changes?', description: 'Your unsaved profile changes will be lost. Cancel to continue editing.', confirmLabel: 'Discard Changes', danger: true }))
        return false; this.clear(); return true; }
    async save() { if (this.busy() || !this.draft())
        return null; const d = this.draft()!; if (!d.display_name.trim() || Array.from(d.display_name.trim()).length > 30) {
        this.error.set('Display Name must contain 1–30 characters.');
        return null;
    } if (Array.from(d.bio).length > 500) {
        this.error.set('Bio must contain at most 500 characters.');
        return null;
    } if (d.socials.length > 5 || d.socials.some(s => !s.label.trim() || !s.url.trim())) {
        this.error.set('Complete each social link or remove it.');
        return null;
    } for (const social of d.socials) {
        try {
            const url = new URL(social.url);
            if (url.protocol !== 'https:' || url.username || url.password)
                throw Error();
        }
        catch {
            this.error.set('Social links must use a valid HTTPS URL.');
            return null;
        }
    } const form = new FormData(); form.set('profile', JSON.stringify(d)); for (const slot of ['avatar', 'banner', 'pin_thumbnail'] as const)
        if (this.files[slot])
            form.set(slot === 'pin_thumbnail' ? slot : slot + '_file', this.files[slot]!); this.busy.set(true); try {
        const saved = await firstValueFrom(this.api.saveProfile(form));
        this.clear();
        this.ui.notify('Profile updated.');
        return saved;
    }
    catch (e) {
        this.error.set(errorMessage(e));
        this.ui.notify(errorMessage(e), 'error');
        return null;
    }
    finally {
        this.busy.set(false);
    } }
    async original(image: ProfileImage) { if (!image.media_id)
        return null; return firstValueFrom(this.api.profileOriginal(image.media_id)); }
    clear() { for (const url of this.urls)
        URL.revokeObjectURL(url); this.urls.clear(); this.files = {}; this.fileVersion.set(0); this.active.set(false); this.pendingMedia.set(false); this.draft.set(null); this.avatarPreview.set(null); this.bannerPreview.set(null); this.pinPreview.set(null); this.error.set(''); }
}
