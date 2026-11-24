// ALTEGO necesita resolver las novedades de los creadores seguidos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {randomUUID} from 'node:crypto';
import {requireUser,requireLiveSession} from '../accounts/auth.js';
import {followingFeedReady} from "../../infrastructure/schema/readiness.js";
import {decorateProduct} from '../products/product-dto.js';
import {reactionNames} from '../conversations/conversation-engagement.js';
import {isVerifiedCreator} from '../verification/verification-status.js';
import {withSocialPair,assertSocialInteractionAllowed} from '../social/social-blocks.js';
import {staffRole,decisionInput,audit,notifyAccount} from '../administration/admin-audit.js';
import {reportReasons} from '../conversations/conversation-moderation.js';
const fail=(message,status=400,code='FEED_REQUEST_REJECTED')=>Object.assign(Error(message),{status,code});
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const listed="p.status='Published' AND p.purged_at IS NULL AND p.moderation_removed=FALSE";
const stamp="DATE_FORMAT(f.published_at,'%Y-%m-%d %H:%i:%s.%f')";
const identifier=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function promotionMessage(sql,product){if(!await followingFeedReady(sql))return undefined;const [[row]]=await sql.execute('SELECT message FROM product_promotion_drafts WHERE product_id=?',[product]);return row?.message||'';}
export async function savePromotionMessage(sql,p,actor,value){
 if(value===undefined)return;if(!await followingFeedReady(sql))throw fail('Following Feed is not available yet.',503);
 if(typeof value!=='string'||value.length>1000)throw fail('Use up to 1,000 characters for the promotional message.');
 const message=value.trim(),previous=await promotionMessage(sql,p.id);if(message===previous)return;
 if(actor.id!==p.owner_id)throw fail('Only the creator can edit this promotional message.',403);
 if(p.moderation_removed||p.status==='Trash'||p.purged_at)throw fail('This item cannot be edited right now.',409);
 await sql.execute('INSERT INTO product_promotion_drafts(product_id,message) VALUES (?,?) ON DUPLICATE KEY UPDATE message=VALUES(message)',[p.id,message]);
 await sql.execute('UPDATE product_promotions SET message=?,message_revision=message_revision+1 WHERE product_id=?',[message,p.id]);
}
export async function publishPromotion(sql,p){if(!await followingFeedReady(sql))return;await sql.execute('INSERT IGNORE INTO product_promotions(public_id,product_id,message,published_at) VALUES (?,?,?,UTC_TIMESTAMP(6))',[randomUUID(),p.id,await promotionMessage(sql,p.id)||'']);}
export async function removeProductPromotion(sql,id){if(await followingFeedReady(sql)){await sql.execute('DELETE FROM product_promotions WHERE product_id=?',[id]);await sql.execute('DELETE FROM product_promotion_drafts WHERE product_id=?',[id]);}}
async function getPromotion(sql,publicId,lock=false){
 if(!identifier.test(publicId||''))throw fail('Publication not found.',404);
 const [[row]]=await sql.execute(`SELECT f.*,p.owner_id FROM product_promotions f JOIN productos p ON p.id=f.product_id WHERE f.public_id=? AND ${listed}`+(lock?' FOR UPDATE':''),[publicId]);if(!row)throw fail('Publication not found.',404);return row;
}
async function summary(sql,id,viewer){const counts=Object.fromEntries(reactionNames.map(name=>[name,0]));let total=0,mine=null;const [rows]=await sql.execute('SELECT reaction,COUNT(*) total,MAX(user_id<=>?) mine FROM product_promotion_reactions WHERE promotion_id=? GROUP BY reaction',[viewer??null,id]);for(const row of rows){counts[row.reaction]=Number(row.total);total+=Number(row.total);if(row.mine)mine=row.reaction;}return{counts,total,mine};}
async function dto(sql,row,viewer){
 const [[p]]=await sql.execute('SELECT p.*,v.snapshot,v.version_number,c.nombre category,u.username,COALESCE(up.display_name,u.username) display_name,up.avatar FROM productos p JOIN product_versions v ON v.id=p.current_version_id JOIN categorias c ON c.id=COALESCE(JSON_EXTRACT(v.snapshot,\'$.category_id\'),p.categoria_id) JOIN users u ON u.id=p.owner_id LEFT JOIN user_profiles up ON up.user_id=u.id WHERE p.id=? AND '+listed,[row.product_id]);if(!p)return null;
 const avatar=parse(p.avatar||'{}'),verified=await isVerifiedCreator(sql,p.owner_id),snapshot=parse(p.snapshot);
 return{id:Number(row.id),public_id:row.public_id,message:row.message,published_at:row.time.replace(' ','T')+'Z',creator:{id:p.owner_id,username:p.username,display_name:p.display_name,avatar_url:avatar.media_id?'/api/profile-media/'+avatar.media_id+'/display':null,verified_creator:verified},product:decorateProduct({...snapshot,owner_id:p.owner_id,creator_name:p.display_name,verified_creator:verified,status:p.status,current_version_id:p.current_version_id,version_number:p.version_number,category:p.category}),reactions:await summary(sql,row.id,viewer)};
}
export async function promotionReportDetail(sql,id){
 const [[r]]=await sql.execute('SELECT r.*,f.message_revision current_revision,f.message,p.owner_id,p.nombre,u.username FROM product_promotion_reports r JOIN product_promotions f ON f.id=r.promotion_id JOIN productos p ON p.id=f.product_id JOIN users u ON u.id=p.owner_id WHERE r.id=?',[id]);if(!r)throw fail('Report not found.',404);
 const [history]=await sql.execute('SELECT reason,created_at,message_text FROM product_promotion_removals WHERE promotion_id=? ORDER BY id DESC',[r.promotion_id]);
 return{id:Number(r.id),title:r.nombre,state:r.status,owner_id:r.owner_id,fields:[{label:'Creator',value:'@'+r.username,user_id:r.owner_id},{label:'Reported message',value:r.message_text||'No promotional message'},{label:'Reason',value:r.reason},{label:'Current message',value:r.message||'No promotional message'},...history.map(h=>({label:'Removed message · '+h.reason,value:h.message_text}))],history,actions:r.status==='pending'?[{id:'dismiss',label:'Dismiss Report'},...(r.message&&r.message_revision===r.current_revision?[{id:'remove_message',label:'Remove Promotional Message'}]:[])]:[]};
}
export async function decidePromotionReport(pool,req){
 const [[info]]=await pool.execute('SELECT p.owner_id FROM product_promotion_reports r JOIN product_promotions f ON f.id=r.promotion_id JOIN productos p ON p.id=f.product_id WHERE r.id=?',[req.recordId]);if(!info)throw fail('Report not found.',404);
 await withSocialPair(pool,req,info.owner_id,async sql=>{
  const [[actor]]=await sql.execute('SELECT role FROM users WHERE id=?',[req.user.id]);if(!staffRole(actor?.role))throw fail('Staff access is required.',403);
  const {reason,explanation}=decisionInput(req.body),[[r]]=await sql.execute('SELECT r.*,f.product_id,f.message,f.message_revision current_revision FROM product_promotion_reports r JOIN product_promotions f ON f.id=r.promotion_id JOIN productos p ON p.id=f.product_id WHERE r.id=? FOR UPDATE',[req.recordId]);
  if(!r||r.status!=='pending')throw fail('This report has already been resolved.',409);
  if(req.params.action==='remove_message'){
   if(!r.message||r.message_revision!==r.current_revision)throw fail('The message changed. Reload this report.',409);
   const [removed]=await sql.execute('INSERT INTO product_promotion_removals(promotion_id,actor_id,message_text,message_revision,reason,explanation) VALUES (?,?,?,?,?,?)',[r.promotion_id,req.user.id,r.message,r.current_revision,reason,explanation]);
   await sql.execute("UPDATE product_promotions SET message='',message_revision=message_revision+1 WHERE id=?",[r.promotion_id]);await sql.execute("UPDATE product_promotion_drafts SET message='' WHERE product_id=?",[r.product_id]);
   await sql.execute("UPDATE product_promotion_reports SET status='resolved' WHERE promotion_id=? AND message_revision=?",[r.promotion_id,r.current_revision]);
   await notifyAccount(sql,{recipient:info.owner_id,actor:req.user.id,allowSelf:true,productId:r.product_id,key:'feed-message-removal:'+removed.insertId,title:'Promotional message removed',description:'Your promotional message was removed. Reason: '+reason.replaceAll('_',' ')+(explanation?'. '+explanation:''),destination:'/products/'+r.product_id+'/edit'});
  }else if(req.params.action==='dismiss')await sql.execute("UPDATE product_promotion_reports SET status='resolved' WHERE id=?",[r.id]);else throw fail('Unknown moderation action.');
  await audit(sql,{actor:req.user.id,category:'moderation',action:'promotion.'+req.params.action,type:'promotion',id:r.promotion_id,reason,changes:{message:r.message,report_id:Number(r.id)}});
 });
}
export function installFollowingFeed(app,pool){
 const ready=async(req,res,next)=>{res.set('Cache-Control','private, no-store').vary('Cookie');if(!await followingFeedReady(pool))return res.status(503).json({error:'Following Feed is not available yet.'});next();};
 app.get('/api/following-feed',requireUser,ready,async(req,res)=>{
  let cursor=null;if(Object.keys(req.query).some(k=>!['cursor'].includes(k)))throw fail('Invalid feed query.');
  if(req.query.cursor){try{if(typeof req.query.cursor!=='string'||req.query.cursor.length>600)throw Error();cursor=JSON.parse(Buffer.from(req.query.cursor,'base64url'));if(cursor.viewer!==req.user.id||!Number.isSafeInteger(cursor.ceiling)||!Number.isSafeInteger(cursor.id)||cursor.id<1||cursor.ceiling<cursor.id||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}$/.test(cursor.time))throw Error();}catch{throw fail('Reload the feed to continue.');}}
  const sql=await pool.getConnection();try{await sql.beginTransaction();const [[top]]=await sql.query('SELECT COALESCE(MAX(id),0) ceiling FROM product_promotions');const ceiling=cursor?.ceiling??Number(top.ceiling),args=[req.user.id,req.user.id,ceiling];
   let where=`${listed} AND p.owner_id<>? AND f.id<=? AND f.published_at>s.created_at`;
   if(cursor){where+=' AND (f.published_at<? OR (f.published_at=? AND f.id<?))';args.push(cursor.time,cursor.time,cursor.id);}
   const [rows]=await sql.execute(`SELECT f.*,${stamp} time FROM product_promotions f JOIN productos p ON p.id=f.product_id JOIN creator_follows s ON s.creator_id=p.owner_id AND s.follower_id=? WHERE ${where} ORDER BY f.published_at DESC,f.id DESC LIMIT 13`,args);
   const shown=rows.slice(0,12),items=[];for(const row of shown){const item=await dto(sql,row,req.user.id);if(item)items.push(item);}const last=shown.at(-1);await sql.commit();res.json({items,next_cursor:rows.length>12?Buffer.from(JSON.stringify({viewer:req.user.id,ceiling,time:last.time,id:Number(last.id)})).toString('base64url'):null});
  }catch(e){await sql.rollback();throw e;}finally{sql.release();}
 });
 app.get('/api/feed-publications/:publicId',ready,async(req,res)=>{const row=await getPromotion(pool,req.params.publicId);const [[time]]=await pool.execute(`SELECT ${stamp} time FROM product_promotions f WHERE f.id=?`,[row.id]);const item=await dto(pool,{...row,...time},req.user?.id);if(!item)throw fail('Publication not found.',404);res.json(item);});
 const write=run=>[requireUser,ready,async(req,res)=>{const info=await getPromotion(pool,req.params.publicId);const result=await withSocialPair(pool,req,info.owner_id,async sql=>{await requireLiveSession(sql,req);const row=await getPromotion(sql,req.params.publicId,true);await assertSocialInteractionAllowed(sql,req.user.id,row.owner_id,{current:true});return run(sql,row,req);});res.json(result);}];
 app.put('/api/feed-publications/:publicId/reaction',...write(async(sql,row,req)=>{
  const reaction=req.body?.reaction;if(Object.keys(req.body||{}).some(k=>k!=='reaction')||reaction!==null&&!reactionNames.includes(reaction))throw fail('Choose a valid reaction.');
  if(['adore','fire'].includes(reaction)&&!await isVerifiedCreator(sql,req.user.id))throw fail('This reaction requires a Verified account.',403,'VERIFIED_REACTION_REQUIRED');
  if(reaction===null)await sql.execute('DELETE FROM product_promotion_reactions WHERE promotion_id=? AND user_id=?',[row.id,req.user.id]);else await sql.execute('INSERT INTO product_promotion_reactions(promotion_id,user_id,reaction) VALUES (?,?,?) ON DUPLICATE KEY UPDATE reaction=VALUES(reaction)',[row.id,req.user.id,reaction]);return summary(sql,row.id,req.user.id);
 }));
 app.post('/api/feed-publications/:publicId/reports',...write(async(sql,row,req)=>{
  if(req.user.id===row.owner_id)throw fail('You cannot report your own content.',403);if(Object.keys(req.body||{}).some(k=>k!=='reason')||!reportReasons.includes(req.body?.reason))throw fail('Choose a report reason.');
  try{await sql.execute('INSERT INTO product_promotion_reports(promotion_id,reporter_id,message_revision,message_text,reason) VALUES (?,?,?,?,?)',[row.id,req.user.id,row.message_revision,row.message,req.body.reason]);}catch(e){if(e.code==='ER_DUP_ENTRY')throw fail('You have already reported this message.',409);throw e;}return{submitted:true};
 }));
}
