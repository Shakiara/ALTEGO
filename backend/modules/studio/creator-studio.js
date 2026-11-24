// ALTEGO necesita resolver el espacio de trabajo de los creadores.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {readSalesSummary} from './sales-insights.js';
import {requireUser,requireLiveSession} from '../accounts/auth.js';
import {publicComment,visiblePost} from '../conversations/conversation-visibility.js';
import {activityTypes} from '../accounts/activity-events.js';


export function installCreatorStudio(app,pool){
 const privateRead=(path,run)=>app.get('/api/studio/'+path,requireUser,async(req,res,next)=>{
  res.set('Cache-Control','private, no-store').vary('Cookie');if(Object.keys(req.query).length)return res.status(400).json({error:'Account selectors are not accepted.'});
  const sql=await pool.getConnection();try{await sql.beginTransaction();await requireLiveSession(sql,req);const result=await run(sql,req.user.id);await sql.commit();res.json(result);}catch(error){await sql.rollback();next(error);}finally{sql.release();}
 });
 privateRead('analytics',readStudioAnalytics);privateRead('community',readStudioCommunity);

 app.get('/api/studio/verification-history',requireUser,async(req,res,next)=>{
  res.set('Cache-Control','private, no-store').vary('Cookie');if(Object.keys(req.query).length)return res.status(400).json({error:'This history does not accept account selectors.'});
  const sql=await pool.getConnection();try{await sql.beginTransaction();await requireLiveSession(sql,req);const [items]=await sql.execute("SELECT id,status,DATE_FORMAT(submitted_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS submitted_at,DATE_FORMAT(decided_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS decided_at,rejection_reason,DATE_FORMAT(revoked_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS revoked_at,revocation_reason FROM creator_verification_applications WHERE user_id=? ORDER BY id DESC",[req.user.id]);await sql.commit();res.json({items});}catch(error){await sql.rollback();next(error);}finally{sql.release();}
 });
 app.get('/api/studio/summary',requireUser,async(req,res,next)=>{
  res.set('Cache-Control','private, no-store').vary('Cookie');
  if(Object.keys(req.query).length)return res.status(400).json({error:'This summary does not accept account selectors or filters.'});
  const sql=await pool.getConnection();
  try{await sql.beginTransaction();await requireLiveSession(sql,req);const user=req.user.id;
   const result=await readStudioSummary(sql,user);await sql.commit();res.json(result);
  }catch(error){await sql.rollback();next(error);}finally{sql.release();}
 });
}

export async function readStudioSummary(sql,user){
   const [[counts]]=await sql.execute(`SELECT COUNT(*) AS total,
    COALESCE(SUM(p.status='Published' AND p.current_version_id IS NOT NULL AND p.moderation_removed=FALSE),0) AS published,
    COALESCE(SUM(r.status='pending'),0) AS pending,COALESCE(SUM(r.status='rejected'),0) AS rejected,
    COALESCE(SUM(p.moderation_removed=TRUE),0) AS removed,
    COALESCE(SUM(p.status='Unlisted' AND p.moderation_removed=FALSE),0) AS unlisted,
    COALESCE(SUM(p.status='Draft' AND p.moderation_removed=FALSE),0) AS drafts,COALESCE(SUM(p.status='Trash'),0) AS trash
    FROM productos p LEFT JOIN product_publication_reviews r ON r.id=(SELECT MAX(pr.id) FROM product_publication_reviews pr WHERE pr.product_id=p.id)
    WHERE p.owner_id=? AND p.purged_at IS NULL`,[user]);
   const [[community]]=await sql.execute(`SELECT
    (SELECT COUNT(*) FROM conversation_posts WHERE author_id=?) AS posts,
    (SELECT COUNT(*) FROM conversation_comments WHERE author_id=? AND root_id IS NULL) AS comments,
    (SELECT COUNT(*) FROM conversation_comments WHERE author_id=? AND root_id IS NOT NULL) AS replies,
    (SELECT COUNT(*) FROM creator_follows WHERE creator_id=?) AS followers`,[user,user,user,user]);
   const [recent]=await sql.execute("SELECT public_id,event_type,reference_label,DATE_FORMAT(occurred_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS occurred_at FROM account_activity WHERE user_id=? ORDER BY occurred_at DESC,id DESC LIMIT 6",[user]);
   return {sales:await readSalesSummary(sql,user),products:Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,Number(v)])),community:Object.fromEntries(Object.entries(community).map(([k,v])=>[k,Number(v)])),recent:recent.map(row=>({id:row.public_id,action:activityTypes[row.event_type]?.action||'Activity',reference:row.reference_label,occurred_at:row.occurred_at}))};
}

