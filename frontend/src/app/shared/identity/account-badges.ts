// ALTEGO necesita resolver las insignias públicas de las cuentas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,computed,effect,inject,input} from '@angular/core';
import {CreatorBadges,VerifiedCreatorBadge} from './verified-creator-badge';import {StaffBadge} from './staff-badge';
@Component({selector:'app-account-badges',imports:[VerifiedCreatorBadge,StaffBadge],host:{'[style.display]':"visible()?'inline-flex':'none'"},template:`@if(role();as staff){<app-staff-badge [role]="staff"/>}<app-verified-creator-badge [creatorId]="creatorId()" [verified]="verified()"/>`,styles:`:host{display:inline-flex;align-items:center;gap:4px;vertical-align:middle;line-height:1;flex-shrink:0;white-space:nowrap}`})
export class AccountBadges{private badges=inject(CreatorBadges);creatorId=input(0);verified=input(false);role=computed(()=>this.badges.readRole(this.creatorId()));visible=computed(()=>!!this.role()||(this.badges.read(this.creatorId())??this.verified()));constructor(){effect(cleanup=>cleanup(this.badges.watch(this.creatorId())));}}
