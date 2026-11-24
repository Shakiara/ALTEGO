// ALTEGO necesita resolver las herramientas administrativas de moderación y verificación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {reviewActionsReady} from "../../infrastructure/schema/readiness.js";
import {anonymousReviewHidden} from '../reviews/review-moderation.js';
import {promotionReportDetail,decidePromotionReport} from '../discovery/following-feed.js';
import {deleteSelectedAudit,manualAuditPredicate} from './audit-retention.js';
import {randomUUID} from 'node:crypto';
import {attachCommunityReports} from '../conversations/community-reporting.js';
import { requireUser } from '../accounts/auth.js';
import {withSocialPair} from '../social/social-blocks.js';
import {governanceReady} from "../../infrastructure/schema/readiness.js";
import { staffRole, adminError, audit, decisionInput, notifyAccount } from './admin-audit.js';
import {removeContent,restoreContent} from './moderation-content.js';
import {decideAppeal,installSanctionAppeals} from './sanction-appeals.js';
import {caseDetails,reviewCase,resolveCase,bumpConversationRank} from '../conversations/conversation-moderation.js';
import {readVerification} from '../verification/creator-verification.js';
import {readAssetFile,validAssetId} from '../../infrastructure/storage/storage-resolver.js';

const base='/api/admin/governance';
const configs={
 feed:{from:'product_promotion_reports r JOIN product_promotions f ON f.id=r.promotion_id JOIN productos p ON p.id=f.product_id JOIN users u ON u.id=p.owner_id',id:'r.id',title:'p.nombre',state:'r.status',owner:'u.username',date:'r.created_at',where:'TRUE'},
 products:{from:`productos p JOIN users u ON u.id=p.owner_id LEFT JOIN product_publication_reviews r ON r.id=(SELECT MAX(pr.id) FROM product_publication_reviews pr WHERE pr.product_id=p.id)`,id:'p.id',title:'p.nombre',state:"COALESCE(r.status,'unreviewed')",owner:'u.username',date:'p.creado_en',where:'p.purged_at IS NULL'},
 cases:{from:'conversation_moderation_cases c LEFT JOIN users u ON u.id=c.author_id',id:'c.id',title:"CONCAT(c.content_type,' #',c.target_id)",state:'c.status',owner:'u.username',date:'c.created_at',where:'TRUE'},
 appeals:{from:'sanction_appeals a JOIN users u ON u.id=a.user_id',id:'a.id',title:"CONCAT('Appeal #',a.id)",state:'a.status',owner:'u.username',date:'a.submitted_at',where:'TRUE'},
 removed:{from:'moderation_removals m LEFT JOIN users u ON u.id=m.owner_id',id:'m.id',title:'m.label',state:"IF(m.restored_at IS NULL,'removed','restored')",owner:'u.username',date:'m.removed_at',where:'TRUE'},
 audit:{from:'administrative_audit a LEFT JOIN users u ON u.id=a.actor_id',id:'a.id',title:'a.action',state:'a.result',owner:'u.username',date:'a.created_at',where:'TRUE'}
};
const action=(id,label)=>({id,label});
export function installAdminGovernance(app,pool,mongo=null){
 installSanctionAppeals(app,pool);
 const wrap=(operation,admin=false,requiresUpdate=true)=>[requireUser,async(req,res,next)=>{
  res.set('Cache-Control','private, no-store').vary('Cookie');
  try{
   if(!staffRole(req.user.role)||admin&&req.user.role!=='admin')throw adminError(403,'This workspace section is not available to your role.');
   if(requiresUpdate&&!await governanceReady(pool))throw adminError(503,'The administration update has not been activated.','GOVERNANCE_NOT_READY');
   await operation(req,res);
  }catch(error){
   if(error.status){
    await audit(pool,{actor:req.user?.id??null,category:'security',action:'administrative.request_rejected',type:'request',id:req.params.section||'workspace',reason:error.code||'request_rejected',result:error.status===403?'denied':'failed'});
    return res.status(error.status).json({error:error.message,code:error.code});
   }
   next(error);
  }
 }];
 async function write(req,owner,operation){
  for(let attempt=0;;attempt++)try{return await withSocialPair(pool,req,owner,async sql=>{
   const [[actor]]=await sql.execute('SELECT id,role FROM users WHERE id=?',[req.user.id]);
   if(!actor||!staffRole(actor.role))throw adminError(403,'Your administrative permissions have changed.');
   return operation(sql,actor);
  });}catch(error){if(error.code!=='ER_LOCK_DEADLOCK'||attempt>=2)throw error;}
 }
 app.post('/api/products/:id/report',requireUser,async(req,res,next)=>{
  try{
   if(!await governanceReady(pool))throw adminError(503,'Product reporting has not been activated.','GOVERNANCE_NOT_READY');
   if(!['harassment','hate_speech','spam','inappropriate','violence','other'].includes(req.body?.reason)||Object.keys(req.body).length!==1)throw adminError(400,'Choose a report reason.');
   const [[product]]=await pool.execute("SELECT id,owner_id FROM productos WHERE id=? AND status IN ('Published','Unlisted') AND purged_at IS NULL AND moderation_removed=FALSE",[req.recordId]);
   if(!product)throw adminError(404,'Product not found.');
   if(req.user.id===product.owner_id)throw adminError(403,'You cannot report your own content.');
   await withSocialPair(pool,req,product.owner_id,async sql=>{
    await sql.execute('SELECT id FROM productos WHERE id=? FOR UPDATE',[product.id]);
    try{await sql.execute("INSERT INTO conversation_reports(public_id,reporter_id,content_type,target_id,reason) VALUES (?,?,'product',?,?)",[randomUUID(),req.user.id,product.id,req.body.reason]);}
    catch(error){if(error.code==='ER_DUP_ENTRY')throw adminError(409,'You have already reported this content.');throw error;}
    const grouped=await attachCommunityReports(sql,{type:'product',targetId:product.id,publicId:String(product.id),ownerId:product.owner_id});
    if(grouped.status==='pending'&&grouped.count>=6)await sql.execute('UPDATE productos SET moderation_removed=TRUE WHERE id=?',[product.id]);
   });
   res.status(201).json({submitted:true});
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message,code:error.code});next(error);}
 });
 app.post(base+'/audit/delete',...wrap(async(req,res)=>{
  const {ids,confirm}=req.body??{};if(confirm!==true||Object.keys(req.body).some(k=>!['ids','confirm'].includes(k)))throw adminError(400,'Confirm the selected audit records.');
  const result=await deleteSelectedAudit(pool,req,ids);res.json(result);
 },true));
 app.get(base+'/accounts',...wrap(async(req,res)=>{
  const {q='',role='',status='',sort='username',direction='asc',discipline='all',page='1'}=req.query;
  if(typeof q!=='string'||q.length>254||!['','admin','moderator','user'].includes(role)||!['','active','suspended'].includes(status)||!['username','role','newest'].includes(sort)||!['asc','desc'].includes(direction)||!['all','warnings','temporary','indefinite'].includes(discipline)||!/^\d{1,6}$/.test(page)||Number(page)<1)throw adminError(400,'Choose valid moderation filters.');
  const values=[],conditions=["EXISTS(SELECT 1 FROM account_sanctions s WHERE s.user_id=u.id"+(discipline==='warnings'?" AND s.kind='warning'":discipline==='temporary'?" AND s.kind='suspension' AND s.expires_at IS NOT NULL":discipline==='indefinite'?" AND s.kind='suspension' AND s.expires_at IS NULL":"")+")"];
  if(q){conditions.push('LOCATE(LOWER(?),LOWER(u.username))>0');values.push(q);}
  if(role){conditions.push('u.role=?');values.push(role);}
  const suspended="EXISTS(SELECT 1 FROM account_sanctions s WHERE s.user_id=u.id AND s.kind='suspension' AND s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>UTC_TIMESTAMP(6)))";
  if(status)conditions.push((status==='active'?'NOT ':'')+suspended);
  const filter=' WHERE '+conditions.join(' AND ');
  const [[count]]=await pool.execute('SELECT COUNT(*) total FROM users u'+filter,values);
  const current=Math.min(Number(page),Math.max(1,Math.ceil(count.total/12)));
  const [rows]=await pool.execute(`SELECT u.id,u.username,u.role,u.created_at,${req.user.role==='admin'?'u.email,':''}${suspended} AS suspended FROM users u${filter} ORDER BY ${{username:'u.username',role:'u.role',newest:'u.created_at'}[sort]} ${direction},u.id LIMIT 12 OFFSET ?`,[...values,(current-1)*12]);
  const {verifiedCreatorIds}=await import('../verification/verification-status.js');const verified=await verifiedCreatorIds(pool,rows.map(r=>r.id));
  res.json({items:rows.map(row=>({...row,suspended:Boolean(row.suspended),verified:verified.has(row.id)})),page:current,total:count.total,size:12});
 }));
 app.get('/api/admin/accounts/:id/verification',...wrap(async(req,res)=>{
  const status=await readVerification(pool,req.recordId);
  const [history]=await pool.execute('SELECT id,status,submitted_at,decided_at,rejection_reason,revocation_reason FROM creator_verification_applications WHERE user_id=? ORDER BY id DESC',[req.recordId]);
  res.json({status,history});
 },true,false));
 app.get(base+'/:section',...wrap(async(req,res)=>{
  const section=req.params.section,cfg=configs[section];
  if(!cfg||section==='appeals'&&req.user.role!=='admin')throw adminError(403,'This section is not available.');
  const {q='',state='',page='1',category='',type=''}=req.query;
  if(typeof q!=='string'||q.length>200||typeof state!=='string'||state.length>30||!/^\d{1,6}$/.test(page)||Number(page)<1)throw adminError(400,'Choose valid listing filters.');
  if(!['','product','conversation','review'].includes(type))throw adminError(400,'Choose a valid report type.');
  const values=[],filters=[cfg.where];
  const ownerId={feed:'p.owner_id',products:'p.owner_id',cases:'c.author_id',appeals:'a.user_id',removed:'m.owner_id',audit:'a.actor_id'}[section];let ownerExpr=cfg.owner,ownerIdExpr=ownerId;
  if(['cases','removed'].includes(section)&&req.user.role!=='admin'&&await reviewActionsReady(pool)){const prefix=section==='cases'?'c':'m',typeColumn=section==='cases'?'content_type':'entity_type',targetColumn=section==='cases'?'target_id':'entity_id';const hide=`${prefix}.${typeColumn}='review' AND ${ownerId}<>${Number(req.user.id)} AND EXISTS(SELECT 1 FROM review_moderation_targets t WHERE t.id=${prefix}.${targetColumn} AND t.is_anonymous=TRUE)`;ownerExpr=`IF(${hide},NULL,${cfg.owner})`;ownerIdExpr=`IF(${hide},NULL,${ownerId})`;}

  if(section==='cases'&&type)filters.push(type==='conversation'?"c.content_type IN ('post','comment','reply')":"c.content_type='"+type+"'");
  if(q){filters.push('LOCATE(LOWER(?),LOWER(CONCAT('+cfg.title+",' ',COALESCE("+ownerExpr+",''))))>0");values.push(q);}
  if(state){filters.push(cfg.state+'=?');values.push(state);}
  if(section==='audit'){
   const allowed=req.user.role==='admin'?['moderation','sanctions','roles','security','verification','products']:['moderation','sanctions','products'];
   if(category&&!allowed.includes(category))throw adminError(403,'This audit category is restricted.');
   filters.push('a.category IN ('+allowed.map(()=>'?').join(',')+')');values.push(...allowed);
   if(category){filters.push('a.category=?');values.push(category);}
  }
  const from=' FROM '+cfg.from+' WHERE '+filters.join(' AND ');
  const [[count]]=await pool.execute('SELECT COUNT(*) total'+from,values);
  const current=Math.min(Number(page),Math.max(1,Math.ceil(count.total/20)));
  const [items]=await pool.execute('SELECT '+cfg.id+' AS id,'+cfg.title+' AS title,'+cfg.state+' AS state,'+ownerExpr+' AS owner,'+ownerIdExpr+' AS owner_id,'+cfg.date+' AS created_at'+(section==='audit'?',('+manualAuditPredicate+') AS deletion_eligible':'')+from+' ORDER BY '+cfg.id+' DESC LIMIT 20 OFFSET ?',[...values,(current-1)*20]);
  res.json({items,total:count.total,page:current,size:20});
 }));
 app.get(base+'/products/:id/assets/:assetId',...wrap(async(req,res)=>{
  if(!validAssetId(req.params.assetId))throw adminError(404,'File not found.');
  const [[asset]]=await pool.execute(`SELECT a.* FROM assets a WHERE a.id=? AND (EXISTS(SELECT 1 FROM productos p WHERE p.id=? AND p.model_asset_id=a.id)
   OR EXISTS(SELECT 1 FROM variants v WHERE v.product_id=? AND v.texture_asset_id=a.id)
   OR EXISTS(SELECT 1 FROM version_variants vv JOIN product_versions pv ON pv.id=vv.version_id WHERE pv.product_id=? AND (vv.model_asset_id=a.id OR vv.texture_asset_id=a.id)))`,[req.params.assetId,req.recordId,req.recordId,req.recordId]);
  if(!asset)throw adminError(404,'File not found.');
  res.set('X-Content-Type-Options','nosniff').type(asset.kind==='glb'?'model/gltf-binary':'image/png').send(await readAssetFile(pool,asset,'preview',{productId:req.recordId}));
 }));
 app.get(base+'/cases/:id/images/:position',...wrap(async(req,res)=>{
  if(!/^[0-7]$/.test(req.params.position))throw adminError(404,'Image not found.');
  const [[image]]=await pool.execute('SELECT i.image_bytes FROM conversation_moderation_cases c JOIN conversation_post_images i ON i.post_id=c.post_id WHERE c.id=? AND i.position=?',[req.recordId,Number(req.params.position)]);
  if(!image)throw adminError(404,'Image not found.');res.type('image/webp').send(image.image_bytes);
 }));
 app.get(base+'/:section/:id',...wrap(async(req,res)=>{
  const {section}=req.params,id=req.recordId;
  if(!configs[section]||section==='appeals'&&req.user.role!=='admin')throw adminError(403,'This section is restricted.');
  let detail;
  if(section==='feed'){detail=await promotionReportDetail(pool,id);}
  else if(section==='cases'){
   const [[item]]=await pool.execute('SELECT public_id FROM conversation_moderation_cases WHERE id=?',[id]);
   if(!item)throw adminError(404,'Case not found.');
   const record=await reviewCase(pool,item.public_id);
   const data=await caseDetails(pool,record,mongo);
   const [reports]=await pool.execute('SELECT r.id,r.reason,r.created_at,u.username AS reporter,r.reporter_id,r.status'+(await reviewActionsReady(pool)?',r.explanation':'')+' FROM conversation_reports r JOIN users u ON u.id=r.reporter_id WHERE r.case_id=? ORDER BY r.id DESC',[id]);
   const [history]=await pool.execute("SELECT action,reason,created_at,result FROM administrative_audit WHERE entity_type='case' AND entity_id=? ORDER BY id DESC",[String(id)]);
   if(record.content_type==='review'){const [[target]]=await pool.execute('SELECT * FROM review_moderation_targets WHERE id=?',[record.target_id]);if(anonymousReviewHidden(target,req.user)){record.author_id=null;record.author=null;}if(target?.author_id===req.user.id)for(const report of reports){report.reporter=null;report.reporter_id=null;}}
   detail={id,...(record.content_type==='product'?{product_id:record.target_id}:{}),title:data.content?.title||'Community report',state:record.status,owner_id:record.author_id,content:data.content,reports,history:[{status:'pending',created_at:record.created_at},...history,...(record.resolved_at?[{status:record.status,created_at:record.resolved_at,reason:record.decision_reason}]:[])],fields:[{label:'Creator',value:record.author?'@'+record.author:'Unavailable account',user_id:record.author_id},{label:'Content type',value:record.content_type},{label:'Reports',value:String(reports.length)},{label:'Assigned to',value:data.assigned_username?'@'+data.assigned_username:'Unassigned',user_id:data.assigned_username?record.assigned_to:null}],actions:record.status==='pending'?[action('assign','Assign to Me'),action('dismiss','Dismiss Reports'),action('remove','Remove Content')]:[]};
   if(data.content?.images)detail.content={...data.content,images:data.content.images.map((_,position)=>base+'/cases/'+id+'/images/'+position)};
  }else if(section==='products'){
   const [[product]]=await pool.execute('SELECT p.*,u.username FROM productos p JOIN users u ON u.id=p.owner_id WHERE p.id=?',[id]);
   if(!product)throw adminError(404,'Product not found.');
   const [reviews]=await pool.execute('SELECT id,status,submitted_at,decided_at,decision_reason,decision_explanation FROM product_publication_reviews WHERE product_id=? ORDER BY id DESC',[id]);
   const pending=reviews.find(r=>r.status==='pending'),[variants]=await pool.execute('SELECT id,name,hex,texture_asset_id,is_default FROM variants WHERE product_id=? AND active=TRUE ORDER BY is_default DESC,id',[id]);
   const [versions]=await pool.execute('SELECT id,version_number,created_at,snapshot FROM product_versions WHERE product_id=? ORDER BY version_number DESC',[id]);
   const assetUrl=asset=>base+'/products/'+id+'/assets/'+asset;
   detail={id,title:product.nombre,state:product.moderation_removed?'removed':pending?'pending':product.status,owner_id:product.owner_id,review_id:pending?.id??null,model_url:product.model_asset_id?assetUrl(product.model_asset_id):null,variants:variants.map(v=>({...v,texture_url:v.texture_asset_id?assetUrl(v.texture_asset_id):null})),history:reviews,versions:versions.map(v=>{const snapshot=typeof v.snapshot==='string'?JSON.parse(v.snapshot):v.snapshot;return {id:v.id,version_number:v.version_number,created_at:v.created_at,state:v.id===product.current_version_id?'Current':'Historical',model_url:snapshot.model_asset_id?assetUrl(snapshot.model_asset_id):null,variants:snapshot.variants.map(item=>({...item,texture_url:item.texture_asset_id?assetUrl(item.texture_asset_id):null}))};}),fields:[{label:'Creator',value:'@'+product.username,user_id:product.owner_id},{label:'Description',value:product.descripcion},{label:'USD',value:String(product.precio)},{label:'Visibility',value:product.status},{label:'Published version ID',value:product.current_version_id?String(product.current_version_id):'Not published'}],actions:[...(pending&&req.user.role==='admin'?[action('review_approve','Approve Publication'),action('review_reject','Reject Publication')]:[]),...(!product.moderation_removed?[action('remove','Remove Content')]:[])]};
  }else if(section==='appeals'){
   const [[appeal]]=await pool.execute('SELECT a.*,u.username,s.kind,s.reason AS sanction_reason FROM sanction_appeals a JOIN users u ON u.id=a.user_id JOIN account_sanctions s ON s.id=a.sanction_id WHERE a.id=?',[id]);
   if(!appeal)throw adminError(404,'Appeal not found.');
   const [history]=await pool.execute("SELECT action,reason,created_at,changes,result FROM administrative_audit WHERE entity_type='appeal' AND entity_id=? ORDER BY id DESC",[String(id)]);
   detail={id,title:'Appeal #'+appeal.id,state:appeal.status,owner_id:appeal.user_id,fields:[{label:'Account',value:'@'+appeal.username,user_id:appeal.user_id},{label:'Sanction',value:appeal.kind},{label:'Sanction reason',value:appeal.sanction_reason},{label:'Appeal',value:appeal.explanation},{label:'Decision reason',value:appeal.decision_reason||'Pending'}],history,actions:appeal.status==='pending'?[action('approve','Approve Appeal'),action('reject','Reject Appeal')]:[action(appeal.status==='approved'?'correct_reject':'correct_approve','Correct Decision')]};
  }else if(section==='removed'){
   const [[removed]]=await pool.execute('SELECT * FROM moderation_removals WHERE id=?',[id]);if(!removed)throw adminError(404,'Removal not found.');
   if(removed.entity_type==='review'){const [[target]]=await pool.execute('SELECT * FROM review_moderation_targets WHERE id=?',[removed.entity_id]);if(anonymousReviewHidden(target,req.user))removed.owner_id=null;}
   detail={id,title:removed.label,state:removed.restored_at?'restored':'removed',owner_id:removed.owner_id,fields:[{label:'Content type',value:removed.entity_type},{label:'Reason',value:removed.reason},{label:'Explanation',value:removed.explanation||'—'},{label:'Removed at',value:String(removed.removed_at)},{label:'Restored at',value:removed.restored_at?String(removed.restored_at):'Not restored'}],actions:req.user.role==='admin'&&!removed.restored_at?[action('restore','Restore Content')]:[]};
  }else{
   const [[entry]]=await pool.execute('SELECT a.*,u.username AS actor_username FROM administrative_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.id=?',[id]);if(!entry)throw adminError(404,'Audit event not found.');
   if(req.user.role!=='admin'&&!['moderation','sanctions','products'].includes(entry.category))throw adminError(403,'This audit record is restricted.');
   detail={id,title:entry.action,state:entry.result,fields:[{label:'Category',value:entry.category},{label:'Entity',value:entry.entity_type+' #'+entry.entity_id},{label:'Actor',value:entry.actor_username?'@'+entry.actor_username:'Former account',user_id:entry.actor_id},{label:'Reason',value:entry.reason||'—'},{label:'Changes',value:JSON.stringify(entry.changes)}],actions:[]};
  }
  res.json(detail);
 }));
 async function caseAction(sql,actor,id,actionId,body){
  const {reason}=decisionInput(body);
  const [[item]]=await sql.execute('SELECT * FROM conversation_moderation_cases WHERE id=?',[id]);
  if(!item||item.status!=='pending')throw adminError(409,'This case has already been resolved.');
  if(item.content_type==='review')await sql.execute('SELECT id FROM review_moderation_targets WHERE id=? FOR UPDATE',[item.target_id]);
  else if(item.content_type==='product')await sql.execute('SELECT id FROM productos WHERE id=? FOR UPDATE',[item.target_id]);
  else await sql.execute('SELECT id FROM conversation_posts WHERE id=? FOR UPDATE',[item.post_id]);
  const [[current]]=await sql.execute('SELECT status FROM conversation_moderation_cases WHERE id=? FOR UPDATE',[id]);if(current.status!=='pending')throw adminError(409,'This case has already been resolved.');
  if(actionId==='assign'){
   await sql.execute('UPDATE conversation_moderation_cases SET assigned_to=? WHERE id=?',[actor.id,id]);
  }else if(actionId==='remove'){
   await removeContent(sql,actor,item.content_type,item.target_id,body);
   await resolveCase(sql,item,'removed',actor.id);
  }else if(actionId==='dismiss'){
   const [[removed]]=await sql.execute('SELECT id FROM moderation_removals WHERE entity_type=? AND entity_id=? AND restored_at IS NULL',[item.content_type,item.target_id]);
   if(!removed){
    if(item.content_type==='review'){                                                                      }
    else if(item.content_type==='product')await sql.execute('UPDATE productos SET moderation_removed=FALSE WHERE id=?',[item.target_id]);
    else if(item.content_type==='post')await sql.execute('DELETE FROM conversation_hidden_posts WHERE post_id=?',[item.target_id]);
    else{await sql.execute('UPDATE conversation_comments SET hidden_at=NULL WHERE id=?',[item.target_id]);await bumpConversationRank(sql,item.post_id);}
   }
   await resolveCase(sql,item,'restored',actor.id);
  }else throw adminError(400,'Unknown case action.');
  await sql.execute('UPDATE conversation_moderation_cases SET decision_reason=? WHERE id=?',[reason,id]);
  await audit(sql,{actor:actor.id,category:'moderation',action:'case.'+actionId,type:'case',id,reason});
  if(actionId==='dismiss'&&item.author_id)await notifyAccount(sql,{recipient:item.author_id,key:'case-dismiss:'+id,title:'Moderation review completed',description:'The reports were reviewed without an account sanction.',destination:'/account/status'});
 }
 app.post(base+'/cases/bulk',...wrap(async(req,res)=>{
  const {ids,action:actionId}=req.body??{};decisionInput(req.body);
  if(!Array.isArray(ids)||!ids.length||ids.length>20||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length||!['assign','dismiss'].includes(actionId))throw adminError(400,'Select up to 20 distinct cases for assignment or dismissal.');
  await write(req,req.user.id,async(sql,actor)=>{for(const id of [...ids].sort((a,b)=>a-b))await caseAction(sql,actor,id,actionId,req.body);});
  res.json({completed:ids.length});
 }));
 app.post(base+'/:section/:id/actions/:action',...wrap(async(req,res)=>{
  const {section,action:actionId}=req.params,id=req.recordId;decisionInput(req.body);if(section==='feed'){await decidePromotionReport(pool,req);return res.status(204).end();}
  let owner=req.user.id;
  const tables={cases:['conversation_moderation_cases','author_id'],products:['productos','owner_id'],appeals:['sanction_appeals','user_id'],removed:['moderation_removals','owner_id']};
  if(!tables[section])throw adminError(400,'Unknown administrative action.');
  const [table,field]=tables[section],[[record]]=await pool.execute('SELECT '+field+' AS owner FROM '+table+' WHERE id=?',[id]);
  if(!record)throw adminError(404,'Record not found.');owner=record.owner??owner;
  await write(req,owner,async(sql,actor)=>{
   if(section==='cases')await caseAction(sql,actor,id,actionId,req.body);
   else if(section==='products'&&actionId==='remove')await removeContent(sql,actor,'product',id,req.body);
   else if(section==='removed'&&actionId==='restore')await restoreContent(sql,actor,id,req.body);
   else if(section==='appeals')await decideAppeal(sql,actor,id,actionId,req.body);
   else throw adminError(400,'Unknown administrative action.');
  });
  res.status(204).end();
 }));
}
