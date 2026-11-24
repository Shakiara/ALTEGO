// ALTEGO necesita resolver el ciclo de creación y publicación de productos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {promotionMessage,savePromotionMessage,publishPromotion,removeProductPromotion} from '../discovery/following-feed.js';
import {planProductDeletion,scheduleProductExpiry,cancelProductExpiry,completePermanentDeletion} from '../../infrastructure/storage/permanent-deletion.js';
import {validateCategoryAssignment} from '../catalog/catalog-categories.js';
import {governanceReady} from "../../infrastructure/schema/readiness.js";

import {audit,decisionInput,notifyAccount,productPublicFilter} from '../administration/admin-audit.js';

import {requiresPublicationReview} from '../verification/publication-policy.js';

import {requireLiveSession} from '../accounts/auth.js';

import {isVerifiedCreator,pendingPublicationReview as pendingReview,verificationReady} from '../verification/verification-status.js';

import {withSocialPair} from '../social/social-blocks.js';

import {notifyFollowingPublication} from '../social/social-notifications.js';

import {recordActivity} from '../accounts/activity-events.js';

import {publicCreator} from '../accounts/profiles.js';

import {decorateProduct as decorate} from './product-dto.js';

import {markProductIndexesPending,refreshProductIndexes} from './product-storage.js';

import {installHistory} from './history.js';

import express from 'express';

import {randomUUID} from 'node:crypto';

import {requireAdmin,requireUser} from '../accounts/auth.js';

import {storeAsset,fail} from '../../infrastructure/storage/assets.js';

import {readAssetFile,validAssetId} from '../../infrastructure/storage/storage-resolver.js';

import {bindTemporaryUpload} from '../../infrastructure/storage/upload-staging.js';

const parse=value=>typeof value==='string'?JSON.parse(value):value;

const owner=(req,p)=>req.user&&(req.user.role==='admin'||req.user.id===p.owner_id);

export const visible=(req,p)=>!p.purged_at&&(!p.moderation_removed||owner(req,p))&&(['Published','Unlisted'].includes(p.status)||owner(req,p));





async function transaction(pool,action){const sql=pool.getConnection?await pool.getConnection():pool;try{await sql.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await sql.beginTransaction();const result=await action(sql);await sql.commit();return result;}catch(e){await sql.rollback();throw e;}finally{if(pool.getConnection)sql.release();}}

