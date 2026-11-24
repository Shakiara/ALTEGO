// ALTEGO necesita resolver los bloqueos entre cuentas y sus restricciones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {requireLiveSession} from '../accounts/auth.js';
export const blocksMigration='014_user_blocks';
export const blockError=(status,code,message)=>Object.assign(Error(message),{status,code});
export async function requireBlocksReady(sql){const [rows]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[blocksMigration]);if(!rows.length)throw blockError(503,'BLOCKS_NOT_READY','Blocked users are unavailable. Please try again later.');}


export async function withSocialPair(pool,req,target,run){const sql=pool.getConnection?await pool.getConnection():pool;try{await requireBlocksReady(sql);await sql.beginTransaction();try{
 const ids=[...new Set([req.user.id,target])].sort((a,b)=>a-b);for(const id of ids){const [[user]]=await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);if(!user)throw blockError(404,'USER_NOT_FOUND','User not found.');}
 await requireLiveSession(sql,req);const result=await run(sql);await sql.commit();return result;
}catch(error){await sql.rollback();throw error;}}finally{if(pool.getConnection)sql.release();}}
export async function blockState(sql,viewer,target,{current=false}={}){const [rows]=await sql.execute('SELECT blocker_id FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)'+(current?' FOR SHARE':''),[viewer,target,target,viewer]);return {blocked:rows.some(r=>r.blocker_id===viewer),social_restricted:rows.length>0};}
export async function assertSocialInteractionAllowed(sql,actor,target,options){const state=await blockState(sql,actor,target,options);if(state.social_restricted)throw blockError(403,'SOCIAL_BLOCKED','Social interactions are unavailable between these accounts.');}