export async function readStudioAnalytics(sql,user){
 const summary=await readStudioSummary(sql,user);
 const [history]=await sql.execute(`SELECT month,SUM(products) AS products,SUM(versions) AS versions,SUM(posts) AS posts FROM (
  SELECT DATE_FORMAT(creado_en,'%Y-%m') AS month,COUNT(*) AS products,0 AS versions,0 AS posts FROM productos WHERE owner_id=? GROUP BY month
  UNION ALL SELECT DATE_FORMAT(v.created_at,'%Y-%m'),0,COUNT(*),0 FROM product_versions v JOIN productos p ON p.id=v.product_id WHERE p.owner_id=? GROUP BY DATE_FORMAT(v.created_at,'%Y-%m')
  UNION ALL SELECT DATE_FORMAT(created_at,'%Y-%m'),0,0,COUNT(*) FROM conversation_posts WHERE author_id=? GROUP BY DATE_FORMAT(created_at,'%Y-%m')
 ) events GROUP BY month ORDER BY month DESC`,[user,user,user]);
 return {summary,history:history.reverse().map(row=>({month:row.month,products:Number(row.products),versions:Number(row.versions),posts:Number(row.posts)}))};
}
export async function readStudioCommunity(sql,user){
 const allowed=`${publicComment} AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=? AND b.blocked_id=c.author_id) OR (b.blocked_id=? AND b.blocker_id=c.author_id))`;
 const [posts]=await sql.execute(`SELECT p.public_id AS id,p.title,p.pinned,DATE_FORMAT(p.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS created_at,
 IF(EXISTS(SELECT 1 FROM moderation_removals m WHERE m.entity_type='post' AND m.entity_id=p.id AND m.restored_at IS NULL),'removed',IF(${visiblePost('p')},'visible','under_review')) AS state,
 (SELECT COUNT(*) FROM conversation_comments c WHERE c.post_id=p.id AND c.root_id IS NULL AND ${allowed}) AS comments,
 (SELECT COUNT(*) FROM conversation_comments c WHERE c.post_id=p.id AND c.root_id IS NOT NULL AND ${allowed}) AS replies,
 (SELECT COUNT(*) FROM conversation_post_reactions r WHERE r.target_id=p.id) AS reactions
 FROM conversation_posts p WHERE p.author_id=? ORDER BY p.id DESC`,[user,user,user,user,user]);
 const [received]=await sql.execute(`SELECT c.public_id AS id,c.body,c.root_id,p.public_id AS post_id,p.title AS post_title,u.id AS author_id,u.username,
 DATE_FORMAT(c.created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS created_at FROM conversation_comments c JOIN conversation_posts p ON p.id=c.post_id JOIN users u ON u.id=c.author_id
 WHERE p.author_id=? AND c.author_id<>? AND ${visiblePost('p')} AND ${allowed} ORDER BY c.id DESC LIMIT 50`,[user,user,user,user]);
 return {posts:posts.map(row=>({...row,pinned:Boolean(row.pinned),comments:Number(row.comments),replies:Number(row.replies),reactions:Number(row.reactions)})),received};
}
