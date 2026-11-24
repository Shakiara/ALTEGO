// ALTEGO necesita resolver las cuotas y el uso de Storage por creador.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {productIdFromPath} from './product-layout.js';
import {syncStorageAlerts} from './storage-alerts.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {creatorRoot,creatorStorageEnabled} from './storage-identity.js';
import {storageRoot,safeStoragePath} from './storage-resolver.js';
import {requireUser,requireAdmin,requireLiveSession} from '../../modules/accounts/auth.js';
import {isVerifiedCreator} from '../../modules/verification/verification-status.js';
import {audit} from '../../modules/administration/admin-audit.js';

export const quotaMigration='028_product_storage_quotas';
export const MiB=1024*1024;
const fail=(message,status=409)=>Object.assign(Error(message),{status});
export async function quotaReady(sql){return Boolean((await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[quotaMigration]))[0].length);}
export async function migrateStorageQuotas(sql){
 if(!(await sql.execute("SELECT id FROM schema_migrations WHERE id='027_creator_storage'"))[0].length)throw Error('Apply Storage migration 027 first.');
 await sql.query("CREATE TABLE IF NOT EXISTS storage_quota_defaults(role ENUM('user','moderator','admin') PRIMARY KEY,limit_bytes BIGINT UNSIGNED NULL,revision INT UNSIGNED NOT NULL DEFAULT 1) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
 await sql.query('CREATE TABLE IF NOT EXISTS storage_quota_overrides(user_id INT UNSIGNED PRIMARY KEY,limit_bytes BIGINT UNSIGNED NULL,revision INT UNSIGNED NOT NULL DEFAULT 1,CONSTRAINT fk_storage_quota_user FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
 for(const [role,bytes]of [['user',2048*MiB],['moderator',5120*MiB],['admin',null]])await sql.execute('INSERT IGNORE INTO storage_quota_defaults(role,limit_bytes) VALUES (?,?)',[role,bytes]);
 await sql.execute('INSERT IGNORE INTO schema_migrations(id) VALUES (?)',[quotaMigration]);
}


export async function inventoryCreator(id){
 const base=creatorRoot(id),files=[],seen=new Set();
 async function scan(relative){let entries;try{entries=await fs.readdir(await safeDirectory(relative),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const entry of entries){const rel=path.join(relative,entry.name);if(entry.isSymbolicLink())throw fail('Unsafe Storage link.');if(entry.isDirectory())await scan(rel);else{let file,stat;try{file=await safeStoragePath(rel);stat=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}const key=stat.ino?stat.dev+':'+stat.ino:rel;if(seen.has(key))continue;seen.add(key);files.push({path:rel.replaceAll('\\','/'),bytes:stat.size});}}
 }
 async function safeDirectory(relative){const sentinel=await safeStoragePath(path.join(relative,'.inventory-check'));return path.dirname(sentinel);}
 await scan(base);return files;
}
export async function storageUsage(sql,id){
 const [products]=await sql.execute('SELECT id,status,purged_at FROM productos WHERE owner_id=?',[id]);
 const [operations]=await sql.execute("SELECT id,file_key,descriptor FROM storage_cleanup_operations WHERE state IN ('planned','quarantined','purge_planned')");
 const known=new Map(products.map(p=>[Number(p.id),p])),quarantine=new Map();
 for(const op of operations){const d=typeof op.descriptor==='string'?JSON.parse(op.descriptor):op.descriptor;if(d.product_id&&known.has(Number(d.product_id)))quarantine.set(op.id+'/'+op.file_key,Number(d.product_id));}
 const totals={published:0,drafts_unpublished:0,recoverable:0},files=await inventoryCreator(id);let productFiles=0,profileFiles=0,conversationFiles=0,quarantinedFiles=0;
 for(const file of files){const segments=file.path.split('/');let product=known.get(productIdFromPath(file.path))||null;
  if(segments[1]==='quarantine'){quarantinedFiles++;const productId=quarantine.get(segments.slice(2,4).join('/').replace(/\.bin$/,''));if(productId)product=known.get(productId);}
  if(segments[1]==='uploads'&&segments[2]==='profile')profileFiles++;
  if(segments[1]==='uploads'&&segments[2]==='conversation')conversationFiles++;
  if(segments[1]==='products'||segments[1]==='quarantine'||product){productFiles++;const bucket=segments[1]==='quarantine'||!product||product.purged_at||product.status==='Trash'?'recoverable':product.status==='Published'?'published':'drafts_unpublished';totals[bucket]+=file.bytes;}
 }
 return {used_bytes:Object.values(totals).reduce((a,b)=>a+b,0),breakdown:totals,inventory:{product_files:productFiles,profile_files:profileFiles,conversation_files:conversationFiles,quarantined_files:quarantinedFiles}};
}
export async function storagePolicy(sql,id){
 const [[user]]=await sql.execute('SELECT role FROM users WHERE id=?',[id]);if(!user)throw fail('Account not found.',404);
 const [[override]]=await sql.execute('SELECT limit_bytes FROM storage_quota_overrides WHERE user_id=?',[id]);
 let category=user.role;if(category==='user'&&await isVerifiedCreator(sql,id)){const [[configured]]=await sql.execute("SELECT role FROM storage_quota_defaults WHERE role='verified'");if(configured)category='verified';}
 const [[role]]=await sql.execute('SELECT limit_bytes FROM storage_quota_defaults WHERE role=?',[category]);if(!role)throw fail('Storage policy is unavailable.');
 const value=override||role;return {plan:override?'Individual':category==='verified'?'Verified Creator':category==='moderator'?'Moderator':category==='admin'?'Admin':'Users',limit_bytes:!override&&category==='admin'?null:value.limit_bytes===null?null:Number(value.limit_bytes),individual:Boolean(override),category,default_limit_bytes:category==='admin'?null:role.limit_bytes===null?null:Number(role.limit_bytes)};
}
export async function productStorageSummary(sql,id){const policy=await storagePolicy(sql,id),usage=await storageUsage(sql,id);return {...policy,...usage,available_bytes:policy.limit_bytes===null?null:Math.max(0,policy.limit_bytes-usage.used_bytes),usage_percentage:policy.limit_bytes===null?null:policy.limit_bytes===0?(usage.used_bytes?100:0):Math.round(usage.used_bytes/policy.limit_bytes*10000)/100};}

export async function withStorageWrite(sql,owner,additional,action){
 if(!creatorStorageEnabled()||!await quotaReady(sql))return action();
 const name='altego_product_quota_'+owner,[[lock]]=await sql.execute('SELECT GET_LOCK(?,0) acquired',[name]);
 if(Number(lock.acquired)!==1)throw fail('Another Storage operation is in progress. Please try again.');
 try{await sql.execute("SELECT role FROM storage_quota_defaults WHERE role=(SELECT role FROM users WHERE id=?) OR role='verified' FOR SHARE",[owner]);const summary=await productStorageSummary(sql,owner);if(additional>0&&summary.limit_bytes!==null&&summary.used_bytes+additional>summary.limit_bytes)throw fail('Product Storage limit reached. Available: '+Math.max(0,summary.limit_bytes-summary.used_bytes)+' bytes; required: '+additional+' bytes.',413);
  const disk=await fs.statfs(storageRoot);if(additional>0&&Number(disk.bavail)*Number(disk.bsize)<additional+16*MiB)throw fail('Not enough disk space for this upload.',507);
  return await action();
 }finally{await sql.execute('SELECT RELEASE_LOCK(?)',[name]);}
}

export function installStorageQuotas(app,pool){
 app.get('/api/studio/storage',requireUser,async(req,res)=>{res.set('Cache-Control','private, no-store');if(!await quotaReady(pool))return res.status(503).json({error:'Product Storage is not available yet.'});const summary=await productStorageSummary(pool,req.user.id);await syncStorageAlerts(pool,req.user.id);res.json(summary);});
 app.get('/api/admin/storage-quotas',requireUser,requireAdmin,async(req,res)=>{res.set('Cache-Control','private, no-store');const [defaults]=await pool.query('SELECT * FROM storage_quota_defaults ORDER BY role');const [rows]=await pool.query('SELECT u.id,u.username,u.role,p.display_name,q.limit_bytes,q.revision FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN storage_quota_overrides q ON q.user_id=u.id ORDER BY u.id');const accounts=[];for(const row of rows){const summary=await productStorageSummary(pool,row.id);accounts.push({...row,verified_creator:await isVerifiedCreator(pool,row.id),summary});}res.json({defaults,accounts});});
 app.put('/api/admin/storage-quotas/:scope/:target',requireUser,requireAdmin,async(req,res)=>{
  const {scope,target}=req.params,{limit_bytes:bytes,revision,inherit}=req.body||{};
  if(!['role','account'].includes(scope)||scope==='role'&&!['user','verified','moderator','admin'].includes(target)||scope==='account'&&!/^[1-9]\d*$/.test(target)||bytes!==null&&(!Number.isSafeInteger(bytes)||bytes<=0)||!Number.isSafeInteger(revision)||revision<0||inherit!==undefined&&typeof inherit!=='boolean')throw fail('Enter a valid Storage limit.',400);
  if(scope==='role'&&target==='admin'&&bytes!==null)throw fail('Admin defaults to Unlimited. Use an individual exception for a specific account.',400);
  const sql=await pool.getConnection();let locked=false;const name=scope==='account'?'altego_product_quota_'+target:'altego_storage_quota_settings';
  try{const [[lock]]=await sql.execute('SELECT GET_LOCK(?,0) acquired',[name]);if(Number(lock.acquired)!==1)throw fail('Storage settings are busy.');locked=true;await sql.beginTransaction();await requireLiveSession(sql,req);const [[actor]]=await sql.execute('SELECT role FROM users WHERE id=? FOR UPDATE',[req.user.id]);if(actor?.role!=='admin')throw fail('Administrator access is required.',403);
   const before=scope==='account'?await productStorageSummary(sql,Number(target)):null;const table=scope==='role'?'storage_quota_defaults':'storage_quota_overrides',column=scope==='role'?'role':'user_id';
   const [[old]]=await sql.execute('SELECT * FROM '+table+' WHERE '+column+'=? FOR UPDATE',[target]);if((old?.revision||0)!==revision)throw fail('Storage settings changed. Reload and try again.');
   if(scope==='account'){const [[user]]=await sql.execute('SELECT id FROM users WHERE id=?',[target]);if(!user)throw fail('Account not found.',404);}
   if(scope==='account'&&inherit)await sql.execute('DELETE FROM storage_quota_overrides WHERE user_id=?',[target]);else if(old)await sql.execute('UPDATE '+table+' SET limit_bytes=?,revision=revision+1 WHERE '+column+'=?',[bytes,target]);else await sql.execute('INSERT INTO '+table+'('+column+',limit_bytes) VALUES (?,?)',[target,bytes]);
   const after=scope==='account'?await productStorageSummary(sql,Number(target)):null;await audit(sql,{actor:req.user.id,category:'security',action:'storage_quota_updated',type:scope==='role'?'storage_role':'storage_account',id:target,changes:{operation:inherit?'reset':bytes===null?'unlimited':'change',previous_effective:before?.limit_bytes??null,new_effective:after?.limit_bytes??bytes,previous_exception:old?{limit_bytes:old.limit_bytes}:null,new_exception:scope==='account'&&!inherit?{limit_bytes:bytes}:null}});await sql.commit();try{if(scope==='account')await syncStorageAlerts(pool,Number(target));else{const [affected]=await pool.query('SELECT id FROM users ORDER BY id');for(const user of affected)await syncStorageAlerts(pool,user.id);}}catch(error){console.error('Storage warning refresh:',error.code||error.name);}res.json({saved:true});
  }catch(e){await sql.rollback();throw e;}finally{if(locked)await sql.execute('SELECT RELEASE_LOCK(?)',[name]);sql.release();}
 });
}
