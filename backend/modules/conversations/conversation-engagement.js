// ALTEGO necesita resolver las respuestas, menciones y reacciones de conversaciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {governanceReady} from "../../infrastructure/schema/readiness.js";
import {removeContent} from '../administration/moderation-content.js';
import {verifiedCreatorIds} from '../verification/verification-status.js';
import {createHash,randomUUID} from 'node:crypto';
import {isVerifiedCreator} from '../accounts/profiles.js';
import {assertSocialInteractionAllowed,blockError,blockState,withSocialPair} from '../social/social-blocks.js';
import {notifySocialEvent,readSocialPreferences,socialResponse,uuidPattern} from '../social/social-notifications.js';
import {cleanModerationForDeletion,bumpConversationRank} from './conversation-moderation.js';
import {postVisibility,publicComment,readConversation as reader} from './conversation-visibility.js';

export const reactionNames=['like','love','haha','wow','sad','angry','adore','fire'];
const exclusive=reactionNames.slice(6);
const bad=(message='Invalid conversation request.')=>blockError(400,'INVALID_ENGAGEMENT',message);
const missing=()=>blockError(404,'COMMENT_NOT_FOUND','Comment or post not found.');
const denied=()=>blockError(403,'COMMENT_FORBIDDEN','You cannot modify this comment.');
const counts=()=>Object.fromEntries(reactionNames.map(name=>[name,0]));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date="DATE_FORMAT(c.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS created_at";
function uuid(value) {
  if (typeof value!=='string' || !uuidPattern.test(value)) throw bad('Invalid conversation identifier.');
  return value.toLowerCase();
}
function payload(body,fields) {
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>!fields.includes(key))) throw bad();
}
function text(value) {
  if (typeof value!=='string' || !value.trim() || value.length>1000) throw bad('Enter a comment of up to 1,000 characters.');
  return value.trim();
}

async function getPost(sql,owner,postId,lock=false) {
  const [[row]]=await sql.execute('SELECT p.id,p.author_id,p.public_id FROM conversation_posts p WHERE p.public_id=? AND p.author_id=? AND '+await postVisibility(sql,'p')+(lock?' FOR UPDATE':''),[postId,owner]);
  if (!row) throw missing();
  return row;
}
async function findComment(sql,postId,publicId) {
  const [[row]]=await sql.execute(`SELECT c.* FROM conversation_comments c WHERE c.post_id=? AND c.public_id=? AND ${publicComment}`,[postId,publicId]);
  if (!row) throw missing();
  return row;
}

async function summaries(sql,kind,ids,viewer) {
  const result=new Map(ids.map(id=>[id,{counts:counts(),total:0,mine:null}]));
  if (!ids.length) return result;
  const [rows]=await sql.execute(`SELECT target_id,reaction,COUNT(*) AS total,MAX(user_id <=> ?) AS mine
    FROM conversation_${kind}_reactions WHERE target_id IN (${ids.map(()=>'?').join(',')}) GROUP BY target_id,reaction`,[viewer ?? null,...ids]);
  for (const row of rows) {
    const summary=result.get(row.target_id);
    summary.counts[row.reaction]=Number(row.total);
    summary.total+=Number(row.total);
    if (row.mine) summary.mine=row.reaction;
  }
  return result;
}
export async function attachPostEngagement(sql,posts,viewer) {
  const ids=posts.map(post=>post.id);
  const reactions=await summaries(sql,'post',ids,viewer);
  if (!ids.length) return reactions;
  const [rows]=await sql.execute(`SELECT post_id,COUNT(*) AS total FROM conversation_comments WHERE root_id IS NULL AND hidden_at IS NULL
    AND post_id IN (${ids.map(()=>'?').join(',')}) GROUP BY post_id`,ids);
  for (const summary of reactions.values()) summary.comment_count=0;
  for (const row of rows) reactions.get(row.post_id).comment_count=Number(row.total);
  return reactions;
}