export function installProducts(app,pool,mongo=null){

 installHistory(app,pool);

 const select='SELECT p.*,c.nombre AS category,COALESCE(up.display_name,u.username) AS creator_name FROM productos p JOIN categorias c ON c.id=p.categoria_id LEFT JOIN users u ON u.id=p.owner_id LEFT JOIN user_profiles up ON up.user_id=u.id';

 async function row(sql,id,lock=false){const[rows]=await sql.execute(select+' WHERE p.id=?'+(lock?' FOR UPDATE':''),[id]);if(!rows.length||rows[0].purged_at)throw fail('Item not found.',404);return rows[0];}

 async function editable(sql,req,lock=false){

 if(lock){const [[actor]]=await sql.execute('SELECT role FROM users WHERE id=? FOR UPDATE',[req.user.id]);await requireLiveSession(sql,req);req.user.role=actor?.role;}

 const p=await row(sql,req.recordId,lock);if(!owner(req,p))throw fail('You cannot manage this item.',403);return p;}

 async function managementReview(sql,id){const [[review]]=await sql.execute('SELECT status,decision_reason,decision_explanation,decided_at FROM product_publication_reviews WHERE product_id=? ORDER BY id DESC LIMIT 1',[id]);const [[pin]]=await sql.execute('SELECT pinned_thumbnail_id FROM user_profiles WHERE pinned_product_id=? AND pinned_thumbnail_id IS NOT NULL',[id]);return {thumbnail_url:pin?'/api/profile-media/'+pin.pinned_thumbnail_id+'/display':null,review_status:review?.status??null,review_reason:review?.decision_reason??null,review_explanation:review?.decision_explanation??null};}
 async function draft(sql,p,management=false){const[variants]=await sql.execute('SELECT * FROM variants WHERE product_id=? AND active=TRUE ORDER BY is_default DESC,id',[p.id]);return decorate({id:p.id,owner_id:p.owner_id,creator_name:p.creator_name,verified_creator:await isVerifiedCreator(sql,p.owner_id),...(management?{publication_pending:Boolean(await pendingReview(sql,p.id)),moderation_removed:Boolean(p.moderation_removed),...await managementReview(sql,p.id)}:{}),promotional_message:await promotionMessage(sql,p.id),name:p.nombre,description:p.descripcion,category_id:p.categoria_id,category:p.category,price:Number(p.precio),model_asset_id:p.model_asset_id,model_url:p.modelo_url,status:p.status,revision:p.revision,current_version_id:p.current_version_id,trashed_at:p.trashed_at,variants});}

 async function publicDto(sql,p){if(p.current_version_id&&p.status!=='Draft'){const[v]=await sql.execute("SELECT pv.*,c.nombre AS live_category FROM product_versions pv LEFT JOIN categorias c ON c.id=COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pv.snapshot,'$.category_id')),?) WHERE pv.id=?",[p.categoria_id,p.current_version_id]);if(v.length)return decorate({...parse(v[0].snapshot),creator_name:p.creator_name,verified_creator:await isVerifiedCreator(sql,p.owner_id),owner_id:p.owner_id,category:v[0].live_category||p.category,status:p.status,current_version_id:v[0].id,version_number:v[0].version_number});}return draft(sql,p);}

 async function asset(sql,id,kind,user,product=null){if(!validAssetId(id))throw fail('Invalid file identifier.');const[rows]=await sql.execute('SELECT * FROM assets WHERE id=? AND kind=?'+(product?' FOR UPDATE':''),[id,kind]);if(!rows.length||rows[0].storage_state&&rows[0].storage_state!=='ready')throw fail('The selected file is not available.',400);if(rows[0].owner_id!==user.id&&user.role!=='admin'){const[refs]=await sql.execute('SELECT p.id FROM productos p LEFT JOIN variants v ON v.product_id=p.id WHERE p.owner_id=? AND (p.model_asset_id=? OR v.texture_asset_id=?) LIMIT 1',[user.id,id,id]);if(!refs.length)throw fail('The selected file is not available to your account.',403);}if(product)await bindTemporaryUpload(sql,rows[0],product,pool);return {...rows[0],metadata:parse(rows[0].metadata)};}

 function fields(b){if(typeof b?.name!=='string'||!b.name.trim()||b.name.trim().length>120)throw fail('Item Name is required (maximum 120 characters).');if(!Number.isSafeInteger(Number(b.category_id))||Number(b.category_id)<1)throw fail('Select a category.');if(b.description!=null&&(typeof b.description!=='string'||b.description.length>5000))throw fail('Description must contain at most 5000 characters.');let price=b.price===''||b.price==null?0:Number(b.price);if(!['string','number','undefined'].includes(typeof b.price)&&b.price!==null||!Number.isFinite(price)||price<0||price>99999999.99||Math.abs(price*100-Math.round(price*100))>0.00001)throw fail('Enter a valid non-negative USD price with up to two decimals.');return [Number(b.category_id),b.name.trim(),b.description||'',price];}

 app.post('/api/assets/:kind',requireUser,express.raw({type:()=>true,limit:'25mb'}),async(req,res)=>{if(!['glb','png'].includes(req.params.kind)||!Buffer.isBuffer(req.body))throw fail('Upload a GLB or PNG file.');res.status(201).json(await storeAsset(pool,req.user.id,req.params.kind,req.body,{temporary:true}));});

 app.get('/api/previews/:assetId',async(req,res)=>{

  if(!validAssetId(req.params.assetId))throw fail('Preview not found.',404);

  const[a]=await pool.execute('SELECT * FROM assets WHERE id=?',[req.params.assetId]);if(!a.length||a[0].storage_state&&a[0].storage_state!=='ready')throw fail('Preview not found.',404);

  const[publicRefs]=await pool.execute("SELECT p.id FROM version_variants vv JOIN productos p ON p.current_version_id=vv.version_id WHERE p.status IN ('Published','Unlisted') AND p.purged_at IS NULL" + await productPublicFilter(pool) + " AND (vv.model_asset_id=? OR vv.texture_asset_id=?) LIMIT 1",[a[0].id,a[0].id]);

  if(!publicRefs.some(ref=>(a[0].storage_layout||'legacy')==='legacy'||(a[0].product_id==null||ref.id===a[0].product_id))){if(!req.user)throw fail('Preview not found.',404);try{await asset(pool,a[0].id,a[0].kind,req.user);}catch{throw fail('Preview not found.',404);}}

  res.set('Cache-Control','no-store');res.type(a[0].kind==='glb'?'model/gltf-binary':'image/png');try{res.send(await readAssetFile(pool,a[0],'preview',publicRefs.length?{productId:publicRefs[0].id}:{}));}catch(error){if(error.status===409||['ENOENT','ENOTDIR','ELOOP'].includes(error.code))throw fail('Preview not found.',404);throw error;}

 });

 app.get('/api/creators/:id',async(req,res)=>res.json(await publicCreator(pool,req.recordId,req.user?.id)));

 app.get('/api/my-items',requireUser,async(req,res)=>{const all=req.query.scope==='all'&&req.user.role==='admin';const[rows]=await pool.execute(select+' WHERE p.purged_at IS NULL'+(all?'':' AND p.owner_id=?')+' ORDER BY p.id DESC',all?[]:[req.user.id]);res.json(await Promise.all(rows.map(p=>draft(pool,p,true))));});

 app.get('/api/catalog',async(req,res)=>{

  const page=Number(req.query.page||1),category=Number(req.query.category||0),q=String(req.query.q||'').trim();

  if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(category)||category<0||q.length>200)throw fail('Invalid catalog query.');

  const result=await transaction(pool,async sql=>{

   const base=" FROM productos p LEFT JOIN product_versions pv ON pv.id=p.current_version_id WHERE p.status='Published' AND p.purged_at IS NULL"+await productPublicFilter(sql);

   const cat="COALESCE(JSON_EXTRACT(pv.snapshot,'$.category_id'),p.categoria_id)";

   const where=base+(category?' AND '+cat+'=?':'')+(q?" AND LOCATE(LOWER(?),LOWER(CONCAT(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pv.snapshot,'$.name')),p.nombre),' ',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pv.snapshot,'$.description')),p.descripcion))))>0":'');

   const args=[...(category?[category]:[]),...(q?[q]:[])];

   const[count]=await sql.execute('SELECT COUNT(*) AS total'+where,args);const total=count[0].total,total_pages=Math.ceil(total/25),current=Math.min(page,Math.max(1,total_pages));

   const[ids]=await sql.query('SELECT p.id'+where+' ORDER BY p.id DESC LIMIT 25 OFFSET ?', [...args,(current-1)*25]);

   const[groups]=await sql.query('SELECT '+cat+' AS category_id,COUNT(*) AS total'+base+' GROUP BY '+cat);

   const items=[];for(const entry of ids)items.push(await publicDto(sql,await row(sql,entry.id)));

   return {items,page:current,limit:25,total,total_pages,category_counts:groups};

  });res.json(result);

 });

 app.get('/api/products',async(req,res)=>{const[rows]=await pool.query(select+" WHERE p.status='Published' AND p.purged_at IS NULL"+await productPublicFilter(pool)+" ORDER BY p.id DESC");res.json(await Promise.all(rows.map(p=>publicDto(pool,p))));});

 app.get('/api/products/:id',async(req,res)=>{const p=await row(pool,req.recordId);if(!visible(req,p)||p.status==='Trash')throw fail('Item not found.',404);res.json(await publicDto(pool,p));});

 app.get('/api/products/:id/draft',requireUser,async(req,res)=>res.json(await draft(pool,await editable(pool,req),true)));

 app.get('/api/products/:id/versions',requireUser,async(req,res)=>{await editable(pool,req);const[rows]=await pool.execute('SELECT v.id,v.version_number,v.snapshot,v.created_at,s.version_number AS restored_from FROM product_versions v LEFT JOIN version_restorations r ON r.version_id=v.id LEFT JOIN product_versions s ON s.id=r.source_version_id WHERE v.product_id=? ORDER BY v.version_number DESC',[req.recordId]);res.json(rows.map(v=>({...v,snapshot:decorate(parse(v.snapshot))})));});

 app.post('/api/products',requireUser,async(req,res)=>{const values=fields(req.body);const result=await transaction(pool,async sql=>{await validateCategoryAssignment(sql,values[0]);const [r]=await sql.execute('INSERT INTO productos(categoria_id,nombre,descripcion,precio,owner_id) VALUES (?,?,?,?,?)',[...values,req.user.id]);await recordActivity(sql,{actor:req.user.id,type:'item.created',resourceType:'product',resourceId:r.insertId,label:values[1],metadata:{creator:req.user.username},key:'item:create:'+r.insertId});await savePromotionMessage(sql,await row(sql,r.insertId),req.user,req.body.promotional_message);return draft(sql,await row(sql,r.insertId));});res.status(201).json(result);});

 app.put('/api/products/:id',requireUser,async(req,res)=>{

 const result=await transaction(pool,async sql=>{const p=await editable(sql,req,true);if(await pendingReview(sql,p.id))throw fail('This item is awaiting publication review.',409);if(p.status==='Trash')throw fail('Restore this item before editing.',409);if(req.body.revision!==p.revision)throw fail('This item changed. Reload before saving.',409);const values=fields(req.body);await validateCategoryAssignment(sql,values[0],p.categoria_id);const before=await draft(sql,p);await savePromotionMessage(sql,p,req.user,req.body.promotional_message);

 const modelId=req.body.model_asset_id||null;

 const variants=req.body.variants;if(!Array.isArray(variants)||variants.length>100)throw fail('Use up to 100 color variants.');

 const ids=[...new Set([modelId,...variants.map(v=>v.texture_asset_id)].filter(Boolean))].sort();if(ids.some(id=>!validAssetId(id)))throw fail('Invalid file identifier.');

 if(ids.length)await sql.execute('SELECT id FROM assets WHERE id IN ('+ids.map(()=>'?').join(',')+') ORDER BY id FOR UPDATE',ids);

 const checkedAssets=new Map();async function useAsset(id,kind){const key=id+kind;if(!checkedAssets.has(key))checkedAssets.set(key,await asset(sql,id,kind,req.user,p));return checkedAssets.get(key);}

 if(modelId)await useAsset(modelId,'glb');

 const[existing]=await sql.execute('SELECT * FROM variants WHERE product_id=? AND active=TRUE',[p.id]);const keep=new Set();

 for(const v of variants){if(typeof v.name!=='string'||!v.name.trim()||v.name.length>80||!/^#[0-9a-f]{6}$/i.test(v.hex||''))throw fail('Each variant needs a color name and six-digit HEX.');const old=existing.find(x=>x.id===v.id);if(v.id&&!old)throw fail('Variant does not belong to this item.');const id=old?.id||randomUUID();if(keep.has(id))throw fail('Duplicate variant.');keep.add(id);if(v.texture_asset_id)await useAsset(v.texture_asset_id,'png');await sql.execute('INSERT INTO variants(id,product_id,name,hex,texture_asset_id,is_default,legacy) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),hex=VALUES(hex),texture_asset_id=VALUES(texture_asset_id),is_default=VALUES(is_default)',[id,p.id,v.name.trim(),v.hex,v.texture_asset_id||null,v.is_default===true?1:0,old?.legacy||0]);}

 for(const old of existing)if(!keep.has(old.id)){const[refs]=await sql.execute('SELECT version_id FROM version_variants WHERE variant_id=? LIMIT 1',[old.id]);if(refs.length)throw fail('A published variant cannot be deleted. Its identity must be preserved.',409);await sql.execute('DELETE FROM variants WHERE id=?',[old.id]);}

 if(variants.length&&variants.filter(v=>v.is_default===true).length!==1)throw fail('Select exactly one default variant.');

 await sql.execute('UPDATE productos SET categoria_id=?,nombre=?,descripcion=?,precio=?,model_asset_id=?,revision=revision+1 WHERE id=?',[...values,modelId,p.id]);await markProductIndexesPending(sql,p.id);const after=await draft(sql,await row(sql,p.id));const variantState=list=>JSON.stringify(list.map(v=>({id:v.id,name:v.name,hex:v.hex,texture:v.texture_asset_id,default:v.is_default})).sort((a,b)=>a.id.localeCompare(b.id)));const changed=[];for(const [key,label]of [['name','Name'],['description','Description'],['category_id','Category'],['model_asset_id','3D model']])if(before[key]!==after[key])changed.push(label);if(variantState(before.variants)!==variantState(after.variants))changed.push('Color variants');const creator=p.creator_name?{creator:p.creator_name}:{};if(changed.length)await recordActivity(sql,{actor:req.user.id,type:'item.updated',resourceType:'product',resourceId:p.id,label:after.name,metadata:{fields:changed,...creator},key:'item:edit:'+p.id+':'+after.revision});if(before.price!==after.price)await recordActivity(sql,{actor:req.user.id,type:'item.price_updated',resourceType:'product',resourceId:p.id,label:after.name,metadata:{previous_price:before.price,price:after.price,...creator},key:'item:price:'+p.id+':'+after.revision});return after;});await refreshProductIndexes(pool,req.recordId);res.json(result);

 });

 async function publishItem(sql,req,p,review=null){

 if(p.status==='Trash')throw fail('Restore the item before publishing.',409);

 if(p.moderation_removed)throw fail('This item is restricted by moderation.',409);

 if(!review&&req.body.revision!==p.revision)throw fail('Reload the item before publishing.',409);

 const d=await draft(sql,p);if(!d.model_asset_id)throw fail('A GLB model is required to publish.');const model=await asset(sql,d.model_asset_id,'glb',req.user,p);if(!d.variants.length||d.variants.filter(v=>v.is_default).length!==1)throw fail('At least one valid default variant is required.');

 for(const v of d.variants){if(v.legacy&&!v.texture_asset_id){const[refs]=await sql.execute('SELECT model_asset_id FROM version_variants WHERE variant_id=? ORDER BY version_id LIMIT 1',[v.id]);if(refs[0]?.model_asset_id!==d.model_asset_id)throw fail('The replacement model requires a PNG texture.');}else{if(!v.texture_asset_id)throw fail('Every color variant requires a PNG texture.');await asset(sql,v.texture_asset_id,'png',req.user,p);if(!model.metadata.compatible)throw fail('This GLB does not support Diffuse variants: use embedded materials and UV0 for every mesh.');}}

 if(!review && await verificationReady(sql) && await requiresPublicationReview(sql,p,d)){

  if(await governanceReady(sql))await sql.execute('INSERT INTO product_publication_reviews(product_id,submitted_revision,submitted_snapshot) VALUES (?,?,?)',[p.id,p.revision,JSON.stringify(d)]);

  else await sql.execute('INSERT INTO product_publication_reviews(product_id) VALUES (?)',[p.id]);

  return {...d,publication_pending:true};

 }

 const {verified_creator,promotional_message,...snapshot}=d;

 const[n]=await sql.execute('SELECT COALESCE(MAX(version_number),0)+1 AS number FROM product_versions WHERE product_id=?',[p.id]);const[v]=await sql.execute('INSERT INTO product_versions(product_id,version_number,snapshot) VALUES (?,?,?)',[p.id,n[0].number,JSON.stringify(snapshot)]);if(review?.restore_source_id)await sql.execute('INSERT INTO version_restorations(version_id,source_version_id,product_id,actor_id,request_key) VALUES (?,?,?,?,?)',[v.insertId,review.restore_source_id,p.id,review.restore_actor_id,review.restore_request_key]);for(const variant of d.variants)await sql.execute('INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (?,?,?,?)',[v.insertId,variant.id,d.model_asset_id,variant.texture_asset_id||null]);await sql.execute("UPDATE productos SET status='Published',current_version_id=?,revision=revision+1,trashed_at=NULL WHERE id=?",[v.insertId,p.id]);await markProductIndexesPending(sql,p.id);await publishPromotion(sql,p);if(!p.current_version_id)await notifyFollowingPublication(sql,{creatorId:p.owner_id,productId:p.id,versionId:v.insertId,name:d.name});await recordActivity(sql,{actor:req.user.id,type:'item.published',resourceType:'product',resourceId:p.id,label:d.name,metadata:{version:Number(n[0].number),...(p.creator_name?{creator:p.creator_name}:{})},key:'item:publish:'+v.insertId});return publicDto(sql,await row(sql,p.id));

 }

 app.post('/api/products/:id/publish',requireUser,async(req,res)=>{

  const result=await transaction(pool,async sql=>{

   const item=await editable(sql,req,true);

   if(await pendingReview(sql,item.id))return draft(sql,item,true);

   return publishItem(sql,req,item);

  });

  if(!result.publication_pending)await refreshProductIndexes(pool,req.recordId);

  res.json(result);

 });

 app.get('/api/admin/product-publications',requireUser,requireAdmin,async(req,res)=>{

  if(!await verificationReady(pool))throw fail('Publication review is unavailable.',503);

  const before=req.query.before===undefined?null:Number(req.query.before);

  if(before!==null && (!Number.isSafeInteger(before)||before<1))throw fail('Invalid review cursor.');

  const [rows]=await pool.execute(`SELECT r.id AS review_id,p.id AS product_id,p.nombre AS name,p.owner_id,u.username,r.submitted_at

   FROM product_publication_reviews r JOIN productos p ON p.id=r.product_id JOIN users u ON u.id=p.owner_id

   WHERE r.status='pending' ${before?'AND r.id<?':''} ORDER BY r.id DESC LIMIT 26`,before?[before]:[]);

  res.json({items:rows.slice(0,25),next:rows.length>25?rows[24].review_id:null});

 });

 app.put('/api/admin/product-publications/:id',requireUser,requireAdmin,async(req,res)=>{

  if(!await verificationReady(pool))throw fail('Publication review is unavailable.',503);

  const decision=req.body?.decision;

  if(!['approve','reject'].includes(decision))throw fail('Choose a valid publication decision.');

  const enhanced=await governanceReady(pool);if(enhanced)decisionInput(req.body);else if(Object.keys(req.body).length!==1)throw fail('Choose a valid publication decision.');

  const [[review]]=await pool.execute(`SELECT r.product_id,p.owner_id FROM product_publication_reviews r

    JOIN productos p ON p.id=r.product_id WHERE r.id=?`,[req.recordId]);

  if(!review)throw fail('Publication review not found.',404);

  await withSocialPair(pool,req,review.owner_id,async sql=>{

   const [[actor]]=await sql.execute('SELECT role FROM users WHERE id=?',[req.user.id]);

   if(actor.role!=='admin')throw fail('Administrator access is required.',403);

   const item=await row(sql,review.product_id,true);

   const pending=await pendingReview(sql,item.id);

   if(pending?.id!==req.recordId || (!enhanced&&item.current_version_id) || (enhanced&&pending.submitted_revision!==null&&pending.submitted_revision!==item.revision))throw fail('This publication review has already been resolved.',409);

   if(decision==='approve'){

    if(item.moderation_removed)throw fail('Restore the moderation restriction before approving.',409);

    await publishItem(sql,req,item,pending);

   }

   await sql.execute('UPDATE product_publication_reviews SET status=?,decided_at=UTC_TIMESTAMP(6),decided_by=? WHERE id=?',

     [decision==='approve'?'approved':'rejected',req.user.id,req.recordId]);

   if(enhanced)await sql.execute('UPDATE product_publication_reviews SET decision_reason=?,decision_explanation=? WHERE id=?',[req.body.reason,req.body.explanation?.trim()||null,req.recordId]);

   await audit(sql,{actor:req.user.id,category:'products',action:'publication.'+decision,type:'product',id:item.id,reason:req.body.reason??null,changes:{review_id:req.recordId}});

   await notifyAccount(sql,{recipient:item.owner_id,key:'publication-review:'+req.recordId,title:decision==='approve'?'Publication approved':'Publication rejected',description:'Review the publication decision in My Items.',destination:'/my-items'});

  });

  if(decision==='approve')await refreshProductIndexes(pool,review.product_id);

  res.status(204).end();

 });

 app.post('/api/products/:id/state',requireUser,async(req,res)=>{

 const result=await transaction(pool,async sql=>{const p=await editable(sql,req,true),state=req.body.state;if(await pendingReview(sql,p.id))throw fail('This item is awaiting publication review.',409);if(state==='Trash'&&p.status!=='Trash')await sql.execute("UPDATE productos SET status='Trash',trashed_at=UTC_TIMESTAMP(),revision=revision+1 WHERE id=?",[p.id]);

 else if(state==='Draft'&&p.status==='Trash'){const[age]=await sql.execute('SELECT trashed_at > DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY) AS allowed FROM productos WHERE id=?',[p.id]);if(!age[0].allowed)throw fail('The 30-day restoration period has expired.',409);await sql.execute("UPDATE productos SET status='Draft',trashed_at=NULL,revision=revision+1 WHERE id=?",[p.id]);}

 else if(['Published','Unlisted'].includes(state)&&['Published','Unlisted'].includes(p.status)&&p.current_version_id)await sql.execute('UPDATE productos SET status=?,revision=revision+1 WHERE id=?',[state,p.id]);

 else throw fail('This state transition is not allowed.',409);if(state==='Trash'&&p.status!=='Trash')await scheduleProductExpiry(sql,p);else if(state==='Draft')await cancelProductExpiry(sql,p.id);await markProductIndexesPending(sql,p.id);const after=await draft(sql,await row(sql,p.id));if(p.status!==state){const types={Trash:'item.trashed',Draft:'item.restored',Published:'item.listed',Unlisted:'item.unlisted'};await recordActivity(sql,{actor:req.user.id,type:types[state],resourceType:'product',resourceId:p.id,label:p.nombre,metadata:p.creator_name?{creator:p.creator_name}:{},key:'item:state:'+p.id+':'+after.revision});}return after;});await refreshProductIndexes(pool,req.recordId);res.json(result);

 });


 app.delete('/api/products/:id',requireUser,async(req,res)=>{const operation=await transaction(pool,async sql=>{const [[actor]]=await sql.execute('SELECT role FROM users WHERE id=? FOR UPDATE',[req.user.id]);await requireLiveSession(sql,req);req.user.role=actor?.role;const [[p]]=await sql.execute('SELECT * FROM productos WHERE id=? FOR UPDATE',[req.recordId]);if(!p||!owner(req,p))throw fail('You cannot manage this item.',403);if(!p.purged_at){const [[age]]=await sql.execute('SELECT trashed_at<=UTC_TIMESTAMP()-INTERVAL 30 DAY allowed FROM productos WHERE id=?',[p.id]);if(p.status!=='Trash'||!age.allowed)throw fail('Move to Trash and wait 30 days before purging.',409);}const operation=await planProductDeletion(sql,p);if(!p.purged_at){await removeProductPromotion(sql,p.id);await sql.execute('UPDATE productos SET purged_at=UTC_TIMESTAMP(),revision=revision+1 WHERE id=?',[p.id]);await recordActivity(sql,{actor:req.user.id,type:'item.purged',resourceType:'product',resourceId:p.id,label:p.nombre,metadata:{},key:'item:purge:'+p.id});}await cancelProductExpiry(sql,p.id);return operation;});const result=await completePermanentDeletion(pool,operation,{mongo});if(result.pending)return res.status(202).json({deletion_pending:true,message:result.error});res.status(204).end();});
}
