// ALTEGO necesita resolver el arranque de Express y las conexiones de datos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {cleanupExpiredTemporary} from './infrastructure/storage/upload-retention.js';
import {resumePermanentDeletions} from './infrastructure/storage/permanent-deletion.js';
import {configureStorageIdentity,refreshCreatorInformation} from './infrastructure/storage/storage-identity.js';
import {reconcileVerificationBatch} from './modules/verification/creator-verification.js';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import config from './config.js';
import { createApp } from './app.js';
import {purgeExpiredNotifications} from './modules/social/social-notifications.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {storageRoot} from './infrastructure/storage/storage-resolver.js';

if (process.env.NODE_ENV === 'production') throw new Error('This academic authentication mode cannot run in production.');
const pool = mysql.createPool(config.mysql);
const client = new MongoClient(config.mongo.uri, { serverSelectionTimeoutMS: 5000 });
try {
  await pool.query('SELECT 1');

  for(const old of ['originals','previews','legacy-quarantine','quarantine','recovery']){let present=false;try{await fs.lstat(path.join(storageRoot,old));present=true;}catch(e){if(e.code!=='ENOENT')throw e;}if(present)throw Object.assign(new Error('Complete Storage layout maintenance before starting HTTP.'),{code:'STORAGE_LAYOUT_PENDING'});}
  const [layoutTable]=await pool.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='storage_layout_operations'");
  if(layoutTable.length){const [[pending]]=await pool.query("SELECT COUNT(*) AS count FROM storage_layout_operations WHERE state<>'completed'");if(pending.count)throw Object.assign(new Error('Resume Storage relocation before starting HTTP.'),{code:'STORAGE_LAYOUT_PENDING'});}
  const [creatorLayoutTable]=await pool.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='creator_storage_operations'");if(creatorLayoutTable.length){const [[incomplete]]=await pool.query("SELECT COUNT(*) count FROM creator_storage_operations WHERE state<>'completed' AND JSON_UNQUOTE(JSON_EXTRACT(descriptor,'$.type'))='layout-migration'");if(incomplete.count)throw Error('Resume creator Storage relocation before starting HTTP.');}
  await configureStorageIdentity(pool);

  await client.connect();
  const database = client.db(config.mongo.database);
  await database.command({ ping: 1 });
  await refreshCreatorInformation(pool,storageRoot,{mongo:database});
  const server = createApp(pool, database).listen(config.port, '127.0.0.1', () => {
    console.log(`API ready: http://localhost:${config.port}/api/products`);
    console.log('MySQL and MongoDB connected. Keep this terminal open.');
  });
  const purge = () => purgeExpiredNotifications(pool).catch(error => console.error('Notification retention:', error.code || error.name));
  const creatorInfoTimer=setInterval(()=>void cleanupExpiredTemporary(pool,{mongo:database}).then(()=>resumePermanentDeletions(pool,{mongo:database})).then(()=>refreshCreatorInformation(pool,storageRoot,{mongo:database})).catch(error=>console.error('Creator information:',error.code||error.name)),60000).unref();
  const retention = setInterval(purge, 60 * 60 * 1000).unref();
  void purge();
  let verificationCursor=0, verifying=false;
  const reconcile=async()=>{
    if(verifying)return;
    verifying=true;
    try{verificationCursor=await reconcileVerificationBatch(pool,verificationCursor);}
    catch(error){console.error('Creator verification:',error.code || error.name);}
    finally{verifying=false;}
  };
  const verificationTimer=setInterval(reconcile,60_000).unref();
  void reconcile();
  server.on('close',()=>{
    clearInterval(retention);clearInterval(creatorInfoTimer);
    clearInterval(verificationTimer);
  });
  server.on('error', async (error) => {
    console.error('Could not start the server:', error.code);
    await Promise.allSettled([pool.end(), client.close()]);
    process.exitCode = 1;
  });
  let closing=false;
  const shutdown=()=>{
    if(closing)return;closing=true;
    server.close(async()=>{await Promise.allSettled([pool.end(),client.close()]);process.exit(0);});
    server.closeIdleConnections();
  };
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,shutdown);

  if(process.env.ALTEGO_CONSOLE_RUN_ID)process.once('disconnect',shutdown);
  process.on('message',message=>{if(process.env.ALTEGO_CONSOLE_RUN_ID&&message?.type==='altego.shutdown'&&message.runId===process.env.ALTEGO_CONSOLE_RUN_ID)shutdown();});
} catch (error) {
  console.error('Could not connect:', error.code || error.name);
  console.error('Check config.js, database services and setup scripts.');
  await Promise.allSettled([pool.end(), client.close()]);
  process.exitCode = 1;
}
