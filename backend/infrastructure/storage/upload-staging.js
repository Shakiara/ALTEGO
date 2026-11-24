// ALTEGO necesita resolver la preparación recuperable de archivos cargados.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {lifecycleReady,discardTemporary} from './upload-retention.js';
import fs from 'node:fs/promises';
import {inventoryCreator,MiB,quotaReady,productStorageSummary} from './storage-quotas.js';
import {storageRoot} from './storage-resolver.js';
import {creatorStorageEnabled} from './storage-identity.js';
import {trackUploadFiles} from './storage-cleanup.js';
import {incorporateProductAsset} from '../../modules/products/product-storage.js';
import {randomUUID,createHash} from 'node:crypto';
import {writeAssetFile,readAssetFile,validAssetId} from './storage-resolver.js';

const fail=(message,status=409)=>Object.assign(new Error(message),{status});
async function connection(sql){return sql.getConnection?sql.getConnection():sql;}
async function lock(sql,id){const [rows]=await sql.execute('SELECT GET_LOCK(?,0) AS acquired',['altego_upload_'+id]);return rows[0].acquired===1;}
async function unlock(sql,id){await sql.execute('SELECT RELEASE_LOCK(?)',['altego_upload_'+id]).catch(()=>{});}

export async function storeTemporaryUpload(pool,ownerId,kind,data,metadata){
 const guard=await connection(pool),name='altego_pending_upload_'+ownerId;let locked=false;
 try{const [[lock]]=await guard.execute('SELECT GET_LOCK(?,0) acquired',[name]);if(Number(lock.acquired)!==1)throw fail('Another upload is in progress. Please try again.');locked=true;
  if(creatorStorageEnabled()){const files=(await inventoryCreator(ownerId)).filter(f=>f.path.includes('/uploads/pending/'));if(files.length+2>128||files.reduce((n,f)=>n+f.bytes,0)+data.length*2>250*MiB)throw fail('Temporary upload limit reached. Save your pending files before uploading more.',413);}
  if(await quotaReady(guard)){const summary=await productStorageSummary(guard,ownerId);if(summary.limit_bytes!==null&&summary.used_bytes+data.length>summary.limit_bytes)throw fail('Product Storage limit reached. Available: '+summary.available_bytes+' bytes; required: '+data.length+' bytes.',413);}
  const disk=await fs.statfs(storageRoot);if(Number(disk.bavail)*Number(disk.bsize)<data.length*2+16*MiB)throw fail('Not enough disk space for this upload.',507);
  return await storeTemporaryUploadUnchecked(guard,ownerId,kind,data,metadata);
 }catch(error){if(error.temporary_asset_id&&await lifecycleReady(guard))await discardTemporary(pool,error.temporary_asset_id,{owner:ownerId}).catch(cleanup=>console.error('Failed upload cleanup:',cleanup.code||cleanup.name));throw error;}finally{if(locked)await guard.execute('SELECT RELEASE_LOCK(?)',[name]);if(pool.getConnection)guard.release();}
}
async function storeTemporaryUploadUnchecked(pool,ownerId,kind,data,metadata){
 const sql=await connection(pool),id=randomUUID();let inserted=false,locked=false;
 const asset={id,owner_id:ownerId,kind,sha256:createHash('sha256').update(data).digest('hex'),byte_size:data.length,metadata,storage_layout:'temporary',storage_state:'pending',product_id:null};
 try{
  locked=await lock(sql,id);if(!locked)throw fail('Upload is busy.');

  await sql.execute("INSERT INTO assets(id,owner_id,kind,sha256,byte_size,metadata,storage_layout,storage_state) VALUES (?,?,?,?,?,?,'temporary','pending')",[id,ownerId,kind,asset.sha256,data.length,JSON.stringify(metadata)]);inserted=true;if(await lifecycleReady(sql))await sql.execute('UPDATE assets SET last_activity_at=UTC_TIMESTAMP(6),retention_protected=FALSE WHERE id=?',[id]);
  await writeAssetFile(asset,'original',data);await writeAssetFile(asset,'preview',data);
  const [result]=await sql.execute("UPDATE assets SET storage_state='ready' WHERE id=? AND storage_state='pending'",[id]);
  if(result.affectedRows!==1)throw fail('Upload state changed. Please upload the file again.');
  if(await lifecycleReady(sql))await sql.execute('UPDATE assets SET last_activity_at=UTC_TIMESTAMP(6) WHERE id=?',[id]);await trackUploadFiles(sql,id);
  return {id,kind,...metadata,preview_url:'/api/previews/'+id};
 }catch(error){

  if(inserted)await sql.execute("UPDATE assets SET storage_state='failed' WHERE id=? AND storage_state='pending'",[id]).catch(()=>{});
  if(inserted)error.temporary_asset_id=id;throw error;
 }finally{if(locked)await unlock(sql,id);if(pool.getConnection)sql.release();}
}

export async function bindTemporaryUpload(sql,asset,product,journal=sql){
 if(asset.storage_state&&asset.storage_state!=='ready')throw fail('The upload is not ready.');
 if(asset.product_id!=null&&Number(asset.product_id)!==Number(product.id))throw fail('The file is already linked to another item.');
 if(asset.storage_layout==='product'){await readAssetFile(sql,asset,'original',{productId:product.id});await readAssetFile(sql,asset,'preview',{productId:product.id});return;}
 if(asset.storage_layout!=='temporary')return;

 await readAssetFile(sql,asset,'original',{productId:product.id});
 await readAssetFile(sql,asset,'preview',{productId:product.id});
 await incorporateProductAsset(journal,sql,asset,product);if(await lifecycleReady(sql))await sql.execute('UPDATE assets SET last_activity_at=UTC_TIMESTAMP(6) WHERE id=?',[asset.id]);
}


export async function recoverTemporaryUploads(pool,{minAgeMinutes=30}={}){
 if(!Number.isSafeInteger(minAgeMinutes)||minAgeMinutes<0)throw fail('Invalid recovery age.');
 const [candidates]=await pool.execute("SELECT id FROM assets WHERE storage_layout='temporary' AND storage_state IN ('pending','failed') AND created_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MINUTE)",[minAgeMinutes]);
 const result={ready:[],failed:[],busy:[]};
 for(const item of candidates){
  if(!validAssetId(item.id))throw fail('Invalid upload identifier.');
  const sql=await connection(pool);let locked=false;
  try{
   locked=await lock(sql,item.id);if(!locked){result.busy.push(item.id);continue;}
   const [rows]=await sql.execute('SELECT * FROM assets WHERE id=?',[item.id]);const asset=rows[0];
   if(!asset||!['pending','failed'].includes(asset.storage_state)||asset.storage_layout!=='temporary')continue;
   try{await readAssetFile(sql,{...asset,storage_state:'ready'},'original');await readAssetFile(sql,{...asset,storage_state:'ready'},'preview');
    await sql.execute("UPDATE assets SET storage_state='ready' WHERE id=? AND storage_state IN ('pending','failed')",[asset.id]);await trackUploadFiles(sql,asset.id);result.ready.push(asset.id);
   }catch{
    await sql.execute("UPDATE assets SET storage_state='failed' WHERE id=? AND storage_state IN ('pending','failed')",[asset.id]);result.failed.push(asset.id);
   }
  }finally{if(locked)await unlock(sql,item.id);if(pool.getConnection)sql.release();}
 }
 return result;
}
