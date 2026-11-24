// ALTEGO necesita resolver las descargas autorizadas de productos adquiridos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs';import {pipeline} from 'node:stream/promises';import yazl from 'yazl';
import {checkedAsset,snapshotContent} from '../products/history.js';
export const archiveSlug=value=>String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,65)||'Item';
export async function ownedResources(sql,buyerId,line){
 const snapshot=snapshotContent(line.snapshot,line.product_id),variant=snapshot.variants.find(v=>v.id===line.variant_id);
 const [[reference]]=await sql.execute('SELECT model_asset_id,texture_asset_id FROM version_variants WHERE version_id=? AND variant_id=?',[line.version_id,line.variant_id]);
 if(!variant||!reference||reference.model_asset_id!==snapshot.model_asset_id||(reference.texture_asset_id||null)!==(variant.texture_asset_id||null))throw Object.assign(Error('The acquired version has inconsistent resources.'),{status:409});
 const assets=[];for(const [id,kind]of [[reference.model_asset_id,'glb'],...(reference.texture_asset_id?[[reference.texture_asset_id,'png']]:[])])assets.push({...await checkedAsset(sql,id,kind,false,line.product_id,{buyerId,versionId:line.version_id,variantId:line.variant_id}),kind});
 return {snapshot,variant,assets};
}
export async function writeOwnedZip(files,archive){const zip=new yazl.ZipFile(),finished=pipeline(zip.outputStream,fs.createWriteStream(archive));zip.on('error',e=>zip.outputStream.destroy(e));for(const file of files)zip.addFile(file.source,file.name);zip.end();await finished;}
