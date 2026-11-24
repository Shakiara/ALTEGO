// ALTEGO necesita resolver las listas de seguidores y cuentas seguidas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {canViewAccountList} from '../accounts/account-mutations.js';
import {blockError} from './social-blocks.js';
import {mainAdminId,socialListsMigration} from '../administration/admin-follow-policy.js';
import {verifiedCreatorIds} from '../verification/verification-status.js';
import {id} from '../../core/validation.js';
export function installSocialLists(app,pool){
 app.get('/api/creators/:id/connections',async(req,res)=>{
  res.set('Cache-Control','private, no-store');res.vary('Cookie');
  const kind=req.query.list;if(!['followers','following'].includes(kind)||Object.keys(req.query).some(k=>!['list','cursor'].includes(k)))throw blockError(400,'INVALID_LIST','Choose Followers or Following.');
  let cursor=null;
  if(req.query.cursor!==undefined){try{if(typeof req.query.cursor!=='string'||req.query.cursor.length>500)throw Error();cursor=JSON.parse(Buffer.from(req.query.cursor,'base64url'));if(cursor.owner!==req.recordId||cursor.list!==kind||!id(cursor.member)||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}$/.test(cursor.time))throw Error();}catch{throw blockError(400,'INVALID_CURSOR','Refresh this list to continue.');}}
  const sql=await pool.getConnection();try{await sql.beginTransaction();
   if(!(await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[socialListsMigration]))[0].length)throw blockError(503,'LISTS_NOT_READY','Connections are unavailable. Please try again later.');
   const [[owner]]=await sql.execute('SELECT id FROM users WHERE id=?',[req.recordId]);if(!owner)throw blockError(404,'USER_NOT_FOUND','Profile unavailable.');
   if(!await canViewAccountList(sql,req.recordId,req.user?.id??null,kind==='followers'?'followers_list':'following_list'))throw blockError(403,'LIST_PRIVATE','This list is private.');
   const member=kind==='followers'?'f.follower_id':'f.creator_id',ownerColumn=kind==='followers'?'f.creator_id':'f.follower_id';
   const viewer=req.user?.id??null,admin=await mainAdminId(sql);const params=[viewer,viewer,viewer,viewer,req.recordId];
   let where=' WHERE '+ownerColumn+'=?';if(cursor){where+=' AND (f.created_at<? OR (f.created_at=? AND '+member+'<?))';params.push(cursor.time,cursor.time,cursor.member);}
   const [rows]=await sql.execute(`SELECT u.id,u.username,COALESCE(NULLIF(p.display_name,''),u.username) display_name,
    JSON_UNQUOTE(JSON_EXTRACT(p.avatar,'$.media_id')) avatar_media_id,
    DATE_FORMAT(f.created_at,'%Y-%m-%d %H:%i:%s.%f') followed_at,
    EXISTS(SELECT 1 FROM creator_follows mine WHERE mine.follower_id=? AND mine.creator_id=u.id) viewer_follows,
    EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)) social_restricted,
    u.id=? AS own_account
    FROM creator_follows f JOIN users u ON u.id=${member} LEFT JOIN user_profiles p ON p.user_id=u.id`+where+` ORDER BY f.created_at DESC,${member} DESC LIMIT 21`,params);
   const more=rows.length>20,shown=rows.slice(0,20),verified=await verifiedCreatorIds(sql,shown.map(r=>Number(r.id))),last=shown.at(-1);
   const items=shown.map(r=>({id:Number(r.id),username:r.username,display_name:r.display_name,avatar_url:/^[a-f0-9-]{36}$/i.test(r.avatar_media_id||'')?'/api/profile-media/'+r.avatar_media_id+'/display':null,verified_creator:verified.has(Number(r.id)),viewer_follows:!!Number(r.viewer_follows),social_restricted:!!Number(r.social_restricted),own_account:!!Number(r.own_account),required:!!viewer&&viewer!==admin&&Number(r.id)===admin}));
   const next_cursor=more?Buffer.from(JSON.stringify({owner:req.recordId,list:kind,time:last.followed_at,member:Number(last.id)})).toString('base64url'):null;
   await sql.commit();res.json({items,next_cursor});
  }catch(error){await sql.rollback();throw error;}finally{sql.release();}
 });
}
