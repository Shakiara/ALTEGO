// ALTEGO necesita resolver el esquema de los diarios de limpieza de Storage.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export async function migrateStorageCleanup(sql){
 const [done]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',['008_storage_cleanup']);if(done.length)return {alreadyApplied:true};
 await sql.query(`CREATE TABLE IF NOT EXISTS storage_file_lifecycle (
 file_key CHAR(64) PRIMARY KEY, relative_path VARCHAR(500) NOT NULL,
 product_id INT UNSIGNED NULL, asset_id CHAR(36) NULL,
 kind ENUM('glb','png') NOT NULL, sha256 CHAR(64) NOT NULL, byte_size INT UNSIGNED NOT NULL,
 unreferenced_since DATETIME(6) NULL, loss_pending BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 INDEX upload_lookup(asset_id), INDEX product_hash(product_id,sha256))`);

 await sql.query(`CREATE TABLE IF NOT EXISTS storage_cleanup_operations (
 id CHAR(36) PRIMARY KEY, file_key CHAR(64) NOT NULL,
 state ENUM('planned','quarantined','restored') NOT NULL,
 descriptor JSON NOT NULL, last_error VARCHAR(500) NULL,
 updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX(file_key))`);
 await sql.execute('INSERT INTO schema_migrations(id) VALUES (?)',['008_storage_cleanup']);return {alreadyApplied:false};
}
