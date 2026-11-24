// ALTEGO necesita resolver el arranque local del servidor de desarrollo Angular.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
const frontend=fileURLToPath(new URL('../../frontend/',import.meta.url));
try{process.loadEnvFile(fileURLToPath(new URL('../../.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}
const port=process.env.WEB_PORT||'4200';if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('Invalid WEB_PORT.');
const child=spawn(process.execPath,[path.join(frontend,'node_modules','@angular','cli','bin','ng.js'),'serve','--host','127.0.0.1','--port',port],{cwd:frontend,env:{...process.env,ALTEGO_API_PORT:process.env.PORT||'3000',PORT:port},stdio:'inherit',windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.on('exit',code=>process.exitCode=code??1);
