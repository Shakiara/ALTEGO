// ALTEGO necesita resolver las rutas reservadas para tareas de mantenimiento.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {creatorStorageEnabled,creatorRoot} from './storage-identity.js';
import path from 'node:path';

export function maintenancePath(relative){
 const value=relative.replaceAll('\\','/');
 for(const [old,next] of [['originals','maintenance/legacy/originals'],['previews','maintenance/legacy/previews'],['legacy-quarantine','maintenance/legacy/quarantine'],['quarantine','maintenance/quarantine'],['recovery','maintenance/recovery']])if(value===old||value.startsWith(old+'/'))return next+value.slice(old.length);
 return value;
}
export const legacyQuarantinePath=(id,relative)=>path.join('maintenance','legacy','quarantine',id,relative);
export const ordinaryQuarantinePath=(id,key,owner)=>creatorStorageEnabled()?path.join(creatorRoot(owner),'quarantine',id,key+'.bin'):path.join('maintenance','quarantine',id,key+'.bin');
