// ALTEGO necesita resolver la sincronización de avatares públicos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,computed,effect,inject,input,signal} from '@angular/core';
import {CreatorBadges} from "../identity/verified-creator-badge";
import {Icon} from "../ui/icon";


@Component({selector:'app-live-avatar',imports:[Icon],host:{'aria-hidden':'true'},template:`
 @if(url();as image){@if(failed()!==image){<img [src]="image" alt="" (error)="failed.set(image)"/>}}
 @if(!url()||failed()===url()){@if(fallback()==='icon'){<app-icon name="user"/>}@else{<span>{{label().trim().slice(0,1).toUpperCase()||'?'}}</span>}}
`,styles:`:host{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;min-width:0;border-radius:inherit;overflow:hidden;vertical-align:middle}img{display:block;width:100%;height:100%;object-fit:cover}span{line-height:1}app-icon{width:55%;height:55%}`})
export class LiveAvatar{
 private identities=inject(CreatorBadges);userId=input(0);src=input<string|null|undefined>(null);label=input('');live=input(true);fallback=input<'initial'|'icon'>('initial');failed=signal<string|null>(null);
 url=computed(()=>{const identity=this.live()?this.identities.readIdentity(this.userId()):undefined;return identity?identity.avatar_url:this.src()||null;});
 constructor(){effect(cleanup=>{if(this.live())cleanup(this.identities.watch(this.userId()));});}
}
