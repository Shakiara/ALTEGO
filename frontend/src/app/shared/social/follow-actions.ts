// ALTEGO necesita resolver el seguimiento y su estado autorizado.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Injectable,inject,signal} from '@angular/core';import {Subject,firstValueFrom} from 'rxjs';
import {Api} from "../../core/http/api";import {AuthService} from "../../core/auth/auth-service";import {FollowState} from "./social-types";
@Injectable({providedIn:'root'})
export class FollowActions{
 private api=inject(Api);private auth=inject(AuthService);readonly pending=signal<Set<number>>(new Set());
 readonly changes=new Subject<{actor:number;target:number;state:FollowState}>();
 async change(target:number,following:boolean){const actor=this.auth.user()?.id;if(!actor||target===actor)return;
  if(this.pending().has(target))return;this.pending.update(v=>new Set([...v,target]));
  try{const state=await firstValueFrom(this.api.followCreator(target,following));if(this.auth.user()?.id!==actor)return;this.changes.next({actor,target,state});return state;}
  finally{this.pending.update(v=>{const next=new Set(v);next.delete(target);return next;});}
 }
}
