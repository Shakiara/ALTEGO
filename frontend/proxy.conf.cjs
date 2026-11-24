// ALTEGO necesita resolver el acceso del frontend a la API del mismo entorno.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
const path=require('node:path');
try{require('node:process').loadEnvFile(path.join(__dirname,'..','.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const port=process.env.ALTEGO_API_PORT||process.env.PORT||'3000';if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('Invalid API port.');

module.exports={'/api':{target:'http://127.0.0.1:'+port,secure:false}};
