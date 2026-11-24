// ALTEGO necesita resolver la consulta y revocación de sesiones propias.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {sessionMetadataReady} from './session-metadata.js';import {requireLiveSession} from './auth.js';
const fail=(status,code,message)=>Object.assign(Error(message),{status,code});
export function installActiveSessions(app,pool,requireUser){
 async function transaction(req,run){const sql=pool.getConnection?await pool.getConnection():pool;try{
  if(!await sessionMetadataReady(sql))throw fail(503,'ACTIVE_SESSIONS_NOT_READY','Active sessions are unavailable.');
  await sql.beginTransaction();try{const [[user]]=await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[req.user.id]);if(!user)throw fail(401,'AUTH_REQUIRED','Please log in to continue.');await requireLiveSession(sql,req);const result=await run(sql);await sql.commit();return result;}catch(error){await sql.rollback();throw error;}
 }finally{if(pool.getConnection)sql.release();}}
 const error=(e,res,next)=>{if(e.status&&e.code)return res.status(e.status).json({error:e.message,code:e.code});next(e);};
 app.get('/api/account/sessions',requireUser,async(req,res,next)=>{res.set('Cache-Control','private, no-store');res.vary('Cookie');try{const sessions=await transaction(req,async sql=>{
  const [rows]=await sql.execute("SELECT public_id,device_label,browser_label,device_type,token_hash,DATE_FORMAT(last_active_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS last_active_at FROM sessions WHERE user_id=? AND expires_at>UTC_TIMESTAMP() ORDER BY (token_hash=?) DESC,last_active_at DESC,created_at DESC,public_id ASC",[req.user.id,req.sessionHash]);
  if(!rows.some(r=>r.token_hash===req.sessionHash))throw fail(401,'AUTH_REQUIRED','Your session has expired. Please log in again.');
  if(rows.some(r=>!r.public_id))throw fail(503,'ACTIVE_SESSIONS_NOT_READY','Active sessions are unavailable.');
  return rows.map(r=>({id:r.public_id,device:r.device_label||'Unknown device',browser:r.browser_label||'Unknown browser',device_type:r.device_type,last_active_at:r.last_active_at,current:r.token_hash===req.sessionHash}));
 });res.json({sessions});}catch(e){error(e,res,next);}});
 app.delete('/api/account/sessions/:sessionId',requireUser,async(req,res,next)=>{res.set('Cache-Control','private, no-store');res.vary('Cookie');try{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.sessionId))throw fail(400,'INVALID_SESSION','Invalid session.');
  if(req.body&&Object.keys(req.body).length)throw fail(400,'INVALID_REQUEST','Invalid sign-out request.');
  await transaction(req,async sql=>{const [[row]]=await sql.execute('SELECT token_hash FROM sessions WHERE public_id=? AND user_id=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE',[req.params.sessionId.toLowerCase(),req.user.id]);if(!row)throw fail(404,'SESSION_NOT_FOUND','This session is no longer active.');if(row.token_hash===req.sessionHash)throw fail(409,'CURRENT_SESSION','Use Sign Out Everywhere to close the current session.');await sql.execute('DELETE FROM sessions WHERE public_id=? AND user_id=?',[req.params.sessionId.toLowerCase(),req.user.id]);});res.status(204).end();
 }catch(e){error(e,res,next);}});
}
