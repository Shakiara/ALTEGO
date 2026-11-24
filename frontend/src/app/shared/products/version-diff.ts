// ALTEGO necesita resolver la comparación de versiones publicadas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import type {PublishedVersion} from "../../core/http/api";
export interface VersionChange {title:string;rows:{text:string;hex?:string;before?:string;after?:string}[];}
const price=(n:number)=>n===0?'FREE':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const known=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
export function versionChanges(current:PublishedVersion,previous?:PublishedVersion):VersionChange[]{
 const c=current.snapshot,p=previous?.snapshot,groups:VersionChange[]=[];
 const add=(title:string,rows:VersionChange['rows'])=>{if(rows.length)groups.push({title,rows});};
 if(current.restored_from)add('Restored Version',[{text:'Restored from v'+current.restored_from}]);
 if(current.version_number===1){
  add('Initial Publication',[{text:'Initial publication.'},...(Number.isFinite(c.price)?[{text:'Price: '+price(c.price)}]:[]),...(c.model_asset_id?[{text:'Initial GLB assigned.'}]:[])]);
  add('Initial Variants',(c.variants||[]).map(v=>({text:v.name,hex:v.hex})));
  if(!Number.isFinite(c.price)||!c.model_asset_id||!c.variants?.length)add('Historical Data',[{text:'Changes could not be determined.'}]);return groups;
 }
 if(!p){add('Historical Data',[{text:'Changes could not be determined.'}]);return groups;}
 let incomplete=false;
 if(Number.isFinite(c.price)&&Number.isFinite(p.price)){if(c.price!==p.price)add('Price Changed',[{text:'',before:price(p.price),after:price(c.price)}]);}else incomplete=true;
 const details:VersionChange['rows']=[];
 for(const[key,label]of [['name','Name'],['description','Description'],['category_id','Category']] as const){if(known(c,key)&&known(p,key)){if(c[key]!==p[key])details.push({text:label+' updated.'});}else incomplete=true;}
 add('Item Updated',details);
 if(c.model_asset_id&&p.model_asset_id){if(c.model_asset_id!==p.model_asset_id)add('Model Updated',[{text:'GLB asset reference replaced.'}]);}else incomplete=true;
 if(!Array.isArray(c.variants)||!Array.isArray(p.variants)||[...c.variants,...p.variants].some(v=>!v.id)){incomplete=true;}
 else{
  const before=new Map(p.variants.map(v=>[v.id,v])),after=new Map(c.variants.map(v=>[v.id,v]));
  add('Added Variants',c.variants.filter(v=>!before.has(v.id)).map(v=>({text:v.name,hex:v.hex})));
  add('Removed Variants',p.variants.filter(v=>!after.has(v.id)).map(v=>({text:v.name,hex:v.hex})));
  const updated:VersionChange['rows']=[];
  for(const v of c.variants){const old=before.get(v.id);if(!old)continue;const changes:string[]=[];
   for(const key of ['name','hex','texture_asset_id','is_default'] as const){if(!known(v,key)||!known(old,key)){incomplete=true;continue;}if(v[key]===old[key])continue;
    if(key==='name')changes.push(old.name+' → '+v.name);else if(key==='hex')changes.push(old.hex+' → '+v.hex);else if(key==='texture_asset_id')changes.push('texture updated');else changes.push(v.is_default?'set as default':'no longer default');
   }if(changes.length)updated.push({text:v.name+': '+changes.join(' · '),hex:v.hex});
  }add('Updated Variants',updated);
 }
 if(incomplete)add('Historical Data',[{text:'Changes could not be determined.'}]);
 else if(!groups.some(g=>g.title!=='Restored Version'))add('Comparison',[{text:'No changes detected.'}]);
 return groups;
}
