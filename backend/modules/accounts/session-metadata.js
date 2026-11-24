// ALTEGO necesita resolver los datos descriptivos de las sesiones.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {createHash} from 'node:crypto';
export const sessionMetadataMigration='013_session_metadata';
export async function sessionMetadataReady(sql){const [rows]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[sessionMetadataMigration]);return rows.length===1;}
export async function withSessionSchemaLock(source,run){const sql=source.getConnection?await source.getConnection():source;let name;try{const [[db]]=await sql.query('SELECT DATABASE() AS database_name');if(!db.database_name)throw Error('Database required');name='altego_sessions_'+createHash('sha256').update(db.database_name).digest('hex').slice(0,40);const [[lock]]=await sql.execute('SELECT GET_LOCK(?,10) AS acquired',[name]);if(Number(lock.acquired)!==1)throw Object.assign(Error('Session setup is busy. Please try again.'),{status:503});return await run(sql);}finally{if(name)await sql.execute('SELECT RELEASE_LOCK(?)',[name]).catch(()=>{});if(source.getConnection)sql.release();}}



export function sessionClient(userAgent){
 const unknown={device_label:null,browser_label:null,device_type:'unknown'};
 if(typeof userAgent!=='string'||!userAgent||userAgent.length>2048||/bot|crawler|spider|headless|curl|wget/i.test(userAgent))return unknown;
 const platforms=[[/iPhone/i,'iPhone','mobile'],[/iPad/i,'iPad','tablet'],[/Android/i,'Android',/Mobile/i.test(userAgent)?'mobile':'tablet'],[/Windows NT/i,'Windows','desktop'],[/Macintosh|Mac OS X/i,'Mac','desktop'],[/Linux|X11/i,'Linux','desktop']];
 let platform=platforms.find(([pattern])=>pattern.test(userAgent));

 if(/Windows NT/i.test(userAgent)&&/Macintosh|iPhone|iPad|Android/i.test(userAgent))platform=undefined;
 const browsers=[[/Edg(?:e|A|iOS)?\//,'Edge'],[/OPR\//,'Opera'],[/SamsungBrowser\//,'Samsung Internet'],[/Firefox\/|FxiOS\//,'Firefox'],[/Chrome\/|CriOS\//,'Chrome'],[/Version\/.*Safari\//,'Safari']];const browser=browsers.find(([pattern])=>pattern.test(userAgent));
 return {device_label:platform?.[1]||null,browser_label:browser?.[1]||null,device_type:platform?.[2]||'unknown'};
}
export async function touchSession(sql,req){
 if(!req.sessionHash||req.method!=='GET'&&req.method!=='HEAD')return;
 if(['/api/auth/me','/api/health','/api/account/sessions'].includes(req.path)||req.path.startsWith('/api/previews/')||req.path.startsWith('/api/profile-media/'))return;
 if(!await sessionMetadataReady(sql))return;
 await sql.execute('UPDATE sessions SET last_active_at=UTC_TIMESTAMP(6) WHERE token_hash=? AND expires_at>UTC_TIMESTAMP() AND (last_active_at IS NULL OR last_active_at<DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 60 SECOND))',[req.sessionHash]);
}
