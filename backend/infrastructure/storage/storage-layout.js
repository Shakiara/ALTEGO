// ALTEGO necesita resolver los traslados verificados entre distribuciones de Storage.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {storageRoot,readAssetFile} from './storage-resolver.js';
import {maintenancePath} from './storage-maintenance-paths.js';
import {validateSnapshot} from '../../modules/products/history.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const fail=m=>Object.assign(new Error(m),{code:'STORAGE_LAYOUT_CONFLICT'});
const oldRoots=['originals','previews','legacy-quarantine','quarantine','recovery'];
const journalId='maintenance-layout-v1';

async function raw(relative,parents=false){
 if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'||p.includes(':')))throw fail('Unsafe relocation path.');
 let current=path.resolve(storageRoot);const root=await fs.lstat(current);if(!root.isDirectory()||root.isSymbolicLink())throw fail('Unsafe Storage root.');
 for(const [i,piece] of relative.split('/').entries()){
  current=path.join(current,piece);let stat;try{stat=await fs.lstat(current);}catch(e){if(e.code!=='ENOENT')throw e;if(parents&&i<relative.split('/').length-1){await fs.mkdir(current);stat=await fs.lstat(current);}else continue;}
  if(stat&&(stat.isSymbolicLink()||i<relative.split('/').length-1&&!stat.isDirectory()||i===relative.split('/').length-1&&!stat.isFile()))throw fail('Unsafe relocation link or file.');
 }
 return current;
}
async function content(relative){try{const file=await raw(relative),stat=await fs.stat(file);return {sha256:hash(await fs.readFile(file)),byte_size:stat.size};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function scan(directory){const result=[];async function walk(relative){const absolute=path.join(storageRoot,relative);let entries;try{const s=await fs.lstat(absolute);if(s.isSymbolicLink()||!s.isDirectory())throw fail('Unsafe source directory.');entries=await fs.readdir(absolute,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}for(const e of entries){const r=relative+'/'+e.name;if(e.isSymbolicLink())throw fail('Symbolic links require manual review.');if(e.isDirectory())await walk(r);else if(e.isFile())result.push({from:r,to:maintenancePath(r),...await content(r)});else throw fail('Unknown Storage entry.');}}await walk(directory);return result;}
async function emptyDirectories(relative){const full=path.resolve(storageRoot,relative);if(!full.startsWith(path.resolve(storageRoot)+path.sep))throw fail('Invalid obsolete directory.');try{const stat=await fs.lstat(full);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('Unsafe obsolete directory.');for(const e of await fs.readdir(full,{withFileTypes:true})){if(e.isDirectory()&&!e.isSymbolicLink())await emptyDirectories(relative+'/'+e.name);else throw fail('An obsolete directory still contains files.');}await fs.rmdir(full);}catch(e){if(e.code!=='ENOENT')throw e;}}
async function assertBackup(backup,inventory){if(!backup)throw fail('A verified external backup is required.');const root=await fs.realpath(storageRoot),back=await fs.realpath(backup);if(back===root||back.startsWith(root+path.sep))throw fail('Backup must be outside Storage.');const manifest=parse(await fs.readFile(path.join(back,'manifest.json'),'utf8'));for(const [relative,expected]of Object.entries(manifest.files)){const full=path.resolve(back,relative);if(!full.startsWith(back+path.sep)||hash(await fs.readFile(full))!==expected)throw fail('Backup integrity differs.');}for(const e of inventory)if(manifest.files['source/storage/'+e.from]!==e.sha256)throw fail('Relocation file is not covered by backup.');}
async function verifyBusiness(sql){const [assets]=await sql.query("SELECT * FROM assets WHERE storage_state='ready'");for(const a of assets)for(const role of ['original','preview'])await readAssetFile(sql,a,role);const [versions]=await sql.query('SELECT * FROM product_versions');for(const v of versions)await validateSnapshot(sql,v,v.product_id,true);return {assets:assets.length,versions:versions.length};}
export async function inspectStorageLayout(){let files=[];for(const dir of oldRoots)files.push(...await scan(dir));return {storage_root:await fs.realpath(storageRoot),files};}
export async function reorganizeStorage(pool,{backup,confirmation,onStage=async()=>{}}={}){
 if(confirmation!=='REORGANIZE_STORAGE')throw fail('Explicit REORGANIZE_STORAGE confirmation is required.');
 if(/(?:^|[\\/])(?:backups|altego-backups|migration-backups)(?:[\\/]|$)/i.test(storageRoot))throw fail('Backup Storage roots are protected.');
 const sql=await pool.getConnection(),held=[],uploads=[];let journal=null,transaction=false;
 try{
  for(const name of ['altego_storage_layout','altego_storage_cleanup','altego_legacy_retirement','altego_legacy_storage_migration']){const [[r]]=await sql.execute('SELECT GET_LOCK(?,0) AS acquired',[name]);if(r.acquired!==1)throw fail('An incompatible Storage operation is active.');held.push(name);}
  await prepareStorageLayoutSchema(sql);
  const [[prior]]=await sql.execute('SELECT * FROM storage_layout_operations WHERE id=?',[journalId]);
  const journalConnection=await pool.getConnection();
  try{
   if(prior){journal=prior;if(await fs.realpath(storageRoot)!==prior.storage_root)throw fail('Relocation journal belongs to another Storage root.');}
   else {const inventory=(await inspectStorageLayout()).files;await assertBackup(backup,inventory);journal={id:journalId,storage_root:await fs.realpath(storageRoot),backup_path:await fs.realpath(backup),inventory};await journalConnection.execute("INSERT INTO storage_layout_operations(id,state,storage_root,backup_path,inventory) VALUES (?,'prepared',?,?,?)",[journalId,journal.storage_root,journal.backup_path,JSON.stringify(inventory)]);}
   const inventory=parse(journal.inventory);await assertBackup(journal.backup_path,inventory);
   await sql.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await sql.beginTransaction();transaction=true;
   await sql.query('SELECT id FROM productos ORDER BY id FOR UPDATE');
   const [assets]=await sql.query('SELECT id FROM assets ORDER BY id');for(const a of assets){const name='altego_upload_'+a.id;const [[r]]=await sql.execute('SELECT GET_LOCK(?,0) AS acquired',[name]);if(r.acquired!==1)throw fail('An active upload protects the layout.');uploads.push(name);}await sql.query('SELECT id FROM assets ORDER BY id FOR UPDATE');
   const [[pending]]=await sql.query("SELECT (SELECT COUNT(*) FROM storage_incorporations WHERE status IN ('preparing','prepared'))+(SELECT COUNT(*) FROM storage_migrations WHERE state<>'completed')+(SELECT COUNT(*) FROM storage_cleanup_operations WHERE state IN ('planned','purge_planned'))+(SELECT COUNT(*) FROM legacy_retirement_operations WHERE state IN ('planned','purge_planned')) AS count");if(pending.count)throw fail('Resolve pending Storage operations before relocation.');
   const actual=(await inspectStorageLayout()).files;if(actual.some(e=>!inventory.some(i=>i.from===e.from&&i.sha256===e.sha256&&i.byte_size===e.byte_size)))throw fail('Unrecorded source appeared after preflight.');
   for(const e of inventory){const source=await content(e.from),target=await content(e.to);for(const candidate of [source,target])if(candidate&&(candidate.sha256!==e.sha256||candidate.byte_size!==e.byte_size))throw fail('Relocation integrity differs.');if(source&&target||!source&&!target)throw fail('Ambiguous relocation locations.');}
   await onStage('locked',inventory);
   if(prior?.state!=='completed')await journalConnection.execute("UPDATE storage_layout_operations SET state='moving',last_error=NULL WHERE id=?",[journalId]);
   for(const e of inventory){if(await content(e.from)){await fs.rename(await raw(e.from),await raw(e.to,true));await onStage('moved',e);}const check=await content(e.to);if(!check||check.sha256!==e.sha256||check.byte_size!==e.byte_size)throw fail('Relocated file verification failed.');e.verified=true;await journalConnection.execute('UPDATE storage_layout_operations SET inventory=? WHERE id=?',[JSON.stringify(inventory),journalId]);}
   const [legacy]=await sql.query('SELECT id,descriptor FROM legacy_retirement_operations');for(const op of legacy){const d=parse(op.descriptor);if(d.quarantine_path)d.quarantine_path=maintenancePath(d.quarantine_path);await sql.execute('UPDATE legacy_retirement_operations SET descriptor=?,updated_at=updated_at WHERE id=?',[JSON.stringify(d),op.id]);}
   const verified=await verifyBusiness(sql);await onStage('verified',verified);await sql.commit();transaction=false;
   await journalConnection.execute("UPDATE storage_layout_operations SET state='completed',completed_at=COALESCE(completed_at,UTC_TIMESTAMP(6)),last_error=NULL WHERE id=?",[journalId]);
   for(const dir of oldRoots)await emptyDirectories(dir);
   for(const dir of ['maintenance/quarantine','maintenance/legacy','maintenance/recovery']){const probe=await raw(dir+'/__directory_probe__',true);if(path.dirname(probe)!==path.resolve(storageRoot,dir))throw fail('Invalid final directory.');}
   return {state:'completed',movedFiles:inventory.length,...verified,oldRootsRemoved:true};
  }finally{journalConnection.release();}
 }catch(error){if(transaction)await sql.rollback();if(journal)await sql.execute('UPDATE storage_layout_operations SET last_error=? WHERE id=?',[String(error.code||error.message).slice(0,1000),journalId]).catch(()=>{});throw error;}
 finally{for(const name of [...held,...uploads].reverse())await sql.execute('SELECT RELEASE_LOCK(?)',[name]).catch(()=>{});sql.release();}
}


export async function prepareStorageLayoutSchema(sql){await sql.query("CREATE TABLE IF NOT EXISTS storage_layout_operations (id VARCHAR(64) PRIMARY KEY,state ENUM('prepared','moving','completed') NOT NULL,storage_root TEXT NOT NULL,backup_path TEXT NOT NULL,inventory JSON NOT NULL,created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),completed_at DATETIME(6) NULL,last_error TEXT NULL)");}
