// ALTEGO necesita resolver la revisión y resolución de casos de conversaciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {reviewActionsReady} from "../../infrastructure/schema/readiness.js";
import {findReview} from '../reviews/review-moderation.js';
import {attachCommunityReports} from './community-reporting.js';
import {governanceReady} from "../../infrastructure/schema/readiness.js";
import {audit,decisionInput,staffRole} from '../administration/admin-audit.js';
import {removeContent,protectRemovedContent} from '../administration/moderation-content.js';
import {randomUUID} from 'node:crypto';
import '../accounts/auth.js';
import {assertSocialInteractionAllowed,blockError,withSocialPair} from '../social/social-blocks.js';
import {notifySocialEvent,removeSocialNotificationsForHiddenContent,uuidPattern} from '../social/social-notifications.js';
import {missingConversation,moderationReady,publicComment,readConversation,visiblePost} from './conversation-visibility.js';
import {installPollActions,readPolls} from './conversation-polls.js';

export const reportReasons = ['harassment','hate_speech','spam','inappropriate','violence','other'];
const threshold = 6;
const denied = () => blockError(403,'ADMIN_REQUIRED','Administrator access is required.');
const invalid = message => blockError(400,'INVALID_MODERATION_REQUEST',message);
const conflict = () => blockError(409,'MODERATION_RESOLVED','This case has already been resolved.');
const caseDates = `DATE_FORMAT(m.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS created_at,
  DATE_FORMAT(m.resolved_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS resolved_at`;

function reportType(target) {
  return 'root_id' in target ? target.root_id===null ? 'comment' : 'reply' : 'post';
}

export function bumpConversationRank(sql,postId) {
  return sql.execute('INSERT INTO conversation_rank(post_id) VALUES (?) ON DUPLICATE KEY UPDATE revision=revision+1',[postId]);
}

export async function notifyModeration(sql,item,state,destination=null) {
  if (item.author_id===null) return;
  const messages = {
    hidden: ['Content hidden for review','Your '+item.content_type+' was temporarily hidden after community reports.'],
    restored: ['Content restored','Your '+item.content_type+' was restored after moderation review.'],
    removed: ['Content removed','Your '+item.content_type+' was removed from public view during moderation.'],
  };
  const [title,description] = messages[state];
  await notifySocialEvent(sql,{recipient:item.author_id,category:'moderation',key:'moderation:'+item.public_id+':'+state,title,description,destination});
}


async function lockPost(sql,author,postId,{hidden=false,numeric=false}={}) {
  const [[post]] = await sql.execute(`SELECT p.id,p.author_id,p.public_id FROM conversation_posts p
    WHERE p.${numeric?'id':'public_id'}=? AND p.author_id=? AND ${hidden?'TRUE':visiblePost('p')} FOR UPDATE`,[postId,author]);
  if (!post) throw missingConversation();
  return post;
}

async function reportContent(sql,req) {
  const post = await lockPost(sql,req.recordId,req.params.postId);
  const commentId = req.params.commentId;
  const [[target]] = commentId
    ? await sql.execute(`SELECT c.id,c.author_id,c.public_id,c.root_id FROM conversation_comments c
        WHERE c.public_id=? AND c.post_id=? AND ${publicComment} FOR UPDATE`,[commentId,post.id])
    : [[post]];
  if (!target) throw missingConversation();
  const actor = req.user.id;
  if (actor===target.author_id) throw blockError(403,'SELF_REPORT','You cannot report your own content.');
  await assertSocialInteractionAllowed(sql,actor,post.author_id,{current:true});
  if (target.author_id!==post.author_id) {
    await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[target.author_id]);
    await assertSocialInteractionAllowed(sql,actor,target.author_id,{current:true});
  }
  const contentType = reportType(target);
  try {
    await sql.execute(`INSERT INTO conversation_reports(public_id,reporter_id,post_id,content_type,target_id,reason)
      VALUES (?,?,?,?,?,?)`,[randomUUID(),actor,post.id,contentType,target.id,req.body.reason]);
  } catch (error) {
    if (error.code==='ER_DUP_ENTRY') throw blockError(409,'ALREADY_REPORTED','You have already reported this content.');
    throw error;
  }
  if(await governanceReady(sql)){
    const grouped=await attachCommunityReports(sql,{type:contentType,targetId:target.id,publicId:target.public_id,ownerId:target.author_id,postId:post.id});
    const review={status:grouped.status,public_id:grouped.public_id},count={total:grouped.count};
    if(review.status==='pending'&&count.total>=threshold){
      if(contentType==='post')await sql.execute('INSERT IGNORE INTO conversation_hidden_posts(post_id) VALUES (?)',[post.id]);
      else{await sql.execute('UPDATE conversation_comments SET hidden_at=COALESCE(hidden_at,UTC_TIMESTAMP(6)) WHERE id=?',[target.id]);await bumpConversationRank(sql,post.id);}
      await removeSocialNotificationsForHiddenContent(sql,{postId:post.id,commentId:commentId?target.id:null});
      await notifyModeration(sql,{author_id:target.author_id,content_type:contentType,public_id:review.public_id},'hidden');
    }
    return;
  }
  const [reports] = await sql.execute(`SELECT id FROM conversation_reports
    WHERE content_type=? AND target_id=? AND status='active' AND case_id IS NULL FOR UPDATE`,[contentType,target.id]);
  if (reports.length<threshold) return;
  const publicId = randomUUID();
  const [created] = await sql.execute(`INSERT INTO conversation_moderation_cases
    (public_id,post_id,target_id,target_public_id,content_type,author_id) VALUES (?,?,?,?,?,?)`,
    [publicId,post.id,target.id,target.public_id,contentType,target.author_id]);
  await sql.execute(`UPDATE conversation_reports SET case_id=?
    WHERE content_type=? AND target_id=? AND status='active' AND case_id IS NULL`,[created.insertId,contentType,target.id]);
  if (contentType==='post') await sql.execute('INSERT INTO conversation_hidden_posts(post_id) VALUES (?)',[post.id]);
  else {
    await sql.execute('UPDATE conversation_comments SET hidden_at=UTC_TIMESTAMP(6) WHERE id=?',[target.id]);
    await bumpConversationRank(sql,post.id);
  }
  await removeSocialNotificationsForHiddenContent(sql,{postId:post.id,commentId:commentId?target.id:null});
  await notifyModeration(sql,{author_id:target.author_id,content_type:contentType,public_id:publicId},'hidden');
}

