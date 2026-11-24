// ALTEGO necesita resolver la contraseña y el cierre de sesiones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {randomUUID} from 'node:crypto';import {recordActivity} from './activity-events.js';
import {matchesCurrentPassword} from './account-mutations.js';
import {requireLiveSession,clearSessionCookie} from './auth.js';

const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
export function newPasswordProblem(value){
 if(typeof value!=='string'||value.length<8)return {code:'PASSWORD_TOO_SHORT',error:'Use at least 8 characters.'};
 if(value.length>128)return {code:'PASSWORD_TOO_LONG',error:'Use no more than 128 characters.'};
 if(!/[A-Z]/.test(value))return {code:'PASSWORD_UPPERCASE',error:'Include an uppercase letter.'};
 if(!/[a-z]/.test(value))return {code:'PASSWORD_LOWERCASE',error:'Include a lowercase letter.'};
 if(!/[0-9]/.test(value))return {code:'PASSWORD_NUMBER',error:'Include a number.'};

 if(!/[\W_]/.test(value))return {code:'PASSWORD_SYMBOL',error:'Include a symbol.'};
 return null;
}

export function installSecurity(app,pool,requireUser){
 async function transaction(req,run){
  const sql=pool.getConnection?await pool.getConnection():pool;
  try{
   await sql.beginTransaction();


   const [[user]]=await sql.execute('SELECT id,password FROM users WHERE id=? FOR UPDATE',[req.user.id]);
   if(!user)throw fail(401,'AUTH_REQUIRED','Please log in to continue.');
   await requireLiveSession(sql,req);
   await run(sql,user);await sql.commit();
  }catch(error){await sql.rollback();throw error;}
  finally{if(pool.getConnection)sql.release();}
 }
 function failure(error,res,next){
  if(error.status&&error.code)return res.status(error.status).json({error:error.message,code:error.code});
  next(error);
 }
 app.put('/api/account/password',requireUser,async(req,res,next)=>{
  res.set('Cache-Control','private, no-store');res.vary('Cookie');
  try{
   const body=req.body;
   if(!body||Object.keys(body).some(key=>!['current_password','new_password','confirm_password'].includes(key))||typeof body.current_password!=='string'||!body.current_password.length||body.current_password.length>128)throw fail(400,'INVALID_CURRENT_PASSWORD','Enter your current password.');
   const problem=newPasswordProblem(body.new_password);if(problem)throw fail(400,problem.code,problem.error);
   if(typeof body.confirm_password!=='string'||body.confirm_password!==body.new_password)throw fail(400,'PASSWORD_CONFIRMATION','Passwords do not match.');
   await transaction(req,async(sql,user)=>{
    if(!matchesCurrentPassword(user.password,body.current_password))throw fail(403,'INVALID_PASSWORD','Your current password is incorrect.');
    if(matchesCurrentPassword(user.password,body.new_password))throw fail(400,'PASSWORD_UNCHANGED','Choose a different password.');
    await sql.execute('UPDATE users SET password=? WHERE id=?',[body.new_password,user.id]);
    await sql.execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',[user.id,req.sessionHash]);
    await recordActivity(sql,{actor:user.id,type:'account.password_changed',key:'password:'+randomUUID()});
   });

   res.json({changed:true});
  }catch(error){failure(error,res,next);}
 });
 app.post('/api/account/sessions/revoke-all',requireUser,async(req,res,next)=>{
  res.set('Cache-Control','private, no-store');res.vary('Cookie');
  try{
   if(req.body&&Object.keys(req.body).length)throw fail(400,'INVALID_REQUEST','Invalid sign-out request.');
   await transaction(req,sql=>sql.execute('DELETE FROM sessions WHERE user_id=?',[req.user.id]));
   clearSessionCookie(req,res);res.status(204).end();
  }catch(error){failure(error,res,next);}
 });
}
