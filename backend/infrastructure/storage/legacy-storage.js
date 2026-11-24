// ALTEGO necesita resolver la compatibilidad y recuperación de recursos de formatos anteriores.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {storageRoot,assetLocation,readVerifiedStorageFile,readAssetFile,safeStoragePath} from './storage-resolver.js';
import {persistContent,productFileLocation,syncProductIndexesLocked} from '../../modules/products/product-storage.js';
import {validateSnapshot} from '../../modules/products/history.js';
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const digest=data=>createHash('sha256').update(data).digest('hex');
const fail=message=>Object.assign(new Error(message),{code:'LEGACY_STORAGE_CONFLICT'});

export {storageReferences} from './storage-references.js';
import {storageReferences} from './storage-references.js';

async function legacyDescriptor(asset){
 const result={};
 for(const role of ['original','preview']){
  const relative=assetLocation({...asset,storage_layout:'legacy',product_id:null},role);
  const data=await readVerifiedStorageFile(relative,asset);
  result[role]={kind:asset.kind,sha256:digest(data),byte_size:data.length};
 }
 return result;
}

export async function inventoryLegacyStorage(sql){
 const state=await storageReferences(sql),owners=new Map(),descriptors={};
 for(const [productId,refs]of state.refs)for(const id of refs.keys()){if(!owners.has(id))owners.set(id,[]);owners.get(id).push(productId);}
 const legacy=state.assets.filter(a=>a.storage_layout==='legacy');
 for(const a of legacy)descriptors[a.id]=await legacyDescriptor(a);
 const products=[];let required=0;
 for(const p of state.products){const resources=[...state.refs.get(p.id).values()].filter(a=>a.storage_layout==='legacy');if(!resources.length)continue;
  const unique=new Map();for(const a of resources)for(const d of Object.values(descriptors[a.id]))unique.set(d.kind+':'+d.sha256,d.byte_size);
  required+=[...unique.values()].reduce((a,b)=>a+b,0);
  products.push({id:p.id,creator_id:p.owner_id,status:p.status,purged:!!p.purged_at,resources:resources.map(a=>a.id),physical_files:unique.size,versions:state.versions.filter(v=>v.product_id===p.id).length});
 }
 const extras=[];let legacyFiles=0;
 for(const directory of ['originals','previews']){for(const name of await fs.readdir(path.join(storageRoot,'maintenance','legacy',directory))){
  const relative=path.join('maintenance','legacy',directory,name);const bytes=await fs.readFile(await safeStoragePath(relative));legacyFiles++;
  if(!state.assets.some(a=>name===a.id+'.'+a.kind))extras.push({relative,byte_size:bytes.length,sha256:digest(bytes)});
 }}
 const disk=await fs.statfs(storageRoot);const available=disk.bavail*disk.bsize;
 return {products,legacy_resources:legacy.length,legacy_files:legacyFiles,snapshots:state.versions.length,
  orphans:legacy.filter(a=>!owners.has(a.id)).map(a=>a.id),shared:[...owners].filter(([,p])=>p.length>1).map(([asset_id,products])=>({asset_id,products})),
  descriptors,unregistered_files:extras,copy_bytes_upper_bound:required,available_bytes:available,sufficient_space:available>required+16*1024*1024};
}

async function verifyProduct(sql,product,refs,versions){
 for(const asset of refs.values())for(const role of ['original','preview'])await readAssetFile(sql,asset,role,{productId:product.id});

 for(const version of versions.filter(v=>v.product_id===product.id))await validateSnapshot(sql,version,product.id,true);
}

