// ALTEGO necesita resolver las referencias que protegen recursos utilizados.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const fail=message=>Object.assign(Error(message),{code:'STORAGE_REFERENCE_CONFLICT'});

export async function storageReferences(sql){
 const [products]=await sql.query('SELECT * FROM productos ORDER BY id');
 const [assets]=await sql.query('SELECT * FROM assets ORDER BY id');
 const [variants]=await sql.query('SELECT * FROM variants ORDER BY id');
 const [versions]=await sql.query('SELECT * FROM product_versions ORDER BY product_id,version_number');
 const [history]=await sql.query('SELECT vv.*,pv.product_id FROM version_variants vv JOIN product_versions pv ON pv.id=vv.version_id');
 const refs=new Map(products.map(p=>[p.id,new Map()]));const assetMap=new Map(assets.map(a=>[a.id,a]));
 function add(productId,id,kind){if(!id)return;const a=assetMap.get(id);if(!refs.has(productId)||!a||a.kind!==kind)throw fail('A persisted asset reference is invalid.');refs.get(productId).set(id,a);}
 for(const p of products)add(p.id,p.model_asset_id,'glb');
 for(const v of variants)add(v.product_id,v.texture_asset_id,'png');
 for(const v of versions){const s=parse(v.snapshot);if(s.id!==v.product_id)throw fail('Snapshot product identity differs.');add(v.product_id,s.model_asset_id,'glb');for(const variant of s.variants||[])add(v.product_id,variant.texture_asset_id,'png');}
 for(const v of history){add(v.product_id,v.model_asset_id,'glb');add(v.product_id,v.texture_asset_id,'png');}

 if(await acquisitionReady(sql)){
  const [acquisitions]=await sql.query('SELECT product_id,variant_id,acquired_version_id FROM acquisitions');
  for(const a of acquisitions){const v=versions.find(v=>v.id===a.acquired_version_id&&v.product_id===a.product_id),snapshot=v&&parse(v.snapshot),variant=snapshot?.variants?.find(v=>v.id===a.variant_id);if(!variant)throw fail('An acquired version reference is invalid.');add(a.product_id,snapshot.model_asset_id,'glb');add(a.product_id,variant.texture_asset_id,'png');}
 }
 return {products,assets,variants,versions,refs};
}

import {acquisitionReady} from "../schema/readiness.js";
