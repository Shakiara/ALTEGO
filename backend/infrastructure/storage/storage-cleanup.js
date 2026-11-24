// ALTEGO necesita resolver la retención, cuarentena y recuperación de archivos de Storage.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {productStorageDirectory,productStorageFile} from './product-layout.js';
import {creatorStorageEnabled,creatorRoot,creatorIdFromRoot,ownerFromStoragePath,profileUploadPath} from './storage-identity.js';
import fs from 'node:fs/promises';
import {maintenancePath,legacyQuarantinePath,ordinaryQuarantinePath} from './storage-maintenance-paths.js';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';
import {storageRoot,safeStoragePath,readVerifiedStorageFile,assetLocation,validAssetId} from './storage-resolver.js';
import {storageReferences} from './storage-references.js';
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const key=relative=>createHash('sha256').update(relative.replaceAll('\\','/')).digest('hex');
const fail=message=>Object.assign(new Error(message),{code:'STORAGE_CLEANUP_CONFLICT'});
const normalize=p=>p.split(path.sep).join('/');
const canonical=/^(?:creators\/)?([a-z0-9_]+)\/(?:products\/|[a-z0-9-]+--p)([1-9]\d*)\/(?:assets\/|versions\/v[1-9]\d*\/)(glb|png)\/([a-f0-9]{64})\.(glb|png)$/;
const temporary=/^(?:temporary\/)?([a-z0-9_]+)\/(?:uploads\/pending\/)?([a-f0-9-]{36})\/(original|preview)\.(glb|png)$/;

async function backupRoot(){
 let current=path.resolve(storageRoot);
 while(true){
  if(/^(?:backup|backups|altego-backups|migration-backups)$/i.test(path.basename(current)))return true;

  try{const manifest=JSON.parse(await fs.readFile(path.join(current,'manifest.json'),'utf8'));if(manifest.files?.['mysql.json'])return true;}catch(e){if(!['ENOENT','EISDIR'].includes(e.code)&&!(e instanceof SyntaxError))throw e;}
  const parent=path.dirname(current);if(parent===current)return false;current=parent;
 }
}


function permitted(entry){
 const r=normalize(entry.relative_path),c=r.match(canonical),u=r.match(temporary);
 if(entry.artifact_type==='staging')return validStaging(entry);
 return !!(c&&Number(c[2])===entry.product_id&&c[3]===entry.kind&&c[4]===entry.sha256&&c[5]===entry.kind||u&&validAssetId(u[2])&&u[2]===entry.asset_id&&u[4]===entry.kind);
}
const quarantineRelative=op=>{if(!validAssetId(op.id)||!/^[a-f0-9]{64}$/.test(op.file_key))throw fail('Invalid cleanup checkpoint.');const d=parse(op.descriptor);return ordinaryQuarantinePath(op.id,op.file_key,ownerFromStoragePath(d.relative_path));};
async function exists(relative){try{const p=await safeStoragePath(relative);await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}

async function state(sql){
 const refs=await storageReferences(sql);
 const [profileMedia]=await sql.query('SELECT * FROM profile_media');const conversationMedia=creatorStorageEnabled()?(await sql.query('SELECT storage_path,storage_sha256 FROM conversation_post_images WHERE storage_path IS NOT NULL'))[0]:[];
 const [files]=await sql.query('SELECT * FROM product_files');const [links]=await sql.query('SELECT * FROM asset_file_links');
 const [incorporations]=await sql.query('SELECT * FROM storage_incorporations');const pending=incorporations.filter(o=>['preparing','prepared'].includes(o.status));
 const [migrations]=await sql.query("SELECT * FROM storage_migrations WHERE state<>'completed'");
 const [life]=await sql.query("SELECT *,DATE_FORMAT(unreferenced_since,'%Y-%m-%dT%H:%i:%s.%fZ') AS since_utc,DATE_FORMAT(DATE_ADD(unreferenced_since,INTERVAL 30 DAY),'%Y-%m-%dT%H:%i:%s.%fZ') AS quarantine_eligible_at, GREATEST(0,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(6),DATE_ADD(unreferenced_since,INTERVAL 30 DAY))) AS remaining_seconds,NOT loss_pending AND unreferenced_since<=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 30 DAY) AS eligible FROM storage_file_lifecycle");
 const [operations]=await sql.query("SELECT *,DATE_FORMAT(quarantined_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS quarantined_utc,DATE_FORMAT(DATE_ADD(quarantined_at,INTERVAL 30 DAY),'%Y-%m-%dT%H:%i:%s.%fZ') AS purge_eligible_at,quarantined_at<=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 30 DAY) AS purge_due FROM storage_cleanup_operations ORDER BY updated_at,id");
 const [legacy]=await sql.query("SELECT *,DATE_FORMAT(quarantined_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS quarantined_utc,DATE_FORMAT(DATE_ADD(quarantined_at,INTERVAL 30 DAY),'%Y-%m-%dT%H:%i:%s.%fZ') AS purge_eligible_at,quarantined_at<=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 30 DAY) AS purge_due FROM legacy_retirement_operations ORDER BY id");
 return {profileMedia,conversationMedia,...refs,files,links,pending,incorporations,migrations,life,operations,legacy};
}

function reasons(entry,s){
 const result=[];if(entry.protected_reason)return [entry.protected_reason];if(!permitted(entry))return ['Protected path: Legacy, backup, index or unmanaged file'];
 if(entry.artifact_type==='staging'&&entry.artifact_state!=='abandoned')result.push('Staging operation must be reconciled or explicitly abandoned');
 const p=s.products.find(p=>p.id===entry.product_id),a=s.assets.find(a=>a.id===entry.asset_id);
 if(entry.artifact_type==='staging'&&(!p||!normalize(entry.relative_path).startsWith(productStorageDirectory(p).replaceAll('\\','/')+'/')))result.push('Staging product ownership differs');
 if(entry.product_id&&normalize(entry.relative_path).match(canonical)){
  const c=normalize(entry.relative_path).match(canonical);if(c&&(!p||p.owner_id!==creatorIdFromRoot(c[1])||!normalize(entry.relative_path).startsWith(normalize(productStorageDirectory(p))+'/')))result.push('Product owner or storage context differs');
  const ids=s.links.filter(l=>s.files.some(f=>f.id===l.file_id&&f.product_id===entry.product_id&&f.kind===entry.kind&&f.sha256===entry.sha256)).map(l=>l.asset_id);
  if(ids.some(id=>s.refs.get(entry.product_id)?.has(id)))result.push('Draft, active/inactive variant or published snapshot reference');

  if([...s.refs.get(entry.product_id)?.values()||[]].some(a=>a.kind===entry.kind&&a.sha256===entry.sha256))result.push('Persisted logical asset reference');
  if(s.migrations.some(m=>m.product_id===entry.product_id))result.push('Legacy migration pending recovery');
 }
 if(entry.asset_id){
  if(!a)result.push('Upload metadata unavailable');
  else{
   if(a.storage_state!=='ready'&&!(a.storage_state==='abandoned'&&a.abandoned_at&&a.abandoned_artifacts))result.push('Upload pending, failed or unknown: recovery required');
   if(a.storage_layout==='legacy'||a.retention_protected)result.push('Protected upload requires independent authorization');
   if(a.storage_layout==='temporary'&&[...s.refs.values()].some(r=>r.has(a.id)))result.push('Persisted upload reference');
  }
 }
 for(const op of s.pending){
  const d=parse(op.descriptor);
  if(op.asset_id===entry.asset_id||op.product_id===entry.product_id&&Object.values(d).some(f=>f.kind===entry.kind&&f.sha256===entry.sha256))result.push('Incorporation pending recovery');
 }
 return [...new Set(result)];
}

async function entries(s,{scan=false,productId=null,assetId=null}={}){
 const all=new Map();
 const add=entry=>{entry.relative_path=normalize(entry.relative_path);entry.file_key=key(entry.relative_path);all.set(entry.file_key,entry);};
 for(const f of s.files)if(assetId==null&&(productId==null||f.product_id===productId))add({relative_path:productStorageFile({id:f.product_id,owner_id:f.creator_id},f),product_id:f.product_id,asset_id:null,kind:f.kind,sha256:f.sha256,byte_size:f.byte_size});
 for(const a of s.assets)if(a.storage_layout!=='legacy'&&(assetId==null||a.id===assetId)&&(productId==null||a.product_id===productId))for(const role of ['original','preview']){
  const relative=assetLocation({...a,storage_layout:'temporary',product_id:null},role);
  const op=s.operations.find(o=>o.file_key===key(relative)&&['planned','quarantined','purge_planned'].includes(o.state));
  const artifact=a.storage_state==='abandoned'?parse(a.abandoned_artifacts||{})[role]:null;
  const entry={relative_path:relative,product_id:a.product_id,asset_id:a.id,kind:a.kind,sha256:artifact?.sha256||a.sha256,byte_size:artifact?.byte_size??a.byte_size};
  try{if(await exists(relative)||op)add(entry);}catch(error){if(error.status!==409)throw error;add({...entry,protected_reason:'Unsafe storage link: manual verification required'});}
 }
 for(const media of s.profileMedia||[])for(const role of ['original','display'])add({relative_path:profileUploadPath(media.owner_id,media.id,role==='original'?'original.'+media.extension:'display.webp'),kind:role==='original'?media.extension:'webp',sha256:role==='original'?media.original_sha256:media.display_sha256,byte_size:role==='original'?media.original_size:media.display_size,protected_reason:'Registered creator profile media'});
 for(const media of s.conversationMedia||[]){let size=null;try{size=(await fs.stat(await safeStoragePath(media.storage_path))).size;}catch(error){if(error.code!=='ENOENT')throw error;}add({relative_path:media.storage_path,kind:'webp',sha256:media.storage_sha256,byte_size:size,protected_reason:'Referenced conversation image'});}
 for(const row of s.life)if(!all.has(row.file_key)&&(assetId==null||row.asset_id===assetId)&&(productId==null||row.product_id===productId)){
  if(row.artifact_type==='staging'&&row.artifact_state==='completed'&&!await exists(row.relative_path))continue;
  add(row);
 }
 if(scan){
  async function walk(relative=''){
   const rootStat=await fs.lstat(storageRoot);if(rootStat.isSymbolicLink()||!rootStat.isDirectory())throw fail('Unsafe storage root.');
   const directory=relative?await safeDirectory(relative):storageRoot;
   for(const e of await fs.readdir(directory,{withFileTypes:true})){
    const child=relative?path.join(relative,e.name):e.name;

    if(e.isSymbolicLink()){add({relative_path:child,protected_reason:'Unsafe symbolic link'});continue;}
    if(e.isDirectory())await walk(child);
    else if(!all.has(key(child))){const c=normalize(child).match(canonical),p=c&&s.products.find(p=>p.id===Number(c[2])&&p.owner_id===creatorIdFromRoot(c[1]));
     if(c&&p&&c[3]===c[5]){const data=await fs.readFile(await safeStoragePath(child));const sha256=createHash('sha256').update(data).digest('hex');const claim=s.incorporations.find(o=>o.product_id===p.id&&o.creator_id===p.owner_id&&['preparing','prepared','abandoned'].includes(o.status)&&Object.values(parse(o.descriptor)).some(d=>d.kind===c[3]&&d.sha256===sha256&&d.byte_size===data.length));
      if(sha256!==c[4]||!claim)add({relative_path:child,protected_reason:'Unknown or inconsistent canonical file without a trusted operation'});
      else add({relative_path:child,product_id:p.id,asset_id:null,kind:c[3],sha256,byte_size:data.length});}
     else add({relative_path:child,protected_reason:'Protected path: Legacy, backup, index or unmanaged file'});
    }
   }
  }
  await walk();
 }
 return [...all.values()];
}


async function safeDirectory(relative){
 if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'||p.includes(':')))throw fail('Unsafe storage directory.');
 let current=path.resolve(storageRoot);const root=await fs.realpath(current);
 for(const part of relative.split(/[\\/]/)){current=path.join(current,part);const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory()||!(await fs.realpath(current)).startsWith(root+path.sep))throw fail('Unsafe storage directory.');}
 return current;
}