export async function resolveCase(sql,item,decision,moderatorId) {
  await sql.execute(`UPDATE conversation_moderation_cases SET status=?,moderator_id=?,resolved_at=UTC_TIMESTAMP(6) WHERE id=?`,
    [decision,moderatorId,item.id]);
  await sql.execute("UPDATE conversation_reports SET status='resolved' WHERE case_id=? AND status='active'",[item.id]);
}


export async function cleanModerationForDeletion(sql,postId,commentId=null,moderatorId=null) {
  if (!await moderationReady(sql)) return;
  await protectRemovedContent(sql,postId,commentId);
  const scope = commentId===null ? 'TRUE' : `m.content_type<>'post' AND EXISTS
    (SELECT 1 FROM conversation_comments c WHERE c.id=m.target_id AND (c.id=? OR c.root_id=?))`;
  const args = commentId===null ? [postId] : [postId,commentId,commentId];
  const [pending] = await sql.execute(`SELECT m.* FROM conversation_moderation_cases m WHERE m.post_id=?
    AND m.status='pending' AND ${scope} ORDER BY m.id FOR UPDATE`,args);
  for (const item of pending) {
    await resolveCase(sql,item,'removed',moderatorId);
    if (moderatorId!==null) await notifyModeration(sql,item,'removed');
  }
  await sql.execute(`DELETE m FROM conversation_reports m WHERE m.post_id=? AND m.case_id IS NULL AND ${scope}`,args);
}

const publicCase = row => ({
  id:row.public_id,record_id:row.id,assigned_to:row.assigned_to??null,assigned_username:row.assigned_username??null,author_id:row.author_id,moderator_id:row.moderator_id, content_type:row.content_type, status:row.status, author:row.author,
  created_at:row.created_at, resolved_at:row.resolved_at, moderator:row.moderator,
  report_count:Number(row.report_count),
});
const caseFrom = ` FROM conversation_moderation_cases m
  LEFT JOIN users author ON author.id=m.author_id LEFT JOIN users reviewer ON reviewer.id=m.moderator_id`;
const caseSelect = `SELECT m.*, ${caseDates}, author.username AS author, reviewer.username AS moderator,
  (SELECT COUNT(*) FROM conversation_reports r WHERE r.case_id=m.id) AS report_count`+caseFrom;

export async function reviewCase(sql,publicId) {
  const [[item]] = await sql.execute(caseSelect+' WHERE m.public_id=?',[publicId]);
  if (!item) throw missingConversation();
  return item;
}

