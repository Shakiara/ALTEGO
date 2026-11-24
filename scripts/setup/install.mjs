// ALTEGO necesita resolver la inicialización reproducible de destinos nuevos o semillas intactas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import mysql from '../../backend/node_modules/mysql2/promise.js';
import {MongoClient} from '../../backend/node_modules/mongodb/lib/index.js';
import config from '../../backend/config.js';
import {schemaShape,assertSameSchema,verifyInstallationTriggers} from './schema-verification.mjs';
import {initializeMongo,mongoContract} from './mongo-initializer.mjs';
import {executeInstallationSql} from './sql-runner.mjs';
import {initializeAcademicResources,readSeedAssetsManifest,verifyAcademicResources,removeInstalledSeedAssets} from '../../backend/infrastructure/schema/academic-resources.js';
import {configureStorageIdentity} from '../../backend/infrastructure/storage/storage-identity.js';
import {syncProductIndexesLocked} from '../../backend/modules/products/product-storage.js';

const root=fileURLToPath(new URL('../../',import.meta.url)),mode=process.argv[2];
if(!['--new','--initialize'].includes(mode)||process.argv.length!==3)throw Error('Use --new for unused destinations, or --initialize after executing both canonical database scripts.');
if(!/^[A-Za-z0-9_]{1,64}$/.test(config.mysql.database)||!/^[A-Za-z0-9_-]{1,64}$/.test(config.mongo.database))throw Error('Invalid installation destination.');
const storage=path.resolve(process.env.ALTEGO_STORAGE_ROOT||path.join(root,'storage'));
const expected=JSON.parse(await fs.readFile(new URL('../../backend/infrastructure/schema/expected-schema.json',import.meta.url)));
let sql,mongo;
try{
 try{const stat=await fs.lstat(storage);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Installation requires regular, new Storage.');if((await fs.readdir(storage)).length){let receipt;try{receipt=JSON.parse(await fs.readFile(path.join(storage,'.academic-resources.json'),'utf8'));}catch{}if(receipt?.format===1&&receipt.complete===true)throw Error('This installation is already initialized. Use Verify Installation or start ALTEGO; no databases or resources were changed. For a completely new installation restore seed-assets from the original ZIP or repository and select unused destinations.');throw Error('Installation requires empty Storage. Review partial installations; existing data is never reset.');}}catch(error){if(error.code!=='ENOENT')throw error;}
 const manifest=await readSeedAssetsManifest();
 sql=await mysql.createConnection({...config.mysql,database:undefined,timezone:'Z'});mongo=new MongoClient(config.mongo.uri);
 await mongo.connect();
 const [[exists]]=await sql.execute('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[config.mysql.database]);
 const mongoExists=(await mongo.db().admin().listDatabases()).databases.some(d=>d.name===config.mongo.database);
 try{const stat=await fs.lstat(storage);if(stat.isSymbolicLink()||!stat.isDirectory()||(await fs.readdir(storage)).length)throw Error('Installation requires new, empty Storage.');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(mode==='--new'){
  if(exists||mongoExists)throw Error('Existing database detected. Select unused MySQL and MongoDB destinations; nothing was reset.');

  await executeInstallationSql(sql,await fs.readFile(new URL('../../database/mysql.sql',import.meta.url),'utf8'),config.mysql.database);
  await initializeMongo(mongo.db(config.mongo.database));
 }else{
  if(!exists||!mongoExists)throw Error('Execute mysql.sql and mongodb.js first, or use --new.');
  await sql.query('USE `'+config.mysql.database+'`');
 }

 await sql.changeUser({database:config.mysql.database});
 assertSameSchema(await schemaShape(sql),expected);await verifyInstallationTriggers(sql);
 const [[admin]]=await sql.query('SELECT id,username,email,password,role FROM users');
 const [[count]]=await sql.query('SELECT COUNT(*) n FROM users');
 if(count.n!==1||admin.id!==1||admin.username!=='admin'||admin.email!=='admin@altego.test'||admin.password!=='default'||admin.role!=='admin')throw Error('Initialization refuses an account outside the untouched academic seed.');
 const counts={users:1,user_handles:1,user_profiles:1,account_settings:1,social_policy:1,storage_quota_defaults:4,categorias:3,productos:2,assets:31,product_files:31,asset_file_links:62,variants:29,product_versions:2,version_variants:29,product_storage:2,product_promotions:2,schema_migrations:37};
 for(const table of expected[0]){const [[row]]=await sql.query('SELECT COUNT(*) n FROM `'+table.TABLE_NAME+'`');if(Number(row.n)!==(counts[table.TABLE_NAME]||0))throw Error('Initialization refuses existing application data: '+table.TABLE_NAME);}
 const db=mongo.db(config.mongo.database),contract=await mongoContract();
 const names=(await db.listCollections().toArray()).map(c=>c.name).sort();if(names.join(',')!==contract.collections.map(c=>c.name).sort().join(','))throw Error('Unexpected MongoDB collections.');
 for(const spec of contract.collections){const docs=await db.collection(spec.name).find().sort({_id:1}).toArray();if(JSON.stringify(docs)!==JSON.stringify([...spec.documents].sort((a,b)=>a._id.localeCompare(b._id))))throw Error('Initialization refuses existing MongoDB content.');}
 await configureStorageIdentity(sql);const resources=await initializeAcademicResources(sql,{confirmedNewInstallation:true,manifest});
 await sql.beginTransaction();try{for(const p of manifest.products)await syncProductIndexesLocked(sql,p.id);await sql.commit();}catch(error){await sql.rollback();throw error;}
 const verified=await verifyAcademicResources(sql,manifest);
 await sql.end();sql=null;await mongo.close();mongo=null;
 const cleanup=await removeInstalledSeedAssets(manifest);
 console.log(JSON.stringify({installed:true,tables:expected[0].length,triggers:3,accounts:1,products:2,variants:29,resources,verified,seedAssetsRemoved:cleanup.removed}));
}catch(error){console.error('Installation stopped:',error.code||error.message);console.error('Existing data is never reset. Review destinations and any partial installation before retrying.');process.exitCode=1;}
finally{await sql?.end();await mongo?.close();}
