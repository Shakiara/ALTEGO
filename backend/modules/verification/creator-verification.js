// ALTEGO necesita resolver la elegibilidad y las solicitudes de verificación de creadores.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {validAssetId} from '../../infrastructure/storage/storage-resolver.js';
import {refinementsReady} from "../../infrastructure/schema/readiness.js";
import {governanceReady} from "../../infrastructure/schema/readiness.js";
import {audit} from '../administration/admin-audit.js';
import {requireAdmin} from '../accounts/auth.js';
import {blockError,withSocialPair} from '../social/social-blocks.js';
import {notifySocialEvent,socialResponse} from '../social/social-notifications.js';
import {downgradeVerifiedReactions} from '../conversations/conversation-engagement.js';
import {automaticAdminIds,verificationReady,verifiedCreatorIds} from './verification-status.js';
import {id} from '../../core/validation.js';
import {readSalesSummary} from '../studio/sales-insights.js';

export const rejectionReasons=['eligibility','original_content','suspicious_activity','guidelines','other'];
export const revocationReasons=['guidelines','fraud','privilege_abuse','security','other'];
const settings='/settings?section=verification';
const actionPath=settings+'&apply=1';
const conflict=message=>blockError(409,'VERIFICATION_CONFLICT',message);
const unavailable=()=>blockError(503,'VERIFICATION_UNAVAILABLE','Creator Verification is currently unavailable.');
const notFound=()=>blockError(404,'VERIFICATION_NOT_FOUND','Verification application not found.');
const date=(alias,name)=>`DATE_FORMAT(${alias}.${name},'%Y-%m-%dT%H:%i:%s.%fZ') AS ${name}`;
const applicationFields=`a.id,a.user_id,a.status,a.decided_by,a.revoked_by,a.rejection_reason,a.revocation_reason,
  ${['submitted_at','decided_at','revoked_at','retry_at'].map(name=>date('a',name)).join(',')}`;


const officialMetrics=async(sql,userId)=>{
 if(!await governanceReady(sql))return {salesCents:null,activeSanctions:null};
 const [[state]]=await sql.execute("SELECT COUNT(*) active,SUM(kind='suspension') suspended FROM account_sanctions WHERE user_id=? AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(6))",[userId]);
 const sales=await readSalesSummary(sql,userId);
 return {salesCents:sales.ready?sales.total_revenue_cents:null,activeSanctions:Number(state.active),accountActive:!Number(state.suspended)};
};


export function omittedVerificationRequirements(status){
 const m=status.metrics,omitted=[];
 if(!(m.salesCents>50000||m.approvedItems>=1000))omitted.push('sales_or_items');
 if(!m.accountActive)omitted.push('account_active');if(!m.completeProfile)omitted.push('complete_profile');if(m.ageDays<30)omitted.push('account_age');if(m.activeSanctions!==0)omitted.push('no_active_sanctions');
 if(status.application?.retry_at&&new Date(status.application.retry_at).getTime()>Date.now())omitted.push('application_cooldown');return omitted;
}
async function approveCreator(sql,actor,userId,{applicationId=null,overrideReason,readMetrics=officialMetrics}={}){
 const status=await readVerification(sql,userId,readMetrics);
 if(status.permanent||status.state==='verified')throw conflict('This account is already verified.');
 const omitted=omittedVerificationRequirements(status);
 if(omitted.length&&!overrideReason)throw conflict('Eligibility requirements are not met. An administrative exception reason is required.');
 if(overrideReason&&!await refinementsReady(sql))throw unavailable();
 let id=applicationId??(status.application?.status==='pending'?status.application.id:null);
 if(id){const [[current]]=await sql.execute('SELECT user_id,status FROM creator_verification_applications WHERE id=? FOR UPDATE',[id]);if(current?.user_id!==userId||current.status!=='pending')throw conflict('This application has already been resolved.');}
 else{const [row]=await sql.execute('INSERT INTO creator_verification_applications(user_id) VALUES (?)',[userId]);id=row.insertId;}
 await sql.execute("UPDATE creator_verification_applications SET status='approved',decided_at=UTC_TIMESTAMP(6),decided_by=? WHERE id=?",[actor,id]);
 if(await refinementsReady(sql))await sql.execute('UPDATE creator_verification_applications SET approval_reason=?,approval_exception=? WHERE id=?',[omitted.length?overrideReason:null,omitted.length?JSON.stringify({omitted_requirements:omitted,metrics:status.metrics}):null,id]);
 await audit(sql,{actor,category:'verification',action:omitted.length?'verification.exception_approved':'verification.approve',type:'account',id:userId,reason:omitted.length?'administrative_exception':'eligibility_met',changes:{application_id:id,exception_reason:omitted.length?overrideReason:null,omitted_requirements:omitted}});
 await notify(sql,userId,'approved:'+id,'Verification Approved',"You're a Verified Creator!",'/creators/'+userId);return id;
}

