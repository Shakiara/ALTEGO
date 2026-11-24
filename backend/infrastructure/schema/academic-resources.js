// ALTEGO necesita importar y comprobar las semillas sin conservar copias de instalación innecesarias.
// Este módulo valida archivos y referencias y retira únicamente seed-assets al terminar correctamente.
import {productStorageFile} from '../storage/product-layout.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {storageRoot,safeStoragePath,readVerifiedStorageFile} from '../storage/storage-resolver.js';

const root=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const seedRoot=path.join(root,'seed-assets');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const folded=p=>process.platform==='win32'?p.toLowerCase():p;
const inside=(parent,p)=>folded(p)===folded(parent)||folded(p).startsWith(folded(parent)+path.sep);
const missing=()=>Error('seed-assets is missing. Restore it from the original ZIP or repository for a completely new installation; never reinitialize an existing database.');

async function assertSeedRoot(){
 if(path.resolve(await fs.realpath(root))!==root||path.dirname(seedRoot)!==root)throw Error('Unsafe installation root.');
 if(root.split(/[\\/]/).some(p=>['archive','backups','altego-backups','execution-results','phase-evidence'].includes(p.toLowerCase())))throw Error('Install from an active project copy, never from an archive or backup.');
 const storage=path.resolve(storageRoot);if(inside(seedRoot,storage)||inside(storage,seedRoot))throw Error('Storage and seed-assets must be separate directories.');
 let stat;try{stat=await fs.lstat(seedRoot);}catch(error){if(error.code==='ENOENT')throw missing();throw error;}
 if(stat.isSymbolicLink()||!stat.isDirectory()||await fs.realpath(seedRoot)!==seedRoot)throw Error('seed-assets must be a regular directory of this installation.');
 return stat;
}
async function seedPath(relative,{create=false}={}){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe seed path.');
 const resolved=path.resolve(seedRoot,relative);if(!inside(seedRoot,resolved)||resolved===seedRoot)throw Error('Seed path escapes its directory.');
 let current=seedRoot;const parts=relative.split(/[\\/]/);
 for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);let stat;try{stat=await fs.lstat(current);}catch(error){if(error.code!=='ENOENT'||!create)throw error;if(i<parts.length-1)await fs.mkdir(current);continue;}if(stat.isSymbolicLink()||i<parts.length-1&&!stat.isDirectory()||i===parts.length-1&&!stat.isFile())throw Error('Unsafe seed file or directory.');}
 return resolved;
}
function seedRelative(asset){
 if(!asset.path?.startsWith('seed-assets/'))throw Error('Seed manifest points outside seed-assets.');
 return asset.path.slice('seed-assets/'.length);
}
async function seedSnapshot(manifest){
 const identity=await assertSeedRoot(),manifestPath=await seedPath('manifest.json'),manifestBytes=await fs.readFile(manifestPath);
 if(JSON.stringify(JSON.parse(manifestBytes))!==JSON.stringify(manifest))throw Error('Seed manifest changed during initialization.');
 if(manifest.format!==1||manifest.products?.length!==2||manifest.products.map(p=>p.id).join(',')!=='1,2')throw Error('Unexpected seed products.');
 const files=[{relative:'manifest.json',bytes:manifestBytes}],allowed=new Set(['manifest.json']),dirs=new Set();
 for(const p of manifest.products){if(p.variants?.length!==(p.id===1?12:17))throw Error('Unexpected seed variants.');for(const asset of p.files){const relative=seedRelative(asset);if(allowed.has(relative)||!['glb','png'].includes(asset.kind)||!relative.endsWith('.'+asset.kind))throw Error('Invalid seed file inventory.');const source=await seedPath(relative),bytes=await fs.readFile(source);if(hash(bytes)!==asset.sha256||bytes.length!==asset.bytes)throw Error('Seed resource integrity check failed.');allowed.add(relative);for(let d=path.dirname(relative);d!=='.';d=path.dirname(d))dirs.add(d.replaceAll('\\','/'));files.push({relative,bytes});}}
 if(files.length!==32)throw Error('Seed inventory must contain 31 resources and its manifest.');
 async function walk(directory,relative=''){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const r=relative?relative+'/'+entry.name:entry.name;if(entry.isSymbolicLink())throw Error('Seed links are not allowed.');if(entry.isDirectory()){if(!dirs.has(r))throw Error('Unexpected seed directory; seeds were retained.');await walk(path.join(directory,entry.name),r);}else if(!entry.isFile()||!allowed.has(r))throw Error('Unexpected seed file; seeds were retained.');}}
 await walk(seedRoot);return {identity,files};
}
export async function readSeedAssetsManifest(){
 await assertSeedRoot();const manifest=JSON.parse(await fs.readFile(await seedPath('manifest.json'),'utf8'));await seedSnapshot(manifest);return manifest;
}
export async function initializeAcademicResources(sql,{confirmedNewInstallation=false,manifest=null}={}){
 if(!confirmedNewInstallation)throw Error('Seed resources require explicit new-installation confirmation.');
 const [[marker]]=await sql.execute("SELECT id FROM schema_migrations WHERE id='academic_seed_v1'");if(!marker)throw Error('The academic seed marker is missing.');
 manifest??=await readSeedAssetsManifest();await seedSnapshot(manifest);const files=[];
 for(const product of manifest.products)for(const asset of product.files){const bytes=await fs.readFile(await seedPath(seedRelative(asset)));const [[stored]]=await sql.execute('SELECT owner_id,kind,sha256,byte_size,storage_layout,product_id FROM assets WHERE id=?',[asset.assetId]);if(!stored||stored.owner_id!==1||stored.kind!==asset.kind||stored.sha256!==asset.sha256||stored.byte_size!==asset.bytes||stored.storage_layout!=='product'||stored.product_id!==product.id)throw Error('Seed registry differs. No files were overwritten.');files.push({path:productStorageFile({id:product.id,owner_id:1},{...asset,storage_version:1}),bytes});}
 try{const stat=await fs.lstat(storageRoot);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unsafe Storage destination.');if((await fs.readdir(storageRoot)).length)throw Error('Seed initialization requires empty Storage. Review partial installations; existing data is never reset.');}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir(storageRoot,{recursive:true});for(const file of files){const destination=await safeStoragePath(file.path,{createParents:true});await fs.writeFile(destination,file.bytes,{flag:'wx'});if(hash(await fs.readFile(destination))!==hash(file.bytes))throw Error('Seed resource copy failed.');}
 await fs.writeFile(path.join(storageRoot,'.academic-resources.json'),JSON.stringify({format:1,complete:false,files:files.length}),{flag:'wx'});return {academic:true,copied:files.length};
}
export async function verifyAcademicResources(sql,manifest){
 const {validateSnapshot}=await import('../../modules/products/history.js');let variants=0,files=0;
 for(const p of manifest.products){const [[product]]=await sql.execute('SELECT * FROM productos WHERE id=?',[p.id]);if(!product||product.owner_id!==1||product.status!=='Published'||product.model_asset_id!==p.modelAssetId)throw Error('Seed product reference differs.');const [[version]]=await sql.execute('SELECT * FROM product_versions WHERE id=? AND product_id=?',[product.current_version_id,p.id]);if(!version||version.version_number!==1)throw Error('Seed version reference differs.');const {s}=await validateSnapshot(sql,version,p.id,true);if(s.variants.length!==p.variants.length||s.model_asset_id!==p.modelAssetId)throw Error('Seed snapshot differs.');
  for(let i=0;i<p.variants.length;i++){const expected=p.variants[i],actual=s.variants[i],texture=p.files.find(f=>f.path===expected.texture);if(!texture||actual.name!==expected.name||actual.hex.toLowerCase()!==expected.hex.toLowerCase()||actual.texture_asset_id!==texture.assetId)throw Error('Seed color reference differs.');variants++;}
  for(const asset of p.files){const [[stored]]=await sql.execute('SELECT * FROM product_files WHERE product_id=? AND kind=? AND sha256=?',[p.id,asset.kind,asset.sha256]);if(!stored||stored.creator_id!==1||stored.byte_size!==asset.bytes||stored.storage_version!==1)throw Error('Seed physical registry differs.');await readVerifiedStorageFile(productStorageFile(product,stored),{sha256:asset.sha256,byte_size:asset.bytes});files++;}}
 if(variants!==29||files!==31)throw Error('Seed totals differ.');await fs.writeFile(path.join(storageRoot,'.academic-resources.json'),JSON.stringify({format:1,complete:true,installationComplete:true,files,products:2,variants,seedAssetsPolicy:'remove-after-verification'}));return {products:2,variants,files};
}
export async function removeInstalledSeedAssets(manifest){
 const snapshot=await seedSnapshot(manifest),current=await fs.lstat(seedRoot);if(current.dev!==snapshot.identity.dev||current.ino!==snapshot.identity.ino)throw Error('Seed directory identity changed.');
 const pending=path.join(root,'.seed-assets-removal-'+randomUUID());if(path.dirname(pending)!==root)throw Error('Unsafe seed cleanup target.');let moved=false;
 try{await fs.rename(seedRoot,pending);moved=true;if((await fs.lstat(pending)).isSymbolicLink()||await fs.realpath(pending)!==pending)throw Error('Unsafe seed cleanup directory.');await fs.rm(pending,{recursive:true});}
 catch(error){if(moved){try{if(await fs.stat(seedRoot).catch(()=>null))throw Error('seed-assets was replaced during cleanup.');if(await fs.stat(pending).catch(()=>null))await fs.rename(pending,seedRoot);else await fs.mkdir(seedRoot);for(const file of snapshot.files){const destination=await seedPath(file.relative,{create:true});try{const bytes=await fs.readFile(destination);if(!bytes.equals(file.bytes))throw Error('Unexpected file during seed recovery.');}catch(readError){if(readError.code!=='ENOENT')throw readError;await fs.writeFile(destination,file.bytes,{flag:'wx'});}}await seedSnapshot(manifest);}catch(recovery){throw Error('Seed cleanup failed; recovery needs review. '+error.message+' / '+recovery.message);}}throw Error('Seed cleanup failed; seed-assets was retained or restored. '+error.message);}
 return {removed:true,files:snapshot.files.length};
}
