// ALTEGO necesita resolver las tablas compartidas de los espacios de gestión.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,input,output} from '@angular/core';
import {VerifiedCreatorBadge} from "../identity/verified-creator-badge";
import {RouterLink} from '@angular/router';
import {Icon} from './icon';
import {VisualButton} from './visual-primitives';

export interface WorkspaceColumn {key:string;label:string;kind?:'identity'|'badge'|'verification';}
export interface WorkspaceRow {id:number;values:Record<string,string>;tones?:Record<string,string>;profileIds?:Record<string,number|undefined>;selectable?:boolean;}

@Component({selector:'app-workspace-table',imports:[RouterLink,VisualButton,Icon,VerifiedCreatorBadge],host:{'[attr.aria-busy]':'loading()'},templateUrl:'./workspace-table.html',styleUrl:'./workspace-table.css'})
export class WorkspaceTable{
 columns=input.required<WorkspaceColumn[]>();rows=input.required<WorkspaceRow[]>();loading=input(false);
 page=input(1);pages=input(1);total=input(0);showTotal=input(true);itemLabel=input('accounts');tableLabel=input('Accounts');actionLabel=input('View account');
 selectionEnabled=input(false);selectionIds=input<Set<number>>(new Set());selectionChanged=output<{id:number;selected:boolean}>();
 selected=output<number>();changed=output<number>();
}
