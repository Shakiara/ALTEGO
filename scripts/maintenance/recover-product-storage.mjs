// ALTEGO necesita resolver la recuperación de incorporaciones e índices de productos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import mysql from '../../backend/node_modules/mysql2/promise.js';
import config from '../../backend/config.js';
import {recoverProductStorage} from '../../backend/modules/products/product-storage.js';

const sql=mysql.createPool(config.mysql);
try{console.log(JSON.stringify(await recoverProductStorage(sql)));}finally{await sql.end();}