export async function migrateLegacyProducts(pool,{onStage=async()=>{},productIds=null}={}){
 const journal=await pool.getConnection();const result={completed:[],already_completed:[]};
 try{
  const [lock]=await journal.query("SELECT GET_LOCK('altego_legacy_storage_migration',0) AS acquired");if(lock[0].acquired!==1)throw fail('Another Legacy migration is running.');
  const [schema]=await journal.execute('SELECT id FROM schema_migrations WHERE id=?',['007_legacy_storage']);if(!schema.length)throw fail('Apply storage schema 007 before migration.');
  const inventory=await inventoryLegacyStorage(journal);if(!inventory.sufficient_space)throw fail('Insufficient storage space.');
  const [previous]=await journal.query('SELECT product_id FROM storage_migrations ORDER BY product_id');
  const ids=[...new Set([...inventory.products.map(p=>p.id),...previous.map(p=>p.product_id)])].sort((a,b)=>a-b).filter(id=>!productIds||productIds.includes(id));
  for(const productId of ids){const sql=await pool.getConnection();let prepared=false;
   try{

    await sql.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await sql.beginTransaction();

    const [rows]=await sql.execute('SELECT * FROM productos WHERE id=? FOR UPDATE',[productId]);const product=rows[0];if(!product)throw fail('Migration product no longer exists.');
    let state=await storageReferences(sql),refs=state.refs.get(productId);
    const assetIds=[...refs.keys()].sort();
    if(assetIds.length)await sql.query('SELECT id FROM assets WHERE id IN (?) ORDER BY id FOR UPDATE',[assetIds]);
    state=await storageReferences(sql);refs=state.refs.get(productId);
    const [prior]=await sql.execute('SELECT * FROM storage_migrations WHERE product_id=?',[productId]);
    const [mapped]=await sql.execute('SELECT asset_id FROM asset_file_links WHERE product_id=?',[productId]);
    const legacy=[...refs.values()].filter(a=>a.storage_layout==='legacy'&&!mapped.some(m=>m.asset_id===a.id));
    if(prior[0]?.state==='completed'&&!legacy.length){
     await verifyProduct(sql,product,refs,state.versions);await sql.commit();result.already_completed.push(productId);continue;
    }
    const descriptor={};
    for(const a of legacy)descriptor[a.id]=await legacyDescriptor(a);

    await journal.execute("INSERT INTO storage_migrations(product_id,creator_id,state,inventory) VALUES (?,?,'preparing',?) ON DUPLICATE KEY UPDATE state='preparing',inventory=VALUES(inventory),last_error=NULL",[productId,product.owner_id,JSON.stringify(descriptor)]);prepared=true;
    await onStage('locked',productId);
    for(const a of legacy)for(const role of ['original','preview']){
     const data=await readVerifiedStorageFile(assetLocation(a,role),descriptor[a.id][role]);
     await persistContent(product,descriptor[a.id][role],data,{sql});
     await onStage('copied',productId,a.id);
     await readVerifiedStorageFile(productFileLocation(product,descriptor[a.id][role]),descriptor[a.id][role]);
    }
    await onStage('verified',productId);
    await sql.execute("INSERT INTO product_storage(product_id,creator_id,index_state) VALUES (?,?,'pending') ON DUPLICATE KEY UPDATE index_state='pending'",[productId,product.owner_id]);
    for(const a of legacy){
     for(const role of ['original','preview']){
      const file=descriptor[a.id][role];
      await sql.execute('INSERT INTO product_files(product_id,creator_id,kind,sha256,byte_size) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[productId,product.owner_id,file.kind,file.sha256,file.byte_size]);
      const [files]=await sql.execute('SELECT * FROM product_files WHERE product_id=? AND kind=? AND sha256=?',[productId,file.kind,file.sha256]);
      if(files[0].creator_id!==product.owner_id||files[0].byte_size!==file.byte_size)throw fail('Canonical metadata conflicts with Legacy bytes.');
      await sql.execute('INSERT INTO asset_file_links(product_id,asset_id,representation,file_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE file_id=VALUES(file_id)',[productId,a.id,role,files[0].id]);
     }
     const referencedBy=[...state.refs].filter(([,r])=>r.has(a.id)).map(([id])=>id);

     const [links]=await sql.execute("SELECT DISTINCT product_id FROM asset_file_links WHERE asset_id=? AND representation='original'",[a.id]);
     if(referencedBy.every(id=>links.some(l=>l.product_id===id)))await sql.execute("UPDATE assets SET storage_layout='product',product_id=? WHERE id=?",[referencedBy.length===1?productId:null,a.id]);
    }
    const after=await storageReferences(sql);await verifyProduct(sql,product,after.refs.get(productId),after.versions);
    await syncProductIndexesLocked(sql,productId);
    await onStage('before_commit',productId);
    await sql.execute("UPDATE storage_migrations SET state='completed',last_error=NULL WHERE product_id=?",[productId]);
    await sql.commit();result.completed.push(productId);
   }catch(error){
    await sql.rollback();
    if(prepared)await journal.execute("UPDATE storage_migrations SET state='failed',last_error=? WHERE product_id=? AND state<>'completed'",[String(error.code||error.message).slice(0,500),productId]).catch(()=>{});
    error.migrationResult=result;throw error;
   }finally{sql.release();}
  }
  return result;
 }finally{await journal.query("SELECT RELEASE_LOCK('altego_legacy_storage_migration')").catch(()=>{});journal.release();}
}
