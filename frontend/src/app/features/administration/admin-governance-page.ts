// ALTEGO necesita resolver las páginas administrativas de moderación y auditoría.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {AdminDialog} from "../../shared/administration/admin-dialog";
import {AdminCarousel} from "../../shared/administration/admin-carousel";
import {AuthService} from "../../core/auth/auth-service";
import {DatePipe,TitleCasePipe} from '@angular/common';
import {Component,DestroyRef,ElementRef,ViewChild,computed,inject,signal} from '@angular/core';
import {ActivatedRoute,RouterLink} from '@angular/router';
import {FormsModule} from '@angular/forms';
import {firstValueFrom,Subscription} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {AdminGovernanceService,GovernanceDetail,GovernancePage,moderationReasons} from "../../shared/administration/admin-governance-service";
import {WorkspaceTable,WorkspaceColumn} from "../../shared/ui/workspace-table";
import {GlassPanel,VisualButton,VisualField,VisualModal} from "../../shared/ui/visual-primitives";
import {UiFeedback} from "../../shared/ui/ui-feedback";
import {Icon} from "../../shared/ui/icon";
import {Model} from "../../shared/model-viewer/model";
import {errorMessage} from "../../core/http/api";

@Component({selector:'app-admin-governance-page',imports:[AdminDialog,AdminCarousel,DatePipe,TitleCasePipe,FormsModule,RouterLink,WorkspaceTable,GlassPanel,VisualButton,VisualField,VisualModal,Icon,Model],templateUrl:'./admin-governance-page.html',styleUrl:'./admin-governance-page.css'})
export class AdminGovernancePage{
 auth=inject(AuthService);pane='details';selecting=false;selectedVersion:string|null=null;selectedVariant:string|null=null;
 private route=inject(ActivatedRoute);private api=inject(AdminGovernanceService);private ui=inject(UiFeedback);private destroy=inject(DestroyRef);
 section=this.route.snapshot.data['section'] as string;queue='products';caseType='product';
 get currentSection(){return this.section==='products'?this.queue:this.section;}
 chooseQueue(queue:string){if(this.busy())return;this.caseType=queue==='reviews'?'review':'product';this.queue=queue==='reviews'?'cases':queue;this.state='';this.selectedIds.clear();this.load();}
 applyFilters(){this.selectedIds.clear();this.load();}
 titles:Record<string,string>={feed:'Feed Reports',products:'Content Moderation',cases:'Product Reports',appeals:'Appeals',removed:'Removed Content',audit:'Audit Log'};
 title=this.titles[this.section];search='';state='';category='';reason='';explanation='';chosen='';busy=signal(false);loading=signal(false);detailLoading=signal(false);
 error=signal('');detailError=signal('');page=signal<GovernancePage|null>(null);detail=signal<GovernanceDetail|null>(null);texture=signal<string|null>(null);
 reasons=moderationReasons;selectedIds=new Set<number>();bulkAction='assign';bulkReason='';
 private request?:Subscription;private detailRequest?:Subscription;private trigger?:HTMLElement;
 @ViewChild('drawer',{static:true})drawer!:ElementRef<HTMLDialogElement>;
 columns:WorkspaceColumn[]=[{key:'title',label:'Item'},{key:'owner',label:'Account'},{key:'state',label:'Status',kind:'badge'},{key:'date',label:'Date'}];
 rows=computed(()=>(this.page()?.items||[]).map(row=>({id:row.id,selectable:!!row.deletion_eligible,profileIds:row.owner_id?{owner:row.owner_id}:{},values:{title:row.title.replaceAll('_',' '),username:row.title,owner:row.owner?'@'+row.owner:'—',state:row.state,date:new Date(row.created_at).toLocaleDateString('en-US')},tones:{state:row.state==='pending'?'moderator':row.state==='removed'?'suspended':'user'}})));
 pages=computed(()=>Math.max(1,Math.ceil((this.page()?.total||0)/(this.page()?.size||20))));
 get states(){return this.currentSection==='feed'?['pending','resolved']:this.currentSection==='products'?['pending','approved','rejected','unreviewed']:this.currentSection==='cases'?['pending','restored','removed']:this.section==='appeals'?['pending','approved','rejected']:this.section==='removed'?['removed','restored']:['success','denied','failed'];}
 constructor(){this.load();}
 ngAfterViewInit(){const id=Number(this.route.snapshot.queryParamMap.get('item'));if(this.section==='products'&&Number.isSafeInteger(id)&&id>0)queueMicrotask(()=>this.open(id));}
 load(page=1){this.request?.unsubscribe();this.loading.set(true);this.error.set('');if(this.section!=='audit')this.selectedIds.clear();
  this.request=this.api.list(this.currentSection,{q:this.search,state:this.state,page,category:this.category,...(this.currentSection==='cases'?{type:this.caseType}:{})}).pipe(takeUntilDestroyed(this.destroy)).subscribe({next:result=>{this.page.set(result);this.loading.set(false);},error:error=>{this.page.set(null);this.loading.set(false);this.error.set(errorMessage(error));}});
 }
 open(id:number){this.trigger=document.activeElement as HTMLElement;this.detail.set(null);this.detailLoading.set(true);this.detailError.set('');this.texture.set(null);this.reason='';this.explanation='';this.chosen='';this.selectedVersion=null;this.selectedVariant=null;this.pane='details';this.detailRequest?.unsubscribe();
  this.detailRequest=this.api.detail(this.currentSection,id).pipe(takeUntilDestroyed(this.destroy)).subscribe({next:result=>{this.detail.set(result);this.selectVariant(this.activeVariants().find(v=>v.is_default)?.id||this.activeVariants()[0]?.id||'');this.detailLoading.set(false);},error:error=>{this.detailError.set(errorMessage(error));this.detailLoading.set(false);}});
  this.drawer.nativeElement.showModal();
 }
 closed(){if(this.drawer.nativeElement.open)return;this.detailRequest?.unsubscribe();this.detail.set(null);this.texture.set(null);this.reason='';this.explanation='';this.chosen='';if(this.trigger?.isConnected)this.trigger.focus();}
 dirty=()=>!!this.reason||!!this.explanation.trim()||!!this.chosen;isBusy=()=>this.busy();
 detailTabs(){const d=this.detail();return ['details',...(d?.model_url||d?.versions?.length?['preview']:[]),...(d?.history?.length||d?.versions?.length?['history']:[]),...(d?.reports?.length?['reports']:[])];}
 readable(value:string){const labels:Record<string,string>={'audit.records_deleted':'Audit Records Deleted','administrative.request_rejected':'Administrative Access Rejected','account.role_changed':'Account Role Changed','case.dismiss':'Reports Dismissed','case.assign':'Case Assigned','case.restored':'Content Restored','case.removed':'Content Removed','content.removed':'Content Removed','content.restored':'Content Restored'};return labels[value]||value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_.-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
 drawerTitle(){const value=this.detail()?.title||this.title;return this.section==='audit'?this.readable(value):value;}
 auditFields(){return (this.detail()?.fields||[]).filter(field=>field.label!=='Changes').map(field=>({...field,value:field.user_id||!field.value?field.value:field.label==='Entity'?field.value.replace(/^[^#]+/,prefix=>this.readable(prefix.trim())+' '):/^[a-z][a-z0-9_.]*$/.test(field.value)?this.readable(field.value):field.value}));}
 auditDate(){return this.page()?.items.find(item=>item.id===this.detail()?.id)?.created_at;}
 auditOriginal(){return this.detail()?.fields.find(field=>field.label==='Changes')?.value??null;}
 auditChanges(){let value:unknown=this.auditOriginal();for(let step=0;step<2&&typeof value==='string';step++){try{value=JSON.parse(value);}catch{break;}}
  const rows:{label:string;before?:string;after?:string;value?:string}[]=[];
  const format=(v:unknown):string=>v===undefined||v===null?'—':Array.isArray(v)?v.map(format).join(', '):typeof v==='object'?Object.entries(v).map(([k,x])=>this.readable(k)+': '+format(x)).join('; '):typeof v==='boolean'?v?'Yes':'No':String(v);
  const pair=(before:unknown,after:unknown,label:string)=>{if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){const a=before as Record<string,unknown>,b=after as Record<string,unknown>;for(const key of new Set([...Object.keys(a),...Object.keys(b)]))pair(a[key],b[key],label?label+' · '+this.readable(key):this.readable(key));}else rows.push({label:label||'Change',before:format(before),after:format(after)});};
  const walk=(v:unknown,label:string)=>{if(v&&typeof v==='object'&&!Array.isArray(v)){const obj=v as Record<string,unknown>;if('before'in obj&&'after'in obj){pair(obj['before'],obj['after'],label);for(const [k,x]of Object.entries(obj))if(!['before','after'].includes(k))walk(x,label?label+' · '+this.readable(k):this.readable(k));}else if('from'in obj&&'to'in obj){pair(obj['from'],obj['to'],label);for(const[k,x]of Object.entries(obj))if(!['from','to'].includes(k))walk(x,this.readable(k));}else for(const[k,x]of Object.entries(obj))walk(x,label?label+' · '+this.readable(k):this.readable(k));}else if(v!==null&&v!==undefined)rows.push({label:label||'Details',value:format(v)});};walk(value,'');return rows;
 }
 selectPane(pane:string){this.pane=pane;requestAnimationFrame(()=>{const body=this.drawer.nativeElement.querySelector('.drawer-body');if(body)body.scrollTop=0;});}
 activeVariants(){return this.selectedVersion?this.detail()?.versions?.find(v=>String(v.id)===this.selectedVersion)?.variants||[]:this.detail()?.variants||[];}
 modelSource(){return this.selectedVersion?this.detail()?.versions?.find(v=>String(v.id)===this.selectedVersion)?.model_url||null:this.detail()?.model_url||null;}
 variantItems(){return this.activeVariants().map(v=>({id:v.id,label:v.name,hex:v.hex}));}
 versionItems(){return (this.detail()?.versions||[]).map(v=>({id:String(v.id),label:'Version '+v.version_number,subtitle:(v.state||'Published')+' · '+new Date(v.created_at).toLocaleDateString('en-US')}));}
 selectVariant(id:string){this.selectedVariant=id;this.texture.set(this.activeVariants().find(v=>v.id===id)?.texture_url||null);}
 selectVersion(id:string|null){this.selectedVersion=id;this.selectVariant(this.activeVariants().find(v=>v.is_default)?.id||this.activeVariants()[0]?.id||'');}
 toggleAudit(){this.selecting=!this.selecting;this.selectedIds.clear();}
 selectVisible(){for(const row of this.page()?.items||[])if(row.deletion_eligible&&this.selectedIds.size<100)this.selectedIds.add(row.id);}
 async deleteAudit(){const ids=[...this.selectedIds];if(!ids.length||this.busy())return;
 if(!await this.ui.confirm({dismissOnBackdrop:true,title:'Delete Audit Records',description:'Permanently delete exactly '+ids.length+' selected '+(ids.length===1?'record':'records')+'? This cannot be undone. Records subject to an explicit retention hold cannot be deleted.',confirmLabel:'Delete '+ids.length+(ids.length===1?' Record':' Records'),danger:true}))return;
 this.busy.set(true);try{const result=await firstValueFrom(this.api.deleteAudit(ids));this.ui.notify(result.deleted+' audit records deleted.');this.selecting=false;this.selectedIds.clear();this.load();}catch(error){this.ui.notify(errorMessage(error),'error');}finally{this.busy.set(false);}}
 async decide(){
  const selected=this.detail();if(!selected||!this.chosen||!this.reason||this.busy())return;
  const label=selected.actions.find(action=>action.id===this.chosen)?.label||'Confirm Decision';
  if(!await this.ui.confirm({dismissOnBackdrop:true,title:label,description:this.currentSection==='products'&&this.chosen.startsWith('review_')?'This decision applies to the submitted draft and will be recorded in the administrative history.':'This decision will be recorded in the administrative history.',danger:true,confirmLabel:label}))return;
  this.busy.set(true);
  try{await firstValueFrom(this.api.decide(this.currentSection,selected,this.chosen,this.reason,this.explanation));this.ui.notify('Decision recorded.');this.drawer.nativeElement.close();this.load(this.page()?.page||1);}
  catch(error){this.detailError.set(errorMessage(error));}
  finally{this.busy.set(false);}
 }
 async bulk(){
  if(!this.selectedIds.size||!this.bulkReason||this.busy())return;
  if(!await this.ui.confirm({dismissOnBackdrop:true,title:'Confirm Case Action',description:'Apply '+this.bulkAction+' to '+this.selectedIds.size+' cases? Each decision will be audited.',danger:true}))return;
  this.busy.set(true);try{await firstValueFrom(this.api.bulk([...this.selectedIds],this.bulkAction,this.bulkReason));this.ui.notify('Cases updated.');this.load();}
  catch(error){this.ui.notify(errorMessage(error),'error');}finally{this.busy.set(false);}
 }
 toggle(id:number,checked:boolean){if(checked&&this.selectedIds.size<(this.currentSection==='cases'?20:100))this.selectedIds.add(id);else this.selectedIds.delete(id);}
}
