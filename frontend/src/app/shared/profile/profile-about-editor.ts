// ALTEGO necesita resolver la edición del contenido About del perfil.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { Component, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ProfileEditState } from './profile-edit-state';
import { ProfilePinSelector } from './profile-pin-selector';
import { GlassPanel, VisualButton, VisualField } from "../ui/visual-primitives";
import { Icon } from "../ui/icon";
@Component({ selector: 'app-profile-about-editor', imports: [FormsModule, ProfilePinSelector, GlassPanel, VisualButton, VisualField, Icon], template: `
 @if(state.draft();as draft){<div appGlass class="profile-about-surface profile-about-editor">
  <div class="about-heading"><h2>About</h2><span class="editing-status">Editing</span></div>
  <fieldset class="about-content" [disabled]="state.busy()">
   <section class="about-bio" aria-labelledby="bio-heading"><h3 id="bio-heading"><label for="profile-bio">Bio</label></h3>
    <textarea appField id="profile-bio" rows="3" [ngModel]="draft.bio" (ngModelChange)="state.update({bio:$event})" aria-describedby="bio-count" [attr.aria-invalid]="length(draft.bio)>500" placeholder="A little about you…"></textarea>
    <p id="bio-count" class="bio-count" [class.counter-warning]="length(draft.bio)>=450" [class.error]="length(draft.bio)>500" aria-live="polite">{{length(draft.bio)}} / 500</p>
   </section>
   <section class="about-socials" aria-labelledby="socials-heading"><div class="section-heading"><h3 id="socials-heading">Socials</h3><span class="section-count" aria-label="Social link count">{{draft.socials.length}} / 5</span></div>
    <div class="social-edit-list">@for(link of draft.socials;track link.id;let index=$index){
     <div class="social-edit-row"><app-icon class="social-platform-icon" [name]="link.platform==='custom'?'link':link.platform"/>
      <label class="social-platform"><span class="sr-only">Platform</span><select appField [ngModel]="link.platform" (ngModelChange)="platform(index,$event)">@for(platform of platforms;track platform.id){<option [value]="platform.id">{{platform.label}}</option>}</select></label>
      <label class="social-name"><span class="sr-only">Visible name</span><input appField [ngModel]="link.label" (ngModelChange)="change(index,'label',$event)" maxlength="40" placeholder="Visible name"/></label>
      <label class="social-url"><span class="sr-only">HTTPS URL</span><input appField type="url" [ngModel]="link.url" (ngModelChange)="change(index,'url',$event)" placeholder="https://" maxlength="2048"/></label>
      <div class="social-row-actions"><button type="button" class="icon-control" [disabled]="index===0" [attr.aria-label]="'Move '+(link.label||'link')+' up'" (click)="move(index,-1)"><app-icon name="arrow-up"/></button><button type="button" class="icon-control" [disabled]="index===draft.socials.length-1" [attr.aria-label]="'Move '+(link.label||'link')+' down'" (click)="move(index,1)"><app-icon name="arrow-down"/></button><button type="button" class="icon-control" [attr.aria-label]="'Remove '+(link.label||'link')" (click)="remove(index)"><app-icon name="trash"/></button></div>
     </div>
    }</div><button appButton class="add-link" type="button" [disabled]="draft.socials.length>=5" (click)="add()"><app-icon name="plus"/><span>Add Link</span></button>
   </section>
   <section class="about-pin" aria-labelledby="pinned-heading"><h3 id="pinned-heading">Pinned Item</h3>
    @if(state.preview()?.pinned_item;as pinned){<div class="pinned-preview">@if(pinned.thumbnail_url){<img [src]="pinned.thumbnail_url" [alt]="pinned.name"/>}<strong>{{pinned.name}}</strong></div>}
    @else if(draft.pinned_product_id){<p class="field-help">Not currently public.</p>}@else{<p class="field-help">No pinned item.</p>}
    <div class="pin-setting-actions"><button appButton type="button" (click)="pinSelector.show()">{{draft.pinned_product_id?'Replace Item':'Choose Item'}}</button>@if(draft.pinned_product_id){<button appButton type="button" (click)="state.selectPin(null)">Remove Pin</button>}</div>
   </section>
  </fieldset>
  @if(state.error()){<p class="notice error" role="alert">{{state.error()}}</p>}
  <div class="profile-save-actions"><button appButton type="button" [disabled]="state.busy()" (click)="cancel.emit()">Cancel</button><button appButton type="button" class="dark" [disabled]="state.busy()||length(draft.bio)>500||length(draft.display_name)>30||!draft.display_name.trim()" (click)="save.emit()">{{state.busy()?'Saving…':'Save Changes'}}</button></div>
 </div><app-profile-pin-selector #pinSelector/>}
`,styleUrls:['./profile-about-layout.css','./profile-about-editor.css'] })
export class ProfileAboutEditor {
    state = inject(ProfileEditState);
    save = output<void>();
    cancel = output<void>();
    platforms = [{ id: 'instagram', label: 'Instagram' }, { id: 'youtube', label: 'YouTube' }, { id: 'tiktok', label: 'TikTok' }, { id: 'roblox', label: 'Roblox' }, { id: 'x', label: 'X' }, { id: 'twitch', label: 'Twitch' }, { id: 'discord', label: 'Discord' }, { id: 'custom', label: 'Custom Link' }];
    length = (text: string) => Array.from(text).length;
    add() { const d = this.state.draft()!; if (d.socials.length < 5)
        this.state.update({ socials: [...d.socials, { id: crypto.randomUUID(), platform: 'custom', label: '', url: '' }] }); }
    change(index: number, key: 'label' | 'url', value: string) { const links = this.state.draft()!.socials.map((s, i) => i === index ? { ...s, [key]: value } : s); this.state.update({ socials: links }); }
    platform(index: number, value: string) { const label = this.platforms.find(p => p.id === value)?.label || ''; this.state.update({ socials: this.state.draft()!.socials.map((s, i) => i === index ? { ...s, platform: value, label: value === 'custom' ? '' : label } : s) }); }
    remove(index: number) { this.state.update({ socials: this.state.draft()!.socials.filter((_, i) => i !== index) }); }
    move(index: number, delta: number) { const links = [...this.state.draft()!.socials], next = index + delta; if (next < 0 || next >= links.length)
        return; [links[index], links[next]] = [links[next], links[index]]; this.state.update({ socials: links }); }
}
