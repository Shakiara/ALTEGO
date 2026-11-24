// ALTEGO necesita resolver la equivalencia estructural y los triggers de la instalación.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import fs from 'node:fs/promises';
import {sqlStatements} from './sql-runner.mjs';

export async function schemaShape(sql){
 const queries=[
 "SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME",
 "SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_DEFAULT,IS_NULLABLE,COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION",
 "SELECT TABLE_NAME,NON_UNIQUE,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,IS_VISIBLE,EXPRESSION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX",
 "SELECT TABLE_NAME,CONSTRAINT_NAME,CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME",
 "SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,ORDINAL_POSITION,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION",
 "SELECT CONSTRAINT_NAME,TABLE_NAME,UNIQUE_CONSTRAINT_NAME,UPDATE_RULE,DELETE_RULE,REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME",
 "SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY CONSTRAINT_NAME"
 ];const result=[];for(const query of queries)result.push((await sql.query(query))[0]);return result;
}
export function assertSameSchema(actual,expected){if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Schema does not match the verified installation contract. No migration markers may be assumed.');}

export async function verifyInstallationTriggers(sql){
 const source=await fs.readFile(new URL('../../database/mysql.sql',import.meta.url),'utf8');
 const expected=sqlStatements(source).filter(s=>s.startsWith('CREATE TRIGGER '));
 const [actual]=await sql.query('SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME');
 if(actual.length!==expected.length)throw Error('Installation trigger count differs.');
 const normalize=s=>s.replace(/\s+/g,' ').trim().toLowerCase();
 for(const statement of expected){const match=statement.match(/^CREATE TRIGGER (\w+) (BEFORE|AFTER) (INSERT|UPDATE|DELETE) ON (\w+) FOR EACH ROW ([\s\S]+)$/i),row=actual.find(t=>t.TRIGGER_NAME===match?.[1]);if(!match||!row||row.ACTION_TIMING!==match[2]||row.EVENT_MANIPULATION!==match[3]||row.EVENT_OBJECT_TABLE!==match[4]||normalize(row.ACTION_STATEMENT)!==normalize(match[5]))throw Error('Installation trigger differs: '+(match?.[1]||'unknown'));}
 return {triggers:actual.length};
}