export async function diagnoseStorage(sql){
 const s=await state(sql),list=await entries(s,{scan:true});
 const protectedRoot=await backupRoot();
 const items=await Promise.all(list.map(async e=>{const row=s.life.find(l=>l.file_key===e.file_key),protection=protectedRoot?['Backup storage root protected']:e.protected_reason?[e.protected_reason]:reasons(e,s),op=s.operations.find(o=>o.file_key===e.file_key&&['planned','quarantined','purge_planned'].includes(o.state));
  let present=false;try{present=await exists(e.relative_path);}catch{protection.push('Unsafe or inaccessible file');}
  let classification=e.protected_reason==='Registered creator profile media'||e.protected_reason==='Referenced conversation image'||/^[a-z0-9_]+\/creator-info\.md$/.test(e.relative_path)?'A':'F';if(e.artifact_type==='staging')classification=e.artifact_state==='abandoned'?'C':'E';
  else if(canonical.test(e.relative_path)&&!e.protected_reason)classification=protection.some(p=>p.includes('reference'))?'A':'C';
  else if(temporary.test(e.relative_path)){const a=s.assets.find(a=>a.id===e.asset_id);classification=a?.storage_state==='pending'||a?.storage_state==='failed'?'E':a?.storage_layout==='temporary'&&a?.storage_state==='ready'?'D':'C';}
  else if(/^maintenance\/legacy\/(originals|previews)\/[a-f0-9-]{36}\.(glb|png)$/.test(e.relative_path))classification='C';
  else if(/^(?:creators\/)?[a-z0-9_]+\/(?:products\/\d+|[a-z0-9-]+--p[1-9]\d*)\/(metadata\.json|draft\/index\.json|versions\/(index|v\d+)\.json)$/.test(e.relative_path))classification='A';
  let observedHash=null,observedSize=null,integrity='unavailable';
  if(present)try{const file=await safeStoragePath(e.relative_path),stat=await fs.lstat(file);observedSize=stat.size;if(stat.size<=25*1024*1024){const bytes=await fs.readFile(file);observedHash=createHash('sha256').update(bytes).digest('hex');integrity=e.sha256?(observedHash===e.sha256&&bytes.length===e.byte_size?'verified':'mismatch'):'observed';
    if(integrity==='mismatch'){protection.push('Observed bytes differ from recorded metadata');if(classification==='E')integrity='incomplete_preparation';else classification='F';}
    if(classification==='A'&&e.relative_path.endsWith('.json')){try{if(JSON.parse(bytes).source!=='mysql')throw Error();}catch{classification='F';integrity='invalid_index';protection.push('Unknown or invalid derived index');}}
   }else{integrity='size_limit';protection.push('Oversized file requires manual inspection');classification='F';}
  }catch{classification='F';protection.push('File could not be verified safely');}
  return {path:e.relative_path,record_type:'file',physical_present:present,classification,sha256:e.sha256??observedHash,observed_sha256:observedHash,byte_size:observedSize??e.byte_size??null,integrity,artifact_type:e.artifact_type||null,artifact_state:e.artifact_state||null,product_id:e.product_id??null,asset_id:e.asset_id??null,protection,
   unreferenced_since:protection.length?null:row?.since_utc??null,remaining_seconds:protection.length?null:row?.remaining_seconds??null,
   quarantine_eligible_at:protection.length?null:row?.quarantine_eligible_at??null,
   status:protection.length?'protected':op?(op.state==='planned'?'cleanup_pending':op.state==='purge_planned'?'purge_pending':'quarantined'):row?.loss_pending?'pending_confirmation':!row?.unreferenced_since?'untracked':row.eligible?'eligible':'waiting',operation_id:op?.id??null};
 }));

 for(const [kind,ops]of [['ordinary',s.operations],['legacy',s.legacy]])for(const op of ops){
  let location,present;try{location=operationLocation(kind,op);present=await exists(location);}catch{items.push({record_type:'quarantine_operation',scope:kind,operation_id:op.id,status:'inconsistent',classification:'F',physical_present:false,protection:['Unknown or unsafe quarantine descriptor']});continue;}
  const prior=items.findIndex(i=>normalize(i.path)===normalize(location));
  const d=parse(op.descriptor);let status=op.state,protection=[];
  if(present)try{await readVerifiedStorageFile(location,d);}catch(error){status='inconsistent';protection.push('Quarantine integrity or path check failed');}
  if(op.state==='purged'&&present){status='inconsistent';protection.push('Unexpected bytes after a completed purge');}
  if(!op.quarantined_at&&op.state!=='restored'&&op.state!=='purged')protection.push('Confirmed quarantine entry date unavailable');
  const record={path:normalize(location),record_type:'quarantine_operation',scope:kind,operation_id:op.id,original_path:kind==='legacy'?op.relative_path:d.relative_path,physical_present:present,status,classification:status==='inconsistent'?'F':op.state==='planned'?'E':kind==='legacy'?'B':'C',sha256:d.sha256,byte_size:d.byte_size,integrity:present&&status!=='inconsistent'?'verified':status==='inconsistent'?'failed':'unavailable',quarantined_at:op.quarantined_utc,purge_eligible_at:op.purge_eligible_at,purge_due:!!op.purge_due,eligibility_requires_final_check:true,protection,purge_intent:op.state==='purge_planned',purged:op.state==='purged'};
  if(prior>=0)items[prior]=record;else if(present||['planned','quarantined','purge_planned','purged'].includes(op.state))items.push(record);
 }
 return items;
}


