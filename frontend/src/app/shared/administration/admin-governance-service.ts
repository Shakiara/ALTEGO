// ALTEGO necesita resolver los servicios de moderación, auditoría y verificación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Injectable,inject} from '@angular/core';
import {HttpClient} from '@angular/common/http';
export interface GovernanceRow{id:number;title:string;state:string;owner:string|null;owner_id?:number|null;deletion_eligible?:boolean;created_at:string;}
export interface GovernancePage{items:GovernanceRow[];page:number;total:number;size:number;}
export interface GovernanceHistory{action?:string;status?:string;reason?:string;decision_reason?:string;created_at?:string;submitted_at?:string;result?:string;}
export interface GovernanceDetail{
 id:number;title:string;state:string;owner_id?:number|null;product_id?:number;review_id?:number|null;
 fields:{label:string;value:string|null;user_id?:number|null}[];actions:{id:string;label:string}[];
 reports?:{id:number;reason:string;created_at:string;reporter:string|null;explanation?:string|null;reporter_id?:number;status:string}[];
 history?:GovernanceHistory[];versions?:{id:number;version_number:number;created_at:string;state?:string;model_url?:string|null;variants?:{id:string;name:string;hex:string;is_default?:boolean;texture_url:string|null}[]}[];
 content?:{title?:string;body?:string;images:string[];poll?:{question?:string;options:{label:string;votes:number}[]}};
 model_url?:string|null;variants?:{id:string;name:string;hex:string;is_default?:boolean;texture_url:string|null}[];
}
export const moderationReasons=['community_guidelines','harassment','hate_speech','spam','inappropriate','violence','fraud','security','other'];
@Injectable({providedIn:'root'})
export class AdminGovernanceService{
 private http=inject(HttpClient);private root='/api/admin/governance';
 list(section:string,params:Record<string,string|number>){return this.http.get<GovernancePage>(this.root+'/'+section,{params});}
 detail(section:string,id:number){return this.http.get<GovernanceDetail>(this.root+'/'+section+'/'+id);}
 decide(section:string,detail:GovernanceDetail,action:string,reason:string,explanation:string){
  const body={reason,explanation,confirm:true};
  if(section==='products'&&action.startsWith('review_'))return this.http.put<void>('/api/admin/product-publications/'+detail.review_id,{decision:action==='review_approve'?'approve':'reject',...body});
  return this.http.post<void>(this.root+'/'+section+'/'+detail.id+'/actions/'+action,body);
 }
 deleteAudit(ids:number[]){return this.http.post<{deleted:number}>(this.root+'/audit/delete',{ids,confirm:true});}
 bulk(ids:number[],action:string,reason:string){return this.http.post<{completed:number}>(this.root+'/cases/bulk',{ids,action,reason,confirm:true});}
}
