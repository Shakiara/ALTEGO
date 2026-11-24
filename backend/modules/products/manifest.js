// ALTEGO necesita resolver los manifiestos de productos y sus referencias de archivos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../../infrastructure/storage/assets.js';
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const topKeys=new Set('id owner_id creator_name name description category_id category price model_asset_id model_url status revision current_version_id version_number trashed_at variants'.split(' '));
const variantKeys=new Set('id product_id name hex texture_asset_id texture_url is_default legacy active'.split(' '));

export function encodeSnapshot(raw,aliases){
 const s=structuredClone(typeof raw==='string'?JSON.parse(raw):raw);
 for(const k of Object.keys(s))if(!topKeys.has(k))throw fail('Historical snapshot contains unsupported fields. Archive cannot be generated safely.',409);
 const safeUrl=value=>value==null||/^\/(?:api\/previews\/[a-f0-9-]{36}|models\/[a-zA-Z0-9_.-]+\.glb)$/.test(value)||/^http:\/\/(?:localhost|127\.0\.0\.1):3000\/api\/previews\/[a-f0-9-]{36}$/.test(value);
 if(!safeUrl(s.model_url))throw fail('Historical preview URL cannot be exported safely.',409);
 if(!aliases[s.model_asset_id])throw fail('Historical model reference is incomplete.',409);
 s.model_asset_id=aliases[s.model_asset_id];
 for(const v of s.variants){for(const k of Object.keys(v))if(!variantKeys.has(k))throw fail('Historical variant contains unsupported fields.',409);if(!safeUrl(v.texture_url))throw fail('Historical texture URL cannot be exported safely.',409);if(v.texture_asset_id){if(!aliases[v.texture_asset_id])throw fail('Historical texture reference is incomplete.',409);v.texture_asset_id=aliases[v.texture_asset_id];}}
 return s;
}
export function objectDelta(before,after,exclude=[]){
 const set={},unset=[];
 for(const key of Object.keys(after))if(!exclude.includes(key)&&(!has(before,key)||!isDeepStrictEqual(before[key],after[key])))set[key]=structuredClone(after[key]);
 for(const key of Object.keys(before))if(!exclude.includes(key)&&!has(after,key))unset.push(key);
 return{...(Object.keys(set).length?{set}:{}),...(unset.length?{unset}:{})};
}
export function snapshotDelta(before,after){
 const patch=objectDelta(before,after,['variants']),old=new Map(before.variants.map(v=>[v.id,v])),next=new Map(after.variants.map(v=>[v.id,v]));
 const add=after.variants.filter(v=>!old.has(v.id)),remove=before.variants.filter(v=>!next.has(v.id)).map(v=>v.id),update=[];
 for(const v of after.variants){const previous=old.get(v.id);if(!previous)continue;const changes=objectDelta(previous,v,['id']);if(Object.keys(changes).length)update.push({id:v.id,...changes});}
 const order=after.variants.map(v=>v.id),orderChanged=!isDeepStrictEqual(before.variants.map(v=>v.id),order);
 if(add.length||remove.length||update.length||orderChanged)patch.variants={...(add.length?{add:structuredClone(add)}:{}),...(remove.length?{remove}:{}),...(update.length?{update}:{}),...(orderChanged?{order}:{})};
 return patch;
}
function applyObject(target,patch){for(const k of patch.unset||[])delete target[k];for(const[k,value]of Object.entries(patch.set||{})){if(['__proto__','constructor','prototype'].includes(k))throw Error('Invalid patch key');target[k]=structuredClone(value);}}
export function reconstructVersion(manifest,number){
 if(manifest.format_version===1){const v=manifest.versions.find(v=>v.version_number===number);if(!v)throw Error('Version missing');return structuredClone(v.snapshot);}
 if(manifest.format_version!==2)throw Error('Unsupported manifest format');
 let state;
 for(const v of manifest.versions){if(v.version_number>number)break;if(v.version_number===1)state=structuredClone(v.initial);else{if(!state)throw Error('Initial snapshot missing');applyObject(state,v.changes);const patch=v.changes.variants;if(patch){const variants=new Map(state.variants.map(x=>[x.id,x]));for(const id of patch.remove||[])variants.delete(id);for(const added of patch.add||[])variants.set(added.id,structuredClone(added));for(const update of patch.update||[]){if(!variants.has(update.id))throw Error('Unknown variant');applyObject(variants.get(update.id),update);}state.variants=patch.order?patch.order.map(id=>{if(!variants.has(id))throw Error('Unknown order reference');return variants.get(id);}):[...variants.values()];}}
  if(v.version_number===number){const decode=ref=>{if(!manifest.assets[ref])throw Error('Unknown asset alias');return manifest.assets[ref].asset_id;};state.model_asset_id=decode(state.model_asset_id);for(const variant of state.variants)if(variant.texture_asset_id)variant.texture_asset_id=decode(variant.texture_asset_id);return state;}
 }throw Error('Version missing');
}
export function archiveReadme(manifest){return `ALTEGO — ${manifest.item_name}\nVersiones incluidas: v1–v${manifest.requested_version}.\n\nLas carpetas vN/models y vN/textures contienen archivos incorporados por primera vez al historial; no se duplican los archivos heredados.\nmanifest.json (format_version: 2) describe el estado inicial completo y los cambios incrementales.\n\nReconstrucción: comenzar con versions[0].initial; aplicar cada changes.set y changes.unset en orden. En variants, eliminar remove, incorporar add, aplicar update y ordenar según order cuando exista. Un changes vacío conserva el estado anterior. restored_from registra la procedencia; sus cambios se aplican normalmente.\n\nLos campos model_asset_id y texture_asset_id usan alias cortos del índice assets. Cada alias conserva el asset_id original y apunta al índice files. files contiene ruta relativa, SHA-256, tamaño, tipo y used_in (versiones que utilizan el archivo). Resolver los alias permite recuperar exactamente los identificadores originales. Los campos opcionales, valores nulos y orden de variantes se conservan.\n\nVerificar SHA-256 antes de utilizar los archivos. No se incluyen versiones posteriores a la solicitada. Los ZIP anteriores de formato 1 permanecen válidos de manera independiente.\n`;}
