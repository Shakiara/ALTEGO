// ALTEGO necesita resolver la confirmación transaccional de adquisiciones simuladas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {randomUUID,createHash} from 'node:crypto';
import {requireUser,requireLiveSession} from '../accounts/auth.js';
import {suspensionForLogin} from '../accounts/account-sanctions.js';
import {withAcquisitionTransaction,recordAcquisition} from './acquisitions.js';
import {checkoutReady} from "../../infrastructure/schema/readiness.js";

const fail=(status,message,code)=>Object.assign(Error(message),{status,code});
const parse=v=>typeof v==='string'?JSON.parse(v):v;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
export function billingInput(value){
 const fields={full_name:120,country:80,street_address:200,city:100,state:100,postal_code:24};
 if(!exact(value,Object.keys(fields)))throw fail(400,'Include a valid billing address.','INVALID_BILLING');
 const result={};for(const [key,max]of Object.entries(fields)){
  const text=value[key];if(typeof text!=='string'||!text.trim()||text.trim().length>max||/[\u0000-\u001f\u007f]/.test(text))throw fail(400,'Complete the required billing fields.','INVALID_BILLING');result[key]=text.trim();
 }return result;
}
export function checkoutMoney(value){
 const amount=Number(value);if(value===null||value===''||!Number.isFinite(amount)||amount<0)throw fail(409,'An item has an invalid published price.','INVALID_PUBLISHED_PRICE');
 const cents=Math.round(amount*100);if(!Number.isSafeInteger(cents))throw fail(409,'The order amount is not supported.','INVALID_TOTAL');return cents;
}
const addMoney=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw fail(409,'The order amount is not supported.','INVALID_TOTAL');return n;};



