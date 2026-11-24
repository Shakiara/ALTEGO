// ALTEGO necesita resolver las ubicaciones estables y legibles de productos y archivos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {createHash} from 'node:crypto';
import path from 'node:path';
import {creatorRoot} from './storage-identity.js';
const directories=new Map(),versions=new Map();let enabled=false;
const positive=n=>Number.isSafeInteger(Number(n))&&Number(n)>0;
const key=(id,file)=>id+':'+file.kind+':'+file.sha256;
export const readableStorageEnabled=()=>enabled;
export function rememberProductDirectory(product,directory){
 if(!positive(product.id)||!positive(product.owner_id)||!new RegExp('^[a-z0-9][a-z0-9-]{0,63}--p'+product.id+'$').test(directory))throw Error('Invalid readable product directory.');
 const prior=directories.get(Number(product.id));if(prior&&(prior.owner!==Number(product.owner_id)||prior.directory!==directory))throw Error('Product directory identity changed.');
 directories.set(Number(product.id),{owner:Number(product.owner_id),directory});
}
export function rememberProductFile(id,file){if(!positive(file.storage_version)||!['glb','png'].includes(file.kind)||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid product content version.');versions.set(key(id,file),Number(file.storage_version));}
export async function loadProductLayouts(sql){
 const ready=Boolean((await sql.execute("SELECT id FROM schema_migrations WHERE id='037_readable_product_storage'"))[0].length);if(!ready){enabled=false;directories.clear();versions.clear();return;}
 const [products]=await sql.query('SELECT p.id,p.owner_id,s.directory_name FROM productos p JOIN product_storage s ON s.product_id=p.id WHERE s.directory_name IS NOT NULL');
 const [files]=await sql.query('SELECT * FROM product_files WHERE storage_version IS NOT NULL');

 enabled=true;for(const p of products)rememberProductDirectory(p,p.directory_name);for(const f of files)rememberProductFile(f.product_id,f);
}
export function productStorageDirectory(product){
 if(!positive(product?.id)||!positive(product.owner_id))throw Error('Invalid product identity.');const record=directories.get(Number(product.id));
 if(record&&record.owner!==Number(product.owner_id))throw Error('Product storage owner differs.');
 return record?path.join(creatorRoot(product.owner_id),record.directory):path.join(creatorRoot(product.owner_id),'products',String(product.id));
}
export function productStorageFile(product,file){
 if(!['glb','png'].includes(file.kind)||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid product content identifier.');const folder=productStorageDirectory(product);
 if(!directories.has(Number(product.id)))return path.join(folder,'assets',file.kind,file.sha256+'.'+file.kind);
 const version=file.storage_version??versions.get(key(product.id,file));if(!positive(version))throw Error('Content version is missing.');
 return path.join(folder,'versions','v'+version,file.kind,file.sha256+'.'+file.kind);
}
export function productIdFromPath(relative){const pieces=relative.replaceAll('\\','/').split('/');return pieces[1]==='products'?Number(pieces[2]):Number(pieces[1]?.match(/--p([1-9]\d*)$/)?.[1])||null;}


async function reserveLocation(journal,product,identity,descriptor){
 const h=createHash('sha256').update('altego-readable:'+identity).digest('hex'),id=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
 const [[existing]]=await journal.execute('SELECT owner_id,descriptor FROM creator_storage_operations WHERE id=?',[id]);
 if(!existing)await journal.execute("INSERT INTO creator_storage_operations(id,owner_id,state,descriptor) VALUES (?,?,'completed',?)",[id,product.owner_id,JSON.stringify(descriptor)]);
 const [[saved]]=existing?[[existing]]:await journal.execute('SELECT owner_id,descriptor FROM creator_storage_operations WHERE id=?',[id]);
 const value=typeof saved.descriptor==='string'?JSON.parse(saved.descriptor):saved.descriptor;
 if(Number(saved.owner_id)!==Number(product.owner_id)||Object.entries(descriptor).some(([k,v])=>!['directory_name','storage_version'].includes(k)&&value[k]!==v))throw Error('Durable Storage reservation conflicts with product identity.');
 return value;
}
export async function prepareProductDirectory(sql,product,journal=sql){
 if(!enabled)return;
 const [[existing]]=await sql.execute('SELECT * FROM product_storage WHERE product_id=?',[product.id]);

 if(existing){if(existing.directory_name)rememberProductDirectory(product,existing.directory_name);return;}
 const slug=String(product.nombre||product.name||'product').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60).replace(/-+$/,'')||'product';
 const reserved=await reserveLocation(journal,product,'directory:'+product.id,{type:'readable-directory',product_id:Number(product.id),directory_name:slug+'--p'+product.id});
 rememberProductDirectory(product,reserved.directory_name);
 await sql.execute("INSERT INTO product_storage(product_id,creator_id,index_state,directory_name) VALUES (?,?,'pending',?)",[product.id,product.owner_id,reserved.directory_name]);
}
export async function prepareContentVersion(sql,product,file,journal=sql){
 if(!directories.has(Number(product.id)))return file;
 const [[existing]]=await sql.execute('SELECT storage_version FROM product_files WHERE product_id=? AND kind=? AND sha256=?',[product.id,file.kind,file.sha256]);
 let version=existing?.storage_version;
 if(!existing){const [[next]]=await sql.execute('SELECT COALESCE(MAX(version_number),0)+1 version FROM product_versions WHERE product_id=?',[product.id]);const reserved=await reserveLocation(journal,product,'content:'+key(product.id,file),{type:'readable-content',product_id:Number(product.id),kind:file.kind,sha256:file.sha256,byte_size:file.byte_size,storage_version:Number(next.version)});version=reserved.storage_version;}
 const result={...file,storage_version:version};rememberProductFile(product.id,result);return result;
}
