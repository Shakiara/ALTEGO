// ALTEGO necesita resolver la conciliación del checkout y las respuestas de compra.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import type {CheckoutQuote} from './checkout-types';
import type {BagEntry} from './shopping-bag-state';
const ordered=(rows:unknown[])=>JSON.stringify(rows.map(row=>JSON.stringify(row)).sort());
export function bagCheckoutSignature(items:BagEntry[]){return ordered(items.map(i=>[i.product_id,i.variant_id,i.version_id,i.revision??0,i.checkout_eligible??i.available,!!i.owned,i.product?.price??null]));}
export function quoteMatchesBag(q:CheckoutQuote,items:BagEntry[]){
 const included=items.filter(i=>i.checkout_eligible??i.available).map(i=>[i.product_id,i.variant_id,i.version_id,Math.round((i.product?.price||0)*100)]);
 const excluded=items.filter(i=>!(i.checkout_eligible??i.available)).map(i=>[i.product_id,i.variant_id]);
 return ordered(included)===ordered(q.eligible.map(i=>[i.product_id,i.variant_id,i.version_id,i.price_cents]))&&ordered(excluded)===ordered(q.excluded.map(i=>[i.product_id,i.variant_id]));
}

export function reviewedQuote(previous:CheckoutQuote|null,next:CheckoutQuote):CheckoutQuote{
 if(!previous)return next;
 const changes=[...next.changes],add=(type:string,product_id?:number,variant_id?:string)=>{if(!changes.some(c=>c.type===type&&c.product_id===product_id&&c.variant_id===variant_id))changes.push({type,product_id,variant_id});};
 for(const line of next.eligible){const old=previous.eligible.find(v=>v.product_id===line.product_id&&v.variant_id===line.variant_id);if(old&&old.price_cents!==line.price_cents)add('price_changed',line.product_id,line.variant_id);if(old&&old.version_id!==line.version_id)add('version_changed',line.product_id,line.variant_id);}
 const selection=(q:CheckoutQuote)=>ordered(q.eligible.map(i=>[i.product_id,i.variant_id]));
 if(selection(previous)!==selection(next)||ordered(previous.excluded)!==ordered(next.excluded))add('availability_changed');

 if(previous.fingerprint===next.fingerprint)for(const change of previous.changes)add(change.type,change.product_id,change.variant_id);
 return {...next,changes,requires_acknowledgement:next.requires_acknowledgement||changes.length>0};
}