async function transaction(pool,req,run){
 const [ids]=await pool.execute('SELECT DISTINCT product_id FROM shopping_bag_items WHERE user_id=?',[req.user.id]);
 return withAcquisitionTransaction(pool,req.user.id,ids.map(x=>x.product_id),async context=>{
  await requireLiveSession(context.sql,req);
  const [[buyer]]=await context.sql.execute('SELECT id,username,email,role FROM users WHERE id=?',[req.user.id]);
  if(await suspensionForLogin(context.sql,buyer))throw fail(403,'This account is suspended.','ACCOUNT_SUSPENDED');
  return run(context,buyer);
 });
}
async function bagState(context){
 const {sql,buyerId,productIds}=context;
 const [rows]=await sql.execute(`SELECT b.*,p.owner_id,p.status,p.purged_at,p.moderation_removed,p.current_version_id,
 v.version_number,v.snapshot FROM shopping_bag_items b JOIN productos p ON p.id=b.product_id
 LEFT JOIN product_versions v ON v.id=p.current_version_id AND v.product_id=p.id
 WHERE b.user_id=? ORDER BY b.product_id,b.variant_id FOR UPDATE`,[buyerId]);
 if(rows.some(r=>!productIds.includes(r.product_id)))throw fail(409,'Your bag changed. Request a new checkout summary.','BAG_CHANGED');
 const [rights]=await sql.execute('SELECT product_id,variant_id FROM acquisitions WHERE user_id=?',[buyerId]);
 const owned=new Set(rights.map(r=>r.product_id+':'+r.variant_id)),eligible=[],excluded=[];
 for(const row of rows){
  const snapshot=parse(row.snapshot),variant=snapshot?.variants?.find(v=>v.id===row.variant_id&&v.available!==false);
  let reason=null;
  if(owned.has(row.product_id+':'+row.variant_id))reason='already_owned';
  else if(row.owner_id===buyerId)reason='own_product';
  else if(row.status!=='Published'||row.purged_at||row.moderation_removed||!variant)reason='unavailable';
  const identity={product_id:row.product_id,variant_id:row.variant_id};
  if(reason){excluded.push({...identity,reason});continue;}

  const [[link]]=await sql.execute('SELECT variant_id FROM version_variants WHERE version_id=? AND variant_id=?',[row.current_version_id,row.variant_id]);
  if(!link)throw fail(409,'The published item requires an integrity check.','INVALID_VERSION');
  eligible.push({...identity,version_id:row.current_version_id,version_number:row.version_number,
   product_name:snapshot.name,variant_name:variant.name,price_cents:checkoutMoney(snapshot.price),
   saved_version_id:row.version_id,revision:row.revision,added_at:String(row.created_at),version_changed:row.version_id!==row.current_version_id});
 }
 const subtotal=eligible.reduce((sum,item)=>addMoney(sum,item.price_cents),0);
 return {eligible,excluded,currency:'USD',subtotal_cents:subtotal,tax_cents:0,total_cents:subtotal};
}
async function saveQuote(sql,buyerId,state,previous=null){
 const changes=[];
 for(const line of state.eligible){const old=previous?.eligible.find(x=>x.product_id===line.product_id&&x.variant_id===line.variant_id);
  if(line.version_changed||old&&old.version_id!==line.version_id)changes.push({product_id:line.product_id,variant_id:line.variant_id,type:'version_changed'});
  if(old&&old.price_cents!==line.price_cents)changes.push({product_id:line.product_id,variant_id:line.variant_id,type:'price_changed'});
 }
 if(previous&&JSON.stringify(previous.excluded)!==JSON.stringify(state.excluded))changes.push({type:'availability_changed'});
 const id=randomUUID(),fingerprint=hash(state);
 await sql.execute(`INSERT INTO checkout_quotes(id,buyer_id,fingerprint,quote_lines,change_summary,expires_at)
 VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE))`,[id,buyerId,fingerprint,JSON.stringify(state),JSON.stringify(changes)]);
 return {id,fingerprint,expires_in_seconds:900,...state,changes,requires_acknowledgement:changes.length>0};
}
export async function createCheckoutQuote(pool,req){return transaction(pool,req,async(context,buyer)=>{
 const state=await bagState(context),quote=await saveQuote(context.sql,buyer.id,state);
 const [[saved]]=await context.sql.execute('SELECT billing_address FROM checkout_billing_preferences WHERE buyer_id=?',[buyer.id]);
 return {quote,contact:{email:buyer.email,full_name:buyer.username},last_billing_address:saved?parse(saved.billing_address):null,payment_simulated:true};
});}
async function receipt(sql,buyerId,number){
 const [[order]]=await sql.execute(`SELECT id,order_number,created_at,completed_at,status,currency,subtotal_cents,tax_cents,total_cents,payment_method,billing_address FROM orders WHERE order_number=? AND buyer_id=? AND status='completed'`,[number,buyerId]);
 if(!order)throw fail(404,'Order not found.','ORDER_NOT_FOUND');
 const [items]=await sql.execute(`SELECT i.product_id,i.variant_id,i.version_id,i.product_name,i.variant_name,i.price_cents,v.version_number,(p.status='Published' AND p.purged_at IS NULL AND p.moderation_removed=0) AS can_review,
 (a.order_item_id IS NOT NULL) AS acquired FROM order_items i JOIN product_versions v ON v.id=i.version_id AND v.product_id=i.product_id LEFT JOIN acquisitions a ON a.order_item_id=i.id AND a.user_id=i.buyer_id LEFT JOIN productos p ON p.id=i.product_id
 WHERE i.order_id=? AND i.buyer_id=? ORDER BY i.id`,[order.id,buyerId]);
 return {...order,billing_address:parse(order.billing_address),items:items.map(i=>({...i,acquired:Boolean(i.acquired),can_review:Boolean(i.can_review)})),payment_simulated:true};
}
export async function confirmCheckout(pool,req,{beforeCommit}={}){
 const input=req.body;
 if(!exact(input,['quote_id','idempotency_key','billing','payment_method','acknowledged_fingerprint'])||!uuid(input.quote_id)||!uuid(input.idempotency_key)||!['free','simulated_card'].includes(input.payment_method)||input.acknowledged_fingerprint!==undefined&&(typeof input.acknowledged_fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.acknowledged_fingerprint)))throw fail(400,'Invalid simulated checkout request. Do not send card information.','INVALID_CHECKOUT');
 const billing=billingInput(input.billing),requestHash=hash([input.quote_id,billing,input.payment_method,input.acknowledged_fingerprint||null]);
 return transaction(pool,req,async(context,buyer)=>{
  const {sql}=context;
  const [[attempt]]=await sql.execute('SELECT * FROM checkout_attempts WHERE buyer_id=? AND idempotency_key=? FOR UPDATE',[buyer.id,input.idempotency_key]);
  if(attempt){
   if(attempt.request_hash!==requestHash)throw fail(409,'This request key was already used for another checkout.','IDEMPOTENCY_CONFLICT');
   if(attempt.status!=='completed'||!attempt.order_id)throw fail(409,'This checkout attempt requires review.','ATTEMPT_PENDING');
   const [[order]]=await sql.execute('SELECT order_number FROM orders WHERE id=? AND buyer_id=?',[attempt.order_id,buyer.id]);
   return {status:200,body:{order:await receipt(sql,buyer.id,order.order_number),replayed:true}};
  }
  const [[quote]]=await sql.execute('SELECT *,expires_at>UTC_TIMESTAMP(6) valid FROM checkout_quotes WHERE id=? AND buyer_id=? FOR UPDATE',[input.quote_id,buyer.id]);
  if(!quote)throw fail(404,'Checkout summary not found.','QUOTE_NOT_FOUND');
  const state=await bagState(context),previous=parse(quote.quote_lines);
  if(!quote.valid||hash(state)!==quote.fingerprint){
   const updated=await saveQuote(sql,buyer.id,state,previous);
   return {status:409,body:{error:'Your checkout summary changed. Review it before confirming.',code:'QUOTE_CHANGED',quote:updated}};
  }
  if(!state.eligible.length)throw fail(409,'No eligible items remain in your bag.','NO_ELIGIBLE_ITEMS');
  if(parse(quote.change_summary).length&&input.acknowledged_fingerprint!==quote.fingerprint)throw fail(409,'Review and acknowledge the checkout changes.','ACKNOWLEDGEMENT_REQUIRED');
  const method=state.total_cents===0?'free':'simulated_card';
  if(input.payment_method!==method)throw fail(400,'Choose the method for this simulated order.','INVALID_PAYMENT_METHOD');
  await sql.execute('INSERT INTO checkout_attempts(buyer_id,idempotency_key,request_hash,quote_id) VALUES (?,?,?,?)',[buyer.id,input.idempotency_key,requestHash,quote.id]);
  const number=randomUUID();
  const [order]=await sql.execute(`INSERT INTO orders(order_number,buyer_id,status,subtotal_cents,total_cents,payment_method,billing_address,completed_at)
   VALUES (?,?,'completed',?,?,?,?,UTC_TIMESTAMP(6))`,[number,buyer.id,state.subtotal_cents,state.total_cents,method,JSON.stringify(billing)]);
  for(const line of state.eligible){
   const [item]=await sql.execute('INSERT INTO order_items(order_id,buyer_id,product_id,variant_id,version_id,price_cents,product_name,variant_name) VALUES (?,?,?,?,?,?,?,?)',[order.insertId,buyer.id,line.product_id,line.variant_id,line.version_id,line.price_cents,line.product_name,line.variant_name]);
   await recordAcquisition(context,item.insertId);
   await sql.execute('DELETE FROM shopping_bag_items WHERE user_id=? AND product_id=? AND variant_id=? AND revision=?',[buyer.id,line.product_id,line.variant_id,line.revision]);
  }
  await sql.execute('INSERT INTO checkout_billing_preferences(buyer_id,billing_address) VALUES (?,?) ON DUPLICATE KEY UPDATE billing_address=VALUES(billing_address),updated_at=UTC_TIMESTAMP(6)',[buyer.id,JSON.stringify(billing)]);
  await sql.execute("UPDATE checkout_attempts SET status='completed',order_id=?,result_code='SIMULATED_COMPLETED' WHERE buyer_id=? AND idempotency_key=?",[order.insertId,buyer.id,input.idempotency_key]);

  if(beforeCommit)await beforeCommit(context);
  return {status:201,body:{order:await receipt(sql,buyer.id,number),replayed:false}};
 });
}
export function installCheckout(app,pool){
 const endpoint=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({error:e.message,...(e.code?{code:e.code}:{})});next(e);}};
 const base='/api/account/checkout';
 const ready=async(req,res,next)=>{res.set('Cache-Control','private, no-store');res.vary('Cookie');if(!await checkoutReady(pool))return res.status(503).json({error:'Checkout is not available yet.'});next();};
 app.use(base,requireUser,ready);
 app.post(base+'/quote',endpoint(async(req,res)=>{if(!exact(req.body,[])&&req.body!==undefined)throw fail(400,'Checkout uses your current bag.','INVALID_QUOTE');res.json(await createCheckoutQuote(pool,req));}));
 app.get(base+'/attempts/:key',endpoint(async(req,res)=>{
  if(!uuid(req.params.key))throw fail(404,'Order not found.','ORDER_NOT_FOUND');
  const result=await transaction(pool,req,async({sql})=>{const [[row]]=await sql.execute("SELECT o.order_number FROM checkout_attempts a JOIN orders o ON o.id=a.order_id AND o.buyer_id=a.buyer_id WHERE a.buyer_id=? AND a.idempotency_key=? AND a.status='completed'",[req.user.id,req.params.key]);if(!row)throw fail(404,'No completed order was found yet.','ATTEMPT_NOT_FOUND');return receipt(sql,req.user.id,row.order_number);});res.json({order:result});
 }));
 app.post(base+'/confirm',endpoint(async(req,res)=>{const result=await confirmCheckout(pool,req);res.status(result.status).json(result.body);}));
 app.get('/api/account/orders',requireUser,ready,endpoint(async(req,res)=>{
  const raw=req.query.page??'1';if(typeof raw!=='string'||!/^\d{1,8}$/.test(raw)||Number(raw)<1)throw fail(400,'Choose a valid page.','INVALID_PAGE');
  const page=Number(raw),size=10;
  const result=await transaction(pool,req,async({sql})=>{const [[count]]=await sql.execute("SELECT COUNT(*) total FROM orders WHERE buyer_id=? AND status='completed'",[req.user.id]);const [items]=await sql.execute("SELECT order_number,completed_at,currency,total_cents FROM orders WHERE buyer_id=? AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT ? OFFSET ?",[req.user.id,size,(page-1)*size]);return {items,total:count.total,page,pages:Math.max(1,Math.ceil(count.total/size)),size};});res.json(result);
 }));
 app.get('/api/account/orders/:orderNumber/confirmation',requireUser,ready,endpoint(async(req,res)=>{
  if(!uuid(req.params.orderNumber))throw fail(404,'Order not found.','ORDER_NOT_FOUND');
  const result=await transaction(pool,req,context=>receipt(context.sql,req.user.id,req.params.orderNumber));res.json({order:result});
 }));
}
