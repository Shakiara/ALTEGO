// ALTEGO necesita resolver el estado compartido de las variantes favoritas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Injectable,effect,inject,signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Router} from '@angular/router';
import {firstValueFrom} from 'rxjs';
import {AuthService,API_URL} from "../auth/auth-service";
import {UiFeedback} from "../../shared/ui/ui-feedback";
import {errorMessage} from "../http/api";
@Injectable({providedIn:'root'})
export class FavoritesState{
 private http=inject(HttpClient);private auth=inject(AuthService);private router=inject(Router);private ui=inject(UiFeedback);
 private epoch=0;private version=0;private owner:number|null=null;private loaded=false;private loading?:Promise<void>;
 readonly keys=signal<Set<string>>(new Set());readonly pending=signal<Set<string>>(new Set());readonly revision=signal(0);readonly ready=signal(false);
 key(product:number,variant:string){return product+':'+variant;}
 constructor(){effect(()=>{const user=this.auth.user()?.id??null;if(user===this.owner)return;this.owner=user;this.epoch++;this.version++;this.loaded=false;this.loading=undefined;this.keys.set(new Set());this.pending.set(new Set());this.ready.set(false);this.revision.update(v=>v+1);if(user)void this.load().catch(()=>{});});}
 async load():Promise<void>{
  if(this.loaded)return;if(this.loading)return this.loading;
  const epoch=this.epoch,version=this.version;
  const promise=firstValueFrom(this.http.get<{items:{product_id:number;variant_id:string}[]}>(API_URL+'/account/favorites/state')).then(data=>{
   if(epoch!==this.epoch)return;if(version!==this.version){this.loading=undefined;return this.load();}
   this.keys.set(new Set(data.items.map(x=>this.key(x.product_id,x.variant_id))));this.loaded=true;this.ready.set(true);
  }).finally(()=>{if(epoch===this.epoch&&this.loading===promise)this.loading=undefined;});
  this.loading=promise;return promise;
 }
 saved(product:number,variant:string){return this.keys().has(this.key(product,variant));}
 busy(product:number,variant:string){return this.pending().has(this.key(product,variant));}
 async toggle(product:number,variant:string){
  if(!this.auth.user()){await this.router.navigate(['/login'],{queryParams:{returnUrl:this.router.url}});return;}
  const epoch=this.epoch,key=this.key(product,variant);if(this.pending().has(key))return;
  this.pending.update(v=>new Set([...v,key]));
  try{
   await this.load();if(epoch!==this.epoch)return;
   const remove=this.saved(product,variant);const url=API_URL+'/account/favorites/'+product+'/'+encodeURIComponent(variant);
   const result=await firstValueFrom(remove?this.http.delete<{saved:boolean}>(url):this.http.put<{saved:boolean}>(url,{}));
   if(epoch!==this.epoch)return;
   this.version++;this.keys.update(v=>{const next=new Set(v);result.saved?next.add(key):next.delete(key);return next;});this.revision.update(v=>v+1);
   this.ui.notify(result.saved?'Color saved to favorites.':'Color removed from favorites.');
  }catch(error){if(epoch===this.epoch)this.ui.notify(errorMessage(error),'error');}
  finally{if(epoch===this.epoch)this.pending.update(v=>{const next=new Set(v);next.delete(key);return next;});}
 }
}
