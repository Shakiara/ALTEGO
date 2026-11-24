// ALTEGO necesita resolver los requisitos de contenido para publicar productos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {governanceReady} from "../../infrastructure/schema/readiness.js";
import {adminError} from '../administration/admin-audit.js';
const parse=value=>typeof value==='string'?JSON.parse(value):value;


export function importantPublicationChange(before,after){
 const variants=list=>JSON.stringify((list||[]).map(v=>({id:v.id,name:v.name,hex:v.hex,texture:v.texture_asset_id||null,default:Boolean(v.is_default)})).sort((a,b)=>a.id.localeCompare(b.id)));
 return ['name','category_id','model_asset_id'].some(key=>before[key]!==after[key])||variants(before.variants)!==variants(after.variants);
}
export async function requiresPublicationReview(sql,product,draft){
 if(!await governanceReady(sql))return !product.current_version_id&&!draft.verified_creator;
 if(product.moderation_removed)throw adminError(409,'This item is restricted by moderation.');
 const [[latest]]=await sql.execute("SELECT status FROM product_publication_reviews WHERE product_id=? ORDER BY id DESC LIMIT 1",[product.id]);
 if(latest?.status==='rejected')return true;
 if(draft.verified_creator)return false;
 if(!product.current_version_id)return true;
 const [[published]]=await sql.execute('SELECT snapshot FROM product_versions WHERE id=? AND product_id=?',[product.current_version_id,product.id]);
 return !published||importantPublicationChange(parse(published.snapshot),draft);
}
