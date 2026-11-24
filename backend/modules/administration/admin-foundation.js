// ALTEGO necesita resolver las cuentas, roles y permisos administrativos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {audit,notifyAccount} from './admin-audit.js';
import {requireLiveSession,requireUser} from '../accounts/auth.js';
import {adminFoundationReady} from "../../infrastructure/schema/readiness.js";
import {activeSuspension,sanctionFields,sanctionReasons} from '../accounts/account-sanctions.js';
import {verifiedCreatorIds} from '../verification/verification-status.js';

const staff=role=>role==='admin'||role==='moderator';
const reject=(status,message,code)=>Object.assign(Error(message),{status,code});
const forbidden=()=>reject(403,'You do not have permission to perform this action.','ADMIN_PERMISSION_REQUIRED');
const invalid=()=>reject(400,'Choose valid account management options.','INVALID_ADMIN_INPUT');
const notFound=()=>reject(404,'Account or sanction not found.','ADMIN_ACCOUNT_NOT_FOUND');
const protectedAdmin=()=>reject(403,'The Admin account is protected.','ADMIN_PROTECTED');
const labels={username:'u.username',role:'u.role',newest:'u.created_at'};
const publicAccount=(row,verified)=>({...row,verified,suspended:Boolean(row.suspended)});
const accountFields=(admin)=>`u.id,u.username,u.role,u.created_at,${admin?'u.email,':''}
 EXISTS(SELECT 1 FROM account_sanctions s WHERE s.user_id=u.id AND ${activeSuspension}) AS suspended`;

export async function moderatorEligibility(sql,userId){
 const [[row]]=await sql.execute("SELECT FLOOR((UNIX_TIMESTAMP()-UNIX_TIMESTAMP(u.created_at))/86400) age_days,(SELECT COUNT(*) FROM account_sanctions s WHERE s.user_id=u.id AND s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>UTC_TIMESTAMP(6))) active_sanctions,EXISTS(SELECT 1 FROM account_sanctions s WHERE s.user_id=u.id AND s.kind='suspension' AND s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>UTC_TIMESTAMP(6))) suspended FROM users u WHERE u.id=?",[userId]);
 if(!row)throw notFound();return {eligible:Number(row.age_days)>=30&&!Number(row.active_sanctions)&&!row.suspended,ageDays:Number(row.age_days),activeSanctions:Number(row.active_sanctions),accountActive:!row.suspended};
}

