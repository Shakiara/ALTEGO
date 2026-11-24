// ALTEGO necesita resolver el directorio y la gestión autorizada de cuentas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {CreatorBadges} from "../../shared/identity/verified-creator-badge";
import {VerifiedCreatorBadge} from "../../shared/identity/verified-creator-badge";
import {AdminDialog} from "../../shared/administration/admin-dialog";
import {RouterLink} from '@angular/router';
import {ActivatedRoute} from '@angular/router';
import {AccountVerification} from "../../shared/identity/account-verification";
import {DatePipe} from '@angular/common';
import {Component,DestroyRef,ElementRef,ViewChild,computed,inject,signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {FormsModule} from '@angular/forms';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Subscription,firstValueFrom} from 'rxjs';
import {AuthService} from "../../core/auth/auth-service";
import {errorMessage} from "../../core/http/api";
import {Icon} from "../../shared/ui/icon";
import {GlassPanel,VisualButton,VisualField,VisualModal} from "../../shared/ui/visual-primitives";
import {UiFeedback} from "../../shared/ui/ui-feedback";
import {WorkspaceTable,WorkspaceColumn} from "../../shared/ui/workspace-table";

interface ManagedAccount {id:number;username:string;email?:string;role:'admin'|'moderator'|'user';verified:boolean;suspended:boolean;}
interface Sanction {id:number;kind:'warning'|'suspension';reason:string;explanation:string|null;issued_at:string;expires_at:string|null;lifted_at:string|null;active:boolean;}
interface AccountDetails {moderatorEligibility?:{eligible:boolean;ageDays:number;activeSanctions:number;accountActive:boolean};account:ManagedAccount;sanctions:Sanction[];}
interface AccountPage {items:ManagedAccount[];total:number;page:number;size:number;}
const base='/api/admin/workspace/accounts';
const roleNames={admin:'Admin',moderator:'Moderator',user:'User'};
const reasonNames:Record<string,string>={community_guidelines:'Community Guidelines',harassment:'Harassment',spam:'Spam',fraud:'Fraud',security:'Security',other:'Other'};

