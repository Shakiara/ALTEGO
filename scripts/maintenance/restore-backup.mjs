// ALTEGO necesita resolver la restauración de respaldos exclusivamente en bases nuevas aisladas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import mysql from '../../backend/node_modules/mysql2/promise.js';
import {MongoClient,BSON} from '../../backend/node_modules/mongodb/lib/index.js';
import config from '../../backend/config.js';
import {assertSameSchema,schemaShape} from '../setup/schema-verification.mjs';

const identifier=value=>{
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw Error('Invalid backup identifier.');
  return '`'+value+'`';
};


export async function restoreBackup(backup,target){
  if (!/^altego_auth_test_[a-z0-9_]+$/.test(target) || [config.mysql.database,config.mongo.database].includes(target)) {
    throw Error('Use a new altego_auth_test_* database name.');
  }
  const root=await fs.realpath(backup);
  const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json')));
  const files=manifest.files ?? {};
  if (!files['mysql.json'] || (!files['mongodb.ejson'] && (!manifest.mysql || !files['schema.json']))) {
    throw Error('Incomplete backup manifest.');
  }
  for(const [name,hash] of Object.entries(files)){
    const full=await fs.realpath(path.resolve(root,name));
    if (!full.startsWith(root+path.sep)) throw Error('Invalid backup path.');
    if (createHash('sha256').update(await fs.readFile(full)).digest('hex')!==hash) throw Error('Backup checksum mismatch.');
  }
  const session=files['mysql-session.json'] ? JSON.parse(await fs.readFile(path.join(root,'mysql-session.json'),'utf8')) : null;
  if (session && (session.time_zone!=='+00:00' || !session.date_strings)) throw Error('Unsupported backup session metadata.');
  const sql=await mysql.createConnection({...config.mysql,database:undefined,
    ...(session?{timezone:'Z',supportBigNumbers:true,bigNumberStrings:true}:{})});
  const client=files['mongodb.ejson'] ? new MongoClient(config.mongo.uri) : null;
  try{
    if (client){
      await client.connect();
      const existing=await client.db().admin().listDatabases();
      if (existing.databases.some(db=>db.name===target)) throw Error('MongoDB target already exists.');
    }
    if (session) await sql.query("SET time_zone='+00:00'");
    const collation=manifest.mysql?.collation ?? 'utf8mb4_unicode_ci';
    await sql.query('CREATE DATABASE '+identifier(target)+' CHARACTER SET utf8mb4 COLLATE '+identifier(collation));
    await sql.query('USE '+identifier(target));
    await sql.query('SET FOREIGN_KEY_CHECKS=0');
    const tables=JSON.parse(await fs.readFile(path.join(root,'mysql.json'),'utf8'),(_,value)=>
      value?.type==='Buffer' && Array.isArray(value.data)?Buffer.from(value.data):value);
    for (const table of tables) await sql.query(table.create);
    for (const table of tables){
      const [columns]=await sql.query('SHOW COLUMNS FROM '+identifier(table.name));
      const generated=new Set(columns.filter(column=>/(VIRTUAL|STORED) GENERATED/.test(column.Extra)).map(column=>column.Field));
      const temporal=new Set(columns.filter(column=>/^(date|datetime|timestamp)(?:\b|\()/i.test(column.Type)).map(column=>column.Field));
      for (const row of table.rows){
        const keys=Object.keys(row).filter(key=>!generated.has(key));
        const values=keys.map(key=>temporal.has(key)&&typeof row[key]==='string'&&/^\d{4}-\d\d-\d\dT/.test(row[key])?new Date(row[key]):row[key]);
        await sql.execute('INSERT INTO '+identifier(table.name)+' ('+keys.map(identifier).join(',')+
          ') VALUES ('+keys.map(()=>'?').join(',')+')',values);
      }
      const [[count]]=await sql.query('SELECT COUNT(*) AS total FROM '+identifier(table.name));
      if (Number(count.total)!==table.rows.length) throw Error('Restored row count differs for '+table.name);
    }
    if(files['mysql-triggers.json'])for(const t of JSON.parse(await fs.readFile(path.join(root,'mysql-triggers.json'),'utf8'))){if(!['BEFORE','AFTER'].includes(t.timing)||!['INSERT','UPDATE','DELETE'].includes(t.event))throw Error('Invalid trigger metadata.');await sql.query('CREATE TRIGGER '+identifier(t.name)+' '+t.timing+' '+t.event+' ON '+identifier(t.table)+' FOR EACH ROW '+t.statement);}
    await sql.query('SET FOREIGN_KEY_CHECKS=1');
    if (files['schema.json']) assertSameSchema(await schemaShape(sql),JSON.parse(await fs.readFile(path.join(root,'schema.json'),'utf8')));
    if (client){
      for(const item of BSON.EJSON.parse(await fs.readFile(path.join(root,'mongodb.ejson'),'utf8'))){
        const collection=await client.db(target).createCollection(item.name,item.options);
        if (item.documents.length) await collection.insertMany(item.documents);
        for (const index of item.indexes){
          if (index.name==='_id_') continue;
          const {v,ns,key,...options}=index;
          await collection.createIndex(key,options);
        }
      }
    }
    console.log('Backup restored into isolated test database: '+target);
  }finally{
    await sql.end();
    if (client) await client.close();
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await restoreBackup(process.argv[2],process.argv[3]);
