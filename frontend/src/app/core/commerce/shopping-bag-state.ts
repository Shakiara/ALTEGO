// ALTEGO necesita resolver el estado compartido de la bolsa por producto y variante.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Injectable,effect,inject,signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {Router} from '@angular/router';
import {AuthService,API_URL} from "../auth/auth-service";
import {Product,Variant,errorMessage} from "../http/api";
import {UiFeedback} from "../../shared/ui/ui-feedback";

export interface BagEntry{revision?:number;checkout_eligible?:boolean;available_variants?:{id:string;name:string;hex:string}[];product_id:number;variant_id:string;version_id:number;saved_version_id?:number;version_changed?:boolean;owned?:boolean;available:boolean;product:Product|null;}
@Injectable({providedIn:'root'})
export class ShoppingBagState{
 private http=inject(HttpClient);auth=inject(AuthService);private router=inject(Router);private ui=inject(UiFeedback);
 items=signal<BagEntry[]>([]);subtotal=signal(0);pending=signal(new Set<string>());loading=signal(false);error=signal('');
 private owner:number|null=null;private epoch=0;private request=0;
 constructor(){effect(()=>{const id=this.auth.user()?.id??null;if(id===this.owner)return;this.owner=id;this.epoch++;this.request++;this.items.set([]);this.subtotal.set(0);this.pending.set(new Set());this.loading.set(false);this.error.set('');if(id)void this.load();});}
 key(product:number,variant:string){return product+':'+variant;}
 private entry(p:Product,v:Variant|undefined|null){return v?.id?this.items().find(i=>i.product_id===p.id&&i.variant_id===v.id):undefined;}
 contains(p:Product,v:Variant|undefined|null){return !!this.entry(p,v);}
 async load(){

  if(!this.auth.user()||this.pending().size)return false;
  const epoch=this.epoch,request=++this.request;this.loading.set(true);
  try{const data=await firstValueFrom(this.http.get<{items:BagEntry[];subtotal:number}>(API_URL+'/account/bag'));
   if(epoch!==this.epoch||request!==this.request)return false;
   this.items.set(data.items);this.subtotal.set(data.subtotal);this.error.set('');return true;
  }catch(error){if(epoch===this.epoch&&request===this.request)this.error.set(errorMessage(error));return false;
  }finally{if(epoch===this.epoch&&request===this.request)this.loading.set(false);}
 }
 async toggle(p:Product,v:Variant){
  const item=this.entry(p,v);
  if(item)await this.remove(item);else await this.add(p,v);
 }
 async add(p:Product,v:Variant){
  const actor=this.auth.user();
  if(!actor){await this.router.navigate(['/login'],{queryParams:{returnUrl:this.router.url}});return;}
  if(actor.id===p.owner_id||!v.id||!p.current_version_id||v.available===false||!['Published','Unlisted'].includes(p.status)||this.contains(p,v))return;
  const item:BagEntry={product_id:p.id,variant_id:v.id,version_id:p.current_version_id,available:true,product:{...p,variants:[v]}};
  await this.change(item,true);
 }
 async remove(item:BagEntry){if(this.auth.user())await this.change(item,false);}
 async switchVariant(item:BagEntry,variantId:string){
  if(!this.auth.user()||this.loading()||this.pending().size||variantId===item.variant_id)return;
  if(this.items().some(i=>i.product_id===item.product_id&&i.variant_id===variantId)){this.ui.notify('This color is already in your bag.','error');return;}
  const epoch=this.epoch,key=this.key(item.product_id,item.variant_id);this.request++;this.pending.update(s=>new Set([...s,key]));
  try{await firstValueFrom(this.http.patch(API_URL+'/account/bag/'+item.product_id+'/'+item.variant_id,{variant_id:variantId,revision:item.revision??0}));if(epoch===this.epoch)this.ui.notify('Color updated.');}
  catch(e){if(epoch===this.epoch)this.ui.notify(errorMessage(e),'error');}
  finally{if(epoch===this.epoch){this.pending.update(s=>{const next=new Set(s);next.delete(key);return next;});await this.load();}}
 }
 private async change(item:BagEntry,adding:boolean){
  const key=this.key(item.product_id,item.variant_id);if(this.pending().has(key)||this.loading())return;
  const epoch=this.epoch;this.request++;this.pending.update(set=>new Set([...set,key]));let confirmed=false;
  try{
   if(adding)await firstValueFrom(this.http.put(API_URL+'/account/bag/'+item.product_id,{variant_id:item.variant_id,version_id:item.version_id}));
   else await firstValueFrom(this.http.delete(API_URL+'/account/bag/'+item.product_id+'/'+item.variant_id));
   if(epoch!==this.epoch)return;

   this.items.update(items=>{const remaining=items.filter(i=>this.key(i.product_id,i.variant_id)!==key);return adding?[item,...remaining]:remaining;});
   this.subtotal.set(this.items().reduce((sum,i)=>sum+(i.available?Math.round((i.product?.price||0)*100):0),0)/100);
   this.error.set('');confirmed=true;this.ui.notify(adding?'Added to your bag.':'Removed from your bag.');
  }catch(error){if(epoch===this.epoch)this.ui.notify(errorMessage(error),'error');
  }finally{
   if(epoch===this.epoch){
    this.pending.update(set=>{const next=new Set(set);next.delete(key);return next;});

    if(!this.pending().size){const refreshed=await this.load();if(confirmed&&!refreshed&&epoch===this.epoch&&this.error())this.ui.notify('Your selection was updated, but the bag could not be refreshed. Please try again.','error');}
   }
  }
 }
}
