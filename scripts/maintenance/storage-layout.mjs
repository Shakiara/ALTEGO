// ALTEGO necesita resolver los traslados verificados entre distribuciones de Storage.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import mysql from '../../backend/node_modules/mysql2/promise.js';
import config from '../../backend/config.js';
import {inspectStorageLayout,reorganizeStorage} from '../../backend/infrastructure/storage/storage-layout.js';
const mode=process.argv[2]||'--diagnose',args=process.argv.slice(3),opts={};
for(let i=0;i<args.length;i+=2){if(!['--backup','--confirm'].includes(args[i])||!args[i+1]||Object.hasOwn(opts,args[i]))throw Error('Invalid relocation option.');opts[args[i]]=args[i+1];}
if(!['--diagnose','--execute'].includes(mode)||mode==='--diagnose'&&args.length)throw Error('Select diagnose or execute.');
if(mode==='--diagnose')console.log(JSON.stringify(await inspectStorageLayout(),null,2));
else{const pool=mysql.createPool(config.mysql);try{console.log(JSON.stringify(await reorganizeStorage(pool,{backup:opts['--backup'],confirmation:opts['--confirm']}),null,2));}finally{await pool.end();}}
