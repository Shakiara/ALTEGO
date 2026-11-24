// ALTEGO necesita resolver las versiones históricas y restauraciones de productos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {governanceReady} from "../../infrastructure/schema/readiness.js";
import {requiresPublicationReview} from '../verification/publication-policy.js';
import {isVerifiedCreator} from '../verification/verification-status.js';
import {requireLiveSession} from '../accounts/auth.js';
import {pendingPublicationReview} from '../verification/verification-status.js';
import {recordActivity} from '../accounts/activity-events.js';
import {markProductIndexesPending,refreshProductIndexes} from './product-storage.js';
import {encodeSnapshot,snapshotDelta,archiveReadme} from './manifest.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import yazl from 'yazl';
import {requireUser} from '../accounts/auth.js';
import {fail,validateGlb,validatePng} from '../../infrastructure/storage/assets.js';
import {readAssetFile,validAssetId} from '../../infrastructure/storage/storage-resolver.js';
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const positive=v=>/^\d+$/.test(String(v))&&Number.isSafeInteger(Number(v))&&Number(v)>0;
export const canManage=(req,p)=>req.user&&(req.user.role==='admin'||req.user.id===p.owner_id);

export function allowHistory(p){if(p.purged_at||p.status==='Trash')throw fail('Restore the item from Trash before managing versions.',409);if(!['Draft','Published','Unlisted'].includes(p.status))throw fail('This item is restricted.',403);}
async function managed(sql,req,lock=false){if(lock){await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[req.user.id]);await requireLiveSession(sql,req);}const[rows]=await sql.execute('SELECT * FROM productos WHERE id=?'+(lock?' FOR UPDATE':''),[req.recordId]);const p=rows[0];if(!p||p.purged_at)throw fail('Item not found.',404);if(!canManage(req,p))throw fail('You cannot manage this item.',403);allowHistory(p);return p;}
export function snapshotContent(raw,productId){
 const s=parse(raw);
 if(!s||s.id!==productId||typeof s.name!=='string'||!s.name||typeof s.description!=='string'||!positive(s.category_id)||!Number.isFinite(s.price)||s.price<0||!s.model_asset_id||!Array.isArray(s.variants)||!s.variants.length||s.variants.length>100)throw fail('Historical snapshot is incomplete. No changes were made.',409);
 const ids=new Set();const variants=s.variants.map(v=>{if(!v.id||ids.has(v.id)||typeof v.name!=='string'||!/^#[0-9a-f]{6}$/i.test(v.hex)||typeof v.is_default!=='boolean'||(!v.texture_asset_id&&!v.legacy))throw fail('Historical variant data is incomplete.',409);ids.add(v.id);return{id:v.id,name:v.name,hex:v.hex,texture_asset_id:v.texture_asset_id||null,is_default:v.is_default,legacy:!!v.legacy};});
 if(variants.filter(v=>v.is_default).length!==1)throw fail('Historical default variant is invalid.',409);
 return{id:productId,name:s.name,description:s.description,category_id:Number(s.category_id),...(typeof s.category==='string'?{category:s.category}:{}),price:s.price,model_asset_id:s.model_asset_id,variants};
}

export async function checkedAsset(sql,id,kind,preview=false,productId,acquisition=null){
 if(!validAssetId(id))throw fail('Historical asset identifier is invalid.',409);
 const[rows]=await sql.execute('SELECT * FROM assets WHERE id=? AND kind=?',[id,kind]);const a=rows[0];if(!a)throw fail('A historical asset is unavailable.',409);
 let data;try{data=await readAssetFile(sql,a,preview?'preview':'original',{productId,...(acquisition?{acquisition}:{})});}catch{throw fail('A historical file is missing, unsafe or has failed its integrity check.',409);}
 const metadata=kind==='glb'?validateGlb(data):validatePng(data);
 return{...a,data,metadata};
}
export async function validateSnapshot(sql,version,productId,previews=false){
 const s=snapshotContent(version.snapshot,productId);
 const[refs]=await sql.execute('SELECT vv.*,v.product_id FROM version_variants vv JOIN variants v ON v.id=vv.variant_id WHERE vv.version_id=?',[version.id]);
 if(refs.length!==s.variants.length)throw fail('Historical references are incomplete.',409);
 for(const v of s.variants){const r=refs.find(r=>r.variant_id===v.id);if(!r||r.product_id!==productId||r.model_asset_id!==s.model_asset_id||(r.texture_asset_id||null)!==v.texture_asset_id)throw fail('Historical references do not match this item.',409);}
 const model=await checkedAsset(sql,s.model_asset_id,'glb',false,productId);
 if(previews)await checkedAsset(sql,s.model_asset_id,'glb',true,productId);
 const assets=new Map([[model.id,model]]);
 for(const v of s.variants)if(v.texture_asset_id){if(!model.metadata.compatible)throw fail('The historical model cannot use these textures.',409);if(!assets.has(v.texture_asset_id))assets.set(v.texture_asset_id,await checkedAsset(sql,v.texture_asset_id,'png',false,productId));if(previews)await checkedAsset(sql,v.texture_asset_id,'png',true,productId);}
 return{s,assets};
}
export function installHistory(app,pool){
 app.post('/api/products/:id/versions/:versionId/restore',requireUser,async(req,res)=>{
  if(!positive(req.params.versionId)||!Number.isSafeInteger(req.body?.revision)||! /^[a-f0-9-]{36}$/.test(req.body?.request_key||''))throw fail('Invalid restoration request.');
  const sql=await pool.getConnection();let restoration;try{await sql.beginTransaction();const p=await managed(sql,req,true);
   const[prior]=await sql.execute('SELECT * FROM version_restorations WHERE product_id=? AND request_key=?',[p.id,req.body.request_key]);
   if(prior.length){if(prior[0].source_version_id!==Number(req.params.versionId)||prior[0].actor_id!==req.user.id)throw fail('Restoration request conflicts with an existing request.',409);await sql.commit();return res.json({version_id:prior[0].version_id,replayed:true});}
   if(await governanceReady(sql)){
    const [[queued]]=await sql.execute("SELECT id,restore_source_id,restore_actor_id FROM product_publication_reviews WHERE product_id=? AND restore_request_key=? AND status='pending'",[p.id,req.body.request_key]);
    if(queued){if(queued.restore_source_id!==Number(req.params.versionId)||queued.restore_actor_id!==req.user.id)throw fail('Restoration request conflicts with an existing request.',409);await sql.commit();return res.json({publication_pending:true,review_id:queued.id,replayed:true});}
   }
   if(await pendingPublicationReview(sql,p.id))throw fail('This item is awaiting publication review.',409);
   if(p.revision!==req.body.revision)throw fail('This item changed. Reload before restoring.',409);
   const[versions]=await sql.execute('SELECT * FROM product_versions WHERE id=? AND product_id=?',[req.params.versionId,p.id]);if(!versions.length)throw fail('Version not found.',404);
   const{s}=await validateSnapshot(sql,versions[0],p.id,true);
   const[categories]=await sql.execute('SELECT id FROM categorias WHERE id=?',[s.category_id]);if(!categories.length)throw fail('The historical category is unavailable.',409);
   await sql.execute('UPDATE variants SET active=FALSE WHERE product_id=?',[p.id]);
   for(const v of s.variants)await sql.execute('UPDATE variants SET name=?,hex=?,texture_asset_id=?,is_default=?,legacy=?,active=TRUE WHERE id=? AND product_id=?',[v.name,v.hex,v.texture_asset_id,v.is_default,v.legacy,v.id,p.id]);
   if(await governanceReady(sql)&&req.user.role!=='admin'&&await requiresPublicationReview(sql,p,{...s,verified_creator:await isVerifiedCreator(sql,p.owner_id)})){
    await sql.execute('UPDATE productos SET nombre=?,descripcion=?,categoria_id=?,precio=?,model_asset_id=?,revision=revision+1 WHERE id=?',[s.name,s.description,s.category_id,s.price,s.model_asset_id,p.id]);
    const [review]=await sql.execute('INSERT INTO product_publication_reviews(product_id,submitted_revision,submitted_snapshot,restore_source_id,restore_actor_id,restore_request_key) VALUES (?,?,?,?,?,?)',[p.id,p.revision+1,JSON.stringify(s),versions[0].id,req.user.id,req.body.request_key]);
    await markProductIndexesPending(sql,p.id);await sql.commit();await refreshProductIndexes(pool,p.id);
    return res.json({publication_pending:true,review_id:review.insertId,restored_from:versions[0].version_number});
   }
   const[n]=await sql.execute('SELECT COALESCE(MAX(version_number),0)+1 AS number FROM product_versions WHERE product_id=?',[p.id]);
   const snapshot={...s,owner_id:p.owner_id};const[v]=await sql.execute('INSERT INTO product_versions(product_id,version_number,snapshot) VALUES (?,?,?)',[p.id,n[0].number,JSON.stringify(snapshot)]);
   for(const variant of s.variants)await sql.execute('INSERT INTO version_variants(version_id,variant_id,model_asset_id,texture_asset_id) VALUES (?,?,?,?)',[v.insertId,variant.id,s.model_asset_id,variant.texture_asset_id]);
   await sql.execute('INSERT INTO version_restorations(version_id,source_version_id,product_id,actor_id,request_key) VALUES (?,?,?,?,?)',[v.insertId,versions[0].id,p.id,req.user.id,req.body.request_key]);
   await sql.execute("UPDATE productos SET nombre=?,descripcion=?,categoria_id=?,precio=?,model_asset_id=?,current_version_id=?,status='Published',revision=revision+1,trashed_at=NULL WHERE id=?",[s.name,s.description,s.category_id,s.price,s.model_asset_id,v.insertId,p.id]);
   await markProductIndexesPending(sql,p.id);const [[creator]]=await sql.execute('SELECT username FROM users WHERE id=?',[p.owner_id]);await recordActivity(sql,{actor:req.user.id,type:'item.version_restored',resourceType:'product',resourceId:p.id,label:s.name,metadata:{version:Number(n[0].number),source_version:versions[0].version_number,...(creator?{creator:creator.username}:{})},key:'item:restore:'+v.insertId});await sql.commit();restoration={version_id:v.insertId,version_number:n[0].number,restored_from:versions[0].version_number};
  }catch(e){await sql.rollback();throw e;}finally{sql.release();}
  await refreshProductIndexes(pool,req.recordId);res.json(restoration);
 });
 app.get('/api/products/:id/versions/:versionId/download',requireUser,async(req,res)=>{
  if(!positive(req.params.versionId))throw fail('Invalid version identifier.');
  const p=await managed(pool,req);const[target]=await pool.execute('SELECT * FROM product_versions WHERE id=? AND product_id=?',[req.params.versionId,p.id]);if(!target.length)throw fail('Version not found.',404);
  const[versions]=await pool.execute('SELECT v.*,s.version_number AS restored_from FROM product_versions v LEFT JOIN version_restorations r ON r.version_id=v.id LEFT JOIN product_versions s ON s.id=r.source_version_id WHERE v.product_id=? AND v.version_number<=? ORDER BY v.version_number',[p.id,target[0].version_number]);
  if(versions.length!==target[0].version_number||versions.some((v,i)=>v.version_number!==i+1))throw fail('Historical versions are incomplete. A reliable archive cannot be generated.',409);
  const[creator]=await pool.execute('SELECT username FROM users WHERE id=?',[p.owner_id]);
  const slug=(snapshotContent(target[0].snapshot,p.id).name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'Item')+'_v1-to-v'+target[0].version_number;
  const manifest={format_version:2,item_id:p.id,item_name:parse(target[0].snapshot).name,creator_id:p.owner_id,creator_name:creator[0]?.username||null,generated_at:new Date().toISOString(),requested_version:target[0].version_number,versions:[],files:{},assets:{}};

  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'altego-history-'));let disconnected=false;req.on('aborted',()=>disconnected=true);res.on('close',()=>{disconnected=true;});
  try{const content=new Map(),aliases={};let previous;
   for(const version of versions){if(disconnected)throw fail('Download cancelled.',499);const{s,assets}=await validateSnapshot(pool,version,p.id);
    for(const a of assets.values()){const key=a.kind+':'+a.sha256;let file=content.get(key);if(!file){const fileId='f'+(content.size+1),relative=`v${version.version_number}/${a.kind==='glb'?'models':'textures'}/${a.sha256}.${a.kind}`;file={id:fileId,path:relative,sha256:a.sha256,byte_size:a.byte_size,kind:a.kind,used_in:[]};content.set(key,file);manifest.files[fileId]=file;await fs.writeFile(path.join(temp,a.sha256+'.'+a.kind),a.data,{flag:'wx'});}if(!file.used_in.includes(version.version_number))file.used_in.push(version.version_number);if(!aliases[a.id]){const alias='a'+(Object.keys(aliases).length+1);aliases[a.id]=alias;manifest.assets[alias]={asset_id:a.id,file:file.id};}}
    const state=encodeSnapshot(version.snapshot,aliases);manifest.versions.push({version_number:version.version_number,published_at:version.created_at,...(version.restored_from?{restored_from:version.restored_from}:{}),...(previous?{changes:snapshotDelta(previous,state)}:{initial:state})});previous=state;
   }
   if(disconnected)throw fail('Download cancelled.',499);
   const zip=new yazl.ZipFile(),zipPath=path.join(temp,'archive.zip');const finished=pipeline(zip.outputStream,createWriteStream(zipPath));zip.on('error',e=>zip.outputStream.destroy(e));
   for(const file of Object.values(manifest.files))zip.addFile(path.join(temp,file.sha256+'.'+file.kind),slug+'/'+file.path);
   zip.addBuffer(Buffer.from(JSON.stringify(manifest,null,2)),slug+'/manifest.json');zip.addBuffer(Buffer.from(archiveReadme(manifest)),slug+'/README.txt');zip.end();await finished;
   if(disconnected)return;await managed(pool,req);res.set('Cache-Control','no-store');res.set('Access-Control-Expose-Headers','Content-Disposition');
   await new Promise((resolve,reject)=>res.download(zipPath,slug+'.zip',e=>e?reject(e):resolve()));
  }catch(e){if(res.destroyed||req.aborted)return;if(res.headersSent){res.destroy(e);return;}throw e;}finally{await fs.rm(temp,{recursive:true,force:true});}
 });
}