export async function downgradeVerifiedReactions(sql,userId) {
  if(await (await import('../../infrastructure/schema/readiness.js')).followingFeedReady(sql))await sql.execute("UPDATE product_promotion_reactions SET reaction='like' WHERE user_id=? AND reaction IN ('adore','fire')",[userId]);

  for (const kind of ['post','comment']) {
    await sql.execute(`UPDATE conversation_${kind}_reactions SET reaction='like' WHERE user_id=? AND reaction IN ('adore','fire')`,[userId]);
  }
}

async function eligible(sql,actor,privileged,search,limit) {
  const terms=[actor,actor,actor];
  let where=`u.id<>? AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?))`;
  if (!privileged) {
    where+=` AND EXISTS (SELECT 1 FROM creator_follows f WHERE f.follower_id=? AND f.creator_id=u.id)
      AND COALESCE(pref.mention_visibility,'everyone')<>'nobody'
      AND (COALESCE(pref.mention_visibility,'everyone')<>'following'
        OR EXISTS (SELECT 1 FROM creator_follows f WHERE f.follower_id=u.id AND f.creator_id=?))`;
    terms.push(actor,actor);
  }
  if (search!==null) {
    where+=' AND LEFT(u.username,?)=?';
    terms.push(search.length,search);
  }
  const [rows]=await sql.execute(`SELECT u.id,u.username,COALESCE(p.display_name,u.username) AS display_name FROM users u
    LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN social_preferences pref ON pref.user_id=u.id
    WHERE ${where} ORDER BY u.username,u.id LIMIT ${limit}`,terms);
  const verified=await verifiedCreatorIds(sql,rows.map(row=>row.id));
  return rows.map(row=>({...row,verified_creator:verified.has(row.id)}));
}
async function canSaveMention(sql,actor,recipient,access){
  if ((await blockState(sql,actor,recipient,{current:true})).social_restricted) return false;
  if (access) return true;
  const [[pref]]=await sql.execute('SELECT mention_visibility FROM social_preferences WHERE user_id=? FOR SHARE',[recipient]);
  if (pref?.mention_visibility==='nobody') return false;
  const [[forward]]=await sql.execute('SELECT 1 FROM creator_follows WHERE follower_id=? AND creator_id=? FOR SHARE',[actor,recipient]);
  if (!forward) return false;
  if (pref?.mention_visibility!=='following') return true;
  const [[back]]=await sql.execute('SELECT 1 FROM creator_follows WHERE follower_id=? AND creator_id=? FOR SHARE',[recipient,actor]);
  return !!back;
}
const privileged=async (sql,user,verified)=>['admin','moderator'].includes(user.role)||await verified(sql,user.id);

function tokens(value) {
  return [...value.matchAll(/(?<![\p{L}\p{N}_@])@([a-zA-Z0-9_]{3,30})(?![a-zA-Z0-9_])/gu)].map(match=>({
    username:match[1],start:match.index,end:match.index+match[0].length,
  }));
}
async function saveMentions(sql,comment,value,actor,verified,previousBody='') {
  const [before]=await sql.execute('SELECT start_offset,end_offset,recipient_id FROM conversation_mentions WHERE comment_id=? ORDER BY start_offset',[comment]);
  const historic=new Map();
  for (const entry of before) {
    const key=previousBody.slice(entry.start_offset+1,entry.end_offset).toLowerCase();
    const values=historic.get(key) ?? [];
    values.push(entry.recipient_id);
    historic.set(key,values);
  }
  const prior=new Set(before.map(entry=>entry.recipient_id));
  const mentions=[];
  const access=await privileged(sql,actor,verified);
  const lookup=new Map();
  for (const token of tokens(value)) {
    const key=token.username.toLowerCase();
    let recipient=historic.get(key)?.shift();
    if (!recipient) {
      if (!lookup.has(key)) {
        const [[candidate]]=await sql.execute('SELECT id FROM users WHERE username=?',[token.username]);

        if (candidate && candidate.id!==actor.id) {
          await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[candidate.id]);
          const [[current]]=await sql.execute('SELECT username FROM users WHERE id=? FOR SHARE',[candidate.id]);
          const allowed=current?.username.toLowerCase()===key && await canSaveMention(sql,actor.id,candidate.id,access);
          lookup.set(key,allowed ? candidate.id : null);
        } else lookup.set(key,null);
      }
      recipient=lookup.get(key);
    }
    if (recipient) mentions.push({...token,recipient});
  }
  await sql.execute('DELETE FROM conversation_mentions WHERE comment_id=?',[comment]);
  for (const mention of mentions) await sql.execute(
    'INSERT INTO conversation_mentions(comment_id,start_offset,end_offset,recipient_id) VALUES (?,?,?,?)',
    [comment,mention.start,mention.end,mention.recipient]);
  const after=new Set(mentions.map(entry=>entry.recipient));
  for (const recipient of prior) if (!after.has(recipient)) await sql.execute(
    "DELETE FROM social_notifications WHERE comment_id=? AND recipient_id=? AND category='mentions'",[comment,recipient]);
  return [...after].filter(recipient=>!prior.has(recipient)).sort((a,b)=>a-b);
}

