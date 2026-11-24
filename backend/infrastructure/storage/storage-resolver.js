// ALTEGO necesita resolver el acceso autorizado y seguro a archivos de Storage.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {productStorageFile} from './product-layout.js';
import {pendingUploadPath,creatorStorageEnabled} from './storage-identity.js';
import fs from 'node:fs/promises';
import {maintenancePath} from './storage-maintenance-paths.js';
import path from 'node:path';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const storageRoot=process.env.ALTEGO_STORAGE_ROOT||fileURLToPath(new URL('../../../storage/',import.meta.url));
const fail=message=>Object.assign(new Error(message),{status:409});
export const validAssetId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const positive=id=>Number.isSafeInteger(Number(id))&&Number(id)>0;


export function assetLocation(asset,representation='preview',context={}){
 if(!validAssetId(asset?.id)||!['glb','png'].includes(asset.kind)||!['original','preview'].includes(representation))throw fail('Invalid storage identifier.');
 const layout=asset.storage_layout||'legacy';
 if(context.productId!=null&&asset.product_id!=null&&Number(asset.product_id)!==Number(context.productId))throw fail('The file belongs to another item.');
 if(layout==='legacy'&&creatorStorageEnabled())throw fail('Legacy storage must be migrated before serving this resource.');
 if(layout==='legacy')return path.join('maintenance','legacy',representation==='original'?'originals':'previews',asset.id+'.'+asset.kind);
 if(layout==='temporary'){
  if(!positive(asset.owner_id))throw fail('Invalid upload owner.');
  return pendingUploadPath(asset.owner_id,asset.id,representation,asset.kind);
 }
 if(layout==='product'){
  if(!positive(context.creatorId)||!positive(context.productId)||asset.product_id!=null&&Number(asset.product_id)!==Number(context.productId)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw fail('Invalid product storage context.');
  const digest=context.contentHash||asset.sha256;if(!/^[a-f0-9]{64}$/.test(digest))throw fail('Invalid product content hash.');
  return productStorageFile({id:context.productId,owner_id:context.creatorId},{kind:asset.kind,sha256:digest,storage_version:context.storageVersion});
 }
 throw fail('Unsupported storage layout.');
}


export async function safeStoragePath(relative,{createParents=false}={}){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'||p.includes(':')))throw fail('Unsafe storage path.');
 relative=maintenancePath(relative);
 const root=path.resolve(storageRoot);
 if(createParents)await fs.mkdir(root,{recursive:true});
 const rootStat=await fs.lstat(root);if(rootStat.isSymbolicLink()||!rootStat.isDirectory())throw fail('Unsafe storage root.');
 const canonicalRoot=await fs.realpath(root);let current=root;
 const pieces=relative.split(/[\\/]/);
 for(let i=0;i<pieces.length;i++){
  current=path.join(current,pieces[i]);
  let stat;try{stat=await fs.lstat(current);}catch(error){
   if(error.code!=='ENOENT')throw error;
   if(i===pieces.length-1)break;
   if(!createParents)throw error;
   try{await fs.mkdir(current);}catch(e){if(e.code!=='EEXIST')throw e;}
   stat=await fs.lstat(current);
  }
  if(stat.isSymbolicLink()||(i<pieces.length-1&&!stat.isDirectory())||(i===pieces.length-1&&!stat.isFile()))throw fail('Unsafe storage link or file.');
  const actual=await fs.realpath(current);if(!actual.startsWith(canonicalRoot+path.sep))throw fail('Storage path escapes its root.');
 }
 return current;
}

async function assetFileDescriptor(sql,asset,representation,context){
 if(context.productId!=null&&asset.product_id!=null&&Number(context.productId)!==Number(asset.product_id))throw fail('The file belongs to another item.');
 const metadata=typeof asset.metadata==='string'?JSON.parse(asset.metadata):asset.metadata;if(metadata?.temporary_deleted||metadata?.temporary_delete_pending)throw fail('The upload was permanently removed.');
 if(asset.storage_state&&asset.storage_state!=='ready')throw fail('The upload is not ready.');
 let retainedAcquisition=false;


 if(context.acquisition){
  const grant=context.acquisition;
  if(!sql||!positive(context.productId)||!positive(grant.buyerId)||!positive(grant.versionId)||!(validAssetId(grant.variantId)||grant.variantId==='legacy-'+Number(context.productId)))throw fail('Invalid acquired storage context.');
  const {entitledVersion}=await import('../../modules/commerce/acquisitions.js');
  const authorized=await entitledVersion(sql,grant.buyerId,Number(context.productId),grant.variantId,grant.versionId);
  const [refs]=await sql.execute('SELECT variant_id FROM version_variants WHERE version_id=? AND variant_id=? AND (model_asset_id=? OR texture_asset_id=?)',[grant.versionId,grant.variantId,asset.id,asset.id]);
  if(!authorized||!refs.length)throw fail('The acquisition does not authorize this historical file.');retainedAcquisition=true;
 }
 let resolvedContext=context,expected=asset;
 if(asset.storage_layout==='product'||sql&&['legacy',undefined].includes(asset.storage_layout)){
  const [rows]=await sql.execute('SELECT f.*,p.owner_id FROM asset_file_links l JOIN product_files f ON f.id=l.file_id JOIN productos p ON p.id=f.product_id WHERE l.asset_id=? AND l.representation=?'+(retainedAcquisition?' AND p.id=?':' AND p.purged_at IS NULL'),retainedAcquisition?[asset.id,representation,Number(context.productId)]:[asset.id,representation]);
  const file=context.productId!=null?rows.find(f=>Number(f.product_id)===Number(context.productId)):rows.sort((a,b)=>a.product_id-b.product_id)[0];
  if(!file&&asset.storage_layout!=='product')return {relative:assetLocation(asset,representation,context),expected};
  if(!file||asset.product_id!=null&&file.product_id!==asset.product_id||file.creator_id!==file.owner_id||file.kind!==asset.kind||representation==='original'&&(file.sha256!==asset.sha256||file.byte_size!==asset.byte_size))throw fail('Product file references are inconsistent.');
  resolvedContext={...context,productId:context.productId??file.product_id,creatorId:file.creator_id,contentHash:file.sha256,storageVersion:file.storage_version};expected=file;
 }
 return {relative:assetLocation(expected===asset?asset:{...asset,storage_layout:'product'},representation,resolvedContext),expected};
}
export async function resolveAssetFile(sql,asset,representation='preview',context={}){
 const descriptor=await assetFileDescriptor(sql,asset,representation,context);
 const {assertNoPurgeIntent}=await import('./storage-cleanup.js');await assertNoPurgeIntent(sql,descriptor.relative);
 try{const file=await safeStoragePath(descriptor.relative);await fs.lstat(file);return file;}catch(error){
  if(error.code!=='ENOENT'||!sql)throw error;const {quarantinedFile}=await import('./storage-cleanup.js');return quarantinedFile(sql,descriptor.relative,descriptor.expected,{pathOnly:true});
 }
}
export async function readVerifiedStorageFile(relative,expected){
 const file=await safeStoragePath(relative);
 const flags=constants.O_RDONLY|(process.platform==='win32'?0:(constants.O_NOFOLLOW||0));
 const handle=await fs.open(file,flags);
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.size>25*1024*1024)throw fail('Invalid storage file.');
  await safeStoragePath(relative);const data=await handle.readFile();
  if(data.length!==expected.byte_size||createHash('sha256').update(data).digest('hex')!==expected.sha256)throw fail('Storage file integrity check failed.');
  return data;
 }finally{await handle.close();}
}
export async function readAssetFile(sql,asset,representation='preview',context={}){
 const descriptor=await assetFileDescriptor(sql,asset,representation,context);
 const {assertNoPurgeIntent}=await import('./storage-cleanup.js');await assertNoPurgeIntent(sql,descriptor.relative);
 try{return await readVerifiedStorageFile(descriptor.relative,descriptor.expected);}catch(error){
  if(error.code!=='ENOENT'||!sql)throw error;
  const {quarantinedFile}=await import('./storage-cleanup.js');return quarantinedFile(sql,descriptor.relative,descriptor.expected);
 }
}

export async function writeAssetFile(asset,representation,data){
 const relative=assetLocation(asset,representation),file=await safeStoragePath(relative,{createParents:true});
 const handle=await fs.open(file,'wx');
 try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}

 const persisted=await fs.readFile(await safeStoragePath(relative));
 if(persisted.length!==data.length||createHash('sha256').update(persisted).digest('hex')!==asset.sha256)throw fail('Upload verification failed.');
}
