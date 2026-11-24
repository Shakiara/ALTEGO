// ALTEGO necesita resolver la identidad estable de los creadores dentro de Storage.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {loadProductLayouts} from './product-layout.js';

import path from 'node:path';
const names=new Map();let enabled=false;
export const creatorStorageMigration='027_creator_storage';
export async function configureStorageIdentity(sql,{force=false}={}){const [markers]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[creatorStorageMigration]);enabled=force||markers.length>0;const [users]=await sql.query('SELECT id,username FROM users');names.clear();for(const user of users)rememberCreator(user.id,user.username);await loadProductLayouts(sql);return enabled;}
export function rememberCreator(id,name){if(!Number.isSafeInteger(Number(id))||Number(id)<=0||typeof name!=='string'||!/^[a-z0-9_]{3,30}$/.test(name.toLowerCase())||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name.toLowerCase()))throw Error('Unsafe creator namespace.');names.set(Number(id),name.toLowerCase());}
export const creatorStorageEnabled=()=>enabled;
export function creatorRoot(id){if(!Number.isSafeInteger(Number(id))||Number(id)<=0)throw Error('Invalid creator ID.');if(!enabled)return path.join('creators',String(id));const name=names.get(Number(id));if(!name)throw Error('Creator namespace is not registered.');return name;}
export function creatorIdFromRoot(name){if(!enabled&&/^\d+$/.test(name))return Number(name);for(const [id,username]of names)if(username===name)return id;return null;}
export function ownerFromStoragePath(relative){const parts=relative.replaceAll('\\','/').split('/');if(parts[0]==='creators'||parts[0]==='temporary')return Number(parts[1]);return creatorIdFromRoot(parts[0]);}
export const pendingUploadPath=(id,asset,role,kind)=>enabled?path.join(creatorRoot(id),'uploads','pending',asset,role+'.'+kind):path.join('temporary',String(id),asset,role+'.'+kind);
export const profileUploadPath=(id,asset,file)=>enabled?path.join(creatorRoot(id),'uploads','profile',asset,file):path.join(creatorRoot(id),'profile','media',asset,file);
export async function refreshCreatorInformation(sql,storageRoot,options={}){const {refreshInformation}=await import('./creator-information.js');return refreshInformation(sql,storageRoot,options);}