const commentSelect=`SELECT c.id,c.post_id,c.public_id,c.author_id,c.body,c.revision,${date},
  u.username,COALESCE(up.display_name,u.username) AS display_name,
  JSON_UNQUOTE(JSON_EXTRACT(up.avatar,'$.media_id')) AS avatar,
  root.public_id AS root_public, reply.public_id AS reply_public, replyUser.username AS reply_username,
  (SELECT COUNT(*) FROM conversation_comments ch WHERE ch.root_id=c.id AND ch.hidden_at IS NULL) AS reply_count
  FROM conversation_comments c JOIN users u ON u.id=c.author_id LEFT JOIN user_profiles up ON up.user_id=u.id
  LEFT JOIN conversation_comments root ON root.id=c.root_id
  LEFT JOIN conversation_comments reply ON reply.id=c.reply_to_id AND reply.hidden_at IS NULL
  LEFT JOIN users replyUser ON replyUser.id=reply.author_id`;

async function commentDtos(sql,rows,viewer) {
  if (!rows.length) return [];
  const ids=rows.map(row=>row.id);
  const reactions=await summaries(sql,'comment',ids,viewer);
  const [mentions]=await sql.execute(`SELECT comment_id,start_offset AS start,end_offset AS finish,recipient_id AS user_id
    FROM conversation_mentions WHERE comment_id IN (${ids.map(()=>'?').join(',')}) ORDER BY comment_id,start_offset`,ids);
  const verified=await verifiedCreatorIds(sql,[...rows.map(row=>row.author_id),...mentions.map(row=>row.user_id)]);
  const byComment=new Map();
  for (const {comment_id,finish,...mention} of mentions) {
    const values=byComment.get(comment_id) ?? [];
    values.push({...mention,end:finish,verified_creator:verified.has(mention.user_id)});byComment.set(comment_id,values);
  }
  return rows.map(row=>({
    id:row.public_id,root_id:row.root_public,body:row.body,revision:row.revision,created_at:row.created_at,
    author:{id:row.author_id,username:row.username,display_name:row.display_name,verified_creator:verified.has(row.author_id),
      avatar_url:uuidPattern.test(row.avatar) ? '/api/profile-media/'+row.avatar+'/display' : null},
    reply_to:row.reply_public && row.reply_public!==row.root_public ? {id:row.reply_public,username:row.reply_username} : null,
    reply_count:Number(row.reply_count),reactions:reactions.get(row.id),mentions:byComment.get(row.id) ?? [],
  }));
}

