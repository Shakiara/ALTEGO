// ALTEGO necesita resolver el acceso local y LAN con direcciones descubiertas dinámicamente.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import os from 'node:os';

export function developmentOrigins(env=process.env,interfaces=os.networkInterfaces()){
 if(env.ALTEGO_DEVELOPMENT_LAN!=='1'||env.NODE_ENV==='production')return [];
 const port=Number(env.ALTEGO_WEB_PORT||4200);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid frontend port.');
 const addresses=Object.values(interfaces).flat().filter(Boolean).filter(i=>i.family==='IPv4'&&!i.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)).map(i=>i.address);
 return [...new Set(addresses)].map(ip=>'http://'+ip+':'+port);
}
