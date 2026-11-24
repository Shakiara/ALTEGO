// ALTEGO necesita resolver la biblioteca privada de productos adquiridos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';

import {requireUser,requireLiveSession} from '../accounts/auth.js';import {suspensionForLogin} from '../accounts/account-sanctions.js';

import {withAcquisitionTransaction} from '../commerce/acquisitions.js';import {collectionReady} from "../../infrastructure/schema/readiness.js";

import {ownedResources,writeOwnedZip,archiveSlug} from '../commerce/owned-downloads.js';

const fail=(status,message)=>Object.assign(Error(message),{status});

const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;

const parse=v=>typeof v==='string'?JSON.parse(v):v;

async function access(pool,req,productId,run){

 if(productId!==null&&!positive(productId))throw fail(404,'Product not found.');

 const [owned]=await pool.execute('SELECT DISTINCT product_id FROM acquisitions WHERE user_id=?',[req.user.id]);

 if(productId!==null&&!owned.some(p=>p.product_id===productId))throw fail(404,'Product not found in your collection.');

 return withAcquisitionTransaction(pool,req.user.id,productId===null?owned.map(p=>p.product_id):[productId],async({sql})=>{

  await requireLiveSession(sql,req);const [[buyer]]=await sql.execute('SELECT id,role FROM users WHERE id=?',[req.user.id]);if(!buyer||await suspensionForLogin(sql,buyer))throw fail(403,'This account is suspended.');

  if(!await collectionReady(sql))throw fail(503,'My Collection is temporarily unavailable.');

  const [rows]=await sql.execute(`SELECT a.*,DATE_FORMAT(a.acquired_at,'%Y-%m-%dT%H:%i:%s.%fZ') acquired_at,i.product_name,i.variant_name,i.price_cents,i.creator_id,u.username creator_name,

   v.id version_id,v.version_number,v.snapshot,p.moderation_removed,c.nombre category_name,pin.product_id pinned

   FROM acquisitions a JOIN productos p ON p.id=a.product_id JOIN order_items i ON i.id=a.order_item_id AND i.buyer_id=a.user_id AND i.product_id=a.product_id AND i.variant_id=a.variant_id AND i.version_id=a.acquired_version_id

   JOIN orders o ON o.id=i.order_id AND o.buyer_id=a.user_id AND o.status='completed'

   JOIN product_versions original ON original.id=a.acquired_version_id AND original.product_id=a.product_id

   JOIN product_versions v ON v.product_id=a.product_id AND v.version_number>=original.version_number

   JOIN version_variants vv ON vv.version_id=v.id AND vv.variant_id=a.variant_id

   LEFT JOIN users u ON u.id=i.creator_id LEFT JOIN categorias c ON c.id=JSON_UNQUOTE(JSON_EXTRACT(v.snapshot,'$.category_id'))

   LEFT JOIN collection_pins pin ON pin.user_id=a.user_id AND pin.product_id=a.product_id

   WHERE a.user_id=? ${productId===null?'':'AND a.product_id=?'} ORDER BY a.product_id,a.variant_id,v.version_number DESC`,productId===null?[req.user.id]:[req.user.id,productId]);



  const lines=rows.filter(l=>parse(l.snapshot).variants?.some(v=>v.id===l.variant_id&&v.available!==false));

  if(productId!==null&&!lines.length)throw fail(409,'The collection resources require an integrity check.');

  return run(sql,lines);

 });

}

function groups(lines){const map=new Map();for(const l of lines){let p=map.get(l.product_id);if(!p){p={id:l.product_id,name:l.product_name,creator:l.creator_name||'Unavailable creator',creator_id:l.creator_id,category:l.category_name||'Other',pinned:Boolean(l.pinned),restricted:Boolean(l.moderation_removed),acquired_at:l.acquired_at,variants:[],preview:null,free:false,paid:false};map.set(l.product_id,p);}if(String(l.acquired_at)>String(p.acquired_at))p.acquired_at=l.acquired_at;p.free ||=Number(l.price_cents)===0;p.paid ||=Number(l.price_cents)>0;

 let variant=p.variants.find(v=>v.id===l.variant_id);if(!variant){variant={id:l.variant_id,name:l.variant_name,acquired_at:l.acquired_at,versions:[]};p.variants.push(variant);}const snapshot=parse(l.snapshot),v=snapshot.variants.find(v=>v.id===l.variant_id),base='/api/account/collection/'+l.product_id+'/versions/'+l.version_id+'/variants/'+encodeURIComponent(l.variant_id);

 variant.versions.push({id:l.version_id,variant_id:l.variant_id,number:l.version_number,acquired:l.version_id===l.acquired_version_id,model_url:base+'/model',texture_url:v.texture_asset_id?base+'/texture':null});

 if(!p.preview||l.version_number>p.preview.number)p.preview=variant.versions.at(-1);

 }return [...map.values()];}

