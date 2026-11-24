// ALTEGO necesita resolver la recuperación autorizada de imágenes de perfil.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import mysql from '../../backend/node_modules/mysql2/promise.js';
import config from '../../backend/config.js';
import { profileMediaPath } from '../../backend/modules/accounts/profiles.js';
import { readVerifiedStorageFile } from '../../backend/infrastructure/storage/storage-resolver.js';
const execute = process.argv[2] === '--execute';
if (process.argv.length > 3 || process.argv[2] && !['--execute', '--diagnose'].includes(process.argv[2]))
    throw Error('Use --diagnose or --execute.');
const pool = mysql.createPool(config.mysql);
try {
    const [operations] = await pool.query("SELECT * FROM profile_media_operations WHERE state='preparing' ORDER BY created_at,id"), result = [];
    for (const op of operations) {
        const descriptors = typeof op.descriptor === 'string' ? JSON.parse(op.descriptor) : op.descriptor;
        let complete = true;
        for (const d of descriptors) {
            const [rows] = await pool.execute('SELECT * FROM profile_media WHERE id=? AND owner_id=?', [d.id, op.owner_id]);
            if (!rows.length) {
                complete = false;
                continue;
            }
            for (const role of ['original', 'display'])
                await readVerifiedStorageFile(profileMediaPath(rows[0], role), { sha256: role === 'original' ? rows[0].original_sha256 : rows[0].display_sha256, byte_size: role === 'original' ? rows[0].original_size : rows[0].display_size });
        }
        if (execute && complete)
            await pool.execute("UPDATE profile_media_operations SET state='committed',last_error=NULL WHERE id=? AND state='preparing'", [op.id]);
        result.push({ id: op.id, state: complete ? (execute ? 'committed' : 'recoverable_committed') : 'protected_incomplete_preparation', filesDeleted: 0 });
    }
    console.log(JSON.stringify(result, null, 2));
}
finally {
    await pool.end();
}
