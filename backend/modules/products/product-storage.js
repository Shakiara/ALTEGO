// ALTEGO necesita resolver la incorporación de archivos y los índices de productos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {productStorageDirectory,productStorageFile,prepareProductDirectory,prepareContentVersion,readableStorageEnabled} from '../../infrastructure/storage/product-layout.js';
import {withStorageWrite} from '../../infrastructure/storage/storage-quotas.js';
import {trackProductFiles,resetUploadRetention,protectPreparation,confirmProductRetention,assertNoPurgeIntent,recordStorageArtifact,completeStorageArtifact} from '../../infrastructure/storage/storage-cleanup.js';
import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {safeStoragePath,readAssetFile,readVerifiedStorageFile,validAssetId} from '../../infrastructure/storage/storage-resolver.js';

const parse=value=>typeof value==='string'?JSON.parse(value):value;
const fail=message=>Object.assign(new Error(message),{status:409});
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const hash=data=>createHash('sha256').update(data).digest('hex');
export function productDirectory(product){
 if(!positive(product?.id)||!positive(product.owner_id))throw fail('Invalid product storage owner.');
 return productStorageDirectory(product);
}
export function productFileLocation(product,file){
 if(!['glb','png'].includes(file.kind)||!/^[a-f0-9]{64}$/.test(file.sha256))throw fail('Invalid product file identifier.');
 return productStorageFile(product,file);
}

