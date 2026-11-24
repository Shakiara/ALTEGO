// ALTEGO necesita resolver el esquema de las operaciones de retirada Legacy.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export async function migrateLegacyRetirement(sql){
 const [done]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',['009_legacy_retirement']);if(done.length)return {alreadyApplied:true};
 await sql.query(`CREATE TABLE IF NOT EXISTS legacy_retirement_operations (
 id CHAR(36) PRIMARY KEY, batch_hash CHAR(64) NOT NULL, relative_path VARCHAR(200) NOT NULL,
 descriptor JSON NOT NULL, state ENUM('planned','quarantined','restored') NOT NULL,
 last_error VARCHAR(500) NULL, created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX(batch_hash,relative_path))`);
 await sql.execute('INSERT INTO schema_migrations(id) VALUES (?)',['009_legacy_retirement']);return {alreadyApplied:false};
}