export function meetsVerificationRequirements(metrics){
  return (metrics.salesCents>50000 || metrics.approvedItems>=1000)
    && metrics.accountActive && metrics.completeProfile && metrics.ageDays>=30 && !metrics.activeSanctions;
}

export async function readVerification(sql,userId,readMetrics=officialMetrics){
  const [[profile]]=await sql.execute(`SELECT u.id,u.username,COALESCE(p.display_name,u.username) AS display_name,
    p.bio,JSON_UNQUOTE(JSON_EXTRACT(p.avatar,'$.media_id')) AS avatar_id,
    FLOOR((UNIX_TIMESTAMP()-UNIX_TIMESTAMP(u.created_at))/86400) AS age_days,
    NULLIF(TRIM(p.display_name),'') IS NOT NULL
      AND NULLIF(TRIM(u.username),'') IS NOT NULL AND NULLIF(TRIM(p.bio),'') IS NOT NULL
      AND pm.id IS NOT NULL AS complete_profile
    FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
    LEFT JOIN profile_media pm ON pm.id=JSON_UNQUOTE(JSON_EXTRACT(p.avatar,'$.media_id'))
      AND pm.owner_id=u.id AND pm.slot='avatar' WHERE u.id=?`,[userId]);
  if(!profile)throw notFound();
  const [[items]]=await sql.execute(`SELECT COUNT(DISTINCT p.id) AS approved_items FROM productos p
    JOIN product_publication_reviews r ON r.product_id=p.id AND r.status='approved'
    WHERE p.owner_id=? AND p.status IN ('Published','Unlisted') AND p.purged_at IS NULL AND p.current_version_id IS NOT NULL`,[userId]);
  const [[latest]]=await sql.execute(`SELECT ${applicationFields},a.retry_at>UTC_TIMESTAMP(6) AS waiting
    FROM creator_verification_applications a WHERE user_id=? ORDER BY id DESC LIMIT 1`,[userId]);
  const official=await readMetrics(sql,userId);
  const metrics={
    salesCents:official.salesCents,activeSanctions:official.activeSanctions,accountActive:official.accountActive ?? true,
    approvedItems:Number(items.approved_items),completeProfile:Boolean(profile.complete_profile),ageDays:Number(profile.age_days)
  };
  const automatic=(await automaticAdminIds(sql,[userId])).length>0;
  const eligible=!automatic&&meetsVerificationRequirements(metrics);
  const canApply=eligible && !latest?.waiting && !['pending','approved'].includes(latest?.status);
  const state=automatic ? 'verified' : latest?.status==='approved' ? 'verified' : latest?.status==='pending' ? 'pending'
    : latest?.waiting ? latest.status : eligible ? 'eligible' : 'not_eligible';
  const {waiting,...application}=latest ?? {};
  const {avatar_id,...identity}=profile;
  let approvedException=null;
  const grantsAvailable=await refinementsReady(sql);
  if(grantsAvailable&&latest?.status==='approved'){const [[extra]]=await sql.execute('SELECT approval_exception,approval_reason FROM creator_verification_applications WHERE id=?',[latest.id]);if(extra?.approval_exception)approvedException={...(typeof extra.approval_exception==='string'?JSON.parse(extra.approval_exception):extra.approval_exception),reason:extra.approval_reason};}
  return {state,canApply,eligible,metrics,permanent:automatic,approved_exception:approvedException,administrative_grants_available:grantsAvailable,application:latest&&!automatic?application:null,
    profile:{...identity,avatar_url:avatar_id && /^[a-f0-9-]{36}$/i.test(avatar_id)?'/api/profile-media/'+avatar_id+'/display':null}};
}

const notify=(sql,userId,key,title,description,destination=settings)=>notifySocialEvent(sql,{
  recipient:userId,category:'verification',key:'verification:'+key,title,description,destination,
});

async function syncEligibility(sql,userId,status){
  const [[period]]=await sql.execute('SELECT * FROM creator_verification_periods WHERE user_id=?',[userId]);
  if(Boolean(period?.can_apply)===status.canApply)return;
  if(!status.canApply){
    await sql.execute('UPDATE creator_verification_periods SET can_apply=FALSE WHERE user_id=?',[userId]);
    return;
  }
  const sequence=(period?.sequence_number ?? 0)+1;
  await sql.execute(`INSERT INTO creator_verification_periods(user_id,sequence_number,can_apply) VALUES (?,?,TRUE)
    ON DUPLICATE KEY UPDATE sequence_number=?,can_apply=TRUE`,[userId,sequence,sequence]);
  const retry=['rejected','revoked'].includes(status.application?.status);
  await notify(sql,userId,'eligibility:'+sequence,retry?'You Can Apply Again':"You're Eligible for Verification!",
    retry?'You can submit a new Verified Creator application.':"Congratulations! You've met the requirements to apply for Verified Creator status on ALTEGO.",actionPath);
}