const cursorEncode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function cursorDecode(value,post,root,order) {
  if (value===undefined) return null;
  if (typeof value!=='string' || !/^[\w-]{1,400}$/.test(value)) throw bad('Invalid comment page.');
  let data;
  try { data=JSON.parse(Buffer.from(value,'base64url').toString()); } catch { throw bad('Invalid comment page.'); }
  if (!data || data.post!==post || data.root!==root || data.order!==order ||
    !Number.isSafeInteger(data.last) || data.last<1 || !Number.isSafeInteger(data.anchor) || data.anchor<data.last ||
    !Number.isSafeInteger(data.score) || data.score<0 || typeof data.rank!=='string') throw bad('Invalid comment page.');
  return data;
}
async function listComments(sql,post,root,order,viewer,cursor,limit) {
  const page=cursorDecode(cursor,post,root,order);
  const [[head]]=await sql.execute('SELECT COALESCE(MAX(id),0) AS anchor FROM conversation_comments WHERE post_id=?',[post]);
  const anchor=page?.anchor ?? Number(head.anchor);
  let rank='';
  if (order==='popular') {
    const [[state]]=await sql.execute('SELECT CAST(revision AS CHAR) AS revision FROM conversation_rank WHERE post_id=?',[post]);
    rank=state?.revision ?? '0';
    if (page && rank!==page.rank) throw blockError(409,'COMMENT_ORDER_CHANGED','Reaction counts changed. Refresh the comments.');
  }
  const score='(SELECT COUNT(*) FROM conversation_comment_reactions r WHERE r.target_id=c.id)';
  const direction=order==='newest'?'DESC':'ASC';
  let where=` WHERE c.post_id=? AND c.root_id <=> ? AND c.id<=? AND ${publicComment}`;
  const args=[post,root,anchor];
  if (page) {
    if (order==='popular') {
      where+=` AND (${score}<? OR (${score}=? AND c.id>?))`;
      args.push(page.score,page.score,page.last);
    } else {
      where+=' AND c.id'+(direction==='DESC'?'<':'>')+'?';
      args.push(page.last);
    }
  }
  const select=order==='popular'?commentSelect.replace('SELECT c.id','SELECT '+score+' AS score,c.id'):commentSelect;
  const [rows]=await sql.execute(select+where+` ORDER BY ${order==='popular'?'score DESC,':''}c.id ${direction} LIMIT ${limit+1}`,args);
  const items=rows.slice(0,limit),last=items.at(-1);
  return {items:await commentDtos(sql,items,viewer),next_cursor:rows.length>limit
    ?cursorEncode({post,root,order,anchor,last:last.id,score:Number(last.score ?? 0),rank}):null};
}

async function writer(pool,req,author,operation) {
  for (let attempts=0;;attempts++) {
    try {return await withSocialPair(pool,req,author,operation);}
    catch(error) {if (attempts>=2 || error.code!=='ER_LOCK_DEADLOCK') throw error;}
  }
}