async function journalConnection(sql){
 const c=sql.connection?.config;if(!c)throw fail('Cleanup journal connection unavailable.');
 return mysql.createConnection(Object.fromEntries(['host','port','user','password','database','socketPath','ssl','timezone','decimalNumbers'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]])));
}

async function restoreEntry(sql,e,s){
 if(s.operations.some(o=>o.file_key===e.file_key&&o.state==='purge_planned'))throw fail('An interrupted purge must be reconciled before reuse.');
 const operations=s.operations.filter(o=>o.file_key===e.file_key&&['planned','quarantined'].includes(o.state));if(!operations.length)return;
 if(await backupRoot())throw fail('Backup storage roots are protected.');
 for(const op of operations){
  const target=quarantineRelative(op);
  if(await exists(target)){
   await readVerifiedStorageFile(target,e);
   if(!await exists(e.relative_path))await fs.rename(await safeStoragePath(target),await safeStoragePath(e.relative_path,{createParents:true}));
   else await readVerifiedStorageFile(e.relative_path,e);
  }else await readVerifiedStorageFile(e.relative_path,e);
  await sql.execute("UPDATE storage_cleanup_operations SET state='restored',last_error=NULL WHERE id=?",[op.id]);
 }
}

async function trackEntries(sql,list,s,{pending=false}={}){
 for(const e of list){if(!permitted(e))continue;
  const protection=reasons(e,s);if(protection.length)await restoreEntry(sql,e,s);
  const previous=s.life.find(l=>l.file_key===e.file_key);
  const deferred=pending&&!protection.length&&(!previous?.unreferenced_since||previous.loss_pending);
  const clear=protection.length||deferred;
  await sql.execute(`INSERT INTO storage_file_lifecycle(file_key,relative_path,product_id,asset_id,kind,sha256,byte_size,unreferenced_since,loss_pending)
   VALUES (?,?,?,?,?,?,?,IF(?,NULL,UTC_TIMESTAMP(6)),?) ON DUPLICATE KEY UPDATE unreferenced_since=IF(?,NULL,COALESCE(unreferenced_since,UTC_TIMESTAMP(6))),loss_pending=VALUES(loss_pending),product_id=VALUES(product_id),sha256=VALUES(sha256),byte_size=VALUES(byte_size)`,[e.file_key,e.relative_path,e.product_id??null,e.asset_id??null,e.kind,e.sha256,e.byte_size,clear,deferred?1:0,clear]);
 }
}


export async function trackProductFiles(sql,productId,{pending=true}={}){
 const s=await state(sql),list=await entries(s,{productId});

 await trackEntries(sql,list,s,{pending});
}

export async function confirmProductRetention(sql,productId){return trackProductFiles(sql,productId,{pending:false});}

export async function trackUploadFiles(sql,assetId){
 const s=await state(sql),list=await entries(s,{assetId});await trackEntries(sql,list,s);
}

export async function resetUploadRetention(sql,assetId){

 const s=await state(sql);for(const e of await entries(s,{assetId}))await restoreEntry(sql,e,s);
 await sql.execute('UPDATE storage_file_lifecycle FORCE INDEX(upload_lookup) SET unreferenced_since=UTC_TIMESTAMP(6) WHERE asset_id=?',[assetId]);
}

export async function protectPreparation(journal,asset,product,descriptor){

 const hashes=[...new Set(Object.values(descriptor).map(f=>f.sha256))];
 await journal.query('UPDATE storage_file_lifecycle FORCE INDEX(upload_lookup) SET unreferenced_since=NULL WHERE asset_id=?',[asset.id]);
 for(const hash of hashes)await journal.query('UPDATE storage_file_lifecycle FORCE INDEX(product_hash) SET unreferenced_since=NULL WHERE product_id=? AND sha256=?',[product.id,hash]);
}

async function locked(pool,entry,action){
 const sql=await pool.getConnection();let uploadLock=false;
 try{
  if(entry.asset_id){const [lock]=await sql.execute('SELECT GET_LOCK(?,0) AS acquired',['altego_upload_'+entry.asset_id]);if(lock[0].acquired!==1)return {busy:true};uploadLock=true;}
  await sql.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await sql.beginTransaction();
  if(entry.product_id){const [p]=await sql.execute('SELECT id FROM productos WHERE id=? FOR UPDATE',[entry.product_id]);if(!p.length)throw fail('Product disappeared.');}
  if(entry.asset_id)await sql.execute('SELECT id FROM assets WHERE id=? FOR UPDATE',[entry.asset_id]);
  const result=await action(sql);await sql.commit();return result;
 }catch(e){await sql.rollback();throw e;}finally{if(uploadLock)await sql.execute('SELECT RELEASE_LOCK(?)',['altego_upload_'+entry.asset_id]).catch(()=>{});sql.release();}
}

export async function trackStorage(pool){
 if(await backupRoot())throw fail('Backup storage roots are protected.');
 const s=await state(pool),list=(await entries(s,{scan:true})).filter(permitted);let tracked=0;
 for(const e of list)await locked(pool,e,async sql=>{const current=await state(sql);await trackEntries(sql,[e],current);tracked++;});
 return {tracked};
}

