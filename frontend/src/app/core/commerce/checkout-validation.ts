// ALTEGO necesita resolver la validación del formulario de checkout.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import type {BillingAddress,CheckoutQuote,ConfirmRequest} from './checkout-types';
export interface FictionalCard{holder:string;number:string;expiry:string;cvv:string;}
export const emptyCard=():FictionalCard=>({holder:'',number:'',expiry:'',cvv:''});
export function cardErrors(card:FictionalCard,now=new Date()):Record<string,string>{
 const errors:Record<string,string>={};
 if(!card.holder.trim()||card.holder.trim().length>120)errors['holder']='Enter the fictional cardholder name.';
 if(!/^[\d -]+$/.test(card.number)||!/^\d{13,19}$/.test(card.number.replace(/[ -]/g,'')))errors['number']='Use 13–19 fictional digits.';
 const expiry=/^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(card.expiry.trim());
 const month=Number(expiry?.[1]),year=expiry?(expiry[2].length===2?2000+Number(expiry[2]):Number(expiry[2])):0;
 if(!expiry||month<1||month>12||year<now.getFullYear()||year===now.getFullYear()&&month<now.getMonth()+1)errors['expiry']='Use a current or future date (MM/YY).';
 if(!/^\d{3,4}$/.test(card.cvv))errors['cvv']='Use a fictional 3–4 digit code.';
 return errors;
}
export function billingErrors(b:BillingAddress):Record<string,string>{const errors:Record<string,string>={};for(const [key,max]of Object.entries({full_name:120,country:80,street_address:200,city:100,state:100,postal_code:24})){const value=b[key as keyof BillingAddress];if(!value.trim()||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))errors[key]='Complete this field (maximum '+max+' characters).';}return errors;}
export function checkoutKey(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const data=crypto.getRandomValues(new Uint8Array(16));data[6]=(data[6]&15)|64;data[8]=(data[8]&63)|128;const hex=[...data].map(v=>v.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);}

export function confirmationRequest(q:CheckoutQuote,b:BillingAddress,key:string,acknowledged:boolean):ConfirmRequest{return {quote_id:q.id,idempotency_key:key,billing:{full_name:b.full_name.trim(),country:b.country.trim(),street_address:b.street_address.trim(),city:b.city.trim(),state:b.state.trim(),postal_code:b.postal_code.trim()},payment_method:q.total_cents===0?'free':'simulated_card',...(q.requires_acknowledgement&&acknowledged?{acknowledged_fingerprint:q.fingerprint}:{})};}
