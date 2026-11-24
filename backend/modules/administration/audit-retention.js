// ALTEGO necesita resolver la retención de registros de auditoría.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {requireLiveSession} from '../accounts/auth.js';
import {audit} from './admin-audit.js';
import {adminError} from './admin-audit.js';
import {governanceReady} from "../../infrastructure/schema/readiness.js";
export const manualAuditPredicate="COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.retention_hold')),'false') NOT IN ('true','1')";
export const expiredAuditPredicate=`a.created_at<UTC_TIMESTAMP(6)-INTERVAL 24 MONTH
 AND NOT EXISTS(SELECT 1 FROM conversation_moderation_cases c WHERE c.status='pending' AND c.author_id=a.actor_id)
 AND NOT EXISTS(SELECT 1 FROM sanction_appeals p WHERE p.status='pending' AND p.user_id=a.actor_id)
 AND NOT EXISTS(SELECT 1 FROM account_sanctions s WHERE s.user_id=a.actor_id AND s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>UTC_TIMESTAMP(6)))
 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.changes,'$.retention_hold')),'false') NOT IN ('true','1')
 AND NOT EXISTS(SELECT 1 FROM conversation_moderation_cases c WHERE c.status='pending' AND a.entity_type='account' AND CAST(c.author_id AS CHAR)=a.entity_id)
 AND NOT EXISTS(SELECT 1 FROM conversation_moderation_cases c WHERE c.status='pending' AND
  ((a.entity_type='case' AND CAST(c.id AS CHAR)=a.entity_id) OR (a.entity_type=c.content_type AND CAST(c.target_id AS CHAR)=a.entity_id)))
 AND NOT EXISTS(SELECT 1 FROM moderation_removals m WHERE m.restored_at IS NULL AND m.entity_type=a.entity_type AND CAST(m.entity_id AS CHAR)=a.entity_id)
 AND NOT EXISTS(SELECT 1 FROM sanction_appeals p WHERE p.status='pending' AND
  ((a.entity_type='account' AND CAST(p.user_id AS CHAR)=a.entity_id) OR (a.entity_type='appeal' AND CAST(p.id AS CHAR)=a.entity_id) OR (a.entity_type='sanction' AND CAST(p.sanction_id AS CHAR)=a.entity_id)))
 AND NOT EXISTS(SELECT 1 FROM account_sanctions s WHERE s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>UTC_TIMESTAMP(6)) AND ((a.entity_type='sanction' AND CAST(s.id AS CHAR)=a.entity_id) OR (a.entity_type='account' AND CAST(s.user_id AS CHAR)=a.entity_id)))
 AND NOT EXISTS(SELECT 1 FROM product_publication_reviews p WHERE p.status='pending' AND a.entity_type='product' AND CAST(p.product_id AS CHAR)=a.entity_id)`;
export async function auditRetention(sql,{execute=false,limit=100}={}){
 if(!await governanceReady(sql))throw adminError(503,'Audit retention requires administration governance 021.');
 if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('Choose a retention batch of 1–500.');
 if(!execute){
  const [[count]]=await sql.query('SELECT COUNT(*) eligible FROM administrative_audit a WHERE '+expiredAuditPredicate);
  return {eligible:Number(count.eligible),deleted:0,dryRun:true};
 }
 await sql.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await sql.beginTransaction();
 try{
  const [proposed]=await sql.query('SELECT a.id,a.actor_id,a.entity_type,a.entity_id FROM administrative_audit a WHERE '+expiredAuditPredicate+' ORDER BY a.id LIMIT ?',[limit]);
  await lockAuditOwners(sql,proposed);
  const candidates=[];
  for(const proposedRow of proposed){const [[row]]=await sql.execute('SELECT a.id FROM administrative_audit a WHERE a.id=? AND '+expiredAuditPredicate+' FOR UPDATE',[proposedRow.id]);if(row)candidates.push(row);}
  let deleted=0;
  for(const row of candidates){

   const [result]=await sql.execute('DELETE a FROM administrative_audit a WHERE a.id=? AND '+expiredAuditPredicate,[row.id]);deleted+=result.affectedRows;
  }
  await sql.commit();return {eligible:candidates.length,deleted,dryRun:false};
 }catch(error){await sql.rollback();throw error;}
}

async function lockAuditOwners(sql,proposed){


  const owners=new Set();
  for(const row of proposed){
   if(row.actor_id)owners.add(Number(row.actor_id));
   if(!/^[1-9][0-9]*$/.test(row.entity_id))continue;
   let query;
   if(row.entity_type==='account')query='SELECT id AS owner_id FROM users WHERE id=?';
   else if(row.entity_type==='sanction')query='SELECT user_id AS owner_id FROM account_sanctions WHERE id=?';
   else if(row.entity_type==='appeal')query='SELECT user_id AS owner_id FROM sanction_appeals WHERE id=?';
   else if(row.entity_type==='case')query='SELECT author_id AS owner_id FROM conversation_moderation_cases WHERE id=?';
   else if(row.entity_type==='product')query='SELECT owner_id FROM productos WHERE id=?';
   else if(row.entity_type==='post')query='SELECT author_id AS owner_id FROM conversation_posts WHERE id=?';
   else if(['comment','reply'].includes(row.entity_type))query='SELECT author_id AS owner_id FROM conversation_comments WHERE id=?';
   if(query){const [[target]]=await sql.execute(query,[row.entity_id]);if(target?.owner_id)owners.add(Number(target.owner_id));}
  }
  for(const id of [...owners].sort((a,b)=>a-b))await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
}

export async function deleteSelectedAudit(pool,req,ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw adminError(400,'Select 1–100 distinct audit records.');
 const sql=await pool.getConnection();try{await sql.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await sql.beginTransaction();try{
 const [proposed]=await sql.query('SELECT id,actor_id,entity_type,entity_id FROM administrative_audit WHERE id IN (?) ORDER BY id',[ids]);
 await lockAuditOwners(sql,[...proposed,{actor_id:req.user.id,entity_type:'request',entity_id:'audit'}]);
 const [[actor]]=await sql.execute('SELECT role FROM users WHERE id=?',[req.user.id]);if(actor?.role!=='admin')throw adminError(403,'Only Admin can delete audit records.');await requireLiveSession(sql,req);
 if(proposed.length!==ids.length)throw adminError(409,'The selection changed. Refresh the audit log.');
 for(const id of [...ids].sort((a,b)=>a-b)){const [[row]]=await sql.execute('SELECT a.id FROM administrative_audit a WHERE a.id=? AND '+manualAuditPredicate+' FOR UPDATE',[id]);if(!row)throw adminError(409,'A selected record is subject to an explicit retention hold.');}
 for(const id of ids){const [deleted]=await sql.execute('DELETE a FROM administrative_audit a WHERE a.id=? AND '+manualAuditPredicate,[id]);if(deleted.affectedRows!==1)throw adminError(409,'A record is no longer eligible. Nothing was deleted.');}
 await audit(sql,{actor:req.user.id,category:'security',action:'audit.records_deleted',type:'audit_batch',id:ids.slice().sort((a,b)=>a-b).join(',').slice(0,80),reason:'admin_explicit_deletion',changes:{count:ids.length,deleted_ids:ids}});
 await sql.commit();return {deleted:ids.length};
 }catch(error){await sql.rollback();throw error;}}finally{sql.release();}
}