export async function persistContent(product,file,data,{sql=null}={}){
 const relative=productFileLocation(product,file);let exists=false;try{await readVerifiedStorageFile(relative,file);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(exists)return;
 if(!sql)return persistContentUnchecked(product,file,data,{sql});
 return withStorageWrite(sql,product.owner_id,data.length,()=>persistContentUnchecked(product,file,data,{sql}));
}
async function persistContentUnchecked(product,file,data,{sql=null}={}){
 const relative=productFileLocation(product,file);
 if(sql)await assertNoPurgeIntent(sql,relative);
 const destination=await safeStoragePath(relative,{createParents:true});
 try{await fs.lstat(destination);await readVerifiedStorageFile(relative,file);return;}catch(error){if(error.code!=='ENOENT')throw error;}

 const stageRelative=path.join(path.dirname(relative),'.pending-'+randomUUID()+'.tmp');
 const stage=await safeStoragePath(stageRelative,{createParents:true});
 if(sql)await recordStorageArtifact(sql,product,stageRelative,file.kind,data);
 const handle=await fs.open(stage,'wx');try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
 await readVerifiedStorageFile(stageRelative,file);
 try{

  await fs.link(await safeStoragePath(stageRelative),await safeStoragePath(relative));
 }catch(error){if(error.code!=='EEXIST')throw error;}
 await readVerifiedStorageFile(relative,file);

 await fs.unlink(await safeStoragePath(stageRelative));
 if(sql)await completeStorageArtifact(sql,stageRelative);
}


export async function prepareProductAsset(pool,sql,asset,product){
 const config=sql.connection?.config;if(!config)throw fail('Storage journal connection is unavailable.');

 const options=Object.fromEntries(['host','port','user','password','database','socketPath','ssl','timezone','decimalNumbers'].map(k=>[k,config[k]]).filter(([,v])=>v!==undefined));
 const journal=await mysql.createConnection(options);
 try{return await prepareWithJournal(journal,sql,asset,product);}finally{await journal.end();}
}
async function prepareWithJournal(journal,sql,asset,product){
 if(!validAssetId(asset.id)||asset.storage_layout!=='temporary'||asset.storage_state!=='ready')throw fail('The temporary upload is unavailable.');
 if(asset.product_id!=null&&Number(asset.product_id)!==Number(product.id))throw fail('The file belongs to another item.');
 await prepareProductDirectory(sql,product,journal);
 productDirectory(product);
 const original=await readAssetFile(sql,asset,'original',{productId:product.id});
 const preview=await readAssetFile(sql,asset,'preview',{productId:product.id});
 const data={original,preview};const descriptor={};
 for(const role of ['original','preview'])descriptor[role]=await prepareContentVersion(sql,product,{kind:asset.kind,sha256:hash(data[role]),byte_size:data[role].length},journal);
 const [prior]=await journal.execute('SELECT * FROM storage_incorporations WHERE asset_id=? AND product_id=?',[asset.id,product.id]);
 if(prior.length&&(prior[0].creator_id!==product.owner_id||JSON.stringify(parse(prior[0].descriptor))!==JSON.stringify(descriptor))){

  if(prior[0].creator_id!==product.owner_id||!['original','preview'].every(role=>Object.entries(descriptor[role]).every(([k,v])=>parse(prior[0].descriptor)[role]?.[k]===v)))throw fail('Storage preparation conflicts with an earlier attempt.');
 }
 await journal.execute("INSERT INTO storage_incorporations(asset_id,product_id,creator_id,descriptor,status) VALUES (?,?,?,?,'preparing') ON DUPLICATE KEY UPDATE status=IF(status='committed','committed','preparing'),last_error=NULL",[asset.id,product.id,product.owner_id,JSON.stringify(descriptor)]);
 await protectPreparation(journal,asset,product,descriptor);
 try{
  for(const role of ['original','preview'])await persistContent(product,descriptor[role],data[role],{sql});
  await journal.execute("UPDATE storage_incorporations SET status='prepared',last_error=NULL WHERE asset_id=? AND product_id=? AND status<>'committed'",[asset.id,product.id]);
  return descriptor;
 }catch(error){
  await journal.execute('UPDATE storage_incorporations SET last_error=? WHERE asset_id=? AND product_id=?',[String(error.code||'PREPARATION_FAILED').slice(0,120),asset.id,product.id]).catch(()=>{});
  throw error;
 }
}

export async function incorporateProductAsset(journal,sql,asset,product){
 const descriptor=await prepareProductAsset(journal,sql,asset,product);

 await sql.execute("INSERT INTO product_storage(product_id,creator_id,index_state) VALUES (?,?,'pending') ON DUPLICATE KEY UPDATE index_state='pending'",[product.id,product.owner_id]);
 for(const role of ['original','preview']){
  const file=descriptor[role];
  if(readableStorageEnabled())await sql.execute('INSERT INTO product_files(product_id,creator_id,kind,sha256,byte_size,storage_version) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[product.id,product.owner_id,file.kind,file.sha256,file.byte_size,file.storage_version??null]);else await sql.execute('INSERT INTO product_files(product_id,creator_id,kind,sha256,byte_size) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[product.id,product.owner_id,file.kind,file.sha256,file.byte_size]);
  const [rows]=await sql.execute('SELECT * FROM product_files WHERE product_id=? AND kind=? AND sha256=?',[product.id,file.kind,file.sha256]);
  if(rows[0].creator_id!==product.owner_id||rows[0].byte_size!==file.byte_size)throw fail('Product file metadata conflicts with stored content.');
  await sql.execute('INSERT INTO asset_file_links(product_id,asset_id,representation,file_id) VALUES (?,?,?,?)',[product.id,asset.id,role,rows[0].id]);
 }
 await sql.execute("UPDATE assets SET storage_layout='product',product_id=? WHERE id=? AND storage_layout='temporary'",[product.id,asset.id]);
 await sql.execute("UPDATE storage_incorporations SET status='committed',last_error=NULL WHERE asset_id=? AND product_id=?",[asset.id,product.id]);
 await resetUploadRetention(sql,asset.id);
}

export async function markProductIndexesPending(sql,productId){
 await trackProductFiles(sql,productId);
 await sql.execute("UPDATE product_storage SET index_state='pending' WHERE product_id=?",[productId]);
}

async function writeIndex(relative,value,sql,product){
 const bytes=Buffer.byteLength(JSON.stringify(value,null,2)+'\n');let previous=0;try{previous=(await fs.stat(await safeStoragePath(relative))).size;}catch(error){if(error.code!=='ENOENT')throw error;}
 return withStorageWrite(sql,product.owner_id,Math.max(0,bytes-previous),()=>writeIndexUnchecked(relative,value,sql,product));
}
async function writeIndexUnchecked(relative,value,sql,product){
 const content=Buffer.from(JSON.stringify(value,null,2)+'\n');const target=await safeStoragePath(relative,{createParents:true});
 try{if((await fs.readFile(target)).equals(content))return;}catch(error){if(error.code!=='ENOENT')throw error;}
 const stageRelative=relative+'.'+randomUUID()+'.tmp',stage=await safeStoragePath(stageRelative,{createParents:true});
 await recordStorageArtifact(sql,product,stageRelative,'json',content);
 const handle=await fs.open(stage,'wx');try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
 await safeStoragePath(relative);await fs.rename(stage,target);await completeStorageArtifact(sql,stageRelative);
}

export async function syncProductIndexes(pool,productId){
 const sql=await pool.getConnection();
 try{
  await sql.beginTransaction();
  await syncProductIndexesLocked(sql,productId);await sql.commit();return {productId};
 }catch(error){await sql.rollback();throw error;}finally{sql.release();}
}


export async function syncProductIndexesLocked(sql,productId){
  const [products]=await sql.execute('SELECT * FROM productos WHERE id=? FOR UPDATE',[productId]);const product=products[0];
  const [managed]=await sql.execute('SELECT * FROM product_storage WHERE product_id=?',[productId]);
  if(!product||!managed.length||product.purged_at)return {skipped:true};
  if(managed[0].creator_id!==product.owner_id)throw fail('The product storage owner changed.');
  await confirmProductRetention(sql,productId);
  const [variants]=await sql.execute('SELECT * FROM variants WHERE product_id=? AND active=TRUE ORDER BY is_default DESC,id',[productId]);
  const [versions]=await sql.execute('SELECT * FROM product_versions WHERE product_id=? ORDER BY version_number',[productId]);
  const [links]=await sql.execute('SELECT l.asset_id,l.representation,f.kind,f.sha256,f.byte_size'+(readableStorageEnabled()?',f.storage_version':'')+' FROM asset_file_links l JOIN product_files f ON f.id=l.file_id WHERE f.product_id=? ORDER BY l.asset_id,l.representation',[productId]);
  const folder=productDirectory(product);
  const physicalFiles=links.map(file=>({...file,path:productFileLocation(product,file).replaceAll('\\','/')}));
  const index=(relative,value)=>writeIndex(relative,value,sql,product);
  const draft={id:product.id,owner_id:product.owner_id,name:product.nombre,description:product.descripcion,category_id:product.categoria_id,price:Number(product.precio),model_asset_id:product.model_asset_id,status:product.status,revision:product.revision,variants};
  await index(path.join(folder,'draft','index.json'),{source:'mysql',draft});

  for(const version of versions){const snapshot=parse(version.snapshot),ids=new Set([snapshot.model_asset_id,...snapshot.variants.map(v=>v.texture_asset_id).filter(Boolean)]);await index(path.join(folder,'versions','v'+version.version_number+'.json'),{source:'mysql',...version,snapshot,files:physicalFiles.filter(file=>ids.has(file.asset_id))});}

  await safeStoragePath(path.join(folder,'versions','index.json'),{createParents:true});
  await index(path.join(folder,'versions','index.json'),{source:'mysql',versions:versions.map(v=>({id:v.id,version_number:v.version_number}))});
  await index(path.join(folder,'metadata.json'),{source:'mysql',product_id:product.id,creator_id:product.owner_id,name:product.nombre,status:product.status,purged_at:product.purged_at,revision:product.revision,current_version_id:product.current_version_id,files:physicalFiles});
  await sql.execute("UPDATE product_storage SET index_state='ready',index_revision=? WHERE product_id=?",[product.revision,productId]);return {revision:product.revision};
}

export async function refreshProductIndexes(pool,productId){
 try{return await syncProductIndexes(pool,productId);}catch(error){

  console.error('Storage index refresh pending:',error.code||'INDEX_REFRESH_FAILED');return {pending:true};
 }
}

export async function recoverProductStorage(pool){
 const [operations]=await pool.query("SELECT * FROM storage_incorporations WHERE status IN ('preparing','prepared') ORDER BY product_id,asset_id");
 const result={prepared:[],superseded:[],failed:[],indexes:[]};
 for(const op of operations){const sql=await pool.getConnection();try{
  await sql.beginTransaction();const [p]=await sql.execute('SELECT * FROM productos WHERE id=? FOR UPDATE',[op.product_id]);
  const [a]=await sql.execute('SELECT * FROM assets WHERE id=? FOR UPDATE',[op.asset_id]);
  if(!p.length||!a.length||p[0].purged_at||p[0].owner_id!==op.creator_id||a[0].storage_layout!=='temporary'||a[0].product_id!=null&&a[0].product_id!==op.product_id){
   await sql.execute("UPDATE storage_incorporations SET status='superseded' WHERE asset_id=? AND product_id=? AND status<>'committed'",[op.asset_id,op.product_id]);result.superseded.push(op.asset_id);
  }else{await prepareProductAsset(pool,sql,a[0],p[0]);result.prepared.push(op.asset_id);}

  await sql.commit();
 }catch(error){await sql.rollback();result.failed.push({asset_id:op.asset_id,code:error.code||'RECOVERY_FAILED'});}finally{sql.release();}}
 const [pending]=await pool.query("SELECT product_id FROM product_storage WHERE index_state='pending'");
 for(const p of pending){try{await syncProductIndexes(pool,p.product_id);result.indexes.push(p.product_id);}catch(error){result.failed.push({product_id:p.product_id,code:error.code||'INDEX_REFRESH_FAILED'});}}
 return result;
}
