// ALTEGO necesita resolver el listado y los detalles de casos de conversaciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {RouterLink} from '@angular/router';
import {FormsModule} from '@angular/forms';
import {AuthService} from "../../core/auth/auth-service";
import {DatePipe} from '@angular/common';
import {Component,DestroyRef,ElementRef,ViewChild,computed,inject,signal} from '@angular/core';
import {firstValueFrom} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {Api,assetUrl,errorMessage} from "../../core/http/api";
import {reportReasons,type ModerationCase,type ModerationCaseDetails,type ReportReason} from "../../shared/community/community-types";
import {UiFeedback} from "../../shared/ui/ui-feedback";
import {GlassPanel,VisualButton,VisualField,VisualModal} from "../../shared/ui/visual-primitives";
import {WorkspaceTable,WorkspaceColumn} from "../../shared/ui/workspace-table";
import {AdminGovernanceService} from "../../shared/administration/admin-governance-service";
import {AdminDialog} from "../../shared/administration/admin-dialog";
import {Icon} from "../../shared/ui/icon";

@Component({selector:'app-admin-page',imports:[RouterLink,DatePipe,FormsModule,GlassPanel,VisualButton,VisualField,VisualModal,WorkspaceTable,AdminDialog,Icon],templateUrl:'./admin-conversations-page.html',styleUrl:'./admin-conversations-page.css'})
export class AdminConversationsPage{
 auth=inject(AuthService);reason='';search='';contentType='';section='summary';
 private api=inject(Api);private governance=inject(AdminGovernanceService);private ui=inject(UiFeedback);private destroy=inject(DestroyRef);
 @ViewChild('drawer',{static:true})drawer!:ElementRef<HTMLDialogElement>;
 readonly tab=signal<'pending'|'resolved'>('pending');readonly items=signal<ModerationCase[]>([]);readonly cursor=signal<string|null>(null);
 readonly selected=signal<ModerationCaseDetails|null>(null);readonly listLoading=signal(false);readonly detailLoading=signal(false);readonly deciding=signal(false);
 readonly listError=signal('');readonly detailError=signal('');readonly pageIndex=signal(1);readonly total=signal<number|null>(null);
 private listRequest=0;private detailRequest=0;private starts:(string|null)[]=[null];private filters={q:'',type:''};private trigger?:HTMLElement;private selectedId='';
 readonly imageUrl=assetUrl;readonly reasonLabel=(id:ReportReason)=>reportReasons.find(reason=>reason.id===id)?.label??id;
 readonly statusLabel=(status:string)=>({pending:'Pending Review',restored:'Restored',removed:'Removed'}[status]||status);
 readonly columns:WorkspaceColumn[]=[{key:'case',label:'Case'},{key:'author',label:'Author'},{key:'type',label:'Type'},{key:'reports',label:'Reports'},{key:'status',label:'Status',kind:'badge'}];
 readonly rows=computed(()=>this.items().map((item,index)=>({id:index+1,profileIds:item.author_id?{author:item.author_id}:{},values:{case:item.id.slice(0,8).toUpperCase()+' · '+new Date(item.created_at).toLocaleDateString('en-US'),username:item.id,author:item.author?'@'+item.author:'Unavailable account',type:item.content_type[0].toUpperCase()+item.content_type.slice(1),reports:String(item.report_count),status:this.statusLabel(item.status)},tones:{status:item.status==='pending'?'moderator':item.status==='removed'?'suspended':'active'}})));
 readonly pages=computed(()=>this.total()===null?this.pageIndex()+(this.cursor()?1:0):Math.max(1,Math.ceil(this.total()!/20)));
 readonly pagerTotal=computed(()=>this.total()??((this.pageIndex()-1)*20+this.items().length+(this.cursor()?1:0)));
 readonly sections=computed(()=>this.selected()?.content?['summary','content','reports','history']:['summary','reports','history']);
 hasFilters=()=>!!(this.filters.q||this.filters.type);
 reportAction='assign';reportSelection=new Set<number>();
 dirty=()=>!!this.reason||this.reportSelection.size>0||this.reportAction!=='assign';isBusy=()=>this.deciding();
 constructor(){void this.load();}
 selectTab(tab:'pending'|'resolved'){if(tab===this.tab()||this.deciding())return;this.tab.set(tab);this.resetPages();void this.load();}
 applyFilters(){if(this.deciding())return;this.filters={q:this.search.trim(),type:this.contentType};this.resetPages();void this.load();}
 private resetPages(){this.starts=[null];this.pageIndex.set(1);this.total.set(null);this.cursor.set(null);}
 async load(page=1){const before=this.starts[page-1];if(before===undefined)return;const request=++this.listRequest;this.listLoading.set(true);this.listError.set('');
  try{const result=await firstValueFrom(this.api.moderationCases(this.tab(),before,this.filters).pipe(takeUntilDestroyed(this.destroy)));if(this.destroy.destroyed||request!==this.listRequest)return;
   this.items.set(result.items);this.cursor.set(result.next_cursor);this.pageIndex.set(page);this.total.set(typeof result.total==='number'?result.total:null);this.starts=this.starts.slice(0,page);if(result.next_cursor)this.starts.push(result.next_cursor);
  }catch(error){if(!this.destroy.destroyed&&request===this.listRequest)this.listError.set(errorMessage(error));}
  finally{if(!this.destroy.destroyed&&request===this.listRequest)this.listLoading.set(false);}
 }
 openRow(row:number){const item=this.items()[row-1];if(item)void this.review(item.id);}
 async review(id:string){if(this.deciding())return;if(!this.drawer.nativeElement.open)this.trigger=document.activeElement as HTMLElement;this.selectedId=id;this.reportSelection.clear();this.reportAction='assign';this.reason='';this.section='summary';this.selected.set(null);this.detailError.set('');if(!this.drawer.nativeElement.open)this.drawer.nativeElement.showModal();const request=++this.detailRequest;this.detailLoading.set(true);
  try{const item=await firstValueFrom(this.api.moderationCase(id).pipe(takeUntilDestroyed(this.destroy)));if(!this.destroy.destroyed&&request===this.detailRequest)this.selected.set(item);}
  catch(error){if(!this.destroy.destroyed&&request===this.detailRequest)this.detailError.set(errorMessage(error));}
  finally{if(!this.destroy.destroyed&&request===this.detailRequest)this.detailLoading.set(false);}
 }
 retryDetail(){void this.review(this.selectedId);}
 closed(){if(this.drawer.nativeElement.open)return;++this.detailRequest;this.selected.set(null);this.reason='';this.reportSelection.clear();this.reportAction='assign';this.detailLoading.set(false);if(this.trigger?.isConnected)this.trigger.focus();else document.getElementById('case-search')?.focus();}
 toggleReportCase(id:number,checked:boolean){if(checked&&this.reportSelection.size<20)this.reportSelection.add(id);else this.reportSelection.delete(id);}
 async manageReports(item:ModerationCaseDetails){if(!item.record_id||!this.reason||this.deciding())return;this.deciding.set(true);try{
  const ids=this.reportSelection.size?[...this.reportSelection]:[item.record_id];
  if(!await this.ui.confirm({dismissOnBackdrop:true,title:this.reportAction==='assign'?'Assign Cases':'Dismiss Reports',description:'Apply this action to exactly '+ids.length+' pending cases? Each decision will be recorded.',danger:this.reportAction==='dismiss'}))return;
  await firstValueFrom(this.governance.bulk(ids,this.reportAction,this.reason));this.reason='';this.reportSelection.clear();this.ui.notify('Cases updated.');await this.reviewAfterAction(item.id);this.resetPages();await this.load();
 }catch(error){this.detailError.set(errorMessage(error));}finally{this.deciding.set(false);}}
 private async reviewAfterAction(id:string){this.selected.set(await firstValueFrom(this.api.moderationCase(id)));}
 async decide(item:ModerationCaseDetails,action:'restore'|'remove'){
  if(item.status!=='pending'||this.deciding()||!this.reason)return;const remove=action==='remove';this.deciding.set(true);this.detailError.set('');
  try{if(!await this.ui.confirm({dismissOnBackdrop:true,title:remove?'Remove content from public view?':'Restore content?',description:remove?'The content and its interactions will be preserved for administrative recovery.':'The content will return according to its original visibility.',confirmLabel:remove?'Remove Content':'Restore',danger:remove}))return;
   this.selected.set(await firstValueFrom(this.api.resolveModerationCase(item.id,action,this.reason)));this.reason='';this.ui.notify(remove?'Content removed from public view.':'Content restored.');this.resetPages();await this.load();
  }catch(error){this.detailError.set(errorMessage(error));}finally{this.deciding.set(false);}
 }
}
