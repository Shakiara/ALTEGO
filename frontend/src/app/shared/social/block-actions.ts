// ALTEGO necesita resolver las confirmaciones de bloqueo y desbloqueo de cuentas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Injectable,inject,signal} from '@angular/core';import {Subject,firstValueFrom} from 'rxjs';import {Api,BlockUser,errorMessage} from "../../core/http/api";import {AuthService} from "../../core/auth/auth-service";import {UiFeedback} from "../ui/ui-feedback";
@Injectable({providedIn:'root'})
export class BlockActions{
 private api=inject(Api);private auth=inject(AuthService);private ui=inject(UiFeedback);
 busy=signal(false);failed=signal(false);changes=new Subject<{actor_id:number;user_id:number;blocked:boolean}>();
 async change(user:BlockUser,blocked:boolean){
  const actor=this.auth.user();if(!actor||actor.id===user.id||this.busy())return null;
  this.busy.set(true);this.failed.set(false);try{
   const confirmed=await this.ui.confirm({title:blocked?'Unblock this user?':'Block this user?',description:user.display_name+' (@'+user.username+')'+(blocked?'':' — This prevents social interactions in both directions.'),danger:!blocked,confirmLabel:blocked?'Unblock':'Block User'});
   if(!confirmed||this.auth.user()?.id!==actor.id)return null;
   const result=await firstValueFrom(blocked?this.api.unblockUser(user.id):this.api.blockUser(user.id));
   if(this.auth.user()?.id!==actor.id)return null;
   this.changes.next({actor_id:actor.id,...result});this.ui.notify(result.blocked?'User blocked.':'User unblocked.');return result;
  }catch(error){this.failed.set(true);if(this.auth.user()?.id===actor.id)this.ui.notify(errorMessage(error),'error');return null;}
  finally{this.busy.set(false);}
 }
}
