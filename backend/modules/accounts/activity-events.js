// ALTEGO necesita resolver el registro de eventos de actividad de cuenta.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {randomUUID} from 'node:crypto';
export const activityMigration='015_account_activity';
export const activityTypes=Object.freeze({
 'account.username_changed':{category:'changes',action:'Username changed',allowed:['username']},
 'account.email_changed':{category:'changes',action:'Email changed',allowed:[]},
 'account.privacy_changed':{category:'changes',action:'Privacy updated',allowed:['list','visibility']},
 'account.password_changed':{category:'changes',action:'Password changed',allowed:[]},
 'user.blocked':{category:'interactions',action:'User blocked',allowed:[]},'user.unblocked':{category:'interactions',action:'User unblocked',allowed:[]},
 'review.posted':{category:'interactions',action:'Review posted',allowed:['rating']},
 'item.created':{category:'content',action:'Item created',allowed:['creator']},
 'item.updated':{category:'content',action:'Item updated',allowed:['fields','creator']},
 'item.price_updated':{category:'content',action:'Price updated',allowed:['previous_price','price','creator']},
 'item.published':{category:'content',action:'Item published',allowed:['version','creator']},
 'item.trashed':{category:'content',action:'Item moved to Trash',allowed:['creator']},
 'item.restored':{category:'content',action:'Item restored',allowed:['creator']},
 'item.listed':{category:'content',action:'Item listed',allowed:['creator']},'item.unlisted':{category:'content',action:'Item unlisted',allowed:['creator']},
 'item.purged':{category:'content',action:'Item removed',allowed:['creator']},
 'item.version_restored':{category:'content',action:'Version restored',allowed:['version','source_version','creator']}
});
export const activityError=(status,code,message)=>Object.assign(Error(message),{status,code});
export async function requireActivityReady(sql){const [rows]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[activityMigration]);if(!rows.length)throw activityError(503,'ACTIVITY_NOT_READY','Activity is unavailable. Please try again later.');}
function safeMetadata(type,input={}){const config=activityTypes[type];if(!config||!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!config.allowed.includes(k)))throw Error('Invalid activity metadata');const result={};for(const [key,value]of Object.entries(input)){if(typeof value==='string'&&value.length<=160)result[key]=value;else if(typeof value==='number'&&Number.isFinite(value)&&value>=0)result[key]=value;else if(key==='fields'&&Array.isArray(value)&&value.length<=12&&value.every(v=>typeof v==='string'&&v.length<=40))result[key]=value;else throw Error('Invalid activity value');}if(Buffer.byteLength(JSON.stringify(result))>2048)throw Error('Activity metadata is too large');return result;}

export async function recordActivity(sql,{actor,type,resourceType='account',resourceId=null,label='Account',metadata={},key,occurredAt=null}){
 await requireActivityReady(sql);const config=activityTypes[type],safe=safeMetadata(type,metadata);if(!Number.isSafeInteger(actor)||actor<1||!['account','product','user'].includes(resourceType)||resourceId!==null&&!/^[1-9]\d{0,9}$/.test(String(resourceId))||typeof label!=='string'||!label||label.length>160||typeof key!=='string'||!key||key.length>160)throw Error('Invalid activity descriptor');
 const search=[config.action,label,...Object.values(safe).flat()].join(' ').slice(0,700);
 await sql.execute('INSERT INTO account_activity(public_id,user_id,event_type,category,resource_type,resource_id,reference_label,metadata,search_text,event_key,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,COALESCE(?,UTC_TIMESTAMP(6))) ON DUPLICATE KEY UPDATE id=id',[randomUUID(),actor,type,config.category,resourceType,resourceId===null?null:String(resourceId),label,JSON.stringify(safe),search,key,occurredAt instanceof Date?occurredAt.toISOString().slice(0,23).replace('T',' '):occurredAt]);
}
