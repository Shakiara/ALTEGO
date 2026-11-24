// ALTEGO necesita resolver el esquema de retención y recuperación de archivos.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export async function migrateStorageRetention(sql){
 const [done]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',['010_storage_retention']);if(done.length)return {alreadyApplied:true};
 async function column(table,name,type){const [rows]=await sql.query('SHOW COLUMNS FROM `'+table+'` LIKE ?',[name]);if(!rows.length)await sql.query('ALTER TABLE `'+table+'` ADD COLUMN `'+name+'` '+type);}
 for(const table of ['storage_cleanup_operations','legacy_retirement_operations']){
  await sql.query('ALTER TABLE `'+table+"` MODIFY state ENUM('planned','quarantined','restored','purge_planned','purged') NOT NULL");
  await column(table,'quarantined_at','DATETIME(6) NULL');await column(table,'purge_intent_at','DATETIME(6) NULL');await column(table,'purged_at','DATETIME(6) NULL');await column(table,'purge_metadata','JSON NULL');
 }

 await sql.query("UPDATE legacy_retirement_operations SET quarantined_at=STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(descriptor,'$.verified_at')),'%Y-%m-%dT%H:%i:%s.%fZ'),updated_at=updated_at WHERE quarantined_at IS NULL AND state='quarantined' AND JSON_UNQUOTE(JSON_EXTRACT(descriptor,'$.verified_at')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{6}Z$'");
 await sql.query("ALTER TABLE storage_file_lifecycle MODIFY kind ENUM('glb','png','json') NOT NULL");
 await column('storage_file_lifecycle','artifact_type',"ENUM('asset','staging') NOT NULL DEFAULT 'asset'");
 await column('storage_file_lifecycle','artifact_state',"ENUM('preparing','completed','abandoned') NULL");
 await column('storage_file_lifecycle','abandoned_at','DATETIME(6) NULL');await column('storage_file_lifecycle','abandonment_reason','VARCHAR(500) NULL');
 await sql.query("ALTER TABLE assets MODIFY storage_state ENUM('pending','ready','failed','abandoned') NOT NULL DEFAULT 'ready'");
 for(const table of ['assets','storage_incorporations']){
  await column(table,'abandoned_at','DATETIME(6) NULL');await column(table,'abandonment_reason','VARCHAR(500) NULL');
 }
 await column('assets','abandoned_artifacts','JSON NULL');
 await sql.query("ALTER TABLE storage_incorporations MODIFY status ENUM('preparing','prepared','committed','superseded','abandoned') NOT NULL");
 await sql.execute('INSERT INTO schema_migrations(id) VALUES (?)',['010_storage_retention']);return {alreadyApplied:false};
}
