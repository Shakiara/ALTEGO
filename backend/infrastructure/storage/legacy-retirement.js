// ALTEGO necesita resolver la retirada controlada de copias Legacy autorizadas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';
import {maintenancePath,legacyQuarantinePath} from './storage-maintenance-paths.js';
import path from 'node:path';
import os from 'node:os';
import mysql from 'mysql2/promise';
import {createHash,randomUUID} from 'node:crypto';
import {storageReferences} from './legacy-storage.js';
import {storageRoot,safeStoragePath,readVerifiedStorageFile,readAssetFile,resolveAssetFile,validAssetId} from './storage-resolver.js';
import {validateSnapshot} from '../../modules/products/history.js';
import {diagnoseStorage} from './storage-cleanup.js';
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const digest=v=>createHash('sha256').update(v).digest('hex');
const stable=v=>JSON.stringify(v,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Date)&&!Buffer.isBuffer(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const fail=message=>Object.assign(new Error(message),{code:'LEGACY_RETIREMENT_CONFLICT'});
export const retirementBatchHash=candidates=>digest(stable(candidates));
const normalize=value=>value.split(path.sep).join('/');
const sourcePattern=/^(originals|previews)\/([a-f0-9-]{36})\.(glb|png)$/;
function identity(relative){const match=typeof relative==='string'&&relative.match(sourcePattern);if(!match||!validAssetId(match[2]))throw fail('Invalid Legacy retirement path.');return {asset_id:match[2],kind:match[3],representation:match[1]==='originals'?'original':'preview'};}
function quarantineRelative(op){if(!validAssetId(op.id))throw fail('Invalid retirement checkpoint.');identity(op.relative_path);return legacyQuarantinePath(op.id,op.relative_path);}
async function exists(relative){try{await fs.lstat(await safeStoragePath(relative));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function optionalRows(sql,table){const [tables]=await sql.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);return tables.length?(await sql.query('SELECT * FROM `'+table+'`'))[0]:[];}
async function currentState(sql){
 const s=await storageReferences(sql);
 const [files]=await sql.query('SELECT * FROM product_files ORDER BY id'),[links]=await sql.query('SELECT * FROM asset_file_links ORDER BY product_id,asset_id,representation');
 const [checkpoints]=await sql.query('SELECT * FROM storage_migrations ORDER BY product_id'),[incorporations]=await sql.query('SELECT * FROM storage_incorporations ORDER BY product_id,asset_id');
 return {...s,files,links,checkpoints,incorporations,cleanup:await optionalRows(sql,'storage_cleanup_operations')};
}
async function sourceContent(relative){
 const file=await safeStoragePath(relative),stat=await fs.lstat(file);if(!stat.isFile()||stat.size>25*1024*1024)throw fail('Unknown or oversized Legacy file.');
 const bytes=await fs.readFile(file),expected={sha256:digest(bytes),byte_size:bytes.length};await readVerifiedStorageFile(relative,expected);return expected;
}
async function verifyNewProduct(sql,s,productId){
 const product=s.products.find(p=>p.id===productId);if(!product)throw fail('A referenced product is missing.');
 for(const asset of s.refs.get(productId).values())for(const role of ['original','preview']){
  const links=s.links.filter(l=>l.asset_id===asset.id&&l.product_id===productId&&l.representation===role);if(links.length!==1)throw fail('A product representation is not completely migrated.');
  const file=s.files.find(f=>f.id===links[0].file_id);if(!file||file.product_id!==productId||file.creator_id!==product.owner_id||file.kind!==asset.kind)throw fail('A product file mapping is inconsistent.');
  const relative=`creators/${product.owner_id}/products/${productId}/assets/${file.kind}/${file.sha256}.${file.kind}`;
  const actual=await resolveAssetFile(sql,asset,role,{productId});if(path.resolve(actual)!==path.resolve(await safeStoragePath(relative)))throw fail('The resolver still depends on Legacy or recovery storage.');
  await readVerifiedStorageFile(relative,file);await readAssetFile(sql,asset,role,{productId});
 }

 for(const v of s.versions.filter(v=>v.product_id===productId))await validateSnapshot(sql,v,productId,true);
}
async function classify(sql,s,relative,{sourceOverride=null,verified=new Map()}={}){
 const entry={path:relative,category:'D',reasons:[]};
 try{
  const id=identity(relative);Object.assign(entry,id);
  const content=await sourceContent(sourceOverride||relative);Object.assign(entry,content);
  const asset=s.assets.find(a=>a.id===id.asset_id);if(!asset||asset.kind!==id.kind)throw fail('Legacy file has no matching asset identity.');
  if(id.representation==='original'&&(asset.sha256!==content.sha256||asset.byte_size!==content.byte_size))throw fail('Legacy original differs from MySQL.');
  const owners=[...s.refs].filter(([,refs])=>refs.has(asset.id)).map(([productId])=>productId).sort((a,b)=>a-b);entry.products=owners;
  const pending=s.incorporations.some(o=>['preparing','prepared'].includes(o.status)&&(o.asset_id===asset.id||Object.values(parse(o.descriptor)).some(f=>owners.includes(o.product_id)&&f.sha256===content.sha256&&f.kind===asset.kind)));
  if(asset.storage_state!=='ready'||pending||s.checkpoints.some(c=>c.state!=='completed'&&(owners.includes(c.product_id)||parse(c.inventory)[asset.id]))){entry.category='C';entry.reasons=['Asset, incorporation or migration pending recovery'];return entry;}
  if(!owners.length){if(asset.sha256!==content.sha256||asset.byte_size!==content.byte_size)throw fail('Unreferenced Legacy representation differs from recorded content.');entry.category='B';entry.reasons=['No persisted references; explicit protection remains in force'];return entry;}
  const replacements=[];
  for(const productId of owners){
   const checkpoint=s.checkpoints.find(c=>c.product_id===productId);
   if(!checkpoint||checkpoint.state!=='completed'||!parse(checkpoint.inventory)[asset.id]){entry.category='C';entry.reasons=['No completed migration checkpoint covering this asset context'];return entry;}
   const recorded=parse(checkpoint.inventory)[asset.id][id.representation];if(!recorded||recorded.sha256!==content.sha256||recorded.byte_size!==content.byte_size)throw fail('Migration checkpoint differs from Legacy content.');
   const link=s.links.find(l=>l.asset_id===asset.id&&l.product_id===productId&&l.representation===id.representation),file=link&&s.files.find(f=>f.id===link.file_id);
   if(!file||file.product_id!==productId||file.kind!==asset.kind||file.sha256!==content.sha256||file.byte_size!==content.byte_size)throw fail('Equivalent replacement cannot be demonstrated.');
   const product=s.products.find(p=>p.id===productId);if(file.creator_id!==product.owner_id)throw fail('Replacement creator differs.');
   const replacement=`creators/${product.owner_id}/products/${productId}/assets/${file.kind}/${file.sha256}.${file.kind}`;
   if(s.cleanup.some(o=>o.state!=='restored'&&parse(o.descriptor).relative_path===replacement)){entry.category='C';entry.reasons=['Replacement has a pending cleanup/recovery operation'];return entry;}
   if(!verified.has(productId))verified.set(productId,verifyNewProduct(sql,s,productId).then(()=>null,e=>e));const error=await verified.get(productId);if(error)throw error;
   replacements.push({product_id:productId,path:replacement,sha256:file.sha256,byte_size:file.byte_size});
  }
  entry.category='A';entry.reasons=['Equivalent canonical content and all persisted references verified'];entry.replacements=replacements;
  entry.proof=digest(stable({asset,products:s.products.filter(p=>owners.includes(p.id)),variants:s.variants.filter(v=>owners.includes(v.product_id)),versions:s.versions.filter(v=>owners.includes(v.product_id)),links:s.links.filter(l=>l.asset_id===asset.id),checkpoints:s.checkpoints.filter(c=>owners.includes(c.product_id))}));
 }catch(error){entry.category='D';entry.reasons=[error.code||error.message];entry.detail=error.message;}
 return entry;
}

export async function inventoryLegacyRetirement(sql){
 const s=await currentState(sql),files=[],verified=new Map(),directoryErrors=[];
 for(const directory of ['originals','previews']){
  try{
   const probe=await safeStoragePath(path.join(directory,'__inventory_probe__'));
   for(const file of (await fs.readdir(path.dirname(probe))).sort())files.push(await classify(sql,s,normalize(path.join(directory,file)),{verified}));
  }catch(error){directoryErrors.push({directory,error:error.code||error.message});}
 }
 const [[database]]=await sql.query('SELECT DATABASE() AS name');
 const candidates=files.filter(f=>f.category==='A');
 const temporaryFiles=(await diagnoseStorage(sql)).filter(f=>f.path.startsWith('temporary/'));
 return {format_version:1,observed_at:new Date().toISOString(),database:database.name,storage_root:await fs.realpath(storageRoot),
  counts:Object.fromEntries(['A','B','C','D'].map(c=>[c,files.filter(f=>f.category===c).length])),legacy_files:files.length,
  logical_resources:new Set(files.map(f=>f.asset_id).filter(Boolean)).size,referenced_resources:new Set(candidates.map(f=>f.asset_id)).size,
  snapshots:s.versions.length,checkpoints:s.checkpoints.map(c=>({product_id:c.product_id,state:c.state,last_error:c.last_error})),
  temporary_assets:s.assets.filter(a=>a.storage_layout==='temporary').length,temporary_files:temporaryFiles,pending_incorporations:s.incorporations.filter(o=>['preparing','prepared'].includes(o.status)).length,
  pending_cleanup:s.cleanup.filter(o=>o.state!=='restored').length,directory_errors:directoryErrors,files,candidates,
  batch_hash:digest(stable(candidates))};
}

export async function verifyLegacyBackup(backup,candidates=[]){
 const root=path.resolve(backup),manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json')));
 if(!manifest.files?.['mysql.json'])throw fail('A verified MySQL and Storage backup is required.');
 let checked=0;
 for(const [name,expected]of Object.entries(manifest.files)){
  const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw fail('Unsafe backup manifest path.');
  if(digest(await fs.readFile(file))!==expected)throw fail('Backup checksum differs.');checked++;
 }
 const tables=JSON.parse(await fs.readFile(path.join(root,'mysql.json'))),assets=tables.find(t=>t.name==='assets')?.rows;
 if(!assets||!tables.some(t=>t.name==='product_versions'))throw fail('The backup has no asset or version records.');
 for(const candidate of candidates){identity(candidate.path);if(!assets.some(a=>a.id===candidate.asset_id)||manifest.files['source/storage/'+candidate.path]!==candidate.sha256)throw fail('The backup does not cover a retirement candidate.');}
 return {path:root,verified_files:checked,mysql_tables:tables.length,legacy_files:Object.keys(manifest.files).filter(n=>/^source\/storage\/(originals|previews)\//.test(n)).length,candidates_covered:candidates.length};
}


export async function assertRetirementRehearsal(sql){
 const [[db]]=await sql.query('SELECT DATABASE() AS name');const root=await fs.realpath(storageRoot),temp=await fs.realpath(os.tmpdir());
 if(!/^altego_auth_test_legacyretirement_\d+$/.test(db.name)||!root.startsWith(temp+path.sep)||!path.basename(root).startsWith('altego-legacy-retirement-test-'))throw fail('Legacy retirement is enabled only in an isolated rehearsal.');
}

const approvedIdentityHash='52ddc5dc73d277aa0e50633405731102b4884f5b4bcda19c34d5cde9990a159e';
const approvedIdentity=f=>({path:f.path,asset_id:f.asset_id,kind:f.kind,representation:f.representation,sha256:f.sha256,byte_size:f.byte_size});
export async function assertApprovedLegacyRetirement(sql,manifest,authorization){
 if(authorization?.scope!=='ALTEGO_PHASE_5EC_28_LEGACY_FILES'||authorization.allowlist_hash!==approvedIdentityHash||!Array.isArray(authorization.files))throw fail('Explicit 5E-C authorization is required.');
 const authorized=authorization.files.map(approvedIdentity).sort((a,b)=>a.path.localeCompare(b.path));
 const selected=manifest.candidates.map(approvedIdentity).sort((a,b)=>a.path.localeCompare(b.path));
 if(authorized.length!==28||new Set(authorized.map(f=>f.path)).size!==28||digest(JSON.stringify(authorized))!==approvedIdentityHash||JSON.stringify(selected)!==JSON.stringify(authorized))throw fail('The approved list of 28 files cannot be expanded or substituted.');
 const [[db]]=await sql.query('SELECT DATABASE() AS name');
 if(db.name!==authorization.database||manifest.database!==db.name||await fs.realpath(storageRoot)!==authorization.storage_root||manifest.storage_root!==authorization.storage_root)throw fail('Approved retirement belongs to another environment.');
}

async function independent(sql){const c=sql.connection?.config;if(!c)throw fail('Retirement journal connection unavailable.');return mysql.createConnection(Object.fromEntries(['host','port','user','password','database','socketPath','ssl','timezone','decimalNumbers'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]])));}
async function restoreBytes(op){
 const e=parse(op.descriptor),source=op.relative_path,target=quarantineRelative(op);identity(source);
 if(await exists(source)){await readVerifiedStorageFile(source,e);return;}
 await readVerifiedStorageFile(target,e);

 try{await fs.link(await safeStoragePath(target),await safeStoragePath(source,{createParents:true}));}catch(error){if(error.code!=='EEXIST')throw error;}
 await readVerifiedStorageFile(source,e);
}

export async function retireLegacyRehearsal(pool,manifest,{backup,onStage=async()=>{},authorization=null}={}){
 const guard=await pool.getConnection(),held=[],result={quarantined:[],already_quarantined:[],already_purged:[]};let operation=null;
 try{
  if(authorization)await assertApprovedLegacyRetirement(guard,manifest,authorization);else await assertRetirementRehearsal(guard);
  if(manifest.format_version!==1||manifest.directory_errors?.length||manifest.batch_hash!==digest(stable(manifest.candidates)))throw fail('Invalid retirement manifest.');
  const [[db]]=await guard.query('SELECT DATABASE() AS name');if(db.name!==manifest.database||await fs.realpath(storageRoot)!==manifest.storage_root)throw fail('Retirement manifest belongs to another environment.');
  await verifyLegacyBackup(backup,manifest.candidates);
  for(const name of ['altego_legacy_retirement','altego_legacy_storage_migration','altego_storage_cleanup']){const [[lock]]=await guard.execute('SELECT GET_LOCK(?,0) AS acquired',[name]);if(lock.acquired!==1)throw fail('An incompatible storage operation is running.');held.push(name);}
  if(authorization){

   const state=await currentState(guard),verified=new Map();
   for(const expected of manifest.candidates){
    const [[prior]]=await guard.execute("SELECT * FROM legacy_retirement_operations WHERE batch_hash=? AND relative_path=? AND state<>'restored' ORDER BY created_at DESC,id DESC LIMIT 1",[manifest.batch_hash,expected.path]);
    if(prior?.state==='purged'){await verifyRetiredLegacyForPurge(guard,prior);continue;}
    if(prior?.state==='purge_planned')throw fail('Resume the pending purge before retirement.');
    const sourceOverride=!await exists(expected.path)&&prior?quarantineRelative(prior):null;
    const actual=await classify(guard,state,expected.path,{sourceOverride,verified});
    if(actual.category!=='A'||actual.proof!==expected.proof||actual.sha256!==expected.sha256||actual.byte_size!==expected.byte_size)throw fail('Approved preflight failed; no additional files were moved.');
   }
  }
  for(const expected of manifest.candidates){
   if(expected.category!=='A')throw fail('Only explicitly verified category A files may be rehearsed.');identity(expected.path);
   const sql=await pool.getConnection();operation=null;
   try{
    await sql.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await sql.beginTransaction();
    const before=await currentState(sql),owners=[...before.refs].filter(([,r])=>r.has(expected.asset_id)).map(([id])=>id).sort((a,b)=>a-b);
    for(const id of owners)await sql.execute('SELECT id FROM productos WHERE id=? FOR UPDATE',[id]);
    await sql.execute('SELECT id FROM assets WHERE id=? FOR UPDATE',[expected.asset_id]);
    const s=await currentState(sql),[[prior]]=await sql.execute("SELECT * FROM legacy_retirement_operations WHERE batch_hash=? AND relative_path=? AND state<>'restored' ORDER BY created_at DESC,id DESC LIMIT 1",[manifest.batch_hash,expected.path]);operation=prior||null;
    if(operation?.state==='purged'){await verifyRetiredLegacyForPurge(sql,operation);await sql.commit();result.already_purged.push(expected.path);continue;}
    if(operation?.state==='purge_planned')throw fail('Resume the pending purge before retirement.');
    const alternative=!await exists(expected.path)&&operation?quarantineRelative(operation):null;
    const actual=await classify(sql,s,expected.path,{sourceOverride:alternative});
    if(actual.category!=='A'||actual.proof!==expected.proof||actual.sha256!==expected.sha256||actual.byte_size!==expected.byte_size||stable(actual.products)!==stable(owners))throw fail('Candidate changed, remains necessary or failed integrity verification.');
    await onStage('locked',expected);
    if(operation?.state==='quarantined'){if(await exists(expected.path))throw fail('Legacy original reappeared; explicit recovery is required.');await readVerifiedStorageFile(quarantineRelative(operation),expected);await sql.commit();result.already_quarantined.push(expected.path);continue;}
    if(!operation){operation={id:randomUUID(),batch_hash:manifest.batch_hash,relative_path:expected.path,descriptor:expected,state:'planned'};operation.descriptor={...expected,quarantine_path:quarantineRelative(operation)};
     const journal=await independent(sql);try{await journal.execute("INSERT INTO legacy_retirement_operations(id,batch_hash,relative_path,descriptor,state) VALUES (?,?,?,?,'planned')",[operation.id,manifest.batch_hash,expected.path,JSON.stringify(operation.descriptor)]);}finally{await journal.end();}
    }
    await onStage('planned',expected);
    const target=quarantineRelative(operation);
    if(await exists(expected.path)){
     await readVerifiedStorageFile(expected.path,expected);if(await exists(target))throw fail('Both Legacy locations exist; explicit recovery is required.');
     await fs.rename(await safeStoragePath(expected.path),await safeStoragePath(target,{createParents:true}));
    }
    await onStage('moved',expected);await readVerifiedStorageFile(target,expected);
    const after=await classify(sql,await currentState(sql),expected.path,{sourceOverride:target});if(after.category!=='A'||after.proof!==expected.proof)throw fail('Post-retirement verification failed.');
    await onStage('verified',expected);
    await sql.execute("UPDATE legacy_retirement_operations SET state='quarantined',last_error=NULL,quarantined_at=COALESCE(quarantined_at,UTC_TIMESTAMP(6)),descriptor=JSON_SET(descriptor,'$.verified_at',DATE_FORMAT(UTC_TIMESTAMP(6),'%Y-%m-%dT%H:%i:%s.%fZ')) WHERE id=?",[operation.id]);await onStage('before_commit',expected);await sql.commit();result.quarantined.push(expected.path);
   }catch(error){
    let restored=false,recoveryError=null;

    if(operation&&!['purged','purge_planned'].includes(operation.state)&&error.code!=='SIMULATED_INTERRUPTION')try{await restoreBytes(operation);restored=true;}catch(e){recoveryError=e;}
    await sql.rollback();
    if(operation)await guard.execute('UPDATE legacy_retirement_operations SET state=IF(?,\'restored\',state),last_error=? WHERE id=?',[restored,String(recoveryError?.code||error.code||error.message).slice(0,500),operation.id]);
    error.retirementResult=result;if(recoveryError)error.recoveryError=recoveryError.message;throw error;
   }finally{sql.release();}
  }
  return result;
 }finally{for(const name of held.reverse())await guard.execute('SELECT RELEASE_LOCK(?)',[name]).catch(()=>{});guard.release();}
}

export async function restoreLegacyRehearsal(pool,batchHash,{authorization=null}={}){
 const guard=await pool.getConnection();let held=false;
 try{
  if(authorization)await assertApprovedLegacyRetirement(guard,{database:authorization.database,storage_root:authorization.storage_root,candidates:authorization.files},authorization);else await assertRetirementRehearsal(guard);const [[lock]]=await guard.query("SELECT GET_LOCK('altego_legacy_retirement',0) AS acquired");if(lock.acquired!==1)throw fail('Legacy retirement is busy.');held=true;
  if(!/^[a-f0-9]{64}$/.test(batchHash))throw fail('Invalid retirement batch.');
  const [operations]=await guard.execute("SELECT * FROM legacy_retirement_operations WHERE batch_hash=? AND state<>'restored' ORDER BY created_at,id",[batchHash]);
  if(operations.some(op=>['purged','purge_planned'].includes(op.state)))throw fail('This batch contains a purge intent or permanently purged bytes. Reconcile the purge or use a verified backup.');
  for(const op of operations){const sql=await pool.getConnection();try{await sql.beginTransaction();for(const id of parse(op.descriptor).products)await sql.execute('SELECT id FROM productos WHERE id=? FOR UPDATE',[id]);await sql.execute('SELECT id FROM assets WHERE id=? FOR UPDATE',[parse(op.descriptor).asset_id]);await restoreBytes(op);await sql.execute("UPDATE legacy_retirement_operations SET state='restored',last_error=NULL WHERE id=?",[op.id]);await sql.commit();}catch(error){await sql.rollback();throw error;}finally{sql.release();}}
  return {restored:operations.map(o=>o.relative_path)};
 }finally{if(held)await guard.query("SELECT RELEASE_LOCK('altego_legacy_retirement')").catch(()=>{});guard.release();}
}


export async function retireApprovedLegacy(pool,manifest,options){if(!options?.authorization)throw fail('Explicit authorization is required.');return retireLegacyRehearsal(pool,manifest,options);}


export async function verifyRetiredLegacyForPurge(sql,op,{verifiedProducts=null}={}){
 const d=parse(op.descriptor);if(!validAssetId(op.id)||!['quarantined','purge_planned','purged'].includes(op.state))throw fail('Legacy operation is not a completed retirement.');
 const id=identity(op.relative_path);if(id.asset_id!==d.asset_id||id.representation!==d.representation||id.kind!==d.kind||normalize(quarantineRelative(op))!==maintenancePath(d.quarantine_path))throw fail('Legacy retirement identity differs.');
 const s=await currentState(sql),asset=s.assets.find(a=>a.id===id.asset_id),owners=[...s.refs].filter(([,r])=>r.has(id.asset_id)).map(([p])=>p);
 if(!asset||!owners.length||asset.storage_layout!=='product'||asset.storage_state!=='ready')throw fail('Legacy replacement identity or persistent references are unavailable.');
 for(const productId of owners){
  const checkpoint=s.checkpoints.find(c=>c.product_id===productId&&c.state==='completed'),file=checkpoint&&parse(checkpoint.inventory)[id.asset_id]?.[id.representation];if(!file||file.sha256!==d.sha256||file.byte_size!==d.byte_size)throw fail('Legacy replacement differs from the completed migration.');
  if(s.incorporations.some(o=>o.product_id===productId&&['preparing','prepared'].includes(o.status)))throw fail('An incomplete incorporation protects the Legacy context.');

  if(!verifiedProducts?.has(productId)){await verifyNewProduct(sql,s,productId);verifiedProducts?.add(productId);}
  const actual=await resolveAssetFile(sql,asset,id.representation,{productId}),data=await readAssetFile(sql,asset,id.representation,{productId});
  if(!normalize(path.relative(storageRoot,actual)).startsWith('creators/')||digest(data)!==d.sha256||data.length!==d.byte_size)throw fail('Canonical replacement is not equivalent to the retired file.');
 }
 return {products:owners,sha256:d.sha256,byte_size:d.byte_size};
}
