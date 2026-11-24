// ALTEGO necesita resolver el descubrimiento y filtrado de creadores.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {productPublicFilter} from '../administration/admin-audit.js';import {verifiedCreatorIds} from '../verification/verification-status.js';import {mainAdminId} from '../administration/admin-follow-policy.js';import {decorateProduct} from '../products/product-dto.js';
const fail=message=>Object.assign(Error(message),{status:400});
export function discoveryInput(query){
 if(Object.keys(query).some(key=>!['q','sort','verified','page'].includes(key)))throw fail('Choose valid creator filters.');
 const q=query.q??'',sort=query.sort??'products',verified=query.verified??'all',page=query.page??'1';
 if(typeof q!=='string'||[...q.trim()].length>60||/[\u0000-\u001f]/.test(q)||!['products','followers','name'].includes(sort)||!['all','verified'].includes(verified)||typeof page!=='string'||!/^\d{1,6}$/.test(page)||Number(page)<1)throw fail('Choose valid creator search, order and page.');
 return{q:q.trim(),sort,verified,page:Number(page)};
}
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const media=(value)=>/^[a-f0-9-]{36}$/i.test(value||'')?'/api/profile-media/'+value+'/display':null;
export function installCreatorDiscovery(app,pool){
 app.get('/api/creators/discover',async(req,res)=>{
  const input=discoveryInput(req.query),viewer=req.user?.id??null,size=12,sql=await pool.getConnection();
  res.set('Cache-Control','private, no-store');res.vary('Cookie');
  try{await sql.beginTransaction();
   const published="p.status='Published' AND p.purged_at IS NULL"+await productPublicFilter(sql);
   const base=`WITH published AS (SELECT p.owner_id,COUNT(*) published_items FROM productos p JOIN product_versions pv ON pv.id=p.current_version_id AND pv.product_id=p.id WHERE ${published} GROUP BY p.owner_id), followers AS (SELECT creator_id,COUNT(*) followers FROM creator_follows GROUP BY creator_id) `;
   const params=[],where=[input.q?'1=1':'COALESCE(items.published_items,0)>0'];
   if(input.q){const pattern='%'+input.q.replaceAll('!','!!').replaceAll('%','!%').replaceAll('_','!_')+'%';where.push("(u.username LIKE ? ESCAPE '!' OR up.display_name LIKE ? ESCAPE '!')");params.push(pattern,pattern);}
   if(input.verified==='verified')where.push("(u.role='admin' OR EXISTS(SELECT 1 FROM creator_verification_applications v WHERE v.verified_user=u.id))");
   const from=' FROM users u LEFT JOIN user_profiles up ON up.user_id=u.id LEFT JOIN published items ON items.owner_id=u.id LEFT JOIN followers f ON f.creator_id=u.id WHERE '+where.join(' AND ');
   const [[count]]=await sql.execute(base+'SELECT COUNT(*) total'+from,params);const total=Number(count.total),pages=Math.max(1,Math.ceil(total/size)),page=Math.min(input.page,pages);
   const order={products:'published_items DESC,u.id DESC',followers:'followers DESC,u.id DESC',name:'display_name ASC,u.id ASC'}[input.sort];
   const [rows]=await sql.execute(base+`SELECT u.id,u.username,COALESCE(NULLIF(up.display_name,''),u.username) display_name,up.bio,up.banner,
    JSON_UNQUOTE(JSON_EXTRACT(up.avatar,'$.media_id')) avatar_media_id,JSON_UNQUOTE(JSON_EXTRACT(up.banner,'$.media_id')) banner_media_id,
    COALESCE(items.published_items,0) published_items,COALESCE(f.followers,0) followers,
    EXISTS(SELECT 1 FROM creator_follows mine WHERE mine.follower_id=? AND mine.creator_id=u.id) viewer_follows,
    EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=?)) social_restricted`+from+` ORDER BY ${order} LIMIT ${size} OFFSET ${(page-1)*size}`,[viewer,viewer,viewer,...params]);
   const ids=rows.map(row=>Number(row.id)),verified=await verifiedCreatorIds(sql,ids),admin=await mainAdminId(sql);let previews=[];
   if(ids.length){[previews]=await sql.query(`SELECT * FROM (SELECT p.id,p.owner_id,pv.snapshot,pv.created_at,ROW_NUMBER() OVER(PARTITION BY p.owner_id ORDER BY pv.created_at DESC,pv.id DESC,p.id DESC) position FROM productos p JOIN product_versions pv ON pv.id=p.current_version_id AND pv.product_id=p.id WHERE ${published} AND p.owner_id IN (?)) ranked WHERE position<=3 ORDER BY owner_id,position`,[ids]);}
   const items=rows.map(row=>({id:Number(row.id),username:row.username,display_name:row.display_name,bio:row.bio||null,avatar_url:media(row.avatar_media_id),banner_url:media(row.banner_media_id),banner_preset:parse(row.banner)?.preset||null,published_items:Number(row.published_items),followers:Number(row.followers),verified_creator:verified.has(Number(row.id)),viewer_follows:!!Number(row.viewer_follows),social_restricted:!!Number(row.social_restricted),own_account:Number(row.id)===viewer,follow_required:!!viewer&&viewer!==admin&&Number(row.id)===admin,products:previews.filter(p=>Number(p.owner_id)===Number(row.id)).map(p=>{const snapshot=parse(p.snapshot),product=decorateProduct(snapshot);return{id:Number(p.id),name:product.name,model_url:product.model_url,texture_url:product.variants.find(v=>v.is_default)?.texture_url||null};})}));
   await sql.commit();res.json({items,total,page,pages,size});
  }catch(error){await sql.rollback();throw error;}finally{sql.release();}
 });
}
