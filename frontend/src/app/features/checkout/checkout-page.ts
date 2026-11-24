// ALTEGO necesita resolver la presentación del formulario y resumen de checkout.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,OnDestroy,HostListener,inject,signal,effect,untracked} from '@angular/core';import {CurrencyPipe} from '@angular/common';import {FormsModule} from '@angular/forms';import {Router,RouterLink} from '@angular/router';import {firstValueFrom} from 'rxjs';
import {CheckoutService} from "../../core/commerce/checkout-service";import {AuthService} from "../../core/auth/auth-service";import {ShoppingBagState} from "../../core/commerce/shopping-bag-state";import {errorMessage} from "../../core/http/api";
import {BillingAddress,CheckoutQuote,ConfirmRequest,CheckoutLine} from "../../core/commerce/checkout-types";import {emptyCard,cardErrors,billingErrors,confirmationRequest,checkoutKey} from "../../core/commerce/checkout-validation";
import {bagCheckoutSignature,quoteMatchesBag,reviewedQuote} from "../../core/commerce/checkout-sync";
import {GlassPanel,VisualButton,VisualField} from "../../shared/ui/visual-primitives";import {Icon} from "../../shared/ui/icon";import {Model} from "../../shared/model-viewer/model";
@Component({selector:'app-checkout-page',imports:[FormsModule,CurrencyPipe,RouterLink,GlassPanel,VisualButton,VisualField,Icon,Model],templateUrl:'./checkout-page.html',styleUrl:'./checkout-page.css'})
export class CheckoutPage implements OnDestroy{
 private service=inject(CheckoutService);auth=inject(AuthService);bag=inject(ShoppingBagState);private router=inject(Router);
 quote=signal<CheckoutQuote|null>(null);loading=signal(true);busy=signal(false);uncertain=signal(false);error=signal('');message=signal('');errors=signal<Record<string,string>>({});email='';acknowledged=false;
 billing:BillingAddress={full_name:'',country:'',street_address:'',city:'',state:'',postal_code:''};card=emptyCard();
 readonly billingFields:{key:keyof BillingAddress;label:string;autocomplete:string;max:number}[]=[{key:'full_name',label:'Full Name',autocomplete:'name',max:120},{key:'country',label:'Country / Region',autocomplete:'country-name',max:80},{key:'street_address',label:'Street Address',autocomplete:'street-address',max:200},{key:'city',label:'City',autocomplete:'address-level2',max:100},{key:'state',label:'State / Province',autocomplete:'address-level1',max:100},{key:'postal_code',label:'ZIP / Postal Code',autocomplete:'postal-code',max:24}];
 private owner=this.auth.user()?.id;private destroyed=false;private attempt?:{signature:string;body:ConfirmRequest};
 private observedBag?:string;private refreshing=false;private needsRefresh=false;private billingInitialized=false;private started=false;
 private refreshTimer?:ReturnType<typeof setTimeout>;private expiryTimer?:ReturnType<typeof setTimeout>;private lastRefreshAt=0;
 constructor(){
  effect(()=>{if(this.auth.user()?.id!==this.owner){this.card=emptyCard();this.billing={full_name:'',country:'',street_address:'',city:'',state:'',postal_code:''};this.attempt=undefined;void this.router.navigate(['/login']);}});
  effect(()=>{const signature=bagCheckoutSignature(this.bag.items()),settled=!this.bag.loading()&&!this.bag.pending().size;if(!settled)return;untracked(()=>{if(this.observedBag===undefined){this.observedBag=signature;return;}if(signature!==this.observedBag){this.observedBag=signature;this.queueRefresh();}});});
  void this.initialize();
 }
 private active(){return !this.destroyed&&this.auth.user()?.id===this.owner;}
 private storageKey(){return 'altego.checkout.recovery.'+this.owner;}
 private remember(key:string|null){try{if(key)sessionStorage.setItem(this.storageKey(),key);else sessionStorage.removeItem(this.storageKey());}catch{                                                                                        }}
 private remembered(){try{return sessionStorage.getItem(this.storageKey());}catch{return null;}}
 private async initialize(){const key=this.remembered();if(key){try{const recovered=await firstValueFrom(this.service.recover(key));if(this.active()){this.remember(null);await this.router.navigate(['/orders',recovered.order.order_number,'confirmation']);}return;}catch(e:any){if(!this.active())return;if(e.status===401){await this.sessionExpired();return;}this.message.set('A previous confirmation may still be processing. Your existing ownership will be checked again.');}}this.started=true;await this.refresh();}
 @HostListener('window:focus') focus(){this.queueRefresh();}
 @HostListener('window:online') online(){this.queueRefresh();}
 @HostListener('document:visibilitychange') visible(){if(!document.hidden)this.queueRefresh();}
 private queueRefresh(){
  if(!this.started||!this.active())return;this.needsRefresh=true;
  if(this.busy()||this.refreshing||this.uncertain()||document.hidden)return;
  clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(()=>{this.refreshTimer=undefined;if(!this.active())return;if(this.busy()||this.refreshing||this.uncertain()||document.hidden)return;this.needsRefresh=false;void this.refresh();},Math.max(250,1000-(Date.now()-this.lastRefreshAt)));
 }
 private acceptQuote(next:CheckoutQuote){
  const previous=this.quote(),q=reviewedQuote(previous,next),same=previous?.fingerprint===q.fingerprint;
  this.acknowledged=Boolean(same&&this.acknowledged);this.quote.set(q);this.attempt=undefined;
  clearTimeout(this.expiryTimer);this.expiryTimer=setTimeout(()=>this.queueRefresh(),Math.max(1,next.expires_in_seconds)*1000);
  if(previous&&!same&&q.requires_acknowledgement)this.message.set('Your order changed. Review the items, versions and total before confirming.');
 }
 async refresh(){
  if(!this.active())return;if(this.busy()||this.refreshing||this.uncertain()){this.needsRefresh=true;return;}
  this.refreshing=true;this.needsRefresh=false;this.lastRefreshAt=Date.now();clearTimeout(this.refreshTimer);this.refreshTimer=undefined;this.loading.set(true);this.error.set('');
  try{const data=await firstValueFrom(this.service.quote());if(!this.active())return;this.acceptQuote(data.quote);this.email=data.contact.email;
   if(!this.billingInitialized){this.billing=data.last_billing_address?{...data.last_billing_address}:{...this.billing,full_name:data.contact.full_name};this.billingInitialized=true;}
   await this.bag.load();if(this.active()&&this.quote()&&quoteMatchesBag(this.quote()!,this.bag.items())){this.observedBag=bagCheckoutSignature(this.bag.items());this.needsRefresh=false;}
  }catch(e:any){if(!this.active())return;if(e.status===401)await this.sessionExpired();else this.error.set(errorMessage(e));}
  finally{this.refreshing=false;if(this.active()){this.loading.set(false);if(this.needsRefresh)this.queueRefresh();}}
 }
 retry(){if(this.uncertain())void this.submit();else void this.refresh();}
 product(line:CheckoutLine){return this.bag.items().find(i=>i.product_id===line.product_id&&i.variant_id===line.variant_id)?.product;}
 reason(value:string){return value==='already_owned'?'Already owned':value==='own_product'?'Your own item':'Unavailable';}
 private async sessionExpired(){this.card=emptyCard();this.error.set('Your session expired. Please log in again.');await this.router.navigate(['/login'],{queryParams:{returnUrl:'/checkout'}});}
 async submit(){
  if(this.busy()||this.loading()||!this.active())return;

  if(this.uncertain()&&this.attempt){await this.send(this.attempt.body);return;}
  const q=this.quote();if(!q?.eligible.length)return;
  const errors={...billingErrors(this.billing),...(q.total_cents>0?cardErrors(this.card):{})};this.errors.set(errors);if(Object.keys(errors).length){this.error.set('Check the highlighted fields.');return;}
  if(q.requires_acknowledgement&&!this.acknowledged){this.error.set('Review and acknowledge the updated order.');return;}
  const signature=JSON.stringify([q.id,this.billing,this.acknowledged]);if(this.attempt?.signature!==signature)this.attempt={signature,body:confirmationRequest(q,this.billing,checkoutKey(),this.acknowledged)};
  await this.send(this.attempt.body);
 }
 private async send(body:ConfirmRequest){
  this.remember(body.idempotency_key);this.busy.set(true);this.error.set('');
  try{const response=await firstValueFrom(this.service.confirm(body));if(this.active())await this.completed(response.order.order_number);}
  catch(e:any){if(!this.active())return;
   if(e.status===401)await this.sessionExpired();
   else if(e.status===409&&e.error?.code==='QUOTE_CHANGED'&&e.error.quote){this.uncertain.set(false);this.acceptQuote(e.error.quote);this.acknowledged=false;this.remember(null);this.message.set('Your order changed. Review the items, versions and total before confirming.');this.error.set('');await this.bag.load();}
   else if(e.status===0||e.status>=500){this.uncertain.set(true);try{const result=await firstValueFrom(this.service.recover(body.idempotency_key));if(this.active())await this.completed(result.order.order_number);}catch{if(this.active())this.error.set('The result could not be confirmed. Retry to safely recover the same purchase.');}}
   else{this.uncertain.set(false);this.remember(null);this.error.set(errorMessage(e));}
  }finally{if(this.active()){this.busy.set(false);if(this.needsRefresh&&!this.uncertain())this.queueRefresh();}}
 }
 private async completed(number:string){this.uncertain.set(false);this.card=emptyCard();this.remember(null);this.attempt=undefined;this.needsRefresh=false;await this.bag.load();if(this.active())await this.router.navigate(['/orders',number,'confirmation']);}
 ngOnDestroy(){this.destroyed=true;clearTimeout(this.refreshTimer);clearTimeout(this.expiryTimer);this.card=emptyCard();this.billing={full_name:'',country:'',street_address:'',city:'',state:'',postal_code:''};this.attempt=undefined;}
}