@Component({selector:'app-admin-accounts',imports:[AdminDialog,RouterLink,VerifiedCreatorBadge,AccountVerification,DatePipe,FormsModule,Icon,GlassPanel,VisualButton,VisualField,VisualModal,WorkspaceTable],templateUrl:'./admin-accounts.html',styleUrl:'./admin-accounts.css'})
export class AdminAccounts{
 private creatorBadges=inject(CreatorBadges);
 private route=inject(ActivatedRoute);moderationOnly=this.route.snapshot.data['disciplinary']===true;discipline='all';
 private auth=inject(AuthService);private http=inject(HttpClient);private ui=inject(UiFeedback);private destroy=inject(DestroyRef);
 private listRequest?:Subscription;private detailRequest?:Subscription;private trigger?:HTMLElement;
 @ViewChild('drawer',{static:true}) drawer!:ElementRef<HTMLDialogElement>;
 isAdmin=()=>this.auth.user()?.role==='admin';
 roleNames=roleNames;reasonNames=reasonNames;reasons=Object.keys(reasonNames);
 search='';role='';status='';sort='username';direction='asc';
 result=signal<AccountPage|null>(null);loading=signal(false);error=signal('');
 details=signal<AccountDetails|null>(null);detailError=signal('');busy=signal(false);
 kind:'warning'|'suspension'='warning';reason='';days:number|null=1;indefinite=false;explanation='';
 selectedRole:'user'|'moderator'='user';pane='account';
 @ViewChild(AccountVerification)verification?:AccountVerification;
 dirty=()=>!!this.reason||!!this.explanation.trim()||this.kind!=='warning'||this.days!==1||this.indefinite||!!this.verification?.dirty()||!!this.details()&&this.details()!.account.role!=='admin'&&this.selectedRole!==this.details()!.account.role;
 isBusy=()=>this.busy()||!!this.verification?.busy();
 columns=computed<WorkspaceColumn[]>(()=>[{key:'username',label:'Username',kind:'identity'},...(this.isAdmin()?[{key:'email',label:'Email'}]:[]),
  {key:'role',label:'Role',kind:'badge'},{key:'status',label:'Status',kind:'badge'},{key:'verified',label:'Verified Creator',kind:'verification'}]);
 rows=computed(()=>(this.result()?.items??[]).map(account=>({id:account.id,profileIds:{username:account.id},values:{username:'@'+account.username,email:account.email??'',role:roleNames[account.role],status:account.suspended?'Suspended':'Active',verified:account.verified?'Verified':'Not verified'},tones:{role:account.role,status:account.suspended?'suspended':'active',verified:account.verified?'verified':'unverified'}})));
 pages=computed(()=>Math.max(1,Math.ceil((this.result()?.total??0)/(this.result()?.size??12))));
 constructor(){this.load();}
 ngAfterViewInit(){const id=Number(this.route.snapshot.queryParamMap.get('account'));if(this.moderationOnly&&Number.isSafeInteger(id)&&id>0)queueMicrotask(()=>this.open(id));}
 load(page=1){
  this.listRequest?.unsubscribe();this.loading.set(true);this.error.set('');
  this.listRequest=this.http.get<AccountPage>(this.moderationOnly?'/api/admin/governance/accounts':base,{params:{...(this.moderationOnly?{discipline:this.discipline}:{}),q:this.search,role:this.role,status:this.status,sort:this.sort,direction:this.direction,page}}).pipe(takeUntilDestroyed(this.destroy)).subscribe({
   next:result=>{this.result.set(result);this.loading.set(false);},
   error:error=>{this.result.set(null);this.error.set(errorMessage(error));this.loading.set(false);}
  });
 }
 open(id:number){
  this.trigger=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
  this.pane='account';this.kind='warning';this.reason='';this.days=1;this.indefinite=false;this.explanation='';
  this.read(id,true);this.drawer.nativeElement.showModal();
 }
 read(id:number,reset:boolean){
  this.detailRequest?.unsubscribe();if(reset)this.details.set(null);this.detailError.set('');
  this.detailRequest=this.http.get<AccountDetails>(base+'/'+id).pipe(takeUntilDestroyed(this.destroy)).subscribe({
   next:result=>{this.details.set(result);if(result.account.role!=='admin')this.selectedRole=result.account.role;},
   error:error=>this.detailError.set(errorMessage(error))
  });
 }
 closed(){if(this.drawer.nativeElement.open)return;this.detailRequest?.unsubscribe();this.details.set(null);this.reason='';this.explanation='';this.kind='warning';this.days=1;this.indefinite=false;const trigger=this.trigger;if(trigger?.isConnected)trigger.focus();else document.getElementById('account-search')?.focus();}
 updateVerified(verified:boolean){this.details.update(data=>data?{...data,account:{...data.account,verified}}:data);}
 accountTabs(){return this.isAdmin()?['account','verification','sanctions']:['account','sanctions'];}
 canSanction(account:ManagedAccount){return account.role!=='admin'&&(this.isAdmin()||account.role==='user');}
 validDays(){return this.indefinite&&this.isAdmin()||Number.isInteger(this.days)&&this.days!>=1&&this.days!<=(this.isAdmin()?365:7);}
 async updateRole(account:ManagedAccount){
  await this.change(account,'Change Role',`Change @${account.username} to ${roleNames[this.selectedRole]}? Existing sessions will end.`,
   this.http.put(base+'/'+account.id+'/role',{role:this.selectedRole}),'Role updated.');
  void this.creatorBadges.refresh();
 }
 async issue(account:ManagedAccount){
  if(!this.reason||this.kind==='suspension'&&!this.validDays())return;
  const title=this.kind==='warning'?'Issue Warning':'Suspend Account';
  const action=this.kind==='warning'?'Issue a warning':this.indefinite?'Suspend indefinitely':`Suspend for ${this.days} day(s)`;
  await this.change(account,title,`${action} for @${account.username}? The decision will be recorded in account history.`,
   this.http.post(base+'/'+account.id+'/sanctions',{kind:this.kind,reason:this.reason,explanation:this.explanation,...(this.kind==='suspension'?{days:this.indefinite?null:this.days}:{})}),
   this.kind==='warning'?'Warning issued.':'Account suspended.');
 }
 async lift(account:ManagedAccount,sanction:Sanction){
  await this.change(account,'Lift Suspension',`Allow @${account.username} to sign in again?`,this.http.post(base+'/'+account.id+'/sanctions/'+sanction.id+'/lift',{}),'Suspension lifted.');
 }
 private async change(account:ManagedAccount,title:string,description:string,request:ReturnType<HttpClient['post']>,message:string){
  if(this.busy()||!await this.ui.confirm({dismissOnBackdrop:true,title,description,danger:true,confirmLabel:title}))return;
  this.busy.set(true);
  try{
   await firstValueFrom(request);this.ui.notify(message);this.reason='';this.explanation='';this.kind='warning';this.days=1;this.indefinite=false;
   if(this.drawer.nativeElement.open)this.read(account.id,false);
   this.load(this.result()?.page??1);
  }catch(error){this.ui.notify(errorMessage(error),'error');}
  finally{this.busy.set(false);}
 }
}
