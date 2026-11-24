// ALTEGO necesita definir los contratos de datos de checkout y órdenes.
// Este módulo declara las estructuras compartidas para intercambiar esos datos con tipos consistentes.
export interface BillingAddress{full_name:string;country:string;street_address:string;city:string;state:string;postal_code:string;}
export interface CheckoutLine{product_id:number;variant_id:string;version_id:number;version_number:number;product_name:string;variant_name:string;price_cents:number;version_changed:boolean;}
export interface CheckoutQuote{id:string;fingerprint:string;expires_in_seconds:number;eligible:CheckoutLine[];excluded:{product_id:number;variant_id:string;reason:string}[];changes:{product_id?:number;variant_id?:string;type:string}[];requires_acknowledgement:boolean;currency:string;subtotal_cents:number;tax_cents:number;total_cents:number;}
export interface CheckoutContext{quote:CheckoutQuote;contact:{email:string;full_name:string};last_billing_address:BillingAddress|null;}
export interface OrderReceipt{id:number;order_number:string;created_at:string;completed_at:string;status:string;currency:string;subtotal_cents:number;tax_cents:number;total_cents:number;payment_method:string;billing_address:BillingAddress;items:{product_id:number;variant_id:string;version_id:number;version_number:number;product_name:string;variant_name:string;price_cents:number;can_review?:boolean;acquired:boolean}[];}
export interface ConfirmRequest{quote_id:string;idempotency_key:string;billing:BillingAddress;payment_method:'free'|'simulated_card';acknowledged_fingerprint?:string;}