export async function cleanupStorage(pool,{onStage=async()=>{}}={}){
 if(await backupRoot())throw fail('Backup storage roots are protected.');
 const guard=await pool.getConnection(),result={quarantined:[],skipped:[]};let attemptedKey=null;
 try{
  const [lock]=await guard.query("SELECT GET_LOCK('altego_storage_cleanup',0) AS acquired");if(lock[0].acquired!==1)throw fail('Another cleanup is running.');
  const s=await state(pool);const list=(await entries(s)).filter(permitted);
  for(const e of list){attemptedKey=e.file_key;const outcome=await locked(pool,e,async sql=>{
   const current=await state(sql),row=current.life.find(l=>l.file_key===e.file_key);
   const protection=reasons(e,current);
   if(protection.length){await trackEntries(sql,[e],current);result.skipped.push({path:e.relative_path,reason:protection});return;}

   if(!row?.eligible){result.skipped.push({path:e.relative_path,reason:'Retention period incomplete or untracked'});return;}
   await onStage('locked',e);
   if(current.operations.some(o=>o.file_key===e.file_key&&o.state==='purge_planned'))throw fail('Resume the pending purge before quarantine.');
   let op=current.operations.filter(o=>o.file_key===e.file_key&&['planned','quarantined'].includes(o.state)).at(-1);
   if(!op&&!await exists(e.relative_path)){result.skipped.push({path:e.relative_path,reason:'No active bytes; history or purge tombstone preserved'});return;}
   if(!op){
    op={id:randomUUID(),file_key:e.file_key,descriptor:{...e,unreferenced_since:row.since_utc}};const journal=await journalConnection(sql);
    try{await journal.execute("INSERT INTO storage_cleanup_operations(id,file_key,state,descriptor) VALUES (?,?,'planned',?)",[op.id,op.file_key,JSON.stringify(op.descriptor)]);}finally{await journal.end();}
   }
   await onStage('planned',e);
   const target=quarantineRelative(op);
   try{
    if(await exists(e.relative_path)){
     await readVerifiedStorageFile(e.relative_path,e);
     if(await exists(target))throw fail('Both cleanup locations exist; manual verification required.');
     await fs.rename(await safeStoragePath(e.relative_path),await safeStoragePath(target,{createParents:true}));
    }
    await readVerifiedStorageFile(target,e);

    const timestamp=await journalConnection(sql);try{await timestamp.execute('UPDATE storage_cleanup_operations SET quarantined_at=COALESCE(quarantined_at,UTC_TIMESTAMP(6)) WHERE id=?',[op.id]);}finally{await timestamp.end();}
    await onStage('moved',e);
    await sql.execute("UPDATE storage_cleanup_operations SET state='quarantined',last_error=NULL WHERE id=?",[op.id]);
    result.quarantined.push(e.relative_path);
   }catch(error){throw error;}
  });if(outcome?.busy)result.skipped.push({path:e.relative_path,reason:'Upload lock is busy'});}
  return result;
 }catch(error){

  if(attemptedKey)await guard.execute("UPDATE storage_cleanup_operations SET last_error=? WHERE file_key=? AND state<>'restored'",[String(error.code||error.message).slice(0,500),attemptedKey]).catch(()=>{});
  throw error;
 }finally{await guard.query("SELECT RELEASE_LOCK('altego_storage_cleanup')").catch(()=>{});guard.release();}
}


export async function quarantinedFile(sql,relative,expected,{pathOnly=false}={}){
 const [rows]=await sql.execute("SELECT * FROM storage_cleanup_operations WHERE file_key=? AND state IN ('planned','quarantined') ORDER BY updated_at DESC,id DESC",[key(relative)]);
 for(const op of rows){const e=parse(op.descriptor);if(e.relative_path!==normalize(relative)||!permitted(e)||e.sha256!==expected.sha256||e.byte_size!==expected.byte_size)throw fail('Cleanup recovery descriptor differs.');const location=quarantineRelative(op);try{if(await exists(location)){const bytes=await readVerifiedStorageFile(location,expected);return pathOnly?await safeStoragePath(location):bytes;}}catch(error){if(error.code!=='ENOENT')throw error;}}

 const bytes=await readVerifiedStorageFile(relative,expected);return pathOnly?await safeStoragePath(relative):bytes;
}

