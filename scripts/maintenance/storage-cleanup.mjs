// ALTEGO necesita resolver la retención, cuarentena y recuperación de archivos de Storage.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {storageRoot} from '../../backend/infrastructure/storage/storage-resolver.js';
import {configureStorageIdentity,refreshCreatorInformation} from '../../backend/infrastructure/storage/storage-identity.js';
import fs from 'node:fs/promises';
import mysql from '../../backend/node_modules/mysql2/promise.js';
import config from '../../backend/config.js';
import {diagnoseStorage,trackStorage,cleanupStorage,createStoragePurgePlan,executeStoragePurgePlan,restoreStorageOperation,abandonStorageOperation,recoverStorageUpload,inspectStorageOperations,inspectApprovedCopyDeletion,executeApprovedCopyDeletion} from '../../backend/infrastructure/storage/storage-cleanup.js';
import {migrateStorageCleanup} from '../../backend/infrastructure/schema/compatibility/storage-cleanup-upgrade.js';
import {migrateLegacyRetirement} from '../../backend/infrastructure/schema/compatibility/legacy-retirement-upgrade.js';
import {migrateStorageRetention} from '../../backend/infrastructure/schema/compatibility/storage-retention-upgrade.js';
const modes=['--schema','--diagnose','--track','--execute','--operations','--plan-purge','--purge','--restore','--abandon','--recover-upload','--cycle','--verify-approved-copies','--purge-approved-copies'];
const mode=process.argv[2]||'--diagnose';if(!modes.includes(mode))throw Error('Select an explicit storage maintenance mode.');
const allowed={'--schema':[],'--diagnose':[],'--track':[],'--execute':[],'--operations':[],'--plan-purge':['operations','limit'],'--purge':['plan','confirm'],'--restore':['id','confirm'],'--abandon':['type','id','product-id','reason','confirm'],'--recover-upload':['id','confirm'],'--verify-approved-copies':['proposal','backup'],'--purge-approved-copies':['proposal','backup','recovery-proof','confirm'],'--cycle':['confirm']};
const args=process.argv.slice(3),options={};for(let i=0;i<args.length;i++){const match=args[i].match(/^--([a-z-]+)(?:=(.*))?$/);if(!match||!allowed[mode].includes(match[1])||Object.hasOwn(options,match[1]))throw Error('Unknown or duplicate maintenance option.');const value=match[2]??args[++i];if(value===undefined||value.startsWith('--'))throw Error('Maintenance option requires a value.');options[match[1]]=value;}
const pool=mysql.createPool(config.mysql);
async function readonly(action){const sql=await pool.getConnection();try{await configureStorageIdentity(pool);await sql.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');return await action(sql);}finally{await sql.rollback();sql.release();}}
try{await configureStorageIdentity(pool);
 let result;
 if(mode==='--schema'){
  const sql=await pool.getConnection();try{const [[lock]]=await sql.query("SELECT GET_LOCK('altego_storage_cleanup_schema',10) AS acquired");if(lock.acquired!==1)throw Error('Storage schema is busy.');await migrateStorageCleanup(sql);await migrateLegacyRetirement(sql);result=await migrateStorageRetention(sql);}finally{await sql.query("SELECT RELEASE_LOCK('altego_storage_cleanup_schema')").catch(()=>{});sql.release();}
 }else if(mode==='--diagnose')result=await readonly(diagnoseStorage);
 else if(mode==='--verify-approved-copies'){
  if(!options.proposal||!options.backup)throw Error('Supply --proposal and --backup.');result=await readonly(async sql=>inspectApprovedCopyDeletion(sql,JSON.parse(await fs.readFile(options.proposal,'utf8')),{backup:options.backup}));
 }else if(mode==='--purge-approved-copies'){
  if(!options.proposal||!options.backup||!options['recovery-proof']||!options.confirm)throw Error('Supply the exact proposal, backup, isolated recovery proof and confirmation.');
  result=await executeApprovedCopyDeletion(pool,JSON.parse(await fs.readFile(options.proposal,'utf8')),{backup:options.backup,recoveryProof:JSON.parse(await fs.readFile(options['recovery-proof'],'utf8')),confirmation:options.confirm});
 }else if(mode==='--operations')result=await readonly(inspectStorageOperations);
 else if(mode==='--plan-purge')result=await readonly(sql=>createStoragePurgePlan(sql,{operations:options.operations?.split(','),limit:Number(options.limit||50)}));
 else if(mode==='--purge'){
  if(!options.plan||!options.confirm)throw Error('Supply --plan and --confirm PURGE:<plan confirmation_hash>.');
  result=await executeStoragePurgePlan(pool,JSON.parse(await fs.readFile(options.plan,'utf8')),options.confirm);
 }else if(mode==='--restore')result=await restoreStorageOperation(pool,options.id,options.confirm);
 else if(mode==='--recover-upload')result=await recoverStorageUpload(pool,options.id,options.confirm);
 else if(mode==='--abandon')result=await abandonStorageOperation(pool,{type:options.type,id:options.id,productId:options['product-id']?Number(options['product-id']):null,reason:options.reason,confirmation:options.confirm});
 else if(mode==='--cycle'){
  if(options.confirm!=='TRACK_AND_QUARANTINE')throw Error('Supply --confirm TRACK_AND_QUARANTINE. Periodic maintenance never includes purge.');
  result={tracking:await trackStorage(pool),quarantine:await cleanupStorage(pool)};
 }else result=mode==='--track'?await trackStorage(pool):await cleanupStorage(pool);
 if(['--execute','--purge','--restore','--abandon','--recover-upload','--cycle','--purge-approved-copies'].includes(mode))await refreshCreatorInformation(pool,storageRoot);
 console.log(JSON.stringify(result,null,2));
}finally{await pool.end();}