export async function reconcileVerificationBatch(pool,after=0,readMetrics=officialMetrics){
  if(!await verificationReady(pool))return 0;
  const [users]=await pool.execute('SELECT id FROM users WHERE id>? ORDER BY id LIMIT 25',[after]);
  for(const user of users){
    const sql=await pool.getConnection();
    try{
      await sql.beginTransaction();
      const [[locked]]=await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);
      if(locked)await syncEligibility(sql,user.id,await readVerification(sql,user.id,readMetrics));
      await sql.commit();
    }catch(error){
      await sql.rollback();
      throw error;
    }finally{sql.release();}
  }
  return users.length===25?users.at(-1).id:0;
}

export function installCreatorVerification(app,pool,requireUser,{readMetrics=officialMetrics}={}){
  const wrap=operation=>socialResponse(pool,async(req,res)=>{
    if(!await verificationReady(pool))throw unavailable();
    await operation(req,res);
  });
  app.get('/api/creators/verification-status',wrap(async(req,res)=>{
    const ids=typeof req.query.ids==='string'?req.query.ids.split(','):[];
    if(!ids.length || ids.length>100 || ids.some(value=>!id(value)))throw blockError(400,'INVALID_CREATORS','Choose valid creator IDs.');
    const [staff]=await pool.query("SELECT id,role FROM users WHERE id IN (?) AND role IN ('admin','moderator')",[ids.map(Number)]);
    const [creators]=await pool.query("SELECT u.id,COALESCE(NULLIF(up.display_name,''),u.username) AS display_name,JSON_UNQUOTE(JSON_EXTRACT(up.avatar,'$.media_id')) AS avatar_id FROM users u LEFT JOIN user_profiles up ON up.user_id=u.id WHERE u.id IN (?)",[ids.map(Number)]);
    res.json({verified:[...await verifiedCreatorIds(pool,ids.map(Number))],staff:staff.map(account=>({id:Number(account.id),role:account.role})),creators:creators.map(account=>({id:Number(account.id),display_name:account.display_name,avatar_url:validAssetId(account.avatar_id)?'/api/profile-media/'+account.avatar_id+'/display':null}))});
  }));
  const own='/api/account/creator-verification';
  app.get(own,requireUser,wrap(async(req,res)=>{
    const result=await withSocialPair(pool,req,req.user.id,async sql=>{
      const status=await readVerification(sql,req.user.id,readMetrics);
      await syncEligibility(sql,req.user.id,status);
      return {...status,approved_exception:status.approved_exception?{omitted_requirements:status.approved_exception.omitted_requirements}:null};
    });
    res.json(result);
  }));
  app.post(own,requireUser,wrap(async(req,res)=>{
    if(Object.keys(req.body ?? {}).length)throw blockError(400,'INVALID_APPLICATION','The application does not accept additional fields.');
    const result=await withSocialPair(pool,req,req.user.id,async sql=>{
      const status=await readVerification(sql,req.user.id,readMetrics);
      if(!status.canApply)throw conflict('You cannot apply for verification at this time.');
      const [application]=await sql.execute('INSERT INTO creator_verification_applications(user_id) VALUES (?)',[req.user.id]);
      const pending=await readVerification(sql,req.user.id,readMetrics);
      await syncEligibility(sql,req.user.id,pending);
      await notify(sql,req.user.id,'submitted:'+application.insertId,'Application Submitted','Your Verified Creator application is under review.');
      return pending;
    });
    res.status(201).json(result);
  }));


  app.post('/api/admin/accounts/:id/verification',requireUser,requireAdmin,wrap(async(req,res)=>{
   if(!await refinementsReady(pool))throw unavailable();
   if(req.body?.confirm!==true||Object.keys(req.body).some(k=>!['confirm','exception_reason'].includes(k)))throw blockError(400,'INVALID_APPROVAL','Confirm this verification decision.');
   const reason=req.body.exception_reason;
   if(reason!==undefined&&(typeof reason!=='string'||!reason.trim()||reason.trim().length>500))throw blockError(400,'INVALID_REASON','Write an exception reason of up to 500 characters.');
   const status=await withSocialPair(pool,req,req.recordId,async sql=>{
    const [[actor]]=await sql.execute('SELECT role FROM users WHERE id=?',[req.user.id]);if(actor?.role!=='admin')throw blockError(403,'ADMIN_REQUIRED','Administrator access is required.');
    await approveCreator(sql,req.user.id,req.recordId,{overrideReason:reason?.trim(),readMetrics});return readVerification(sql,req.recordId,readMetrics);
   });res.json(status);
  }));

  const admin='/api/admin/creator-verification';
  app.get(admin,requireUser,requireAdmin,wrap(async(req,res)=>{
    const {status='pending',before}=req.query;
    const filters={pending:"a.status='pending'",approved:"a.status IN ('approved','revoked')",rejected:"a.status='rejected'",
      verified:"a.status='approved'",history:'TRUE'};
    if(!Object.hasOwn(filters,status) || (before!==undefined && !id(before)))throw blockError(400,'INVALID_QUEUE','Choose a valid queue.');
    const [rows]=await pool.execute(`SELECT ${applicationFields},u.username,COALESCE(p.display_name,u.username) AS display_name
      FROM creator_verification_applications a JOIN users u ON u.id=a.user_id LEFT JOIN user_profiles p ON p.user_id=u.id
      WHERE ${filters[status]}${before?' AND a.id<?':''} ORDER BY a.id DESC LIMIT 26`,before?[Number(before)]:[]);
    res.json({items:rows.slice(0,25),next:rows.length>25?rows[24].id:null});
  }));
  const review=admin+'/:id';
  app.get(review,requireUser,requireAdmin,wrap(async(req,res)=>{
    const [[selected]]=await pool.execute(`SELECT ${applicationFields} FROM creator_verification_applications a WHERE a.id=?`,[req.recordId]);
    if(!selected)throw notFound();
    const [history]=await pool.execute(`SELECT ${applicationFields} FROM creator_verification_applications a WHERE a.user_id=? ORDER BY a.id DESC`,[selected.user_id]);
    res.json({selected,history,status:await readVerification(pool,selected.user_id,readMetrics)});
  }));
  app.put(review,requireUser,requireAdmin,wrap(async(req,res)=>{
    const {action,reason}=req.body ?? {};
    const allowed=action==='reject'?rejectionReasons:revocationReasons;
    if(!['approve','reject','revoke'].includes(action) ||
        (action==='approve' ? Object.keys(req.body).length!==1 : !allowed.includes(reason) || Object.keys(req.body).length!==2)){
      throw blockError(400,'INVALID_DECISION','Choose a valid decision and reason.');
    }
    const [[application]]=await pool.execute('SELECT user_id FROM creator_verification_applications WHERE id=?',[req.recordId]);
    if(!application)throw notFound();
    const status=await withSocialPair(pool,req,application.user_id,async sql=>{
      const [[actor]]=await sql.execute('SELECT role FROM users WHERE id=?',[req.user.id]);
      if(actor.role!=='admin')throw blockError(403,'ADMIN_REQUIRED','Administrator access is required.');
      const [[current]]=await sql.execute('SELECT status FROM creator_verification_applications WHERE id=? FOR UPDATE',[req.recordId]);
      if(current?.status!==(action==='revoke'?'approved':'pending'))throw conflict('This application has already been resolved.');
      const userId=application.user_id;
      if((await automaticAdminIds(sql,[userId])).length)throw conflict('The administrator is verified automatically.');
      if(action==='approve'){
        await approveCreator(sql,req.user.id,userId,{applicationId:req.recordId,readMetrics});
      }else if(action==='reject'){
        await sql.execute(`UPDATE creator_verification_applications SET status='rejected',decided_at=UTC_TIMESTAMP(6),decided_by=?,
          rejection_reason=?,retry_at=UTC_TIMESTAMP(6)+INTERVAL 30 DAY WHERE id=?`,[req.user.id,reason,req.recordId]);
        await notify(sql,userId,'rejected:'+req.recordId,'Verification Rejected','Review the decision and when you can apply again.');
      }else{
        await sql.execute(`UPDATE creator_verification_applications SET status='revoked',revoked_at=UTC_TIMESTAMP(6),revoked_by=?,
          revocation_reason=?,retry_at=UTC_TIMESTAMP(6)+INTERVAL 90 DAY WHERE id=?`,[req.user.id,reason,req.recordId]);
        await downgradeVerifiedReactions(sql,userId);
        await notify(sql,userId,'revoked:'+req.recordId,'Verification Revoked','Review the decision and when you can apply again.');
      }
      if(action!=='approve')await audit(sql,{actor:req.user.id,category:'verification',action:'verification.'+action,type:'account',id:userId,reason:reason??null,changes:{application_id:req.recordId}});
      const updated=await readVerification(sql,userId,readMetrics);
      await syncEligibility(sql,userId,updated);
      return updated;
    });
    res.json(status);
  }));
}
