// ALTEGO necesita resolver las consultas y filtros compartidos de Following Feed.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Injectable,inject} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Product} from "../../core/http/api";
import {Reaction,ReactionSummary} from "../../shared/social/social-types";
export interface FeedPublication{id:number;public_id:string;message:string;published_at:string;creator:{id:number;username:string;display_name:string;avatar_url:string|null;verified_creator:boolean};product:Product;reactions:ReactionSummary;}
@Injectable({providedIn:'root'})
export class FollowingFeedService{
 private http=inject(HttpClient);
 list(cursor:string|null){return this.http.get<{items:FeedPublication[];next_cursor:string|null}>('/api/following-feed',{params:cursor?{cursor}:{}});}
 publication(id:string){return this.http.get<FeedPublication>('/api/feed-publications/'+encodeURIComponent(id));}
 reaction(id:string,reaction:Reaction|null){return this.http.put<ReactionSummary>('/api/feed-publications/'+encodeURIComponent(id)+'/reaction',{reaction});}
}
