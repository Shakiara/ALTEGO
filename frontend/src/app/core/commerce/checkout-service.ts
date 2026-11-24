// ALTEGO necesita resolver el acceso a los servicios de checkout y confirmación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Injectable,inject} from '@angular/core';import {HttpClient} from '@angular/common/http';import {API_URL} from "../auth/auth-service";
import {CheckoutContext,ConfirmRequest,OrderReceipt} from './checkout-types';
@Injectable({providedIn:'root'})
export class CheckoutService{
 private http=inject(HttpClient);private base=API_URL+'/account';
 quote(){return this.http.post<CheckoutContext>(this.base+'/checkout/quote',{});}
 confirm(body:ConfirmRequest){return this.http.post<{order:OrderReceipt;replayed:boolean}>(this.base+'/checkout/confirm',body);}
 receipt(number:string){return this.http.get<{order:OrderReceipt}>(this.base+'/orders/'+encodeURIComponent(number)+'/confirmation');}
 recover(key:string){return this.http.get<{order:OrderReceipt}>(this.base+'/checkout/attempts/'+encodeURIComponent(key));}
 orders(page=1){return this.http.get<{items:Pick<OrderReceipt,'order_number'|'completed_at'|'currency'|'total_cents'>[];page:number;pages:number;total:number}>(this.base+'/orders',{params:{page}});}
 download(number:string){return this.http.get(this.base+'/orders/'+encodeURIComponent(number)+'/download',{responseType:'blob'});}
}
