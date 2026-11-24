// ALTEGO necesita resolver los reportes de contenido de la comunidad.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {randomUUID} from 'node:crypto';
export async function attachCommunityReports(sql,{type,targetId,publicId,ownerId,postId=null}){


 const [[open]]=await sql.execute("SELECT id,status,public_id FROM conversation_moderation_cases WHERE content_type=? AND target_id=? AND status='pending' FOR UPDATE",[type,targetId]);
 let item=open;
 if(!item){
  const id=randomUUID();
  const [created]=await sql.execute('INSERT INTO conversation_moderation_cases(public_id,post_id,target_id,target_public_id,content_type,author_id) VALUES (?,?,?,?,?,?)',[id,postId,targetId,publicId,type,ownerId]);
  item={id:created.insertId,status:'pending',public_id:id};
 }
 await sql.execute('INSERT INTO community_case_keys(content_type,target_id,case_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE case_id=?',[type,targetId,item.id,item.id]);
 await sql.execute("UPDATE conversation_reports SET case_id=? WHERE content_type=? AND target_id=? AND case_id IS NULL AND status='active'",[item.id,type,targetId]);
 const [[count]]=await sql.execute('SELECT COUNT(*) total FROM conversation_reports WHERE case_id=?',[item.id]);
 return {...item,count:Number(count.total)};
}
