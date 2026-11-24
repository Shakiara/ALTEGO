// ALTEGO necesita resolver la ejecución explícita de la retención de auditoría.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import mysql from '../../backend/node_modules/mysql2/promise.js';
import config from '../../backend/config.js';
import {auditRetention} from '../../backend/modules/administration/audit-retention.js';

const args=process.argv.slice(2),execute=args.join(' ')==='--execute --confirm PURGE_EXPIRED_ADMIN_AUDIT';
if(args.length&&!execute&&args.join(' ')!=='--dry-run')throw Error('Use --dry-run or --execute --confirm PURGE_EXPIRED_ADMIN_AUDIT after explicit authorization.');
if(execute&&process.env.ALTEGO_AUDIT_RETENTION_AUTHORIZED!=='1')throw Error('Explicit retention authorization is required.');
const sql=await mysql.createConnection(config.mysql);
try{console.log(JSON.stringify(await auditRetention(sql,{execute})));}finally{await sql.end();}
