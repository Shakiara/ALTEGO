// ALTEGO necesita resolver las notificaciones privadas de interacción.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {requiredAdminFollow} from '../administration/admin-follow-policy.js';
import {randomUUID} from 'node:crypto';
import {engagementMigration} from "../../infrastructure/schema/readiness.js";
import {assertSocialInteractionAllowed, blockError, withSocialPair} from './social-blocks.js';

export const optionalCategories = ['mentions','replies','new_followers','following_updates'];
export const notificationCategories = [...optionalCategories,'moderation','verification','orders','storage'];
export const mentionChoices = ['everyone','followers','following','nobody'];
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function engagementReady(sql) {
  const [[row]] = await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[engagementMigration]);
  return !!row;
}

export function socialResponse(pool, operation) {
  return async (req,res,next) => {
    res.set('Cache-Control','private, no-store').vary('Cookie');
    try {
      if (!await engagementReady(pool)) throw blockError(503,'ENGAGEMENT_NOT_READY','Social features are temporarily unavailable.');
      await operation(req,res);
    } catch (error) {
      if (error.status && error.code) return res.status(error.status).json({code:error.code,error:error.message});
      next(error);
    }
  };
}

export async function readSocialPreferences(sql,userId) {
  const [[row]] = await sql.execute('SELECT * FROM social_preferences WHERE user_id=?',[userId]);
  return {
    mention_visibility:row?.mention_visibility ?? 'everyone',
    notifications:Object.fromEntries(notificationCategories.map(category => [category,
      !optionalCategories.includes(category) || row?.[category] === undefined || Boolean(row[category])])),
  };
}

export async function notifySocialEvent(sql,event) {
  const {recipient,actor,category,key,context=key,title,description,destination=null}=event;
  if (!notificationCategories.includes(category)) throw Error('Unknown notification category.');
  if (recipient===actor&&!event.allowSelf) return;
  const social=optionalCategories.includes(category);

  const [[user]]=await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[recipient]);
  if (!user || !(await readSocialPreferences(sql,recipient)).notifications[category]) return;
  let group;
  if (social) {
    [[group]]=await sql.execute(`SELECT group_id,DATE_FORMAT(group_started_at,'%Y-%m-%d %H:%i:%s.%f') AS group_started_at FROM social_notifications
      WHERE recipient_id=? AND category=? AND context_key=? AND dismissed_at IS NULL
        AND group_started_at>UTC_TIMESTAMP(6)-INTERVAL 1 HOUR
      ORDER BY group_started_at DESC,id DESC LIMIT 1 FOR UPDATE`,[recipient,category,context]);
  }
  await sql.execute(`INSERT INTO social_notifications
    (recipient_id,event_key,group_id,context_key,category,title,description,destination,post_id,comment_id,product_id,
     created_at,group_started_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6),COALESCE(?,UTC_TIMESTAMP(6)),UTC_TIMESTAMP(6)+INTERVAL 7 DAY)
    ON DUPLICATE KEY UPDATE id=id`,[recipient,key,group?.group_id ?? randomUUID(),context,category,title,description,destination,
    social ? event.postId ?? null : null,social ? event.commentId ?? null : null,social ? event.productId ?? null : null,
    group?.group_started_at ?? null]);
}

export async function notifyFollowingPublication(sql,{creatorId,productId,versionId,name}) {
  if (!await engagementReady(sql)) return;
  const [followers] = await sql.execute(`SELECT f.follower_id FROM creator_follows f
    WHERE f.creator_id=? AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
      (b.blocker_id=f.follower_id AND b.blocked_id=f.creator_id) OR (b.blocker_id=f.creator_id AND b.blocked_id=f.follower_id))
    ORDER BY f.follower_id`,[creatorId]);
  for (const row of followers) {
    await notifySocialEvent(sql,{recipient:row.follower_id,actor:creatorId,category:'following_updates',context:'creator:'+creatorId,
      key:'product:'+versionId,title:'New item from a creator you follow',description:name,destination:'/products/'+productId,productId});
  }
}

