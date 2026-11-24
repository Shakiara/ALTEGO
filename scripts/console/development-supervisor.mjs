// ALTEGO necesita resolver la supervisión de Express, Angular y sus conexiones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import path from 'node:path';
import net from 'node:net';
import {ConsoleModel,terminalLine} from './development-console-model.mjs';
import {OwnedProcesses} from './development-processes.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function validAction(value){return value&&Object.keys(value).every(k=>['type','action'].includes(k))&&value.type==='control'&&['start','stop','restart','shutdown'].includes(value.action);}
export async function assertFreePort(port){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error(`Port ${port} is already in use. Existing processes were not changed.`)));server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
export class DevelopmentSupervisor{
 constructor(root,config,ports,runId,notify=()=>{}){
  this.color=!!process.stdout.isTTY&&!('NO_COLOR' in process.env)&&process.env.TERM!=='dumb';this.root=root;this.config=config;this.ports=ports;this.runId=runId;this.notify=notify;this.owner=new OwnedProcesses();this.model=new ConsoleModel([config.mysql.password,runId]);this.phase='Offline';this.operation=null;this.closing=false;this.generation=0;this.probing=false;this.lastId=0;
  this.services=Object.fromEntries(['API','Frontend','MySQL','MongoDB'].map(name=>[name,{status:name==='MySQL'||name==='MongoDB'?'Starting':'Offline',pid:null,startedAt:null,detail:''}]));
 }
 async connect(){const {default:mysql}=await import('../../backend/node_modules/mysql2/promise.js'),{MongoClient}=await import('../../backend/node_modules/mongodb/lib/index.js');this.sql=mysql.createPool({...this.config.mysql,connectionLimit:1,connectTimeout:2000});this.mongo=new MongoClient(this.config.mongo.uri,{serverSelectionTimeoutMS:2000});this.probeTimer=setInterval(()=>void this.probe(),4000);this.treeTimer=setInterval(()=>void this.owner.record().catch(e=>this.log('Console','Process tracking: '+e.code,'Warning')),10000);this.treeTimer.unref();await this.probe();}
 log(source,message,level){const entry=this.model.add(source,message,level);if(!entry)return;process.stdout.write(terminalLine(entry,message,this.model.secrets,this.color));this.notify();}
 state(name,status,detail=''){const service=this.services[name];if(service.status===status&&service.detail===detail)return;service.status=status;service.detail=detail;this.log(['MySQL','MongoDB'].includes(name)?'Databases':name,`${name}: ${status}${detail?' · '+detail:''}`,status==='Error'?'Error':status==='Online'?'Success':'Info');}
 snapshot(after=0){return{type:'snapshot',phase:this.phase,busy:!!this.operation||this.closing,services:this.services,ports:this.ports,compilation:this.model.compilation,watch:this.model.watch,lastBuild:this.model.lastBuild??null,critical:this.model.critical,logs:this.model.logs.filter(entry=>entry.id>after),lastId:this.model.sequence};}
 launch(source,args,cwd,ipc=false){
  const env={...process.env,...this.environment,FORCE_COLOR:this.color?'1':'0',ALTEGO_CONSOLE_RUN_ID:this.runId,ALTEGO_DEVELOPMENT_LAN:'1',ALTEGO_WEB_PORT:String(this.ports.web),ALTEGO_API_PORT:String(this.ports.api),PORT:String(source==='Frontend'?this.ports.web:this.ports.api)};
  if(this.color)delete env.NO_COLOR;else env.NO_COLOR='1';
  const entry=this.owner.launch(source,args,{cwd,env,stdio:['ignore','pipe','pipe',...(ipc?['ipc']:[])]});const service=this.services[source];service.pid=entry.child.pid;service.startedAt=entry.startedAt;service.detail='';this.log('Console',source+' managed PID '+entry.child.pid);this.state(source,'Starting');const generation=this.generation;
  for(const stream of [entry.child.stdout,entry.child.stderr]){let pending='';stream.setEncoding('utf8');stream.on('data',chunk=>{pending+=chunk;const lines=pending.split(/[\r\n]+/);pending=lines.pop();for(const line of lines)this.log(source,line);if(pending.length>65536){this.log(source,pending);pending='';}});stream.on('end',()=>{if(pending)this.log(source,pending);});}
  entry.child.once('error',error=>{this.log(source,error.message,'Error');this.state(source,'Error',error.code||'Process failed');});
  entry.child.once('exit',(code,signal)=>{if(generation!==this.generation||this.phase==='Stopping'||this.closing)return;this.state(source,'Error',`Process exited (${code??signal})`);this.log(source,`Unexpected exit (${code??signal}). Stopping the managed companion.`,'Error');void this.afterUnexpectedExit();});return entry;
 }
 async afterUnexpectedExit(){if(this.operation)await this.operation.catch(()=>{});if(!this.closing&&this.phase!=='Offline')await this.action('stop');}
 action(action){if(this.closing)return Promise.resolve(false);if(this.operation){this.log('Console','Another server operation is in progress.','Warning');return Promise.resolve(false);}const job=(async()=>{if(action==='stop')await this.stop();else if(action==='start')await this.start();else if(action==='restart'){await this.stop();await this.start();}return true;})();this.operation=job;this.notify();return job.catch(error=>{this.log('Console',error.message,'Error');return false;}).finally(()=>{this.operation=null;this.notify();});}
 async start(){
  if(this.phase==='Running'||this.closing)return;this.phase='Starting';this.generation++;this.model.compilation='Waiting';this.model.watch=false;this.model.lastBuild=null;this.notify();
  try{await assertFreePort(this.ports.api);await assertFreePort(this.ports.web);if(this.closing)return;
   this.launch('API',['server.js'],path.join(this.root,'backend'),true);
   this.launch('Frontend',[path.join(this.root,'frontend/node_modules/@angular/cli/bin/ng.js'),'serve','--host','0.0.0.0','--port',String(this.ports.web)],path.join(this.root,'frontend'));
   this.phase='Running';await this.owner.record();await this.probe();
  }catch(error){this.phase='Offline';this.log('Console',error.message,'Error');this.notify();}
 }
 async stop(){
  this.phase='Stopping';this.notify();const entries=this.owner.entries.filter(entry=>['API','Frontend'].includes(entry.source));for(const name of ['API','Frontend'])if(this.services[name].pid)this.state(name,'Stopping');
  await this.owner.record();for(const entry of entries.filter(e=>e.source==='Frontend'))await this.owner.stop(entry);
  for(const entry of entries.filter(e=>e.source==='API'))if(entry.child.connected){entry.child.send({type:'altego.shutdown',runId:this.runId});await Promise.race([new Promise(r=>entry.child.once('exit',r)),delay(4000)]);}
  for(const entry of entries)await this.owner.stop(entry);await this.owner.verifyStopped(entries);
  this.owner.entries=this.owner.entries.filter(entry=>!entries.includes(entry));this.phase='Offline';this.model.watch=false;for(const name of ['API','Frontend']){this.services[name].pid=null;this.services[name].startedAt=null;this.state(name,'Offline');}this.notify();
 }
 async probe(){if(this.probing||this.closing)return;this.probing=true;const generation=this.generation;try{const checks=['API','Frontend'].map(async name=>{if(!this.services[name].pid||this.phase==='Stopping')return;let ok=false;try{const response=await fetch(`http://127.0.0.1:${name==='API'?this.ports.api:this.ports.web}${name==='API'?'/api/health':'/'}`,{signal:AbortSignal.timeout(1800)});ok=response.ok;}catch{}if(generation!==this.generation||this.phase==='Stopping'||!this.services[name].pid)return;this.state(name,ok?'Online':this.services[name].status==='Starting'?'Starting':'Error',ok?'':this.services[name].status==='Starting'?'Waiting for HTTP readiness':'HTTP health check failed');});
  if(this.sql&&this.mongo)checks.push(this.sql.query({sql:'SELECT 1',timeout:1800}).then(()=>this.state('MySQL','Online'),error=>this.state('MySQL','Error',error.code||error.name)),this.mongo.db(this.config.mongo.database).command({ping:1},{timeoutMS:1800}).then(()=>this.state('MongoDB','Online'),error=>this.state('MongoDB','Error',error.name)));await Promise.all(checks);
 }finally{this.probing=false;this.notify();}}
 async close(){this.closing=true;clearInterval(this.probeTimer);clearInterval(this.treeTimer);if(this.operation)await this.operation.catch(()=>{});try{await this.stop();}finally{await Promise.allSettled([this.sql?.end(),this.mongo?.close()]);}}
}
