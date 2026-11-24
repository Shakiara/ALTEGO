// ALTEGO necesita resolver la insignia pública de creador verificado.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {VerificationBorder,VerificationCheck} from './verification-symbols';
import {DOCUMENT} from '@angular/common';
import {Component,Injectable,computed,effect,inject,input,signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';

@Injectable({providedIn:'root'})
export class CreatorBadges {
  private readonly http=inject(HttpClient);
  private readonly document=inject(DOCUMENT);
  private readonly values=signal<ReadonlyMap<number,boolean>>(new Map());
  private readonly roles=signal<ReadonlyMap<number,'admin'|'moderator'>>(new Map());
  private readonly identities=signal<ReadonlyMap<number,{display_name:string;avatar_url:string|null}>>(new Map());
  private identityEpoch=0;private identityWrites=new Map<number,number>();
  updateIdentity(identity:{id:number;display_name:string;avatar_url:string|null}){this.identityWrites.set(identity.id,++this.identityEpoch);this.identities.update(current=>new Map(current).set(identity.id,{display_name:identity.display_name,avatar_url:identity.avatar_url}));}
  readIdentity(id:number){return this.identities().get(id);}
  private refreshAgain=false;
  private readonly watched=new Map<number,number>();
  private pending?:ReturnType<typeof setTimeout>;
  private timer?:ReturnType<typeof setInterval>;
  private busy=false;

  readRole(id:number){return this.roles().get(id);}

  read(id:number){return this.values().get(id);}

  watch(id:number){
    if(!id)return ()=>{};
    this.watched.set(id,(this.watched.get(id) ?? 0)+1);
    this.timer ??= setInterval(()=>void this.refresh(),20_000);
    if(!this.pending)this.pending=setTimeout(()=>{
      this.pending=undefined;
      void this.refresh();
    },30);
    return ()=>{
      const count=this.watched.get(id) ?? 0;
      if(count>1){this.watched.set(id,count-1);return;}
      this.watched.delete(id);
      if(!this.watched.size){
        clearInterval(this.timer);
        this.timer=undefined;
      }
    };
  }

  async refresh(){
    if(this.busy){this.refreshAgain=true;return;}
    if(this.document.hidden || !this.watched.size)return;
    this.busy=true;
    const users=[...this.watched.keys()],epoch=this.identityEpoch;
    try{
      const next=new Map<number,boolean>();const roles=new Map<number,'admin'|'moderator'>();const identities=new Map<number,{display_name:string;avatar_url:string|null}>();
      for(let offset=0;offset<users.length;offset+=100){
        const ids=users.slice(offset,offset+100);
        const {verified,staff=[],creators=[]}=await firstValueFrom(this.http.get<{verified:number[];staff?:{id:number;role:'admin'|'moderator'}[];creators?:{id:number;display_name:string;avatar_url:string|null}[]}>('/api/creators/verification-status',{params:{ids:ids.join(',')}}));
        for(const account of staff)if(ids.includes(account.id)&&['admin','moderator'].includes(account.role))roles.set(account.id,account.role);
        for(const creator of creators)if(ids.includes(creator.id))identities.set(creator.id,creator);
        const active=new Set(verified);
        for(const id of ids)if(this.watched.has(id))next.set(id,active.has(id));
      }
      this.values.set(next);this.roles.set(roles);this.identities.update(current=>{const merged=new Map(current);for(const [id,identity]of identities)if((this.identityWrites.get(id)||0)<=epoch)merged.set(id,identity);return merged;});
    }catch{

    }finally{this.busy=false;if(this.refreshAgain){this.refreshAgain=false;void this.refresh();}}
  }
}

@Component({
  selector:'app-verified-creator-badge',
  imports:[VerificationBorder,VerificationCheck],
  host:{'[style.display]':"visible()?'inline-flex':'none'"},
  template:`@if(visible()){<span class="verified-badge" role="img" tabindex="0" aria-label="Verified Creator" title="Verified Creator"><app-verification-border/><app-verification-check/></span>}`,
  styles:`:host{vertical-align:middle;flex-shrink:0;line-height:1}.verified-badge{position:relative;display:inline-flex;align-items:center;justify-content:center;width:var(--verified-badge-size,18px);height:var(--verified-badge-size,18px);outline-offset:3px;border-radius:3px}app-verification-border{position:absolute;inset:0;color:var(--verified-border-color,#8c9dc7);transition:filter .22s,transform .22s}app-verification-check{position:absolute;width:53%;height:53%;color:var(--verified-check-color,#617eb3);transition:filter .22s,transform .22s}.verified-badge:hover app-verification-border,.verified-badge:focus-visible app-verification-border{filter:drop-shadow(0 0 2px #b4b6e6aa);transform:rotate(8deg)}.verified-badge:hover app-verification-check,.verified-badge:focus-visible app-verification-check{filter:brightness(1.15);transform:scale(1.06)}.verified-badge:focus-visible{outline:2px solid var(--color-focus,#986d9a)}@media(prefers-reduced-motion:reduce){app-verification-border,app-verification-check{transition:none!important;transform:none!important}}`,
})
export class VerifiedCreatorBadge {
  private readonly badges=inject(CreatorBadges);
  creatorId=input(0);
  verified=input(true);
  visible=computed(()=>this.badges.read(this.creatorId()) ?? this.verified());
  constructor(){effect(cleanup=>cleanup(this.badges.watch(this.creatorId())));}
}