function validStaging(e){
 const p=normalize(e.relative_path),file=path.posix.basename(p),root=p.match(/^(?:creators\/)?([a-z0-9_]+)\/(?:products\/|[a-z0-9-]+--p)([1-9]\d*)\//);if(!root||Number(root[2])!==e.product_id)return false;
 const asset=file.match(/^\.pending-([a-f0-9-]{36})\.tmp$/),index=file.match(/^(?:metadata|index|v\d+)\.json\.([a-f0-9-]{36})\.tmp$/);
 if(asset)return validAssetId(asset[1])&&['glb','png'].includes(e.kind)&&p.endsWith('/'+e.kind+'/'+file);
 return !!(index&&validAssetId(index[1])&&e.kind==='json'&&/\/(?:metadata\.json|draft\/index\.json|versions\/(?:index|v\d+)\.json)\.[a-f0-9-]{36}\.tmp$/.test(p));
}

function operationLocation(kind,op){
 if(kind==='ordinary'){const m=op.purge_metadata?parse(op.purge_metadata):null;if(m?.authorization_scope==='approved_redundant_32'&&m.authorization_hash===approvedRedundantCopyHash){const d=parse(op.descriptor);if(!temporary.test(normalize(d.relative_path))||key(d.relative_path)!==op.file_key)throw fail('Invalid authorized temporary cleanup descriptor.');return d.relative_path;}return quarantineRelative(op);}
 if(kind!=='legacy'||!validAssetId(op.id)||!/^\b(originals|previews)\/[a-f0-9-]{36}\.(glb|png)$/.test(op.relative_path))throw fail('Invalid Legacy quarantine operation.');
 const location=legacyQuarantinePath(op.id,op.relative_path),d=parse(op.descriptor);
 if(!d.quarantine_path||maintenancePath(d.quarantine_path)!==normalize(location))throw fail('Legacy quarantine descriptor differs.');return location;
}

export async function assertNoPurgeIntent(sql,relative){
 if(!sql)return;
 const [rows]=await sql.execute("SELECT state FROM storage_cleanup_operations WHERE file_key=? AND state='purge_planned'",[key(relative)]);
 if(rows.some(r=>r.state==='purge_planned'))throw Object.assign(Error('File maintenance is pending. Resume maintenance before reusing this file.'),{status:409});
}


export async function recordStorageArtifact(sql,product,relative,kind,data){
 const entry={relative_path:normalize(relative),product_id:product.id,kind,artifact_type:'staging'};
 if(!validStaging(entry)||!entry.relative_path.startsWith(productStorageDirectory(product).replaceAll('\\','/')+'/'))throw fail('Invalid preparation artifact.');
 const journal=await journalConnection(sql);
 try{await journal.execute("INSERT INTO storage_file_lifecycle(file_key,relative_path,product_id,kind,sha256,byte_size,artifact_type,artifact_state) VALUES (?,?,?,?,?,?,'staging','preparing')",[key(relative),entry.relative_path,product.id,kind,createHash('sha256').update(data).digest('hex'),data.length]);}finally{await journal.end();}
}
export async function completeStorageArtifact(sql,relative){
 const journal=await journalConnection(sql);try{await journal.execute("UPDATE storage_file_lifecycle SET artifact_state='completed',unreferenced_since=NULL,loss_pending=FALSE WHERE file_key=? AND artifact_type='staging'",[key(relative)]);}finally{await journal.end();}
}

async function maintenance(pool,action){
 if(await backupRoot())throw fail('Backup storage roots are protected.');
 const guard=await pool.getConnection(),held=[];
 try{for(const name of ['altego_storage_cleanup','altego_legacy_retirement','altego_legacy_storage_migration']){const [[lock]]=await guard.execute('SELECT GET_LOCK(?,0) AS acquired',[name]);if(lock.acquired!==1)throw fail('An incompatible storage operation is running.');held.push(name);}return await action(guard);}
 finally{for(const name of held.reverse())await guard.execute('SELECT RELEASE_LOCK(?)',[name]).catch(()=>{});guard.release();}
}
function requireConfirmation(actual,expected){if(actual!==expected)throw fail('Explicit confirmation does not match this operation.');}
async function selectedOperation(sql,kind,id){
 if(!validAssetId(id)||!['ordinary','legacy'].includes(kind))throw fail('Select a known ordinary or Legacy operation UUID.');
 const table=kind==='ordinary'?'storage_cleanup_operations':'legacy_retirement_operations';
 const [rows]=await sql.execute(`SELECT *,DATE_FORMAT(quarantined_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS quarantined_utc,quarantined_at<=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 30 DAY) AS purge_due FROM ${table} WHERE id=?`,[id]);
 if(!rows.length)throw fail('Quarantine operation not found.');return {op:rows[0],table};
}
async function operationLocked(pool,kind,op,action){
 const d=parse(op.descriptor);
 if(kind==='ordinary')return locked(pool,d,action);
 const sql=await pool.getConnection();try{await sql.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await sql.beginTransaction();
  const [actual]=await sql.execute('SELECT DISTINCT f.product_id FROM asset_file_links l JOIN product_files f ON f.id=l.file_id WHERE l.asset_id=? ORDER BY f.product_id',[d.asset_id]);
  const ids=[...new Set([...(d.products||[]),...actual.map(r=>r.product_id)])].sort((a,b)=>a-b);for(const id of ids)await sql.execute('SELECT id FROM productos WHERE id=? FOR UPDATE',[id]);await sql.execute('SELECT id FROM assets WHERE id=? FOR UPDATE',[d.asset_id]);
  const result=await action(sql);await sql.commit();return result;
 }catch(error){await sql.rollback();throw error;}finally{sql.release();}
}
async function fileIdentity(relative){const stat=await fs.lstat(await safeStoragePath(relative),{bigint:true});if(!stat.isFile()||stat.isSymbolicLink())throw fail('Invalid purge target.');return {dev:stat.dev.toString(),ino:stat.ino.toString(),size:stat.size.toString(),mtime_ns:stat.mtimeNs.toString()};}
async function verifyDisposition(sql,kind,op,{missingAllowed=false}={}){
 const d=parse(op.descriptor),target=operationLocation(kind,op);let mode;
 if(kind==='legacy'){
  const {verifyRetiredLegacyForPurge}=await import('./legacy-retirement.js');await verifyRetiredLegacyForPurge(sql,op);mode='verified_legacy_duplicate';
 }else{
  if(!permitted(d)||key(d.relative_path)!==op.file_key)throw fail('Unmanaged quarantine descriptor.');
  const current=await state(sql),e={...d},protection=reasons(e,current),sourcePresent=await exists(d.relative_path);
  const pending=protection.filter(r=>!['Draft, active/inactive variant or published snapshot reference','Persisted logical asset reference','Persisted upload reference'].includes(r));
  if(pending.length)throw fail('A recovery, migration, unsafe path or unfinished operation protects this file.');
  if(op.state==='restored'){
   if(!sourcePresent)throw fail('A restored duplicate has no verified active replacement.');await readVerifiedStorageFile(d.relative_path,d);mode='restored_duplicate';
  }else{
   if(protection.length)throw fail('A persisted reference protects this physical file.');
   const lifecycle=current.life.find(l=>l.file_key===op.file_key);if(!lifecycle||lifecycle.loss_pending||!lifecycle.unreferenced_since)throw fail('The loss-of-reference condition was cancelled or awaits confirmation.');
   const [[times]]=await sql.execute('SELECT unreferenced_since<=DATE_SUB(?,INTERVAL 30 DAY) AS unchanged FROM storage_file_lifecycle WHERE file_key=?',[op.quarantined_at,op.file_key]);
   if(!times?.unchanged)throw fail('This file was reused after quarantine.');
   if(sourcePresent)throw fail('The original path reappeared; recover and reevaluate the operation.');mode='unreferenced_bytes';
  }
 }
 if(await exists(target))await readVerifiedStorageFile(target,d);else if(!missingAllowed)throw fail('Quarantine bytes are missing; no purge intent proves their disposition.');
 return {target,mode,descriptor:d};
}
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const planHash=plan=>createHash('sha256').update(stable(plan)).digest('hex');

export async function createStoragePurgePlan(sql,{operations=null,limit=50}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw fail('Invalid maintenance batch limit.');
 if(await backupRoot()){const [[db]]=await sql.query('SELECT DATABASE() AS name');const body={format_version:1,policy:'30-days-unreferenced-plus-30-days-quarantine',database:db.name,storage_root:await fs.realpath(storageRoot),created_at:new Date().toISOString(),files:[],protected_root:true};return {...body,confirmation_hash:planHash(body)};}
 const [[db]]=await sql.query('SELECT DATABASE() AS name'),s=await state(sql);const candidates=[];
 for(const [kind,ops]of [['ordinary',s.operations],['legacy',s.legacy]])for(const op of ops){
  if(operations&&!operations.includes(kind+':'+op.id)||candidates.length>=limit||!['quarantined','restored','purge_planned'].includes(op.state)||!op.purge_due)continue;
  try{
   const checked=await verifyDisposition(sql,kind,op,{missingAllowed:op.state==='purge_planned'}),metadata=op.purge_metadata?parse(op.purge_metadata):null;
   if(op.state==='purge_planned'&&(!metadata?.file_identity||metadata.storage_root!==await fs.realpath(storageRoot)||metadata.database!==db.name))continue;
   const identity=await exists(checked.target)?await fileIdentity(checked.target):metadata.file_identity;
   candidates.push({scope:kind,operation_id:op.id,path:normalize(checked.target),original_path:kind==='legacy'?op.relative_path:checked.descriptor.relative_path,sha256:checked.descriptor.sha256,byte_size:checked.descriptor.byte_size,quarantined_at:op.quarantined_utc,file_identity:identity});
  }catch(error){if(!['STORAGE_CLEANUP_CONFLICT','LEGACY_RETIREMENT_CONFLICT'].includes(error.code)&&error.status!==409&&!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
 }
 const plan={format_version:1,policy:'30-days-unreferenced-plus-30-days-quarantine',database:db.name,storage_root:await fs.realpath(storageRoot),created_at:new Date().toISOString(),files:candidates};return {...plan,confirmation_hash:planHash(plan)};
}

export async function executeStoragePurgePlan(pool,plan,confirmation,{onStage=async()=>{}}={}){
 const {confirmation_hash,...body}=plan||{};
 if(plan?.format_version!==1||plan.policy!=='30-days-unreferenced-plus-30-days-quarantine'||!Array.isArray(plan.files)||!plan.files.length||plan.files.length>1000||new Set(plan.files.map(f=>f.scope+':'+f.operation_id)).size!==plan.files.length||confirmation_hash!==planHash(body))throw fail('A nonempty, intact purge plan is required.');
 requireConfirmation(confirmation,'PURGE:'+confirmation_hash);
 return maintenance(pool,async guard=>{
  const [[db]]=await guard.query('SELECT DATABASE() AS name');if(plan.database!==db.name||plan.storage_root!==await fs.realpath(storageRoot))throw fail('Purge plan belongs to another environment.');
  const result={purged:[],already_purged:[]};
  for(const expected of plan.files){const {op}=await selectedOperation(guard,expected.scope,expected.operation_id);
   let outcome;try{outcome=await operationLocked(pool,expected.scope,op,async sql=>{
    const {op:current,table}=await selectedOperation(sql,expected.scope,op.id),d=parse(current.descriptor),target=operationLocation(expected.scope,current);
    if(normalize(target)!==expected.path||d.sha256!==expected.sha256||d.byte_size!==expected.byte_size||current.quarantined_utc!==expected.quarantined_at)throw fail('The selected quarantine record changed.');
    if(current.state==='purged'){result.already_purged.push(op.id);return;}
    if(!['quarantined','restored','purge_planned'].includes(current.state)||!current.purge_due)throw fail('Thirty complete quarantine days have not elapsed.');
    const checked=await verifyDisposition(sql,expected.scope,current,{missingAllowed:current.state==='purge_planned'});
    if(current.state==='purge_planned'){
     const old=parse(current.purge_metadata);if(!old||old.storage_root!==plan.storage_root||old.database!==plan.database||stable(old.file_identity)!==stable(expected.file_identity))throw fail('Durable purge intent differs from this plan.');
    }
    if(await exists(target)){if(stable(await fileIdentity(target))!==stable(expected.file_identity))throw fail('Quarantine file identity changed.');await readVerifiedStorageFile(target,d);}
    else if(current.state!=='purge_planned')throw fail('The selected file disappeared before purge intent.');
    await onStage('locked',expected);
    if(current.state!=='purge_planned'){
     const metadata={policy:plan.policy,plan_hash:confirmation_hash,storage_root:plan.storage_root,database:plan.database,file_identity:expected.file_identity,mode:checked.mode,plan_entry:expected};
     const journal=await journalConnection(sql);try{await journal.execute(`UPDATE ${table} SET state='purge_planned',purge_intent_at=UTC_TIMESTAMP(6),purge_metadata=?,last_error=NULL WHERE id=?`,[JSON.stringify(metadata),op.id]);}finally{await journal.end();}
    }
    await onStage('intent',expected);
    if(await exists(target)){
     await readVerifiedStorageFile(target,d);if(stable(await fileIdentity(target))!==stable(expected.file_identity))throw fail('Purge target changed immediately before removal.');
     await fs.unlink(await safeStoragePath(target));
    }
    await onStage('unlinked',expected);
    await sql.execute(`UPDATE ${table} SET state='purged',purged_at=COALESCE(purged_at,UTC_TIMESTAMP(6)),last_error=NULL WHERE id=?`,[op.id]);await onStage('before_commit',expected);result.purged.push(op.id);
   });}catch(error){const table=expected.scope==='ordinary'?'storage_cleanup_operations':'legacy_retirement_operations';await guard.execute(`UPDATE ${table} SET last_error=? WHERE id=? AND state='purge_planned'`,[String(error.code||error.message).slice(0,500),op.id]).catch(()=>{});throw error;}if(outcome?.busy)throw fail('An active upload protects this operation.');
  }
  return result;
 });
}

export async function restoreStorageOperation(pool,id,confirmation){
 requireConfirmation(confirmation,'RESTORE:'+id);
 return maintenance(pool,async guard=>{const {op}=await selectedOperation(guard,'ordinary',id);
  return operationLocked(pool,'ordinary',op,async sql=>{
   const {op:current}=await selectedOperation(sql,'ordinary',id);if(['purged','purge_planned'].includes(current.state))throw fail('Purge has started or completed; reconcile its journal or use a verified backup.');
   const d=parse(current.descriptor);if(!permitted(d))throw fail('Unknown file cannot be restored automatically.');if(current.state==='restored'){await readVerifiedStorageFile(d.relative_path,d);return {already_restored:id,source:d.relative_path};}await restoreEntry(sql,d,{operations:[current]});
   await sql.execute('UPDATE storage_file_lifecycle SET unreferenced_since=UTC_TIMESTAMP(6),loss_pending=FALSE WHERE file_key=?',[current.file_key]);return {restored:id,source:d.relative_path};
  });
 });
}

export async function abandonStorageOperation(pool,{type,id,productId=null,reason,confirmation}){
 if(typeof reason!=='string'||reason.trim().length<5||reason.length>500)throw fail('An explicit abandonment reason is required.');
 requireConfirmation(confirmation,'ABANDON:'+type+':'+id+(productId?':'+productId:''));
 return maintenance(pool,async guard=>{
  if(type==='staging'){
   if(!/^[a-f0-9]{64}$/.test(id))throw fail('Select a registered staging file key.');const [[entry]]=await guard.execute('SELECT * FROM storage_file_lifecycle WHERE file_key=?',[id]);if(!entry||!validStaging(entry))throw fail('Only registered preparation artifacts can be abandoned.');
   return locked(pool,entry,async sql=>{const current=await state(sql);if(current.pending.some(o=>o.product_id===entry.product_id)||current.migrations.some(o=>o.product_id===entry.product_id))throw fail('A pending product operation protects this staging file.');
    if(!await exists(entry.relative_path)){await sql.execute("UPDATE storage_file_lifecycle SET artifact_state='completed',unreferenced_since=NULL,loss_pending=FALSE,abandonment_reason=? WHERE file_key=?",[reason,id]);return {reconciled_missing_artifact:id};}
    const file=await safeStoragePath(entry.relative_path),data=await fs.readFile(file);if(data.length>25*1024*1024)throw fail('Preparation artifact is oversized.');
    await sql.execute("UPDATE storage_file_lifecycle SET artifact_state='abandoned',abandoned_at=UTC_TIMESTAMP(6),abandonment_reason=?,sha256=?,byte_size=?,unreferenced_since=NULL,loss_pending=TRUE WHERE file_key=?",[reason,createHash('sha256').update(data).digest('hex'),data.length,id]);return {abandoned:id,tracking_required:true};
   });
  }
  if(!validAssetId(id)||!['upload','incorporation'].includes(type))throw fail('Select a known upload or incorporation.');
  const [[asset]]=await guard.execute('SELECT * FROM assets WHERE id=?',[id]);if(!asset)throw fail('Upload not found.');
  const [claims]=await guard.execute("SELECT product_id FROM storage_incorporations WHERE asset_id=? AND status IN ('preparing','prepared') ORDER BY product_id",[id]);
  const entry={asset_id:id,product_id:productId||asset.product_id||claims[0]?.product_id||null};
  return locked(pool,entry,async sql=>{
   const current=await state(sql),a=current.assets.find(a=>a.id===id);if([...current.refs.values()].some(r=>r.has(id))||a.storage_layout!=='temporary')throw fail('A bound or referenced file cannot be declared abandoned.');
   const pending=current.pending.filter(o=>o.asset_id===id);if(pending.some(o=>o.product_id!==entry.product_id))throw fail('Multiple product claims require explicit reconciliation.');
   if(type==='incorporation'){
    if(!Number.isSafeInteger(productId)||!pending.some(o=>o.product_id===productId))throw fail('No matching incomplete incorporation.');
    await sql.execute("UPDATE storage_incorporations SET status='abandoned',abandoned_at=UTC_TIMESTAMP(6),abandonment_reason=? WHERE asset_id=? AND product_id=? AND status IN ('preparing','prepared')",[reason,id,productId]);
   }else{
    if(a.storage_state==='abandoned')return {already_abandoned:id,tracking_required:true};
    if(pending.length)throw fail('Resolve the incomplete incorporation before abandoning its upload.');
    if(current.operations.some(o=>parse(o.descriptor).asset_id===id&&['planned','quarantined','purge_planned'].includes(o.state)))throw fail('Recover or reconcile the quarantine operation before declaring abandonment.');
    const artifacts={};for(const role of ['original','preview']){const relative=assetLocation(a,role);if(await exists(relative)){const bytes=await fs.readFile(await safeStoragePath(relative));if(bytes.length>25*1024*1024)throw fail('Upload artifact is oversized.');artifacts[role]={sha256:createHash('sha256').update(bytes).digest('hex'),byte_size:bytes.length};}}
    await sql.execute("UPDATE assets SET storage_state='abandoned',abandoned_at=UTC_TIMESTAMP(6),abandonment_reason=?,abandoned_artifacts=? WHERE id=?",[reason,JSON.stringify(artifacts),id]);
   }
   await sql.execute('UPDATE storage_file_lifecycle FORCE INDEX(upload_lookup) SET unreferenced_since=NULL,loss_pending=TRUE WHERE asset_id=?',[id]);return {abandoned:type,asset_id:id,tracking_required:true};
  });
 });
}

export async function recoverStorageUpload(pool,id,confirmation){
 if(!validAssetId(id))throw fail('Invalid upload UUID.');requireConfirmation(confirmation,'RECOVER_UPLOAD:'+id);
 return maintenance(pool,async()=>locked(pool,{asset_id:id,product_id:null},async sql=>{
  const s=await state(sql),asset=s.assets.find(a=>a.id===id);if(!asset||asset.storage_layout!=='temporary'||asset.product_id!=null)throw fail('Select an unbound temporary upload.');if(parse(asset.metadata)?.temporary_deleted||parse(asset.metadata)?.temporary_delete_pending)throw fail('A permanently deleted upload cannot be recovered.');
  for(const e of await entries(s,{assetId:id}))await restoreEntry(sql,e,s);
  const {validateGlb,validatePng}=await import('./assets.js');
  for(const role of ['original','preview']){const bytes=await readVerifiedStorageFile(assetLocation(asset,role),asset);if(asset.kind==='glb')validateGlb(bytes);else validatePng(bytes);}
  await sql.execute("UPDATE assets SET storage_state='ready',abandoned_at=NULL,abandonment_reason=NULL,abandoned_artifacts=NULL WHERE id=?",[id]);
  await sql.execute('UPDATE storage_file_lifecycle FORCE INDEX(upload_lookup) SET unreferenced_since=NULL,loss_pending=TRUE WHERE asset_id=?',[id]);return {recovered_upload:id,tracking_required:true};
 }));
}

export async function inspectStorageOperations(sql){
 const s=await state(sql),uploads=[];
 for(const a of s.assets.filter(a=>a.storage_layout==='temporary')){
  let recoverable=true;try{for(const role of ['original','preview'])await readVerifiedStorageFile(assetLocation(a,role),a);}catch{recoverable=false;}
  uploads.push({asset_id:a.id,state:a.storage_state,recovery:recoverable?'complete_bytes_available':'incomplete_or_unknown',abandoned_at:a.abandoned_at,reason:a.abandonment_reason});
 }
 return {uploads,incorporations:s.pending.map(o=>({asset_id:o.asset_id,product_id:o.product_id,state:o.status,last_error:o.last_error})),migrations:s.migrations.map(o=>({product_id:o.product_id,state:o.state})),
  staging:s.life.filter(l=>l.artifact_type==='staging'&&l.artifact_state!=='completed').map(l=>({file_key:l.file_key,path:l.relative_path,state:l.artifact_state,abandoned_at:l.abandoned_at,reason:l.abandonment_reason})),
  purge_intents:[...s.operations.map(o=>({...o,scope:'ordinary'})),...s.legacy.map(o=>({...o,scope:'legacy'}))].filter(o=>o.state==='purge_planned').map(o=>({scope:o.scope,operation_id:o.id,purge_intent_at:o.purge_intent_at}))};
}


export const approvedRedundantCopyHash='11335c489027de8f48c7421fff4e348c42cbd867eae2c5006f577121687d3ba0';
const protectedLegacyCopyHash='75350b489b2f2fe4742bda28a1a266695c296aaf5d1f6f243e568370401e00e0';
const copyIdentity=c=>({path:c.path,asset_id:c.asset_id,group:c.group,representation:c.representation,sha256:c.sha256,byte_size:c.byte_size,operation_id:c.operation_id||null,product_id:c.product_id||null,replacements:c.replacements,quarantined_at:c.quarantined_at||null});
const copySetHash=files=>planHash(files.map(copyIdentity).sort((a,b)=>a.path.localeCompare(b.path)));
function assertApprovedCopies(proposal){
 if(proposal?.format_version!==1||!Array.isArray(proposal.candidates)||proposal.candidates.length!==32||new Set(proposal.candidates.map(c=>c.path)).size!==32||copySetHash(proposal.candidates)!==approvedRedundantCopyHash)throw fail('The proposal differs from the exact 32 authorized files.');
 if(proposal.candidates.filter(c=>c.group==='redundant_legacy_quarantine').length!==28||proposal.candidates.filter(c=>c.group==='completed_temporary_copy').length!==4)throw fail('The authorized groups differ.');
 if(!Array.isArray(proposal.protectedFiles)||proposal.protectedFiles.length!==8||planHash(proposal.protectedFiles.map(c=>({path:c.path,asset_id:c.asset_id,sha256:c.sha256,byte_size:c.byte_size})).sort((a,b)=>a.path.localeCompare(b.path)))!==protectedLegacyCopyHash||proposal.protectedFiles.some(f=>proposal.candidates.some(c=>c.path===f.path)))throw fail('The protected Legacy inventory differs.');
}
async function verifyCopyBackup(backup,proposal){
 if(!backup)throw fail('Supply a fresh verified external backup.');const full=await fs.realpath(backup),root=await fs.realpath(storageRoot);if(full===root||full.startsWith(root+path.sep))throw fail('The backup must remain outside Storage.');
 const bytes=await fs.readFile(path.join(full,'manifest.json')),manifest=parse(bytes.toString());if(!manifest.files?.['mysql.json'])throw fail('The backup has no MySQL snapshot.');
 for(const [relative,digest]of Object.entries(manifest.files)){const file=path.resolve(full,relative);if(!file.startsWith(full+path.sep)||createHash('sha256').update(await fs.readFile(file)).digest('hex')!==digest)throw fail('External backup integrity failed.');}
 for(const file of [...proposal.candidates,...proposal.protectedFiles]){const name='source/storage/'+file.path;if(manifest.files[name]!==file.sha256)throw fail('An authorized or protected file is not covered by the backup.');const data=await fs.readFile(path.join(full,name));if(data.length!==file.byte_size)throw fail('Backup file size differs.');}
 return {path:full,manifest_hash:createHash('sha256').update(bytes).digest('hex'),verified_files:Object.keys(manifest.files).length};
}
const authorizedMetadata=op=>{const m=op?.purge_metadata?parse(op.purge_metadata):null;return m?.authorization_scope==='approved_redundant_32'&&m.authorization_hash===approvedRedundantCopyHash?m:null;};
async function approvedCopyOperation(sql,c){
 if(c.group==='redundant_legacy_quarantine'){const [[op]]=await sql.execute('SELECT * FROM legacy_retirement_operations WHERE id=?',[c.operation_id]);if(!op)throw fail('The authorized Legacy journal is missing.');return {op,table:'legacy_retirement_operations'};}
 const [ops]=await sql.execute('SELECT * FROM storage_cleanup_operations WHERE file_key=? ORDER BY updated_at,id',[key(c.path)]);
 if(ops.some(o=>['planned','quarantined','purge_planned'].includes(o.state)&&!authorizedMetadata(o)))throw fail('Another cleanup operation still needs this temporary copy.');
 return {op:ops.find(o=>authorizedMetadata(o))||null,table:'storage_cleanup_operations'};
}
async function verifyApprovedCopy(sql,c,{allowMissing=false,verifiedProducts=null}={}){
 const {op,table}=await approvedCopyOperation(sql,c);const metadata=authorizedMetadata(op);
 if(op&&['purge_planned','purged'].includes(op.state)&&(!metadata||stable(metadata.authorized_copy)!==stable(copyIdentity(c))))throw fail('The purge journal has a different authorization.');
 const current=await state(sql),asset=current.assets.find(a=>a.id===c.asset_id);if(!asset||asset.storage_state!=='ready'||asset.storage_layout!=='product')throw fail('The active resource is not a ready product asset.');
 if(current.migrations.length||current.pending.some(o=>o.asset_id===asset.id||o.product_id===asset.product_id))throw fail('A pending recovery still needs the copy.');
 if(c.group==='redundant_legacy_quarantine'){
  if(!['quarantined','purge_planned','purged'].includes(op.state))throw fail('Legacy is no longer in the approved retired state.');
  const d=parse(op.descriptor);if(normalize(operationLocation('legacy',op))!==c.path||d.asset_id!==c.asset_id||d.representation!==c.representation||d.sha256!==c.sha256||d.byte_size!==c.byte_size)throw fail('The Legacy descriptor differs from the authorization.');
  const [[date]]=await sql.execute("SELECT DATE_FORMAT(quarantined_at,'%Y-%m-%d %H:%i:%s.%f') AS value FROM legacy_retirement_operations WHERE id=?",[op.id]);if(date.value!==c.quarantined_at)throw fail('The original Legacy retirement date changed.');
  const {verifyRetiredLegacyForPurge}=await import('./legacy-retirement.js');await verifyRetiredLegacyForPurge(sql,op,{verifiedProducts});
 }else{
  const match=c.path.match(temporary);if(!match||match[2]!==asset.id||Number(match[1])!==asset.owner_id||match[3]!==c.representation||match[4]!==asset.kind||asset.product_id!==c.product_id||assetLocation({...asset,storage_layout:'temporary',product_id:null},c.representation)!==path.normalize(c.path))throw fail('The completed upload identity differs.');
  const claims=current.incorporations.filter(o=>o.asset_id===asset.id);if(!claims.length||claims.some(o=>o.status!=='committed')||!claims.some(o=>o.product_id===asset.product_id))throw fail('The upload incorporation is not completed.');
  const lifecycle=current.life.find(l=>l.file_key===key(c.path));if(!lifecycle||lifecycle.asset_id!==asset.id||lifecycle.sha256!==c.sha256||lifecycle.byte_size!==c.byte_size)throw fail('Temporary lifecycle identity differs.');
 }
 const {resolveAssetFile}=await import('./storage-resolver.js');
 if(!Array.isArray(c.replacements)||!c.replacements.length)throw fail('The authorized replacements are missing.');
 for(const r of c.replacements){const actual=await resolveAssetFile(sql,asset,c.representation,{productId:r.product_id});if(normalize(path.relative(storageRoot,actual))!==r.path||!r.path.startsWith('creators/'))throw fail('The resolver no longer uses the approved replacement.');await readVerifiedStorageFile(r.path,c);}
 const present=await exists(c.path);
 if(op?.state==='purged'&&present)throw fail('Bytes reappeared after the authorized purge; do not delete them.');
 if(present)await readVerifiedStorageFile(c.path,c);else if(!(allowMissing&&metadata&&['purge_planned','purged'].includes(op.state)))throw fail('An authorized file is absent without a durable purge record.');
 if(present&&metadata&&stable(await fileIdentity(c.path))!==stable(metadata.file_identity))throw fail('The authorized file identity changed after purge intent.');
 return {op,table,present,metadata};
}
export async function inspectApprovedCopyDeletion(sql,proposal,{backup}={}){
 assertApprovedCopies(proposal);const [[db]]=await sql.query('SELECT DATABASE() AS name');if(proposal.database!==db.name||await fs.realpath(proposal.storage_root)!==await fs.realpath(storageRoot))throw fail('The proposal belongs to another environment.');
 const verifiedBackup=await verifyCopyBackup(backup,proposal);await verifyCopyBackup(proposal.backup,proposal);
 const current=await state(sql);if(current.pending.length||current.migrations.length||current.operations.some(o=>['planned','quarantined','purge_planned'].includes(o.state)&&!authorizedMetadata(o))||current.legacy.some(o=>['planned','purge_planned'].includes(o.state)&&!authorizedMetadata(o)))throw fail('Resolve incompatible pending operations before this purge.');
 for(const f of proposal.protectedFiles)await readVerifiedStorageFile(f.path,f);
 const {validateSnapshot}=await import('../../modules/products/history.js');for(const v of current.versions)await validateSnapshot(sql,v,v.product_id,true);
 const files=[],verifiedProducts=new Set();for(const c of proposal.candidates){const checked=await verifyApprovedCopy(sql,c,{allowMissing:true,verifiedProducts});files.push({path:c.path,state:checked.op?.state||'ready_for_authorized_purge',physical_present:checked.present});}
 return {authorization_hash:approvedRedundantCopyHash,backup:verifiedBackup,files,protected_files_verified:8,snapshots_verified:current.versions.length};
}
async function pruneApprovedEmptyParents(relative){
 const boundary=relative.startsWith('temporary/')?'temporary':'maintenance/legacy/quarantine';let directory=path.posix.dirname(relative);
 while(directory.startsWith(boundary+'/')){try{await fs.rmdir(await safeDirectory(directory));}catch(e){if(e.code==='ENOENT'){}else if(e.code==='ENOTEMPTY'||e.code==='EEXIST')return;else throw e;}directory=path.posix.dirname(directory);}
}
export async function executeApprovedCopyDeletion(pool,proposal,{backup,recoveryProof,confirmation,onStage=async()=>{}}={}){
 assertApprovedCopies(proposal);requireConfirmation(confirmation,'PURGE_APPROVED_32:'+approvedRedundantCopyHash);
 return maintenance(pool,async guard=>{

  const uploadLocks=[];let journal,active=null,transaction=false;
  try{
   await guard.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await guard.beginTransaction();transaction=true;await guard.query('SELECT id FROM productos ORDER BY id FOR UPDATE');
   const [assets]=await guard.query('SELECT id FROM assets ORDER BY id');for(const a of assets){const name='altego_upload_'+a.id;const [[lock]]=await guard.execute('SELECT GET_LOCK(?,0) AS acquired',[name]);if(lock.acquired!==1)throw fail('An active upload prevents the authorized purge.');uploadLocks.push(name);}await guard.query('SELECT id FROM assets ORDER BY id FOR UPDATE');
   const verified=await inspectApprovedCopyDeletion(guard,proposal,{backup});
   if(recoveryProof?.authorization_hash!==approvedRedundantCopyHash||recoveryProof.backup_manifest_hash!==verified.backup.manifest_hash||recoveryProof.recovered_files!==77||recoveryProof.authorized_files_recovered!==32||recoveryProof.snapshots_verified!==12||!recoveryProof.restore_passed||!recoveryProof.zip_v2_passed||!recoveryProof.isolated||!/^altego_auth_test_approvedcleanup_\d+$/.test(recoveryProof.database))throw fail('A successful isolated recovery rehearsal for this exact backup is required.');
   await onStage('preflight',verified);journal=await journalConnection(guard);const result={authorization_hash:approvedRedundantCopyHash,backup:verified.backup,purged:[],already_purged:[]},verifiedProducts=new Set();
   for(const c of proposal.candidates){active=c;let checked=await verifyApprovedCopy(guard,c,{allowMissing:true,verifiedProducts});if(checked.op?.state==='purged'){result.already_purged.push(c.path);continue;}
    await onStage('locked',c);
    if(!checked.metadata){const identity=await fileIdentity(c.path),metadata={authorization_scope:'approved_redundant_32',authorization_hash:approvedRedundantCopyHash,authorized_copy:copyIdentity(c),file_identity:identity,storage_root:proposal.storage_root,database:proposal.database,backup:verified.backup,recovery_proof:recoveryProof};
     if(c.group==='completed_temporary_copy'){
      const descriptor={relative_path:c.path,product_id:c.product_id,asset_id:c.asset_id,kind:c.path.endsWith('.glb')?'glb':'png',sha256:c.sha256,byte_size:c.byte_size};
      const id=randomUUID();await journal.execute("INSERT INTO storage_cleanup_operations(id,file_key,state,descriptor,purge_intent_at,purge_metadata) VALUES (?,?,'purge_planned',?,UTC_TIMESTAMP(6),?)",[id,key(c.path),JSON.stringify(descriptor),JSON.stringify(metadata)]);
     }else await journal.execute("UPDATE legacy_retirement_operations SET state='purge_planned',purge_intent_at=UTC_TIMESTAMP(6),purge_metadata=?,last_error=NULL WHERE id=?",[JSON.stringify(metadata),c.operation_id]);
    }
    await onStage('intent',c);checked=await verifyApprovedCopy(guard,c,{allowMissing:true,verifiedProducts});
    if(checked.present){await readVerifiedStorageFile(c.path,c);if(stable(await fileIdentity(c.path))!==stable(checked.metadata.file_identity))throw fail('File changed immediately before authorized removal.');await fs.unlink(await safeStoragePath(c.path));}
    await onStage('unlinked',c);await journal.execute(`UPDATE ${checked.table} SET state='purged',purged_at=COALESCE(purged_at,UTC_TIMESTAMP(6)),last_error=NULL WHERE id=?`,[checked.op.id]);result.purged.push({path:c.path,operation_id:checked.op.id,sha256:c.sha256,byte_size:c.byte_size});
    await onStage('completed',c);
   }
   for(const f of proposal.protectedFiles)await readVerifiedStorageFile(f.path,f);for(const c of proposal.candidates)await pruneApprovedEmptyParents(c.path);await guard.commit();transaction=false;return result;
  }catch(error){if(transaction)await guard.rollback();if(active){const checked=await approvedCopyOperation(guard,active).catch(()=>null);if(checked?.op)await guard.execute(`UPDATE ${checked.table} SET last_error=? WHERE id=?`,[String(error.code||error.message).slice(0,500),checked.op.id]).catch(()=>{});}throw error;}
  finally{if(journal)await journal.end();for(const name of uploadLocks.reverse())await guard.execute('SELECT RELEASE_LOCK(?)',[name]).catch(()=>{});}
 });
}
