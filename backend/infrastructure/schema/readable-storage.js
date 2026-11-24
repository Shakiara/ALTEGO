// ALTEGO necesita resolver la preparación incremental de las ubicaciones legibles de Storage.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
export const readableStorageMigration='037_readable_product_storage';

export async function prepareReadableStorageSchema(sql){
 const [[done]]=await sql.execute('SELECT id FROM schema_migrations WHERE id=?',[readableStorageMigration]);if(done)return {alreadyApplied:true};
 if(!(await sql.execute("SELECT id FROM schema_migrations WHERE id='036_my_collection'"))[0].length)throw Error('Apply schema 036 before preparing readable Storage.');
 for(const [table,column,definition]of[['product_storage','directory_name','VARCHAR(120) NULL'],['product_files','storage_version','INT UNSIGNED NULL']]){
  const [existing]=await sql.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);if(!existing.length)await sql.query('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition);
 }
 await sql.execute('INSERT INTO schema_migrations(id) VALUES (?)',[readableStorageMigration]);return {alreadyApplied:false};
}