const visibleNotifications=`recipient_id=? AND dismissed_at IS NULL AND expires_at>UTC_TIMESTAMP(6)
  AND (product_id IS NULL OR EXISTS (SELECT 1 FROM productos p WHERE p.id=product_id AND p.status='Published' AND p.purged_at IS NULL AND p.current_version_id IS NOT NULL))`;

async function notificationList(sql,userId) {
  const [rows]=await sql.execute(`SELECT group_id,category,title,description,destination,
    DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS created_at,read_at
    FROM social_notifications WHERE ${visibleNotifications} ORDER BY created_at DESC,id DESC`,[userId]);
  const groups=new Map();
  let unread=0;
  for (const {group_id,read_at,...row} of rows) {
    const item=groups.get(group_id) ?? {id:group_id,...row,count:0,unread:false};
    item.count++;
    item.unread ||= !read_at;
    groups.set(group_id,item);
  }
  for (const item of groups.values()) if (item.unread) unread++;
  return {items:[...groups.values()],unread};
}


export async function removeSocialNotificationsForHiddenContent(sql,{postId,commentId}){
  if(commentId==null){
    await sql.execute('DELETE FROM social_notifications WHERE post_id=?',[postId]);
  }else{
    await sql.execute('DELETE n FROM social_notifications n JOIN conversation_comments c ON c.id=n.comment_id WHERE c.post_id=? AND (c.id=? OR c.root_id=?)',
      [postId,commentId,commentId]);
  }
}

export async function purgeExpiredNotifications(sql) {
  if (!await engagementReady(sql)) return 0;
  const [result]=await sql.execute("DELETE FROM social_notifications WHERE category<>'storage' AND expires_at<=UTC_TIMESTAMP(6) ORDER BY expires_at LIMIT 1000");
  return result.affectedRows;
}

