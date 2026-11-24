// ALTEGO necesita resolver la autenticación y las sesiones de los usuarios.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {developmentOrigins} from '../../infrastructure/network/development-network.js';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {sessionClient,sessionMetadataReady,touchSession,withSessionSchemaLock} from './session-metadata.js';
import {governanceReady} from "../../infrastructure/schema/readiness.js";
import {suspensionForLogin} from './account-sanctions.js';
import {createRegisteredAccount} from './account-settings.js';

export const frontendOrigins = new Set(['http://localhost:4200', 'http://127.0.0.1:4200']);
if(process.env.FRONTEND_ORIGIN){const origin=new URL(process.env.FRONTEND_ORIGIN);if(origin.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('FRONTEND_ORIGIN must be a local HTTP origin.');frontendOrigins.add(origin.origin);}
for(const origin of developmentOrigins())frontendOrigins.add(origin);
const origins=frontendOrigins;
const cookieName = 'altego_session';
const publicUser = user => ({ id:user.id, username:user.username, email:user.email, role:user.role });
const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function signupError(body) {
  if (!body || typeof body.username !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(body.username)) return 'Username must contain 3–30 letters, numbers or underscores.';
  if(/^(admin|creators|temporary|maintenance|originals|previews|quarantine|recovery|backups|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(body.username.toLowerCase()))return 'This username is reserved.';
  if(typeof body.email!=='string'||body.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(body.email))return 'Enter a valid email address.';
  if(typeof body.password!=='string'||body.password.length<8||body.password.length>128||!/[A-Z]/.test(body.password)||!/[a-z]/.test(body.password)||!/[0-9]/.test(body.password)||!/[\W_]/.test(body.password))return 'Password must contain 8–128 characters, uppercase, lowercase, a number and a special character.';
  return null;
}
export function installAuth(app, sql) {

  app.use((req,res,next)=>{
    if(req.get('forwarded') || req.get('x-forwarded-for')) return res.status(403).json({error:'Proxy access is disabled for this local demonstration.',code:'LOCAL_ONLY'});
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.status(403).json({error:'Local demonstration only.',code:'LOCAL_ONLY'});
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!origins.has(req.get('origin')))return res.status(403).json({error:'Request origin is not allowed.',code:'INVALID_ORIGIN'});
    next();
  });
  app.use(async(req,res,next)=>{
    const token=(req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    if(token&&/^[a-f0-9]{64}$/.test(token)){
      const enhanced=await governanceReady(sql);
      const[rows]=await sql.execute('SELECT u.id,u.username,u.email,u.role,s.token_hash'+(enhanced?',s.restricted':'')+' FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP()', [tokenHash(token)]);
      if(rows.length){
       const row=rows[0];req.sessionHash=row.token_hash;
       if(enhanced&&row.restricted)req.restrictedUser=publicUser(row);
       else if(!enhanced||!await suspensionForLogin(sql,row))req.user=publicUser(row);
       if(req.user||req.restrictedUser)await touchSession(sql,req);
      }
    }
    if(req.path.startsWith('/api/auth')||req.user)res.set('Cache-Control','no-store');
    next();
  });
  const attempts=new Map();
  app.use(['/api/auth/login','/api/auth/register'],(req,res,next)=>{
    if(req.method!=='POST')return next();
    const key=req.socket.remoteAddress;const now=Date.now();const old=attempts.get(key);const state=old&&old.until>now?old:{count:0,until:now+60000};state.count++;attempts.set(key,state);
    if(state.count>30)return res.status(429).json({error:'Too many attempts. Try again in a minute.',code:'RATE_LIMITED'});next();
  });
  async function issue(req,res,user,remember,connection=sql,{restricted=false}={}){

    const token=randomBytes(32).toString('hex');
    const lifetime=remember?30*86400:12*3600;
    await withSessionSchemaLock(connection,async sessionSql=>{
      if(req.sessionHash)await sessionSql.execute('DELETE FROM sessions WHERE token_hash=?',[req.sessionHash]);
      if(await sessionMetadataReady(sessionSql)){
        const client=sessionClient(req.get('user-agent'));
        await sessionSql.execute('INSERT INTO sessions (token_hash,user_id,expires_at,public_id,device_label,browser_label,device_type,last_active_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND),?,?,?,?,UTC_TIMESTAMP(6))',[tokenHash(token),user.id,lifetime,randomUUID(),client.device_label,client.browser_label,client.device_type]);
      }else await sessionSql.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))',[tokenHash(token),user.id,lifetime]);
    });
    if(restricted)await connection.execute('UPDATE sessions SET restricted=TRUE WHERE token_hash=?',[tokenHash(token)]);
    res.cookie(cookieName,token,{httpOnly:true,sameSite:'strict',secure:req.secure,path:'/api',...(remember?{maxAge:lifetime*1000}:{})});
    return publicUser(user);
  }
  app.post('/api/auth/register',async(req,res)=>{
    const error=signupError(req.body);if(error)return res.status(400).json({error,code:'INVALID_SIGNUP'});
    try{
      const user=await createRegisteredAccount(sql,req.body);
      res.status(201).json({user:await issue(req,res,user,false)});
    }catch(error){if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Username or email is already in use.',code:'ACCOUNT_EXISTS'});throw error;}
  });
  app.post('/api/auth/login',async(req,res)=>{
    const {identifier,password,rememberMe}=req.body||{};
    if(typeof identifier!=='string'||identifier.length>254||typeof password!=='string'||password.length>128)return res.status(400).json({error:'Enter your username or email and password.',code:'INVALID_LOGIN'});
    const connection=sql.getConnection?await sql.getConnection():sql;
    try{await connection.beginTransaction();
    const[rows]=await connection.execute('SELECT id,username,email,password,role FROM users WHERE username=? OR email=? LIMIT 1 FOR UPDATE',[identifier.trim(),identifier.trim().toLowerCase()]);
    const user=rows[0];const supplied=Buffer.from(password);const stored=Buffer.from(user?.password||'');
    if(!user||stored.length!==supplied.length||!timingSafeEqual(stored,supplied)){await connection.rollback();return res.status(401).json({error:'Invalid username, email or password.',code:'INVALID_CREDENTIALS'});}
    const sanctions=await suspensionForLogin(connection,user);
    if(sanctions){
     if(await governanceReady(connection)){
      await issue(req,res,user,false,connection,{restricted:true});await connection.commit();
      return res.status(403).json({error:'This account is suspended.',code:'ACCOUNT_SUSPENDED',sanctions,restricted:true});
     }
     await connection.rollback();return res.status(403).json({error:'This account is suspended.',code:'ACCOUNT_SUSPENDED',sanctions});
    }
    const authenticated=await issue(req,res,user,rememberMe===true,connection);await connection.commit();res.json({user:authenticated});
    }catch(error){await connection.rollback();throw error;}finally{if(sql.getConnection)connection.release();}
  });
  app.get('/api/auth/me',(req,res)=>res.json({user:req.user||null,...(req.restrictedUser?{restricted:true}:{})}));
  app.post('/api/auth/logout',async(req,res)=>{
    if(req.sessionHash)await sql.execute('DELETE FROM sessions WHERE token_hash=?',[req.sessionHash]);
    clearSessionCookie(req,res);res.status(204).end();
  });
  app.get('/api/admin',requireUser,requireAdmin,(req,res)=>res.json({message:'Admin access is ready. Management tools will be added in later phases.'}));
}
export function requireUser(req,res,next){if(!req.user)return res.status(401).json({error:'Please log in to continue.',code:'AUTH_REQUIRED'});next();}
export function requireAdmin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({error:'Administrator access is required.',code:'ADMIN_REQUIRED'});next();}
export function canEditProduct(sql){return async(req,res,next)=>{const[rows]=await sql.execute('SELECT owner_id FROM productos WHERE id=?',[req.recordId]);if(!rows.length)return res.status(404).json({error:'Product not found.'});if(req.user.role!=='admin'&&rows[0].owner_id!==req.user.id)return res.status(403).json({error:'You cannot modify this item.',code:'NOT_OWNER'});next();};}


export async function requireLiveSession(sql,req){
 if(!req.sessionHash)throw Object.assign(new Error('Please log in to continue.'),{status:401,code:'AUTH_REQUIRED'});
 const [[session]]=await sql.execute('SELECT token_hash FROM sessions WHERE user_id=? AND token_hash=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE',[req.user.id,req.sessionHash]);
 if(!session)throw Object.assign(new Error('Your session has expired. Please log in again.'),{status:401,code:'AUTH_REQUIRED'});
}
export function clearSessionCookie(req,res){res.clearCookie(cookieName,{httpOnly:true,sameSite:'strict',secure:req.secure,path:'/api'});}
