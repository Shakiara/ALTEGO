// ALTEGO necesita resolver la consulta autorizada de contenido sujeto a moderación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {adminError,audit,decisionInput,notifyAccount} from './admin-audit.js';
import {governanceReady} from "../../infrastructure/schema/readiness.js";

export async function removeContent(sql,actor,type,id,body){
 if(!await governanceReady(sql))throw adminError(503,'The moderation update has not been activated.','GOVERNANCE_NOT_READY');
 const {reason,explanation}=decisionInput(body);
 const table=type==='review'?'review_moderation_targets':type==='product'?'productos':type==='post'?'conversation_posts':'conversation_comments';
 const [[row]]=await sql.execute('SELECT * FROM '+table+' WHERE id=? FOR UPDATE',[id]);
 if(!row)throw adminError(404,'Content not found.');
 const owner=type==='product'?row.owner_id:row.author_id;
 const [[existing]]=await sql.execute('SELECT id FROM moderation_removals WHERE entity_type=? AND entity_id=? AND restored_at IS NULL FOR UPDATE',[type,id]);
 if(existing)throw adminError(409,'This content has already been removed.');
 const label=(type==='review'?row.label:type==='product'?row.nombre:type==='post'?row.title:row.body).slice(0,160);
 const [result]=await sql.execute('INSERT INTO moderation_removals(entity_type,entity_id,owner_id,label,reason,explanation,removed_by) VALUES (?,?,?,?,?,?,?)',[type,id,owner,label,reason,explanation,actor.id]);
 if(type==='review'){                                                                                                 }
 else if(type==='product')await sql.execute('UPDATE productos SET moderation_removed=TRUE WHERE id=?',[id]);
 else if(type==='post')await sql.execute('INSERT IGNORE INTO conversation_hidden_posts(post_id) VALUES (?)',[id]);
 else{
  await sql.execute('UPDATE conversation_comments SET hidden_at=COALESCE(hidden_at,UTC_TIMESTAMP(6)) WHERE id=?',[id]);
  await sql.execute('INSERT INTO conversation_rank(post_id) VALUES (?) ON DUPLICATE KEY UPDATE revision=revision+1',[row.post_id]);
 }
 if(type==='review'){await sql.execute("UPDATE conversation_moderation_cases SET status='removed',resolved_at=UTC_TIMESTAMP(6),moderator_id=? WHERE content_type='review' AND target_id=? AND status='pending'",[actor.id,id]);await sql.execute("UPDATE conversation_reports SET status='resolved' WHERE content_type='review' AND target_id=? AND status='active'",[id]);}
 await audit(sql,{actor:actor.id,category:'moderation',action:'content.removed',type,id,reason,changes:{removal_id:result.insertId}});
 if(owner)await notifyAccount(sql,{recipient:owner,key:'content-removal:'+result.insertId,title:'Content removed',description:'Review the moderation decision for your content.',destination:'/account/status'});
 return result.insertId;
}
export async function restoreContent(sql,actor,removalId,body){
 if(actor.role!=='admin')throw adminError(403,'Only Admin can restore moderated content.');
 const {reason}=decisionInput(body);
 const [[entry]]=await sql.execute('SELECT * FROM moderation_removals WHERE id=? FOR UPDATE',[removalId]);
 if(!entry||entry.restored_at)throw adminError(409,'This removal has already been resolved.');
 const {entity_type:type,entity_id:id}=entry;
 if(type==='review'){const [[target]]=await sql.execute('SELECT id FROM review_moderation_targets WHERE id=? FOR UPDATE',[id]);if(!target)throw adminError(409,'The review reference is unavailable.');}
 else if(type==='product'){

  const [[product]]=await sql.execute('SELECT id FROM productos WHERE id=? FOR UPDATE',[id]);
  if(!product)throw adminError(409,'The original content is unavailable.');
  await sql.execute('UPDATE productos SET moderation_removed=FALSE WHERE id=?',[id]);
 }else if(type==='post'){
  const [[post]]=await sql.execute('SELECT id FROM conversation_posts WHERE id=? FOR UPDATE',[id]);
  if(!post)throw adminError(409,'The original content is unavailable.');
  await sql.execute('DELETE FROM conversation_hidden_posts WHERE post_id=?',[id]);
 }else{
  const [[comment]]=await sql.execute('SELECT post_id FROM conversation_comments WHERE id=? FOR UPDATE',[id]);
  if(!comment)throw adminError(409,'The original content is unavailable.');
  await sql.execute('UPDATE conversation_comments SET hidden_at=NULL WHERE id=?',[id]);
  await sql.execute('INSERT INTO conversation_rank(post_id) VALUES (?) ON DUPLICATE KEY UPDATE revision=revision+1',[comment.post_id]);
 }
 await sql.execute('UPDATE moderation_removals SET restored_at=UTC_TIMESTAMP(6),restored_by=? WHERE id=?',[actor.id,removalId]);
 if(type!=='product')await sql.execute("UPDATE conversation_moderation_cases SET status='restored',resolved_at=UTC_TIMESTAMP(6),moderator_id=?,decision_reason=? WHERE content_type=? AND target_id=? AND status='removed'",[actor.id,reason,type,id]);
 await audit(sql,{actor:actor.id,category:'moderation',action:'content.restored',type,id,reason,changes:{removal_id:removalId}});
 if(entry.owner_id)await notifyAccount(sql,{recipient:entry.owner_id,key:'content-restore:'+removalId,title:'Content restored',description:'The moderation removal has been lifted. Other visibility restrictions still apply.',destination:'/account/status'});
}
export async function protectRemovedContent(sql,postId,commentId){
 if(!await governanceReady(sql))return;
 const [rows]=await sql.execute(`SELECT id FROM moderation_removals r WHERE r.restored_at IS NULL AND
 ((r.entity_type='post' AND r.entity_id=?) OR (r.entity_type IN ('comment','reply') AND r.entity_id IN
 (SELECT id FROM conversation_comments WHERE post_id=? AND (? IS NULL OR id=? OR root_id=?)))) LIMIT 1`,[postId,postId,commentId,commentId,commentId]);
 if(rows.length)throw adminError(409,'Moderated content must remain available for administrative recovery.');
}