export function installMyCollection(app,pool){

 app.use('/api/account/collection',(req,res,next)=>{res.set('Cache-Control','private, no-store');res.vary('Cookie');next();});

 app.get('/api/account/collection',requireUser,async(req,res)=>access(pool,req,null,async(sql,lines)=>{

  const sort=req.query.sort||'default',payment=req.query.payment||'all',colors=req.query.colors||'all',page=Number(req.query.page||1),q=String(req.query.q||'').trim().toLowerCase();

  if(!['default','newest','oldest','name'].includes(sort)||!['all','free','paid'].includes(payment)||!['all','one','multiple'].includes(colors)||!positive(page)||page>100000||q.length>150||!['0','1',undefined].includes(req.query.pinned))throw fail(400,'Invalid collection filters.');

  const all=groups(lines),categories=[...new Set(all.map(p=>p.category))].sort(),creators=[...new Set(all.map(p=>p.creator))].sort();

  const items=all.filter(p=>(!q||(p.name+' '+p.creator).toLowerCase().includes(q))&&(!req.query.category||p.category===req.query.category)&&(!req.query.creator||p.creator===req.query.creator)&&(payment==='all'||p[payment])&&(colors==='all'||(colors==='one'?p.variants.length===1:p.variants.length>1))&&(req.query.pinned!=='1'||p.pinned));

  const newest=(a,b)=>String(b.acquired_at).localeCompare(String(a.acquired_at))||b.id-a.id;

  items.sort(sort==='name'?(a,b)=>a.name.localeCompare(b.name)||a.id-b.id:sort==='oldest'?(a,b)=>-newest(a,b):sort==='newest'?newest:(a,b)=>Number(b.pinned)-Number(a.pinned)||newest(a,b));

  res.json({items:items.slice((page-1)*10,page*10).map(({variants,...p})=>({...p,variant_count:variants.length,version_count:variants.reduce((n,v)=>n+v.versions.length,0)})),page,pages:Math.max(1,Math.ceil(items.length/10)),total:items.length,categories,creators});

 }));

 app.get('/api/account/collection/:productId',requireUser,async(req,res)=>access(pool,req,Number(req.params.productId),async(sql,lines)=>res.json(groups(lines)[0])));

 app.put('/api/account/collection/:productId/pin',requireUser,async(req,res)=>access(pool,req,Number(req.params.productId),async(sql)=>{

  if(typeof req.body?.pinned!=='boolean')throw fail(400,'Choose a pin state.');if(req.body.pinned)await sql.execute('INSERT IGNORE INTO collection_pins(user_id,product_id) VALUES (?,?)',[req.user.id,Number(req.params.productId)]);else await sql.execute('DELETE FROM collection_pins WHERE user_id=? AND product_id=?',[req.user.id,Number(req.params.productId)]);res.json({pinned:req.body.pinned});

 }));

 app.get('/api/account/collection/:productId/versions/:versionId/variants/:variantId/:resource',requireUser,async(req,res)=>access(pool,req,Number(req.params.productId),async(sql,lines)=>{

  const line=lines.find(l=>l.version_id===Number(req.params.versionId)&&l.variant_id===req.params.variantId);if(!line||!['model','texture'].includes(req.params.resource))throw fail(404,'Resource not found.');

  const {assets}=await ownedResources(sql,req.user.id,line),asset=assets.find(a=>a.kind===(req.params.resource==='model'?'glb':'png'));if(!asset)throw fail(404,'Resource not found.');res.type(asset.kind==='glb'?'model/gltf-binary':'image/png').send(asset.data);

 }));

 app.get('/api/account/collection/:productId/download',requireUser,async(req,res)=>{

  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'altego-collection-download-'));let cancelled=false;req.on('aborted',()=>cancelled=true);res.on('close',()=>cancelled=true);

  try{const files=[],models=new Map(),manifest=[];let signature;

   await access(pool,req,Number(req.params.productId),async(sql,lines)=>{if(lines.some(l=>l.moderation_removed))throw fail(403,'Downloads are unavailable while this item is restricted by moderation.');signature=JSON.stringify(lines.map(l=>[l.variant_id,l.version_id,l.acquired_version_id]));

    for(const line of lines){if(cancelled)throw fail(499,'Download cancelled.');const {assets,variant}=await ownedResources(sql,req.user.id,line),entry={variant_id:line.variant_id,variant:variant.name,version:line.version_number,version_id:line.version_id,acquired:line.acquired_version_id===line.version_id,files:[]};

     for(const asset of assets){let name=asset.kind==='glb'?models.get(asset.sha256):null;if(!name){name=asset.kind==='glb'?'Models/'+asset.sha256+'.glb':'Variants/'+archiveSlug(line.variant_id)+'/v'+line.version_number+'_'+line.version_id+'/'+archiveSlug(variant.name)+'.png';const source=path.join(temp,String(files.length)+'.'+asset.kind);await fs.writeFile(source,asset.data,{flag:'wx'});files.push({source,name});if(asset.kind==='glb')models.set(asset.sha256,name);}entry.files.push({path:name,sha256:asset.sha256});}manifest.push(entry);

    }

   });const source=path.join(temp,'collection.json');await fs.writeFile(source,JSON.stringify({product_id:Number(req.params.productId),versions:manifest},null,2));files.push({source,name:'Collection.json'});const archive=path.join(temp,'collection.zip');await writeOwnedZip(files,archive);

   await access(pool,req,Number(req.params.productId),async(sql,lines)=>{if(lines.some(l=>l.moderation_removed))throw fail(403,'Downloads are unavailable while this item is restricted by moderation.');if(signature!==JSON.stringify(lines.map(l=>[l.variant_id,l.version_id,l.acquired_version_id])))throw fail(409,'Your collection changed. Please download again.');});if(cancelled)return;

   await new Promise((resolve,reject)=>res.download(archive,'ALTEGO_Collection_'+req.params.productId+'.zip',e=>e?reject(e):resolve()));

  }catch(e){if(req.aborted||res.destroyed)return;if(res.headersSent){res.destroy(e);return;}throw e;}finally{const real=await fs.realpath(temp);if(path.dirname(real)!==await fs.realpath(os.tmpdir())||!path.basename(real).startsWith('altego-collection-download-'))throw Error('Unsafe collection cleanup');await fs.rm(real,{recursive:true,force:true});}

 });

}