export async function caseDetails(sql,item,mongo=null) {
  const [reasons] = await sql.execute('SELECT reason,COUNT(*) AS total FROM conversation_reports WHERE case_id=? GROUP BY reason ORDER BY reason',[item.id]);
  let content = null;
  if (item.status==='pending'||await governanceReady(sql)) {
    if(item.content_type==='review'){const [[target]]=await sql.execute('SELECT * FROM review_moderation_targets WHERE id=?',[item.target_id]);if(!mongo)throw blockError(503,'REVIEWS_UNAVAILABLE','Review moderation is unavailable.');const review=target&&await findReview(mongo,target.review_id);const [[product]]=target?await sql.execute('SELECT nombre FROM productos WHERE id=?',[target.product_id]):[[]];if(review)content={title:(product?.nombre||'Product')+' — Review',body:'Rating: '+review.calificacion+' / 5'+(review.deleted_at?' · Deleted by author':'')+'\n\n'+review.comentario,images:[]};}
    else if(item.content_type==='product'){
      const [[product]]=await sql.execute('SELECT nombre,descripcion FROM productos WHERE id=?',[item.target_id]);
      if(product)content={title:product.nombre,body:product.descripcion,images:[]};
    }else if (item.content_type==='post') {
      const [[post]] = await sql.execute('SELECT title,description,image_count FROM conversation_posts WHERE id=?',[item.post_id]);
      if (post) content = {
        title:post.title, body:post.description,
        poll:(await readPolls(sql,[item.post_id])).get(item.post_id) ?? null,
        images:Array.from({length:post.image_count},(_,position) =>
          '/api/admin/conversation-moderation/'+item.public_id+'/images/'+position),
      };
    } else {
      const [[comment]] = await sql.execute('SELECT body FROM conversation_comments WHERE id=? AND post_id=?',[item.target_id,item.post_id]);
      if (comment) content = {title:null,body:comment.body,images:[]};
    }
  }
  let reports=[],history=[],assignedUsername=null;
  if(await governanceReady(sql)){
    if(item.assigned_to){const [[assigned]]=await sql.execute('SELECT username FROM users WHERE id=?',[item.assigned_to]);assignedUsername=assigned?.username??null;}
    [reports]=await sql.execute('SELECT r.id,r.reason,r.created_at,r.status,r.reporter_id,u.username AS reporter'+(await reviewActionsReady(sql)?',r.explanation':'')+' FROM conversation_reports r LEFT JOIN users u ON u.id=r.reporter_id WHERE r.case_id=? ORDER BY r.id DESC',[item.id]);
    [history]=await sql.execute("SELECT action,reason,created_at FROM administrative_audit WHERE entity_type='case' AND entity_id=? ORDER BY id DESC",[String(item.id)]);
  }
  return {...publicCase(item),reasons:reasons.map(row=>({reason:row.reason,total:Number(row.total)})),content,reports,history,assigned_username:assignedUsername};
}

async function decision(sql,req,item,action,owner) {

  if(item.content_type==='review')throw missingConversation();
  const [[current]] = await sql.execute('SELECT * FROM conversation_moderation_cases WHERE id=? FOR UPDATE',[item.id]);
  if (current?.status!=='pending') throw conflict();
  const post = await lockPost(sql,owner,current.post_id,{hidden:true,numeric:true});
  const isPost = current.content_type==='post';
  if (action==='removed') {
    await removeContent(sql,req.user,current.content_type,current.target_id,req.body);
    await resolveCase(sql,current,'removed',req.user.id);
  } else {
    if(await governanceReady(sql)){const [[removed]]=await sql.execute('SELECT id FROM moderation_removals WHERE entity_type=? AND entity_id=? AND restored_at IS NULL',[current.content_type,current.target_id]);if(removed)throw blockError(409,'REMOVAL_RESTORE_REQUIRED','Restore this content from Removed Content.');}
    if (isPost) await sql.execute('DELETE FROM conversation_hidden_posts WHERE post_id=?',[post.id]);
    else await sql.execute('UPDATE conversation_comments SET hidden_at=NULL WHERE id=? AND post_id=?',[current.target_id,post.id]);
    await resolveCase(sql,current,action,req.user.id);
    const [[visible]] = await sql.execute(`SELECT p.id FROM conversation_posts p WHERE p.id=? AND ${visiblePost('p')}`+
      (isPost?'':` AND EXISTS (SELECT 1 FROM conversation_comments c WHERE c.id=? AND ${publicComment})`),
    isPost?[post.id]:[post.id,current.target_id]);
    const destination = visible ? '/creators/'+post.author_id+'?section=conversations&post='+post.public_id+
      (isPost?'':'&comment='+current.target_public_id) : null;
    await notifyModeration(sql,current,'restored',destination);
  }
  if (!isPost) await bumpConversationRank(sql,post.id);
  await audit(sql,{actor:req.user.id,category:'moderation',action:'case.'+action,type:'case',id:current.id,reason:req.body.reason??null});
}

async function moderationWriter(pool,req,owner,run) {
  for (let attempt=0;;attempt++) {
    try { return await withSocialPair(pool,req,owner,run); }
    catch (error) { if (error.code!=='ER_LOCK_DEADLOCK' || attempt===2) throw error; }
  }
}

