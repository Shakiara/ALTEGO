// ALTEGO necesita resolver la identificación visual del personal autorizado.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,computed,input} from '@angular/core';
@Component({selector:'app-staff-badge',templateUrl:'./staff-gavel.svg',host:{class:'staff-badge',role:'img',tabindex:'0','[attr.aria-label]':'label()','[attr.title]':'label()','[class.is-admin]':"role()==='admin'"},styles:`
 :host{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:var(--staff-badge-size,var(--verified-badge-size,18px));height:var(--staff-badge-size,var(--verified-badge-size,18px));vertical-align:middle;line-height:1;color:var(--staff-badge-color,#9373a0);outline-offset:3px;border-radius:3px;transition:filter .16s ease,translate .16s ease}
 :host(.is-admin){color:var(--staff-badge-color,#9875ad)}svg{display:block;width:100%;height:100%;overflow:visible;transition:transform .2s ease,filter .2s ease;filter:drop-shadow(0 1px 1px #876d8c25)}:host(:hover),:host(:focus-visible){translate:0 -1px;filter:brightness(1.08)}:host(:hover) svg,:host(:focus-visible) svg{transform:rotate(-7deg);filter:drop-shadow(0 1px 2px #ad90ba66)}:host(:focus-visible){outline:2px solid var(--color-focus,#986d9a)}
 @media(prefers-reduced-motion:reduce){:host{transition:none;translate:none!important}svg{transition:none;transform:none!important}}
 `})
export class StaffBadge{role=input.required<'admin'|'moderator'>();label=computed(()=>'Moderator');}
