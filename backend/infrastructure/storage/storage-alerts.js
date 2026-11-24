// ALTEGO necesita resolver los avisos relacionados con el uso de Storage.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {randomUUID} from 'node:crypto';

export async function syncStorageAlerts(pool,userId,summary=null){
 if(!(await pool.execute("SELECT id FROM schema_migrations WHERE id='030_storage_policy_lifecycle'"))[0].length)return;
 const sql=pool.getConnection?await pool.getConnection():pool,owned=!!pool.getConnection;
 try{if(owned)await sql.beginTransaction();await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
  if(!summary){const {productStorageSummary}=await import('./storage-quotas.js');summary=await productStorageSummary(sql,userId);}
  for(const threshold of [80,100]){const key='storage:'+userId+':'+threshold,active=summary.limit_bytes!==null&&summary.used_bytes*100>=summary.limit_bytes*threshold;
   if(!active){await sql.execute("DELETE FROM social_notifications WHERE recipient_id=? AND category='storage' AND event_key=?",[userId,key]);continue;}
   await sql.execute("INSERT INTO social_notifications(recipient_id,event_key,group_id,context_key,category,title,description,destination,created_at,group_started_at,expires_at) VALUES (?,?,?,?,'storage',?,?, '/studio/storage',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),'9999-12-31 23:59:59') ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description)",[userId,key,randomUUID(),key,threshold===100?'Storage limit reached':'Storage is almost full',threshold===100?'Your product storage has reached its limit.':'Your product storage has reached 80% of its limit.']);
  }if(owned)await sql.commit();
 }catch(e){if(owned)await sql.rollback();throw e;}finally{if(owned)sql.release();}
}
export async function reconcileStorageAlerts(pool){if(!(await pool.execute("SELECT id FROM schema_migrations WHERE id='030_storage_policy_lifecycle'"))[0].length)return;const [users]=await pool.query('SELECT id FROM users ORDER BY id');for(const user of users)await syncStorageAlerts(pool,user.id);}