export function installConversationModeration(app,pool,requireUser) {
  const respond = operation => async(req,res,next) => {
    res.set('Cache-Control','private, no-store').vary('Cookie');
    try {
      if (!await moderationReady(pool)) throw blockError(503,'MODERATION_NOT_READY','Community tools are temporarily unavailable.');
      if (['postId','commentId','caseId'].some(key=>req.params[key]!==undefined&&!uuidPattern.test(req.params[key]))) throw missingConversation();
      await operation(req,res);
    } catch (error) {
      if (error.status && error.code) return res.status(error.status).json({code:error.code,error:error.message});
      next(error);
    }
  };
  installPollActions(app,pool,requireUser,respond);
  const postPath = '/api/creators/:id/posts/:postId';
  for (const path of [postPath+'/report',postPath+'/comments/:commentId/report']) {
    app.post(path,requireUser,respond(async(req,res)=>{
      if (!reportReasons.includes(req.body?.reason) || Object.keys(req.body).length!==1) throw invalid('Choose a report reason.');
      await moderationWriter(pool,req,req.recordId,sql=>reportContent(sql,req));
      res.status(201).json({submitted:true});
    }));
  }

  const internal = '/api/admin/conversation-moderation';
  const review = operation => [requireUser,(req,res,next)=>staffRole(req.user.role)?next():res.status(403).json({error:'Moderator access is required.'}),respond(operation)];
  app.get(internal,...review(async(req,res)=>{
    const {status='pending',before,q='',type=''}=req.query;
    if(!['pending','resolved'].includes(status)||typeof q!=='string'||q.length>200||!['','post','comment','reply'].includes(type)||(before!==undefined&&(typeof before!=='string'||!/^\d{1,10}$/.test(before))))throw invalid('Invalid case filters.');
    const filters=["m.content_type IN ('post','comment','reply')",status==='pending'?"m.status='pending'":"m.status<>'pending'"],values=[];
    if(type){filters.push('m.content_type=?');values.push(type);}
    if(q.trim()){filters.push("LOCATE(LOWER(?),LOWER(CONCAT(m.public_id,' ',COALESCE(author.username,''),' ',COALESCE(reviewer.username,''))))>0");values.push(q.trim());}
    const result=await readConversation(pool,async sql=>{
      const where=' WHERE '+filters.join(' AND ');
      const [[count]]=await sql.execute('SELECT COUNT(*) total'+caseFrom+where,values);
      const [rows]=await sql.execute(caseSelect+where+(before?' AND m.id<?':'')+' ORDER BY m.id DESC LIMIT 21',[...values,...(before?[Number(before)]:[])]);
      const page=rows.slice(0,20);return {items:page.map(publicCase),next_cursor:rows.length>20?String(page.at(-1).id):null,total:Number(count.total)};
    });res.json(result);
  }));
  app.get(internal+'/:caseId',...review(async(req,res)=>{
    res.json(await readConversation(pool,async sql=>{const item=await reviewCase(sql,req.params.caseId);if(item.content_type==='review')throw missingConversation();return caseDetails(sql,item);}));
  }));
  app.get(internal+'/:caseId/images/:position',...review(async(req,res)=>{
    if (!/^[0-7]$/.test(req.params.position)) throw missingConversation();
    const [[image]] = await pool.execute(`SELECT i.image_bytes FROM conversation_moderation_cases m
      JOIN conversation_post_images i ON i.post_id=m.post_id
      WHERE m.public_id=? AND m.content_type='post' AND i.position=?`,[req.params.caseId,Number(req.params.position)]);
    if (!image) throw missingConversation();
    res.set('X-Content-Type-Options','nosniff').type('image/webp').send(image.image_bytes);
  }));
  for (const [action,path] of [['restored','restore'],['removed','remove']]) {
    app.put(internal+'/:caseId/'+path,...review(async(req,res)=>{
      if(await governanceReady(pool))decisionInput(req.body);else if(req.body?.confirm!==true||Object.keys(req.body).some(key=>!['confirm','reason','explanation'].includes(key)))throw invalid('Confirm this moderation decision.');
      const item = await reviewCase(pool,req.params.caseId);
      if (item.status!=='pending') throw conflict();
      const [[post]] = await pool.execute('SELECT author_id FROM conversation_posts WHERE id=?',[item.post_id]);
      if (!post) throw conflict();
      await moderationWriter(pool,req,post.author_id,async sql=>{
        const [[actor]] = await sql.execute('SELECT role FROM users WHERE id=?',[req.user.id]);
        if(!staffRole(actor?.role)||(action==='restored'&&actor.role!=='admin'))throw denied();
        await decision(sql,req,item,action,post.author_id);
      });
      res.json(await caseDetails(pool,await reviewCase(pool,req.params.caseId)));
    }));
  }
}