export function installSocialAccounts(app,pool,requireUser) {
  const route=operation=>[requireUser,socialResponse(pool,operation)];
  app.get('/api/account/social-preferences',...route(async(req,res)=>res.json(await readSocialPreferences(pool,req.user.id))));
  app.put('/api/account/social-preferences',...route(async(req,res)=>{
    const entries=Object.entries(req.body ?? {});
    const [[field,value]=[]]=entries;
    if (entries.length!==1 || !(field==='mention_visibility' ? mentionChoices.includes(value)
      : optionalCategories.includes(field)&&typeof value==='boolean')) {
      throw blockError(400,'INVALID_PREFERENCE','Choose a valid preference.');
    }
    const data=await withSocialPair(pool,req,req.user.id,async sql=>{
      await sql.execute(`INSERT INTO social_preferences(user_id,${field}) VALUES (?,?) ON DUPLICATE KEY UPDATE ${field}=?`,[req.user.id,value,value]);
      return readSocialPreferences(sql,req.user.id);
    });
    res.json(data);
  }));
  app.get('/api/account/notifications',...route(async(req,res)=>{const {syncStorageAlerts}=await import('../../infrastructure/storage/storage-alerts.js');await syncStorageAlerts(pool,req.user.id);res.json(await notificationList(pool,req.user.id));}));
  app.get('/api/account/notifications/count',...route(async(req,res)=>{
    const {syncStorageAlerts}=await import('../../infrastructure/storage/storage-alerts.js');await syncStorageAlerts(pool,req.user.id);const [[row]]=await pool.execute(`SELECT COUNT(DISTINCT group_id) AS unread FROM social_notifications
      WHERE ${visibleNotifications} AND read_at IS NULL`,[req.user.id]);
    res.json({unread:Number(row.unread)});
  }));
  app.post('/api/account/notifications/read',...route(async(req,res)=>{
    const data=await withSocialPair(pool,req,req.user.id,async sql=>{
      await sql.execute('UPDATE social_notifications SET read_at=UTC_TIMESTAMP(6) WHERE recipient_id=? AND read_at IS NULL AND dismissed_at IS NULL AND expires_at>UTC_TIMESTAMP(6)',[req.user.id]);
      return notificationList(sql,req.user.id);
    });
    res.json(data);
  }));
  app.delete('/api/account/notifications/:groupId',...route(async(req,res)=>{
    if (!uuidPattern.test(req.params.groupId)) throw blockError(400,'INVALID_NOTIFICATION','Invalid notification.');
    const groupId=req.params.groupId.toLowerCase();const [[storage]]=await pool.execute("SELECT id FROM social_notifications WHERE recipient_id=? AND group_id=? AND category='storage'",[req.user.id,groupId]);if(storage)throw blockError(409,'ACTIVE_STORAGE_WARNING','This warning remains while the storage threshold is active.');
    await withSocialPair(pool,req,req.user.id,async sql=>{
      const [result]=await sql.execute('UPDATE social_notifications SET dismissed_at=UTC_TIMESTAMP(6) WHERE recipient_id=? AND group_id=? AND dismissed_at IS NULL',[req.user.id,groupId]);
      if(result.affectedRows)return;
      const [[existing]]=await sql.execute('SELECT 1 FROM social_notifications WHERE recipient_id=? AND group_id=? LIMIT 1',[req.user.id,groupId]);
      if(!existing)throw blockError(404,'NOTIFICATION_NOT_FOUND','Notification not found.');
    });
    res.json({dismissed_id:groupId});
  }));
  for (const method of ['put','delete']) app[method]('/api/creators/:id/follow',...route(async(req,res)=>{
    const target=req.recordId, actor=req.user.id;
    if (target===actor) throw blockError(400,'SELF_FOLLOW','You cannot follow yourself.');
    const result=await withSocialPair(pool,req,target,async sql=>{
      const required=await requiredAdminFollow(sql,actor,target);
      if(method==='delete'&&required)throw blockError(403,'REQUIRED_ADMIN_FOLLOW','Following Admin is required.');
      if(method==='put'&&required)return followState(sql,target,actor);
      if (method==='delete') {
        await sql.execute('DELETE FROM creator_follows WHERE follower_id=? AND creator_id=?',[actor,target]);
      } else {
        await assertSocialInteractionAllowed(sql,actor,target);
        const [[existing]]=await sql.execute('SELECT 1 FROM creator_follows WHERE follower_id=? AND creator_id=?',[actor,target]);
        if (!existing) {
          await sql.execute('INSERT INTO creator_follows(follower_id,creator_id,created_at) VALUES (?,?,UTC_TIMESTAMP(6))',[actor,target]);
          const [[identity]]=await sql.execute('SELECT display_name FROM user_profiles WHERE user_id=?',[actor]);
          await notifySocialEvent(sql,{recipient:target,actor,category:'new_followers',key:'follow:'+randomUUID(),
            context:'followers:'+target,title:'New follower',description:(identity?.display_name||req.user.username)+' followed you.',destination:'/creators/'+actor});
        }
      }
      return followState(sql,target,actor);
    });
    res.json(result);
  }));
}

export async function followState(sql,target,viewer) {
  const [[row]]=await sql.execute(`SELECT
    (SELECT COUNT(*) FROM creator_follows WHERE creator_id=?) AS followers,
    (SELECT COUNT(*) FROM creator_follows WHERE follower_id=?) AS following,
    EXISTS(SELECT 1 FROM creator_follows WHERE creator_id=? AND follower_id=?) AS viewer_follows`,
  [target,target,target,viewer ?? null]);
  return {followers:Number(row.followers),following:Number(row.following),viewer_follows:Boolean(Number(row.viewer_follows)),required:await requiredAdminFollow(sql,viewer,target)};
}
