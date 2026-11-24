// ALTEGO necesita resolver el estado de navegación de Following Feed.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {FollowActions} from "../../shared/social/follow-actions";
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Injectable,effect,inject} from '@angular/core';
import {AuthService} from "../../core/auth/auth-service";
import {FeedPublication} from './following-feed-service';
import {ReactionSummary} from "../../shared/social/social-types";
export interface FeedCardState{variant:string|null;camera:string|null;expanded:boolean;reaction:ReactionSummary|null;}
@Injectable({providedIn:'root'})
export class FeedViewState{
 private auth=inject(AuthService);private actor:number|null=null;
 cards=new Map<string,FeedCardState>();snapshot:{owner:number;items:FeedPublication[];cursor:string|null;scroll:number}|null=null;
 constructor(){inject(FollowActions).changes.pipe(takeUntilDestroyed()).subscribe(change=>{if(change.actor===this.auth.user()?.id&&!change.state.viewer_follows&&this.snapshot){const removed=this.snapshot.items.filter(p=>p.creator.id===change.target);this.snapshot.items=this.snapshot.items.filter(p=>p.creator.id!==change.target);for(const post of removed)this.cards.delete(post.public_id);}});effect(()=>{const actor=this.auth.user()?.id??null;if(actor!==this.actor){this.actor=actor;this.cards.clear();this.snapshot=null;}});}
 card(id:string){let value=this.cards.get(id);if(!value){value={variant:null,camera:null,expanded:false,reaction:null};this.cards.set(id,value);}return value;}
 clear(){this.cards.clear();this.snapshot=null;}
}
