// ALTEGO necesita resolver la información derivada del Storage de cada creador.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {syncStorageAlerts} from './storage-alerts.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {productStorageSummary,quotaReady} from './storage-quotas.js';
import {creatorRoot,rememberCreator,creatorStorageEnabled} from './storage-identity.js';
import {safeStoragePath} from './storage-resolver.js';
import {isVerifiedCreator} from '../../modules/verification/verification-status.js';

let pending=Promise.resolve();
const clean=value=>String(value??'').replaceAll('\r','').replaceAll('\n',' / ');
const bytes=value=>value===null?'Unlimited':value+' bytes ('+(value/1048576).toFixed(2)+' MB)';

export function refreshInformation(sql,root,{owners=null,mongo=null}={}){
 const job=pending.catch(()=>{}).then(()=>generate(sql,root,owners,mongo));pending=job;return job;
}
async function generate(sql,root,owners,mongo){
 if(!creatorStorageEnabled())return;
 const ids=owners?[...new Set(owners.filter(id=>Number.isSafeInteger(id)&&id>0))]:null;if(ids&&!ids.length)return;
 const [users]=await sql.query("SELECT u.*,p.display_name,p.bio,DATE_FORMAT(u.created_at,'%Y-%m-%dT%H:%i:%sZ') created FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id"+(ids?' WHERE u.id IN (?)':''),ids?[ids]:[]);
 for(const user of users){rememberCreator(user.id,user.username);const folder=path.join(root,creatorRoot(user.id));let stat;try{stat=await fs.lstat(folder);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Unsafe creator directory.');
  await safeStoragePath(path.join(creatorRoot(user.id),'.creator-info-check'));
  const [[sanction]]=await sql.execute("SELECT COUNT(*) count FROM account_sanctions WHERE user_id=? AND kind='suspension' AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(6))",[user.id]);
  const [[products]]=await sql.execute("SELECT COUNT(*) total,COALESCE(SUM(status='Published' AND purged_at IS NULL),0) published,COALESCE(SUM(status='Draft' AND purged_at IS NULL),0) drafts,COALESCE(SUM(status='Unlisted' AND purged_at IS NULL),0) unlisted,COALESCE(SUM(status='Trash' AND purged_at IS NULL),0) recoverable FROM productos WHERE owner_id=?",[user.id]);
  const [[variants]]=await sql.execute('SELECT COUNT(*) count FROM variants v JOIN productos p ON p.id=v.product_id WHERE p.owner_id=?',[user.id]);
  const [[social]]=await sql.execute('SELECT (SELECT COUNT(*) FROM creator_follows WHERE creator_id=?) followers,(SELECT COUNT(*) FROM creator_follows WHERE follower_id=?) following',[user.id,user.id]);
  const [[activity]]=await sql.execute("SELECT (SELECT COUNT(*) FROM conversation_posts WHERE author_id=?) posts,(SELECT COUNT(*) FROM conversation_comments WHERE author_id=?) comments,(SELECT COUNT(*) FROM conversation_post_reactions r JOIN conversation_posts p ON p.id=r.target_id WHERE p.author_id=? AND r.reaction='like')+(SELECT COUNT(*) FROM conversation_comment_reactions r JOIN conversation_comments c ON c.id=r.target_id WHERE c.author_id=? AND r.reaction='like') likes",[user.id,user.id,user.id,user.id]);
  let reviews='N/A';if(mongo){const [items]=await sql.execute('SELECT id FROM productos WHERE owner_id=?',[user.id]);reviews=await mongo.collection('resenas').countDocuments({producto_id:{$in:items.map(p=>p.id)}});}
  let storage=null;if(await quotaReady(sql)){storage=await productStorageSummary(sql,user.id);await syncStorageAlerts(sql,user.id);}
  const inventory=storage?.inventory||null;
  const content='# Creator Information\n\n## Account\n'+[
   ['User ID',user.id],['Username',user.username],['Display Name',clean(user.display_name||user.username)],['Account Created At',user.created],['Account Status',sanction.count?'Suspended':'Active'],['Suspended',sanction.count?'Yes':'No'],['Role',user.role],['Verified Creator',await isVerifiedCreator(sql,user.id)?'Yes':'No']].map(([k,v])=>'- '+k+': '+v+'\n').join('')+
   '\n## Profile\n- Bio: '+(clean(user.bio)||'Not set')+'\n- Profile Visibility: N/A (no profile visibility setting)\n- Followers: '+social.followers+'\n- Following: '+social.following+'\n'+
   '\n## Products\n- Total Products: '+products.total+'\n- Published: '+products.published+'\n- Drafts: '+products.drafts+'\n- Unpublished: N/A (not a separate product state)\n- Unlisted: '+products.unlisted+'\n- Deleted (Recoverable): '+products.recoverable+'\n- Total Product Variants: '+variants.count+' (active and inactive)\n'+
   '\n## Creator Activity\n- Total Reviews Received: '+reviews+'\n- Total Products Sold: N/A (not recorded)\n- Total Downloads: N/A (not recorded)\n'+
   '\n## Conversations\n- Total Posts: '+activity.posts+'\n- Total Comments: '+activity.comments+' (including replies)\n- Total Likes Received: '+activity.likes+'\n'+
   '\n## Product Storage\n- Storage Plan: '+(storage?.plan||'N/A')+'\n- Storage Limit: '+(storage?bytes(storage.limit_bytes):'N/A')+'\n- Storage Used: '+(storage?bytes(storage.used_bytes):'N/A')+'\n- Storage Available: '+(storage?bytes(storage.available_bytes):'N/A')+'\n- Storage Usage Percentage: '+(storage?.usage_percentage===null||!storage?'N/A':storage.usage_percentage+'%')+'\n- Published Products Size: '+(storage?bytes(storage.breakdown.published):'N/A')+'\n- Drafts and Unpublished Size: '+(storage?bytes(storage.breakdown.drafts_unpublished):'N/A')+'\n- Recoverable Products Size: '+(storage?bytes(storage.breakdown.recoverable):'N/A')+'\n'+
   '\n## File Inventory\n- Total Product Files: '+(inventory?.product_files??'N/A')+'\n- Total Profile Files: '+(inventory?.profile_files??'N/A')+'\n- Total Conversation Files: '+(inventory?.conversation_files??'N/A')+'\n- Quarantined Files: '+(inventory?.quarantined_files??'N/A')+'\n';
  const file=await safeStoragePath(path.join(creatorRoot(user.id),'creator-info.md'));let before='';try{before=await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(before.split('\n## Metadata\n')[0]===content)return;
  const stage=file+'.'+randomUUID()+'.pending';try{await fs.writeFile(stage,content+'\n## Metadata\n- Last Updated At: '+new Date().toISOString()+'\n',{flag:'wx'});await fs.rename(stage,file);}finally{await fs.unlink(stage).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 }
}
