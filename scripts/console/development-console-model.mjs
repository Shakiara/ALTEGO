// ALTEGO necesita resolver el estado y los registros depurados de la consola.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export const sources=['All','API','Frontend','Databases','Console'];
export const levels=['All','Info','Success','Warning','Error'];
export function redact(text,secrets=[],preserveColor=false){
 let value=String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g,'');
 for(const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))value=value.split(secret).join('[redacted]');
 const clean=value.replace(/(mongodb(?:\+srv)?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[redacted]@').replace(/(Bearer\s+)\S+/gi,'$1[redacted]').replace(/((?:password|authorization|cookie|token|secret)\s*[:=]\s*)\S+/gi,'$1[redacted]');
 if(!preserveColor)return clean;
 const raw=String(text),plain=raw.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g,'');

 if(plain!==clean)return clean;
 return raw.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g,sequence=>/^\x1b\[[0-9;:]*m$/.test(sequence)?sequence:'').replace(/\x1b(?!\[[0-9;:]*m)/g,'').replace(/[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g,'');
}
export class ConsoleModel{
 constructor(secrets=[]){this.secrets=secrets;this.logs=[];this.sequence=0;this.source=0;this.level=0;this.search='';this.paused=null;this.compilation='Waiting';this.watch=false;this.critical='';this.bytes=0;}
 add(source,message,level){
  message=redact(message,this.secrets);if(!message.trim())return;
  level??=/\berror\b|failed|could not|fatal|exception|ERR!|✘/i.test(message)?'Error':/\bwarn(?:ing)?\b|console\.warn|▲|dynamic import cannot be analyzed/i.test(message)?'Warning':/API ready:|MySQL and MongoDB connected|bundle generation complete|compiled successfully|: Online(?:$|\s)|Desktop connected\./i.test(message)?'Success':'Info';
  const entry={id:++this.sequence,time:new Date().toLocaleTimeString('en-GB'),source,level,message};this.logs.push(entry);this.bytes+=message.length;
  while(this.logs.length>2500||this.bytes>2_000_000){const old=this.logs.shift();this.bytes-=old.message.length;}
  if(level==='Error')this.critical=`${source}: ${message}`;
  if(source==='Frontend'){
   if(/building|changes detected|rebuilding/i.test(message))this.compilation='Building';
   if(/bundle generation complete|compiled successfully/i.test(message)){this.compilation='Success';this.lastBuild=entry.time;}
   if(/bundle generation failed|compilation failed/i.test(message))this.compilation='Failed';
   if(/watch mode enabled|watching for file changes/i.test(message))this.watch=true;
  }
  return entry;
 }
 filtered(){return(this.paused??this.logs).filter(e=>(!this.source||e.source===sources[this.source])&&(!this.level||e.level===levels[this.level])&&(!this.search||e.message.toLowerCase().includes(this.search.toLowerCase())));}
}

export function terminalLine(entry,raw,secrets=[],color=false){const prefix=entry.source==='Frontend'?'WEB':entry.source==='Databases'?'DB':entry.source==='Console'?'DEV':'API';const tint={API:36,WEB:35,DB:34,DEV:90}[prefix];const label=color?`\x1b[${tint}m[${prefix}]\x1b[0m`:`[${prefix}]`;const severity=entry.level==='Error'?'Error':entry.level==='Warning'?'Warning':'';const badge=severity?(color?` \x1b[${severity==='Error'?31:33}m${severity}\x1b[0m`:` ${severity}`):'';return `${label} [${entry.time}]${badge} ${redact(raw,secrets,color)}${color?'\x1b[0m':''}\n`;}
