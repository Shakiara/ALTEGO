// ALTEGO necesita resolver la trazabilidad de las operaciones administrativas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {governanceReady} from "../../infrastructure/schema/readiness.js";
export const moderationReasons=['community_guidelines','harassment','hate_speech','spam','inappropriate','violence','fraud','security','other'];
export const staffRole=role=>['admin','moderator'].includes(role);
export const adminError=(status,message,code='ADMIN_REQUEST_REJECTED')=>Object.assign(Error(message),{status,code});
export function decisionInput(body){
 if(!body||body.confirm!==true||!moderationReasons.includes(body.reason)||body.explanation!==undefined&&(typeof body.explanation!=='string'||body.explanation.length>500))throw adminError(400,'Confirm the action and choose a reason.');
 return {reason:body.reason,explanation:body.explanation?.trim()||null};
}
export async function audit(sql,{actor,category,action,type,id,reason=null,changes=null,result='success'}){
 if(!await governanceReady(sql))return;
 await sql.execute('INSERT INTO administrative_audit(actor_id,category,action,entity_type,entity_id,reason,changes,result) VALUES (?,?,?,?,?,?,?,?)',[actor,category,action,type,String(id),reason,changes===null?null:JSON.stringify(changes),result]);
}
export async function productPublicFilter(sql,alias='p'){
 if(!['p','product'].includes(alias))throw Error('Unknown product query context.');
 return await governanceReady(sql)?' AND '+alias+'.moderation_removed=FALSE':'';
}
export async function notifyAccount(sql,event){
 if(!await governanceReady(sql))return;
 const {notifySocialEvent}=await import('../social/social-notifications.js');
 await notifySocialEvent(sql,{category:'moderation',...event});
}
