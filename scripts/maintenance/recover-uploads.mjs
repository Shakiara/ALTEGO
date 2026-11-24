// ALTEGO necesita resolver la revisión y recuperación de cargas interrumpidas.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import mysql from '../../backend/node_modules/mysql2/promise.js';
import config from '../../backend/config.js';
import {recoverTemporaryUploads} from '../../backend/infrastructure/storage/upload-staging.js';

const sql=mysql.createPool(config.mysql);
try{console.log(JSON.stringify(await recoverTemporaryUploads(sql)));}finally{await sql.end();}
