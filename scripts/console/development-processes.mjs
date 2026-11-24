// ALTEGO necesita resolver el seguimiento y cierre exclusivo de procesos propios.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const managedNames=new Set(['node.exe','esbuild.exe','Altego.DevConsole.exe','cmd.exe']);
export function discoverOwnedProcesses(rows,root,known=[],exitedAt=null){
 const identities=[root,...known].filter(Boolean),active=rows.filter(row=>managedNames.has(row.Name)&&identities.some(p=>p.ProcessId===row.ProcessId&&p.CreationDate===row.CreationDate));
 const byId=new Map(active.map(row=>[row.ProcessId,row]));
 if(root&&!byId.has(root.ProcessId)&&exitedAt)byId.set(root.ProcessId,{...root,virtual:true,end:exitedAt});
 let more=true;while(more){more=false;for(const row of rows){const parent=byId.get(row.ParentProcessId),created=Date.parse(row.CreationDate);if(!byId.has(row.ProcessId)&&parent&&managedNames.has(row.Name)&&created>=Date.parse(parent.CreationDate)&&(!parent.virtual||created<=parent.end)){byId.set(row.ProcessId,row);more=true;}}}
 return [...byId.values()].filter(row=>!row.virtual);
}

export class OwnedProcesses{
 constructor(){this.entries=[];this.recording=null;}
 launch(source,args,options={}){
  const child=spawn(process.execPath,args,{windowsHide:true,detached:process.platform!=='win32',...options});
  const entry={source,child,startedAt:new Date().toISOString(),descendants:[]};this.entries.push(entry);child.once('exit',()=>entry.exitedAt=Date.now());return entry;
 }
 async snapshot(){if(process.platform!=='win32')return[];const {stdout}=await run('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,@{Name="CreationDate";Expression={$_.CreationDate.ToUniversalTime().ToString("o")}} | ConvertTo-Json -Compress'],{windowsHide:true,maxBuffer:4*1024*1024});const parsed=JSON.parse(stdout||'[]');return Array.isArray(parsed)?parsed:[parsed];}
 record(){if(this.recording)return this.recording;this.recording=this.recordNow().finally(()=>this.recording=null);return this.recording;}
 async recordNow(){
  const rows=await this.snapshot();for(const entry of this.entries){
   const root=rows.find(p=>p.ProcessId===entry.child.pid);if(!entry.created&&root&&entry.child.exitCode===null&&entry.child.signalCode===null)entry.created=root.CreationDate;
   const rootIdentity=entry.created?{ProcessId:entry.child.pid,CreationDate:entry.created}:null;
   for(const row of discoverOwnedProcesses(rows,rootIdentity,entry.descendants,entry.exitedAt))if(row.ProcessId!==entry.child.pid&&!entry.descendants.some(p=>p.ProcessId===row.ProcessId&&p.CreationDate===row.CreationDate))entry.descendants.push(row);
  }
 }

 async stop(entry){
  const child=entry.child;
  if(process.platform==='win32'){
   const rows=await this.snapshot();const identities=[...(entry.created?[{ProcessId:child.pid,CreationDate:entry.created}]:[]),...entry.descendants];
   if(!entry.created&&child.exitCode===null&&child.signalCode===null){const current=rows.find(p=>p.ProcessId===child.pid);if(current)identities.push(current);}
   const targets=rows.filter(row=>['node.exe','esbuild.exe','Altego.DevConsole.exe','cmd.exe'].includes(row.Name)&&identities.some(p=>p.ProcessId===row.ProcessId&&p.CreationDate===row.CreationDate));
   const depth=row=>{let n=0,p=row;const seen=new Set();while(p&&!seen.has(p.ProcessId)){seen.add(p.ProcessId);p=targets.find(t=>t.ProcessId===p.ParentProcessId);if(p)n++;}return n;};targets.sort((a,b)=>depth(b)-depth(a));
   for(const target of targets)await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',fileURLToPath(new URL('./stop-development-process.ps1',import.meta.url)),'-TargetPid',String(target.ProcessId),'-ExpectedCreation',target.CreationDate],{windowsHide:true});

  }else{try{process.kill(-child.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}await delay(600);try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
 }
 async verifyStopped(entries){if(process.platform!=='win32')return;const rows=await this.snapshot();for(const entry of entries){const identities=[...(entry.created?[{ProcessId:entry.child.pid,CreationDate:entry.created}]:[]),...entry.descendants];if(rows.some(row=>identities.some(p=>p.ProcessId===row.ProcessId&&p.CreationDate===row.CreationDate)))throw Error('An owned process did not close: '+entry.source);}}
}