export function installAdminFoundation(app,pool){
 const base='/api/admin/workspace';
 const wrap=action=>async(req,res,next)=>{
  try{
   if(!staff(req.user.role))throw forbidden();
   if(!await adminFoundationReady(pool))throw reject(503,'Account management is not available yet.','ADMIN_SETUP_REQUIRED');
   await action(req,res);
  }catch(error){
   if(error.status && error.code)return res.status(error.status).json({error:error.message,code:error.code});
   next(error);
  }
 };

 async function mutate(req,run){
  const sql=await pool.getConnection();
  try{
   await sql.beginTransaction();

   const [rows]=await sql.query('SELECT id,role FROM users WHERE id IN (?) ORDER BY id FOR UPDATE',[[...new Set([req.user.id,req.recordId])]]);
   const actor=rows.find(row=>row.id===req.user.id);
   const target=rows.find(row=>row.id===req.recordId);
   if(!actor || !staff(actor.role))throw forbidden();
   await requireLiveSession(sql,req);
   if(!target)throw notFound();
   if(target.role==='admin')throw protectedAdmin();
   const result=await run(sql,actor,target);
   await sql.commit();
   return result;
  }catch(error){await sql.rollback();throw error;}
  finally{sql.release();}
 }

 app.get(base,requireUser,wrap(async(req,res)=>{
  const [[counts]]=await pool.query(`SELECT COUNT(*) AS accounts,
    COALESCE(SUM(role='moderator'),0) AS moderators,
    COALESCE(SUM(EXISTS(SELECT 1 FROM account_sanctions WHERE user_id=users.id AND ${activeSuspension})),0) AS suspended FROM users`);
  const [[warnings]]=await pool.query("SELECT COUNT(*) AS warnings FROM account_sanctions WHERE kind='warning'");
  res.json({accounts:Number(counts.accounts),moderators:Number(counts.moderators),suspended:Number(counts.suspended),warnings:Number(warnings.warnings)});
 }));

 app.get(base+'/accounts',requireUser,wrap(async(req,res)=>{
  const {q='',role='',status='',sort='username',direction='asc',page='1'}=req.query;
  if(typeof q!=='string'||q.length>254||!['','user','moderator','admin'].includes(role)||
    !['','active','suspended'].includes(status)||!Object.hasOwn(labels,sort)||
    !['asc','desc'].includes(direction)||typeof page!=='string'||!/^([1-9][0-9]{0,5})$/.test(page))throw invalid();
  const admin=req.user.role==='admin';
  const where=[],values=[];
  if(q.trim()){
   const match='%'+q.trim().replace(/[!%_]/g,'!$&')+'%';
   where.push(admin?"(u.username LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')":"u.username LIKE ? ESCAPE '!'");
   values.push(match,...(admin?[match]:[]));
  }
  if(role){where.push('u.role=?');values.push(role);}
  if(status)where.push(`${status==='active'?'NOT ':''}EXISTS(SELECT 1 FROM account_sanctions s WHERE s.user_id=u.id AND ${activeSuspension})`);
  const filter=where.length?'WHERE '+where.join(' AND '):'';
  const [[{total}]]=await pool.execute('SELECT COUNT(*) AS total FROM users u '+filter,values);
  const size=12, current=Math.min(Number(page),Math.max(1,Math.ceil(total/size)));
  const [rows]=await pool.execute(`SELECT ${accountFields(admin)} FROM users u ${filter} ORDER BY ${labels[sort]} ${direction},u.id LIMIT ? OFFSET ?`,[...values,size,(current-1)*size]);
  const verified=await verifiedCreatorIds(pool,rows.map(row=>row.id));
  res.json({items:rows.map(row=>publicAccount(row,verified.has(row.id))),total,page:current,size});
 }));

 app.get(base+'/accounts/:id',requireUser,wrap(async(req,res)=>{
  const [[row]]=await pool.execute(`SELECT ${accountFields(req.user.role==='admin')} FROM users u WHERE u.id=?`,[req.recordId]);
  if(!row)throw notFound();
  const verified=await verifiedCreatorIds(pool,[row.id]);
  const [sanctions]=await pool.execute(`SELECT ${sanctionFields} FROM account_sanctions WHERE user_id=? ORDER BY id DESC`,[row.id]);
  res.json({account:publicAccount(row,verified.has(row.id)),sanctions,moderatorEligibility:await moderatorEligibility(pool,row.id)});
 }));

 app.put(base+'/accounts/:id/role',requireUser,wrap(async(req,res)=>{
  if(req.user.role!=='admin')throw forbidden();
  const {role}=req.body??{};
  if(!['user','moderator'].includes(role)||Object.keys(req.body).length!==1)throw invalid();
  await mutate(req,async(sql,actor,target)=>{
   if(actor.role!=='admin')throw forbidden();
   if(target.role!==role){
    if(role==='moderator'&&!(await moderatorEligibility(sql,target.id)).eligible)throw reject(409,'Moderator requires an active account at least 30 days old with no active sanctions.','MODERATOR_INELIGIBLE');
    await sql.execute('UPDATE users SET role=? WHERE id=?',[role,target.id]);
    await sql.execute('DELETE FROM sessions WHERE user_id=?',[target.id]);
    await audit(sql,{actor:actor.id,category:'roles',action:'account.role_changed',type:'account',id:target.id,changes:{before:target.role,after:role}});
   }
  });
  res.status(204).end();
 }));

 app.post(base+'/accounts/:id/sanctions',requireUser,wrap(async(req,res)=>{
  const {kind,reason,days,explanation}=req.body??{};
  if(!Object.keys(req.body??{}).every(key=>['kind','reason','days','explanation'].includes(key))||
   !['warning','suspension'].includes(kind)||!sanctionReasons.includes(reason)||
   (explanation!==undefined&&(typeof explanation!=='string'||explanation.length>500))||
   (kind==='warning'?days!==undefined:days!==null&&(!Number.isInteger(days)||days<1||days>365)))throw invalid();
  await mutate(req,async(sql,actor,target)=>{
   if(actor.role==='moderator' && (target.role!=='user'||(kind==='suspension'&&(days===null||days>7))))throw forbidden();
   if(kind==='suspension'){
    const [[existing]]=await sql.execute(`SELECT id FROM account_sanctions WHERE user_id=? AND ${activeSuspension} LIMIT 1`,[target.id]);
    if(existing)throw reject(409,'This account already has an active suspension.','SUSPENSION_EXISTS');
   }
   const [issued]=await sql.execute(`INSERT INTO account_sanctions(user_id,issued_by,kind,reason,explanation,expires_at)
    VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL ? DAY))`,[target.id,actor.id,kind,reason,explanation?.trim()||null,days??null]);
   if(kind==='suspension')await sql.execute('DELETE FROM sessions WHERE user_id=?',[target.id]);
   await audit(sql,{actor:actor.id,category:'sanctions',action:'sanction.issued',type:'sanction',id:issued.insertId,reason,changes:{user_id:target.id,kind,days:days??null}});
   await notifyAccount(sql,{recipient:target.id,key:'sanction:'+issued.insertId,title:kind==='warning'?'Account warning':'Account suspended',description:'Review your account status and available appeal.',destination:'/account/status'});
  });
  res.status(201).json({created:true});
 }));

 app.post(base+'/accounts/:id/sanctions/:sanctionId/lift',requireUser,wrap(async(req,res)=>{
  if(req.user.role!=='admin')throw forbidden();
  const {sanctionId}=req.params;
  if(!/^[1-9][0-9]{0,9}$/.test(sanctionId)||Object.keys(req.body??{}).length)throw invalid();
  await mutate(req,async(sql,actor,target)=>{
   if(actor.role!=='admin')throw forbidden();
   const [result]=await sql.execute(`UPDATE account_sanctions SET lifted_at=UTC_TIMESTAMP(6),lifted_by=?
    WHERE id=? AND user_id=? AND ${activeSuspension}`,[actor.id,Number(sanctionId),target.id]);
   if(!result.affectedRows)throw notFound();
   await audit(sql,{actor:actor.id,category:'sanctions',action:'sanction.lifted',type:'sanction',id:Number(sanctionId),changes:{user_id:target.id}});
   await notifyAccount(sql,{recipient:target.id,key:'sanction-lift:'+sanctionId,title:'Suspension lifted',description:'Review your updated account status.',destination:'/account/status'});
  });
  res.status(204).end();
 }));
}
