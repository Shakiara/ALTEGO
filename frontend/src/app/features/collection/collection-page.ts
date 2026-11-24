// ALTEGO necesita resolver la presentación y organización de My Collection.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {Component,OnDestroy,inject,signal,effect,viewChild,ElementRef} from '@angular/core';import {DatePipe} from '@angular/common';import {FormsModule} from '@angular/forms';import {Router,RouterLink} from '@angular/router';import {HttpClient} from '@angular/common/http';import {firstValueFrom} from 'rxjs';

import {AuthService,API_URL} from "../../core/auth/auth-service";import {errorMessage} from "../../core/http/api";import {GlassPanel,VisualButton,VisualField,VisualModal} from "../../shared/ui/visual-primitives";import {Icon} from "../../shared/ui/icon";import {Model} from "../../shared/model-viewer/model";

interface CollectionVersion{id:number;variant_id:string;number:number;acquired:boolean;model_url:string;texture_url:string|null}

interface CollectionVariant{id:string;name:string;acquired_at:string;versions:CollectionVersion[]}

interface CollectionProduct{id:number;name:string;creator:string;creator_id:number|null;category:string;pinned:boolean;restricted?:boolean;acquired_at:string;variant_count:number;version_count:number;preview:CollectionVersion;variants?:CollectionVariant[]}

interface CollectionPageResult{items:CollectionProduct[];page:number;pages:number;total:number;categories:string[];creators:string[]}

@Component({selector:'app-collection-page',imports:[DatePipe,FormsModule,RouterLink,GlassPanel,VisualButton,VisualField,VisualModal,Icon,Model],templateUrl:'./collection-page.html',styleUrl:'./collection-page.css'})

export class CollectionPage implements OnDestroy{

 private http=inject(HttpClient);private auth=inject(AuthService);private router=inject(Router);private owner=this.auth.user()?.id;private destroyed=false;private sequence=0;private endpoint=API_URL+'/account/collection';

 items=signal<CollectionProduct[]>([]);loading=signal(true);error=signal('');actionError=signal('');page=signal(1);pages=signal(1);total=signal(0);categories=signal<string[]>([]);creators=signal<string[]>([]);expanded=signal<number|null>(null);details=signal<CollectionProduct|null>(null);detailLoading=signal(false);detailError=signal('');pinBusy=signal<number|null>(null);downloading=signal<number|null>(null);private detailSequence=0;

 q='';sort='default';category='';creator='';payment='all';colors='all';pinned=false;
 filterDialog=viewChild.required<ElementRef<HTMLDialogElement>>('filterDialog');
 filtersOpen=signal(false);draft={category:'',creator:'',payment:'all',colors:'all',pinned:false};
 private searchTimer:ReturnType<typeof setTimeout>|undefined;private filterOpener:HTMLElement|null=null;
 openFilters(event:Event){this.draft={category:this.category,creator:this.creator,payment:this.payment,colors:this.colors,pinned:this.pinned};this.filterOpener=event.currentTarget instanceof HTMLElement?event.currentTarget:null;this.filtersOpen.set(true);this.filterDialog().nativeElement.showModal();}
 closeFilters(){this.filterDialog().nativeElement.close();}
 filtersClosed(){this.filtersOpen.set(false);if(this.filterOpener?.isConnected)this.filterOpener.focus();this.filterOpener=null;}
 filterBackdrop(event:MouseEvent){const dialog=this.filterDialog().nativeElement;if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)this.closeFilters();}
 applyFilters(){Object.assign(this,this.draft);this.closeFilters();void this.load();}
 resetDraft(){this.draft={category:'',creator:'',payment:'all',colors:'all',pinned:false};}
 searchChanged(){clearTimeout(this.searchTimer);this.searchTimer=setTimeout(()=>{void this.load();},300);}
 activeFilters(){return [{label:'Category',value:this.category},{label:'Creator',value:this.creator},{label:'Acquisition',value:this.payment==='free'?'Includes free items':this.payment==='paid'?'Includes paid items':''},{label:'Owned colors',value:this.colors==='one'?'One color':this.colors==='multiple'?'Multiple colors':''},{label:'',value:this.pinned?'Pinned only':''}].filter(filter=>filter.value);}


 constructor(){effect(()=>{if(this.auth.user()?.id!==this.owner){this.items.set([]);this.details.set(null);void this.router.navigate(['/login']);}});void this.load();}

 private active(){return !this.destroyed&&this.owner===this.auth.user()?.id;}

 private handle(e:any){if(e.status===401)void this.router.navigate(['/login'],{queryParams:{returnUrl:'/collection'}});return errorMessage(e);}

 resource(url:string|null){return url?API_URL.replace(/\/api\/?$/,'')+url:null;}

 async load(page=1){clearTimeout(this.searchTimer);const seq=++this.sequence;this.loading.set(true);this.error.set('');this.expanded.set(null);this.details.set(null);this.detailSequence++;try{const params={q:this.q,sort:this.sort,category:this.category,creator:this.creator,payment:this.payment,colors:this.colors,pinned:this.pinned?'1':'0',page:String(page)};const result=await firstValueFrom(this.http.get<CollectionPageResult>(this.endpoint,{params,withCredentials:true}));if(!this.active()||seq!==this.sequence)return;this.items.set(result.items);this.page.set(result.page);this.pages.set(result.pages);this.total.set(result.total);this.categories.set(result.categories);this.creators.set(result.creators);}catch(e){if(this.active()&&seq===this.sequence)this.error.set(this.handle(e));}finally{if(this.active()&&seq===this.sequence)this.loading.set(false);}}



 preview(item:CollectionProduct,version:CollectionVersion){this.items.update(items=>items.map(p=>p.id===item.id?{...p,preview:version}:p));}
 async expand(item:CollectionProduct){const seq=++this.detailSequence;if(this.expanded()===item.id){this.expanded.set(null);this.details.set(null);return;}this.expanded.set(item.id);this.details.set(null);this.detailLoading.set(true);this.detailError.set('');try{const result=await firstValueFrom(this.http.get<CollectionProduct>(this.endpoint+'/'+item.id,{withCredentials:true}));if(this.active()&&seq===this.detailSequence)this.details.set(result);}catch(e){if(this.active()&&seq===this.detailSequence)this.detailError.set(this.handle(e));}finally{if(this.active()&&seq===this.detailSequence)this.detailLoading.set(false);}}

 async pin(item:CollectionProduct){if(this.pinBusy())return;this.pinBusy.set(item.id);this.actionError.set('');try{await firstValueFrom(this.http.put(this.endpoint+'/'+item.id+'/pin',{pinned:!item.pinned},{withCredentials:true}));if(this.active())await this.load(this.page());}catch(e){if(this.active())this.actionError.set(this.handle(e));}finally{if(this.active())this.pinBusy.set(null);}}

 async download(item:CollectionProduct){if(this.downloading())return;this.downloading.set(item.id);this.actionError.set('');try{const blob=await firstValueFrom(this.http.get(this.endpoint+'/'+item.id+'/download',{responseType:'blob',withCredentials:true}));if(!this.active())return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ALTEGO_Collection_'+item.id+'.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e:any){if(!this.active())return;let message=this.handle(e);if(e.error instanceof Blob)try{message=JSON.parse(await e.error.text()).error||message;}catch{                                }this.actionError.set(message);}finally{if(this.active())this.downloading.set(null);}}

 ngOnDestroy(){clearTimeout(this.searchTimer);if(this.filterDialog().nativeElement.open)this.closeFilters();this.destroyed=true;this.sequence++;this.detailSequence++;this.items.set([]);this.details.set(null);}

}