export function installConversationEngagement(app,pool,requireUser,{verified=isVerifiedCreator}={}) {
  const base='/api/creators/:id/posts/:postId';
  const comments=base+'/comments';
  const respond=operation=>socialResponse(pool,operation);
  const current=(sql,req,lock=false)=>getPost(sql,req.recordId,uuid(req.params.postId),lock);

  app.get('/api/account/mention-candidates',requireUser,respond(async(req,res)=>{
    const q=req.query.q ?? '';
    if (typeof q!=='string' || !/^[a-zA-Z0-9_]{0,30}$/.test(q)) throw bad('Invalid mention search.');
    res.json({items:await eligible(pool,req.user.id,await privileged(pool,req.user,verified),q,8)});
  }));
  app.get(comments,respond(async(req,res)=>{
    const order=req.query.order ?? 'oldest';
    if (!['oldest','newest','popular'].includes(order)) throw bad('Invalid comment order.');
    res.json(await reader(pool,async sql=>{
      const post=await current(sql,req);
      const result=await listComments(sql,post.id,null,order,req.user?.id,req.query.cursor,5);
      for (const item of result.items) {
        if (!item.reply_count) {item.replies={items:[],next_cursor:null};continue;}
        const root=await findComment(sql,post.id,item.id);
        item.replies=await listComments(sql,post.id,root.id,'oldest',req.user?.id,undefined,2);
      }
      return result;
    }));
  }));
  app.get(comments+'/:commentId/replies',respond(async(req,res)=>{
    res.json(await reader(pool,async sql=>{
      const post=await current(sql,req);
      const root=await findComment(sql,post.id,uuid(req.params.commentId));
      if (root.root_id!==null) throw missing();
      return listComments(sql,post.id,root.id,'oldest',req.user?.id,req.query.cursor,3);
    }));
  }));
  app.get(comments+'/:commentId',respond(async(req,res)=>{
    res.json(await reader(pool,async sql=>{
      const post=await current(sql,req);
      const target=await findComment(sql,post.id,uuid(req.params.commentId));
      const [rows]=await sql.execute(commentSelect+' WHERE c.id IN (?,?)',[target.id,target.root_id ?? target.id]);
      const items=await commentDtos(sql,rows,req.user?.id);
      return {items};
    }));
  }));
  app.post(comments,requireUser,respond(async(req,res)=>{
    payload(req.body,['body','reply_to','request_key']);
    const value=text(req.body.body),key=uuid(req.body.request_key),reply=req.body.reply_to==null?null:uuid(req.body.reply_to);
    const comment=await writer(pool,req,req.recordId,async sql=>{
      const post=await current(sql,req,true);
      const digest=hash([post.public_id,reply,value]);
      const [[previous]]=await sql.execute('SELECT id,request_hash,hidden_at FROM conversation_comments WHERE author_id=? AND request_key=?',[req.user.id,key]);
      if (previous) {
        if (previous.request_hash!==digest || previous.hidden_at) throw blockError(409,'COMMENT_REQUEST_CHANGED','This comment request was already used.');
        return previous.id;
      }
      await assertSocialInteractionAllowed(sql,req.user.id,post.author_id);
      const target=reply?await findComment(sql,post.id,reply):null;
      if (target && target.author_id!==post.author_id) {
        await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[target.author_id]);
        await assertSocialInteractionAllowed(sql,req.user.id,target.author_id,{current:true});
      }
      const id=randomUUID();
      const [created]=await sql.execute(`INSERT INTO conversation_comments
        (public_id,post_id,author_id,root_id,reply_to_id,body,request_key,request_hash,created_at)
        VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`,
      [id,post.id,req.user.id,target?.root_id ?? target?.id ?? null,target?.id ?? null,value,key,digest]);
      const mentioned=await saveMentions(sql,created.insertId,value,req.user,verified);
      await notifyComment(sql,post,{id:created.insertId,publicId:id,actor:req.user,target,mentioned,revision:1});
      return created.insertId;
    });
    res.status(201).json(await reader(pool,async sql=>{
      const post=await current(sql,req);
      const [rows]=await sql.execute(commentSelect+' WHERE c.id=? AND c.post_id=? AND '+publicComment,[comment,post.id]);
      const [dto]=await commentDtos(sql,rows,req.user.id);
      if (!dto) throw missing();
      const [[total]]=await sql.execute('SELECT COUNT(*) AS total FROM conversation_comments WHERE post_id=? AND root_id IS NULL AND hidden_at IS NULL',[post.id]);
      return {...dto,post_comment_count:Number(total.total)};
    }));
  }));
  app.put(comments+'/:commentId',requireUser,respond(async(req,res)=>{
    payload(req.body,['body','revision']);
    const value=text(req.body.body),revision=req.body.revision,commentId=uuid(req.params.commentId);
    if (!Number.isSafeInteger(revision)||revision<1) throw bad();
    const comment=await writer(pool,req,req.recordId,async sql=>{
      const post=await current(sql,req,true),target=await findComment(sql,post.id,commentId);
      if (target.author_id!==req.user.id) throw denied();
      if (target.revision!==revision) {
        if (target.body===value && target.revision===revision+1) return target.id;
        throw blockError(409,'COMMENT_CHANGED','This comment changed. Reload it before saving.');
      }
      if (target.body!==value) {
        const mentioned=await saveMentions(sql,target.id,value,req.user,verified,target.body);
        await sql.execute('UPDATE conversation_comments SET body=?,revision=revision+1 WHERE id=?',[value,target.id]);
        await notifyComment(sql,post,{id:target.id,publicId:commentId,actor:req.user,mentioned,revision:revision+1});
      }
      return target.id;
    });
    res.json(await reader(pool,async sql=>{
      const post=await current(sql,req);
      const [rows]=await sql.execute(commentSelect+' WHERE c.id=? AND c.post_id=? AND '+publicComment,[comment,post.id]);
      const [dto]=await commentDtos(sql,rows,req.user.id);
      if (!dto) throw missing();
      return dto;
    }));
  }));
  app.delete(comments+'/:commentId',requireUser,respond(async(req,res)=>{
    await writer(pool,req,req.recordId,async sql=>{
      const post=await current(sql,req,true),target=await findComment(sql,post.id,uuid(req.params.commentId));
      if (![target.author_id,post.author_id].includes(req.user.id) && !['admin','moderator'].includes(req.user.role)) throw denied();
      if(![target.author_id,post.author_id].includes(req.user.id)&&await governanceReady(sql)){await removeContent(sql,req.user,target.root_id===null?'comment':'reply',target.id,req.body);return;}
      await cleanModerationForDeletion(sql,post.id,target.id);
      await sql.execute('DELETE FROM conversation_comments WHERE id=?',[target.id]);
      if (target.root_id===null) await bumpConversationRank(sql,post.id);
    });
    res.sendStatus(204);
  }));
  for (const kind of ['post','comment']) {
    const path=(kind==='post'?base:comments+'/:commentId')+'/reaction';
    app.put(path,requireUser,respond(async(req,res)=>{
      payload(req.body,['reaction']);
      const reaction=req.body.reaction;
      if (reaction!==null && !reactionNames.includes(reaction)) throw bad('Invalid reaction.');
      const data=await writer(pool,req,req.recordId,async sql=>{
        const post=await current(sql,req,true);
        const target=kind==='post'?post:await findComment(sql,post.id,uuid(req.params.commentId));
        const actor=req.user.id;
        await assertSocialInteractionAllowed(sql,actor,post.author_id);
        if (target.author_id!==post.author_id) {
          await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[target.author_id]);
          await assertSocialInteractionAllowed(sql,actor,target.author_id,{current:true});
        }
        if (exclusive.includes(reaction) && !await verified(sql,actor)) throw blockError(403,'VERIFIED_REACTION_REQUIRED','Adore and Fire reactions are exclusive to Verified accounts.');
        const table='conversation_'+kind+'_reactions';
        const [[previous]]=await sql.execute('SELECT reaction FROM '+table+' WHERE target_id=? AND user_id=?',[target.id,actor]);
        if (reaction!== (previous?.reaction ?? null)) {
          if (reaction===null) await sql.execute('DELETE FROM '+table+' WHERE target_id=? AND user_id=?',[target.id,actor]);
          else await sql.execute('INSERT INTO '+table+' (target_id,user_id,reaction) VALUES (?,?,?) ON DUPLICATE KEY UPDATE reaction=?',[target.id,actor,reaction,reaction]);
          if (kind==='comment' && target.root_id===null && (!previous || reaction===null)) await bumpConversationRank(sql,post.id);
        }
        return (await summaries(sql,kind,[target.id],actor)).get(target.id);
      });
      res.json(data);
    }));
  }
}

async function notifyComment(sql,post,{id,publicId,actor,target,mentioned,revision}) {
  const destination='/creators/'+post.author_id+'?section=conversations&post='+post.public_id+'&comment='+publicId;
  const recipients=new Set(mentioned);
  if (target && target.author_id!==actor.id && (await readSocialPreferences(sql,target.author_id)).notifications.replies) {
    recipients.delete(target.author_id);
    await notifySocialEvent(sql,{recipient:target.author_id,actor:actor.id,category:'replies',context:'reply:'+target.public_id,
      key:'reply:'+publicId,title:'New reply',description:actor.username+' replied to your comment.',destination,postId:post.id,commentId:id});
  }
  for (const recipient of recipients) await notifySocialEvent(sql,{recipient,actor:actor.id,category:'mentions',context:'post:'+post.public_id,
    key:'mention:'+publicId+':'+revision,title:'New mention',description:actor.username+' mentioned you.',destination,postId:post.id,commentId:id});
}
