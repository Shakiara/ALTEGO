// ALTEGO necesita resolver las apelaciones de sanciones de cuenta.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {requireLiveSession} from '../accounts/auth.js';
import {adminError,audit,decisionInput,notifyAccount} from './admin-audit.js';
import {governanceReady} from "../../infrastructure/schema/readiness.js";

const dates="DATE_FORMAT(s.issued_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS issued_at,DATE_FORMAT(s.expires_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS expires_at,DATE_FORMAT(s.lifted_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS lifted_at";
export function installSanctionAppeals(app,pool){
 const own=action=>async(req,res,next)=>{
  try{
   if(!await governanceReady(pool))throw adminError(503,'Account appeals are not available yet.','GOVERNANCE_NOT_READY');
   const actor=req.user||req.restrictedUser;
   if(!actor)throw adminError(401,'Please log in to view your account status.','AUTH_REQUIRED');
   const sql=await pool.getConnection();
   try{await sql.beginTransaction();await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[actor.id]);
    await requireLiveSession(sql,{user:actor,sessionHash:req.sessionHash});
    await action(sql,actor,req,res);await sql.commit();
   }catch(error){await sql.rollback();throw error;}finally{sql.release();}
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message,code:error.code});next(error);}
 };
 app.get('/api/account/sanctions',own(async(sql,actor,req,res)=>{
  const [sanctions]=await sql.execute(`SELECT s.id,s.kind,s.reason,s.explanation,${dates},
   (s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>UTC_TIMESTAMP(6))) AS active,
   a.id AS appeal_id,a.status AS appeal_status,a.explanation AS appeal_explanation,
   DATE_FORMAT(a.submitted_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS appeal_submitted_at,
   DATE_FORMAT(a.decided_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS appeal_decided_at,a.decision_reason,a.decision_explanation
   FROM account_sanctions s LEFT JOIN sanction_appeals a ON a.sanction_id=s.id WHERE s.user_id=? ORDER BY s.id DESC`,[actor.id]);
  const [removals]=await sql.execute('SELECT id,entity_type,label,reason,explanation,removed_at,restored_at FROM moderation_removals WHERE owner_id=? ORDER BY id DESC',[actor.id]);
  res.json({sanctions,removals,restricted:Boolean(req.restrictedUser)});
 }));
 app.post('/api/account/sanctions/:id/appeal',own(async(sql,actor,req,res)=>{
  const text=req.body?.explanation;
  if(typeof text!=='string'||!text.trim()||text.trim().length>2000||Object.keys(req.body).length!==1)throw adminError(400,'Write an explanation of up to 2000 characters.');
  const [[sanction]]=await sql.execute('SELECT id FROM account_sanctions WHERE id=? AND user_id=? FOR UPDATE',[req.recordId,actor.id]);
  if(!sanction)throw adminError(404,'Sanction not found.');
  let appeal;
  try{[appeal]=await sql.execute('INSERT INTO sanction_appeals(sanction_id,user_id,explanation) VALUES (?,?,?)',[sanction.id,actor.id,text.trim()]);}
  catch(error){if(error.code==='ER_DUP_ENTRY')throw adminError(409,'Only one appeal is allowed for each sanction.');throw error;}
  await audit(sql,{actor:actor.id,category:'sanctions',action:'appeal.submitted',type:'appeal',id:appeal.insertId,changes:{sanction_id:sanction.id}});
  const [[admin]]=await sql.query("SELECT id FROM users WHERE role='admin'");
  if(admin)await notifyAccount(sql,{recipient:admin.id,key:'appeal-submitted:'+appeal.insertId,title:'New sanction appeal',description:'A sanction appeal is ready for review.',destination:'/admin/appeals'});
  res.status(201).json({id:appeal.insertId,status:'pending'});
 }));
}
export async function decideAppeal(sql,actor,id,action,body){
 if(actor.role!=='admin')throw adminError(403,'Only Admin can decide appeals.');
 const {reason,explanation}=decisionInput(body);
 const [[appeal]]=await sql.execute('SELECT * FROM sanction_appeals WHERE id=? FOR UPDATE',[id]);
 if(!appeal)throw adminError(404,'Appeal not found.');
 const target=action.endsWith('approve')?'approved':'rejected';
 const correction=action.startsWith('correct_');
 if(!['approve','reject','correct_approve','correct_reject'].includes(action)||(!correction&&appeal.status!=='pending')||(correction&&(appeal.status==='pending'||appeal.status===target)))throw adminError(409,'This appeal decision is no longer available.');
 const [[sanction]]=await sql.execute('SELECT s.*,u.role FROM account_sanctions s JOIN users u ON u.id=s.user_id WHERE s.id=? FOR UPDATE',[appeal.sanction_id]);
 if(!sanction||sanction.role==='admin')throw adminError(403,'The Admin account is protected.');
 let stamp=null;
 if(target==='approved'){
  if(!sanction.lifted_at)await sql.execute('UPDATE account_sanctions SET lifted_at=UTC_TIMESTAMP(6),lifted_by=? WHERE id=?',[actor.id,sanction.id]);
  const [[current]]=await sql.execute("SELECT DATE_FORMAT(lifted_at,'%Y-%m-%d %H:%i:%s.%f') AS stamp FROM account_sanctions WHERE id=?",[sanction.id]);
  stamp=!sanction.lifted_at?current.stamp:null;
 }else if(correction&&appeal.effect_lifted_at){
  if(sanction.kind==='suspension'){
   const [[other]]=await sql.execute("SELECT id FROM account_sanctions WHERE user_id=? AND id<>? AND kind='suspension' AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(6)) LIMIT 1",[sanction.user_id,sanction.id]);
   if(other)throw adminError(409,'Review the account current suspension before correcting this appeal.');
  }
  const [changed]=await sql.execute(`UPDATE account_sanctions s JOIN sanction_appeals a ON a.sanction_id=s.id
   SET s.lifted_at=NULL,s.lifted_by=NULL WHERE a.id=? AND s.lifted_at=a.effect_lifted_at`,[appeal.id]);
  if(changed.affectedRows!==1)throw adminError(409,'A later administrative decision protects this sanction.');
  if(sanction.kind==='suspension')await sql.execute('DELETE FROM sessions WHERE user_id=?',[sanction.user_id]);
 }
 await sql.execute('UPDATE sanction_appeals SET status=?,decided_at=UTC_TIMESTAMP(6),decided_by=?,decision_reason=?,decision_explanation=?,effect_lifted_at=?,decision_revision=decision_revision+1 WHERE id=?',[target,actor.id,reason,explanation,stamp,id]);
 await audit(sql,{actor:actor.id,category:'sanctions',action:correction?'appeal.corrected':'appeal.decided',type:'appeal',id,reason,changes:{before:appeal.status,after:target,sanction_id:sanction.id}});
 await notifyAccount(sql,{recipient:appeal.user_id,key:'appeal-decision:'+id+':'+(appeal.decision_revision+1),title:'Appeal '+target,description:'Review the decision for your sanction appeal.',destination:'/account/status'});
}
