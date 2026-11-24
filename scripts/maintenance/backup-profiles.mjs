// ALTEGO necesita resolver los respaldos coherentes de perfiles y recursos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const load=p=>import(pathToFileURL(path.join(root,p)).href);
const {default:mysql}=await load('backend/node_modules/mysql2/promise.js');
const {MongoClient,BSON}=await load('backend/node_modules/mongodb/lib/index.js');
const {default:config}=await load('backend/config.js');
const backupRoot=path.resolve(process.env.ALTEGO_BACKUP_ROOT||path.join(root,'..','altego-backups'));
const storage=(await load('backend/infrastructure/storage/storage-resolver.js')).storageRoot;
if(backupRoot===path.resolve(root)||backupRoot.startsWith(path.resolve(root)+path.sep)||backupRoot===path.resolve(storage)||backupRoot.startsWith(path.resolve(storage)+path.sep))throw Error('Store backups outside the repository and Storage.');
const dest=path.join(backupRoot,'phase6b-'+new Date().toISOString().replaceAll(':','-'));

const sql=await mysql.createConnection({...config.mysql,dateStrings:true,timezone:'Z'}),mongo=new MongoClient(config.mongo.uri);
try{
 await mongo.connect();await sql.query("SET time_zone='+00:00'");await sql.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
 await fs.mkdir(dest,{recursive:true});const tables=[];
 const [names]=await sql.query('SHOW TABLES');
 for(const record of names){const name=Object.values(record)[0];const [definition]=await sql.query('SHOW CREATE TABLE `'+name+'`');const [rows]=await sql.query('SELECT * FROM `'+name+'`');tables.push({name,create:definition[0]['Create Table'],rows});}
 await sql.rollback();
 await fs.writeFile(path.join(dest,'mysql.json'),JSON.stringify(tables));
 const [triggers]=await sql.query('SHOW TRIGGERS');await fs.writeFile(path.join(dest,'mysql-triggers.json'),JSON.stringify(triggers.map(t=>({name:t.Trigger,timing:t.Timing,event:t.Event,table:t.Table,statement:t.Statement}))));
 await fs.writeFile(path.join(dest,'mysql-session.json'),JSON.stringify({time_zone:'+00:00',date_strings:true}));
 const database=mongo.db(config.mongo.database),collections=[];
 for(const c of await database.listCollections().toArray())collections.push({name:c.name,options:c.options,documents:await database.collection(c.name).find().toArray(),indexes:await database.collection(c.name).indexes()});
 await fs.writeFile(path.join(dest,'mongodb.ejson'),BSON.EJSON.stringify(collections));
 for(const name of ['backend','frontend','scripts','database','storage','docs'])await fs.cp(name==='storage'?storage:path.join(root,name),path.join(dest,'source',name),{recursive:true,filter:p=>!['node_modules','dist','.angular'].some(n=>p.split(path.sep).includes(n))});
 for(const name of ['package.json','package-lock.json','.env.example','README.md'])await fs.copyFile(path.join(root,name),path.join(dest,'source',name));
 const files={};async function scan(folder){for(const e of await fs.readdir(folder,{withFileTypes:true})){const p=path.join(folder,e.name);if(e.isDirectory())await scan(p);else files[path.relative(dest,p).split(path.sep).join('/')]=createHash('sha256').update(await fs.readFile(p)).digest('hex');}}await scan(dest);
 await fs.writeFile(path.join(dest,'manifest.json'),JSON.stringify({created_at:new Date().toISOString(),files,counts:Object.fromEntries(tables.map(t=>[t.name,t.rows.length]))},null,2));

 for(const [name,hash]of Object.entries(files))if(createHash('sha256').update(await fs.readFile(path.join(dest,name))).digest('hex')!==hash)throw Error('Backup verification failed');
 console.log(JSON.stringify({backup:dest,tables:tables.length,collections:collections.length,verifiedFiles:Object.keys(files).length}));

}finally{await sql.end();await mongo.close();}



