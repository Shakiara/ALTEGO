// ALTEGO necesita resolver los controles de privacidad de las listas sociales.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,DestroyRef,inject,input,signal} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {Api} from "../../core/http/api";
import {MentionVisibility,OptionalNotification,SocialPreferences,notificationCategories} from './social-types';
import {GlassPanel,VisualButton,VisualField} from "../ui/visual-primitives";
import {UiFeedback} from "../ui/ui-feedback";

@Component({
  selector:'app-social-preferences',imports:[GlassPanel,VisualButton,VisualField],
  template:`
    @if(data();as preferences){
      @if(mode()==='mentions'){
        <label>Who can mention you?
          <select appField [value]="preferences.mention_visibility" [disabled]="busy()" (change)="changeMention($any($event.target).value)">
            <option value="everyone">Everyone</option><option value="followers">Followers</option>
            <option value="following">Following</option><option value="nobody">Nobody</option>
          </select>
        </label>
      }@else{
        <section appGlass class="notification-preferences" aria-label="Notification preferences">
          @for(category of categories;track category[0]){
            <label class="preference-row">
              <span>{{category[1]}} @if(category[0]==='orders'){<small>Unavailable</small>}@else if(!category[2]){<small>Required</small>}</span>
              @if(category[0]!=='orders'){<input type="checkbox" [checked]="preferences.notifications[category[0]]" [disabled]="!category[2]||busy()"
                (change)="changeNotification(category,$any($event.target).checked)">}
            </label>
          }
        </section>
      }
      <span class="preference-status" role="status">{{busy()?'Saving…':status()}}</span>
    }@else if(error()){
      @if(!unavailable()||mode()==='notifications'){
        <p role="alert">{{error()}} <button appButton type="button" (click)="load()">Retry</button></p>
      }
    }@else{<p role="status">Loading preferences…</p>}
  `,
  styles:`
    :host{display:block;min-width:0}label{display:grid;gap:6px;font-size:14px}select{padding:7px 9px}
    .notification-preferences{padding:8px 16px}.preference-row{display:flex;align-items:center;justify-content:space-between;
      min-height:49px;gap:12px;border-bottom:1px solid #e9e1f0}.preference-row:last-child{border:0}
    .preference-row span{overflow-wrap:anywhere}.preference-row small{color:var(--color-muted);margin-inline-start:5px}
    .preference-row input{width:18px;height:18px;min-height:18px;flex:none;accent-color:#806b98}
    .preference-status{display:block;min-height:18px;font-size:12px;color:var(--color-muted)}
  `,
})
export class SocialPreferenceControls {
  private api=inject(Api);
  private ui=inject(UiFeedback);
  private destroyed=false;
  mode=input.required<'mentions'|'notifications'>();
  data=signal<SocialPreferences|null>(null);
  busy=signal(false);
  error=signal('');
  unavailable=signal(false);
  status=signal('');
  categories=notificationCategories;
  constructor(){inject(DestroyRef).onDestroy(()=>this.destroyed=true);void this.load();}
  async load(){
    this.error.set('');
    try{const data=await firstValueFrom(this.api.socialPreferences());if(!this.destroyed)this.data.set(data);}
    catch(error){if(!this.destroyed){this.unavailable.set((error as {status?:number}).status===503);this.error.set("Couldn't load preferences.");}}
  }
  changeMention(value:MentionVisibility){void this.save('mention_visibility',value);}
  changeNotification(category:typeof notificationCategories[number],value:boolean){if(category[2])void this.save(category[0],value);}
  private async save(key:'mention_visibility'|OptionalNotification,value:MentionVisibility|boolean){
    if(this.busy()||!this.data())return;
    this.busy.set(true);this.status.set('');
    try{const data=await firstValueFrom(this.api.updateSocialPreferences(key,value));if(!this.destroyed){this.data.set(data);this.status.set('Saved');}}
    catch{
      if(!this.destroyed){
        this.ui.notify("Couldn't save your preferences.",'error');
        const current=this.data();if(current)this.data.set({...current});
      }
    }finally{this.busy.set(false);}
  }
}
