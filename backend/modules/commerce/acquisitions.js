// ALTEGO necesita resolver la propiedad permanente por producto y variante.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {salesReady} from "../../infrastructure/schema/readiness.js";
import {acquisitionReady} from "../../infrastructure/schema/readiness.js";
import {validVariantId} from '../products/variant-identity.js';
const fail=(message,status=409)=>Object.assign(Error(message),{status});
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const contexts=new WeakSet();
const positive=v=>Number.isSafeInteger(v)&&v>0;
export async function ownsVariant(sql,userId,productId,variantId){
 if(!positive(userId)||!validVariantId(variantId,productId))throw fail('Invalid ownership context.',400);
 if(!await acquisitionReady(sql))return false;
 return Boolean((await sql.execute('SELECT order_item_id FROM acquisitions WHERE user_id=? AND product_id=? AND variant_id=?',[userId,productId,variantId]))[0].length);
}
export async function productHasAcquisitions(sql,productId){
 if(!await acquisitionReady(sql))return false;
 return Boolean((await sql.execute('SELECT order_item_id FROM acquisitions WHERE product_id=? LIMIT 1',[productId]))[0].length);
}
export async function reviewEligibility(sql,userId,productId){
 if(!positive(userId)||!positive(productId))throw fail('Invalid review context.',400);
 if(!await acquisitionReady(sql))return false;
 return Boolean((await sql.execute("SELECT a.order_item_id FROM acquisitions a JOIN order_items i ON i.id=a.order_item_id AND i.buyer_id=a.user_id AND i.product_id=a.product_id AND i.variant_id=a.variant_id JOIN orders o ON o.id=i.order_id AND o.buyer_id=a.user_id AND o.status='completed' WHERE a.user_id=? AND a.product_id=? LIMIT 1",[userId,productId]))[0].length);
}
export async function ownedVariant(sql,userId,productId,variantId){
 if(!await ownsVariant(sql,userId,productId,variantId))return null;
 const [[row]]=await sql.execute(`SELECT a.*,p.current_version_id,v.snapshot FROM acquisitions a JOIN productos p ON p.id=a.product_id LEFT JOIN product_versions v ON v.id=p.current_version_id WHERE a.user_id=? AND a.product_id=? AND a.variant_id=?`,[userId,productId,variantId]);
 const variant=parse(row.snapshot)?.variants?.find(v=>v.id===variantId&&v.available!==false);
 return {product_id:productId,variant_id:variantId,acquired_version_id:row.acquired_version_id,acquired_at:row.acquired_at,current_version_id:variant?row.current_version_id:null};
}

export async function withAcquisitionTransaction(pool,buyerId,productIds,run){
 if(!positive(buyerId)||!Array.isArray(productIds)||productIds.some(id=>!positive(id)))throw fail('Invalid acquisition transaction.',400);
 const sql=await pool.getConnection(),ids=[...new Set(productIds)].sort((a,b)=>a-b);let context;
 try{
  if(!await acquisitionReady(sql))throw fail('Acquisitions are not available yet.',503);
  await sql.beginTransaction();const [[buyer]]=await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[buyerId]);if(!buyer)throw fail('Account not found.',404);
  for(const id of ids)await sql.execute('SELECT id FROM productos WHERE id=? FOR UPDATE',[id]);
  context=Object.freeze({sql,buyerId,productIds:ids});contexts.add(context);
  const result=await run(context);await sql.commit();return result;
 }catch(e){await sql.rollback();throw e;}finally{if(context)contexts.delete(context);sql.release();}
}
export async function recordAcquisition(context,orderItemId){
 if(!contexts.has(context)||!positive(orderItemId))throw fail('A controlled acquisition transaction is required.');
 const {sql,buyerId,productIds}=context;
 const [[line]]=await sql.execute(`SELECT i.*,o.status order_status FROM order_items i JOIN orders o ON o.id=i.order_id AND o.buyer_id=i.buyer_id WHERE i.id=? AND i.buyer_id=? FOR UPDATE`,[orderItemId,buyerId]);
 if(!line||line.order_status!=='completed'||!productIds.includes(line.product_id))throw fail('The completed order does not authorize this acquisition.');
 const [[existing]]=await sql.execute('SELECT * FROM acquisitions WHERE user_id=? AND product_id=? AND variant_id=?',[buyerId,line.product_id,line.variant_id]);
 if(existing){if(Number(existing.order_item_id)===orderItemId)return {created:false,acquisition:existing};throw fail('This color is already owned.');}
 const [[p]]=await sql.execute('SELECT * FROM productos WHERE id=?',[line.product_id]);
 if(!p||p.status!=='Published'||p.purged_at||p.moderation_removed||p.owner_id===buyerId||p.current_version_id!==line.version_id)throw fail('This item cannot be acquired.');
 const [[v]]=await sql.execute('SELECT snapshot,version_number FROM product_versions WHERE id=? AND product_id=?',[line.version_id,line.product_id]);
 const snapshot=v&&parse(v.snapshot);
 if(!snapshot||!snapshot.variants?.some(v=>v.id===line.variant_id&&v.available!==false))throw fail('This color cannot be acquired.');
 if(!Number.isSafeInteger(Number(line.price_cents))||Number(line.price_cents)!==Math.round(Number(snapshot.price||0)*100))throw fail('The acquired price differs from the published version.');

 if(await salesReady(sql)){if(line.creator_id!=null&&line.creator_id!==p.owner_id||line.acquired_version_number!=null&&line.acquired_version_number!==v.version_number)throw fail('Historical sale attribution differs from this acquisition.');await sql.execute('UPDATE order_items SET creator_id=?,acquired_version_number=? WHERE id=?',[p.owner_id,v.version_number,line.id]);}
 await sql.execute('INSERT INTO acquisitions(user_id,product_id,variant_id,order_item_id,acquired_version_id) VALUES (?,?,?,?,?)',[buyerId,line.product_id,line.variant_id,orderItemId,line.version_id]);
 return {created:true};
}

export async function entitledVersion(sql,userId,productId,variantId,versionId){
 if(!positive(userId)||!positive(productId)||!positive(versionId)||!validVariantId(variantId,productId))return false;
 return Boolean((await sql.execute(`SELECT a.user_id FROM acquisitions a
 JOIN order_items i ON i.id=a.order_item_id AND i.buyer_id=a.user_id AND i.product_id=a.product_id AND i.variant_id=a.variant_id AND i.version_id=a.acquired_version_id
 JOIN orders o ON o.id=i.order_id AND o.buyer_id=a.user_id AND o.status='completed'
 JOIN product_versions original ON original.id=a.acquired_version_id AND original.product_id=a.product_id
 JOIN product_versions v ON v.product_id=a.product_id AND v.id=? AND v.version_number>=original.version_number
 JOIN version_variants vv ON vv.version_id=v.id AND vv.variant_id=a.variant_id
 WHERE a.user_id=? AND a.product_id=? AND a.variant_id=?`,[versionId,userId,productId,variantId]))[0].length);
}
