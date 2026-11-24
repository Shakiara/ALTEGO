// ALTEGO necesita resolver las restricciones, sanciones y apelaciones de la cuenta.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Icon} from "../../shared/ui/icon";
import {DatePipe,TitleCasePipe,NgTemplateOutlet} from '@angular/common';
import {Component,DestroyRef,computed,inject,signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {RouterLink} from '@angular/router';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {GlassPanel,VisualButton,VisualField} from "../../shared/ui/visual-primitives";
import {UiFeedback} from "../../shared/ui/ui-feedback";
import {errorMessage} from "../../core/http/api";
interface OwnSanction{id:number;kind:string;reason:string;explanation:string|null;issued_at:string;expires_at:string|null;lifted_at:string|null;active:boolean;appeal_id:number|null;appeal_status:string|null;appeal_explanation:string|null;appeal_submitted_at:string|null;appeal_decided_at:string|null;decision_reason:string|null;decision_explanation:string|null;}
interface OwnStatus{sanctions:OwnSanction[];removals:{id:number;label:string;reason:string;explanation:string|null;removed_at:string;restored_at:string|null}[];restricted:boolean;}
@Component({selector:'app-account-status',imports:[Icon,DatePipe,TitleCasePipe,NgTemplateOutlet,FormsModule,RouterLink,GlassPanel,VisualButton,VisualField],templateUrl:'./account-status.html',styleUrl:'./account-status.css'})
export class AccountStatus{
 private http=inject(HttpClient);private ui=inject(UiFeedback);private destroy=inject(DestroyRef);data=signal<OwnStatus|null>(null);section=signal('active');active=computed(()=>this.data()?.sanctions.filter(s=>s.active)||[]);appeals=computed(()=>this.data()?.sanctions.filter(s=>s.appeal_id)||[]);error=signal('');loading=signal(false);busy=signal(false);drafts:Record<number,string>={};
 constructor(){this.load();}
 load(){this.loading.set(true);this.error.set('');this.http.get<OwnStatus>('/api/account/sanctions').pipe(takeUntilDestroyed(this.destroy)).subscribe({next:data=>{this.data.set(data);this.loading.set(false);},error:error=>{this.error.set(errorMessage(error));this.loading.set(false);}});}
 async appeal(sanction:OwnSanction){if(this.busy()||!this.drafts[sanction.id]?.trim()||!await this.ui.confirm({title:'Submit Appeal',description:'Your explanation will be reviewed by Admin. This does not pause the sanction.'}))return;this.busy.set(true);try{await firstValueFrom(this.http.post('/api/account/sanctions/'+sanction.id+'/appeal',{explanation:this.drafts[sanction.id]}));this.ui.notify('Appeal submitted.');delete this.drafts[sanction.id];this.load();}catch(error){this.error.set(errorMessage(error));}finally{this.busy.set(false);}}
}
