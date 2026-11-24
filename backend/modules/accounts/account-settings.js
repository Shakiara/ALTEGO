// ALTEGO necesita resolver las opciones privadas de configuración de cuenta.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { rememberCreator } from '../../infrastructure/storage/storage-identity.js';
import { ensureRequiredAdminFollow } from '../administration/admin-follow-policy.js';
import { createHash } from 'node:crypto';

export const accountSettingsMigration = '012_account_settings';
const unavailable = () => Object.assign(new Error('Account settings are not ready. An authorized schema migration is required.'), { status: 503, code: 'ACCOUNT_SETTINGS_NOT_READY' });
export const normalizeHandle = value => value.toLowerCase();


export async function withAccountFoundationLock(source, run) {
  const sql = source.getConnection ? await source.getConnection() : source;
  let lock;
  try {
    const [[context]] = await sql.query('SELECT DATABASE() AS database_name');
    if (!context.database_name) throw new Error('A database must be selected.');
    lock = 'altego_account_' + createHash('sha256').update(context.database_name).digest('hex').slice(0, 40);
    const [[state]] = await sql.execute('SELECT GET_LOCK(?,10) AS acquired', [lock]);
    if (Number(state.acquired) !== 1) throw Object.assign(new Error('Account setup is busy. Try again shortly.'), { status: 503 });
    return await run(sql);
  } finally {
    if (lock) await sql.execute('SELECT RELEASE_LOCK(?)', [lock]).catch(() => { });
    if (source.getConnection) sql.release();
  }
}

export async function accountFoundationReady(sql) {
  const [[tables]] = await sql.query("SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('account_settings','user_handles')");
  const [done] = await sql.execute('SELECT id FROM schema_migrations WHERE id=?', [accountSettingsMigration]);
  if (Number(tables.table_count) === 0 && done.length === 0) return false;
  if (Number(tables.table_count) !== 2 || done.length !== 1) throw unavailable();
  return true;
}

export async function reserveUserHandle(sql, userId, username) {

  const handle = normalizeHandle(username);
  await sql.execute('INSERT INTO user_handles(handle,user_id) VALUES (?,?) ON DUPLICATE KEY UPDATE handle=handle', [handle, userId]);
  const [[claim]] = await sql.execute('SELECT user_id FROM user_handles WHERE handle=? FOR UPDATE', [handle]);
  if (Number(claim?.user_id) !== Number(userId)) throw Object.assign(new Error('Username or email is already in use.'), { code: 'ER_DUP_ENTRY' });
}

export async function createRegisteredAccount(source, body) {
  return withAccountFoundationLock(source, async sql => {
    const ready = await accountFoundationReady(sql);
    await sql.beginTransaction();
    try {
      const email = body.email.trim().toLowerCase(), username = normalizeHandle(body.username);
      const [result] = await sql.execute('INSERT INTO users (username,email,password,role) VALUES (?,?,?,?)', [username, email, body.password, 'user']);
      if (ready) {
        await reserveUserHandle(sql, result.insertId, username);
        await sql.execute('INSERT INTO account_settings(user_id) VALUES (?)', [result.insertId]);
      }
      const [[profileSchema]] = await sql.query("SELECT COUNT(*) present FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_profiles'");
      if (profileSchema.present) await sql.execute("INSERT INTO user_profiles(user_id,display_name,bio,socials,avatar,banner) VALUES (?,?,'','[]','{\"kind\":\"default\"}','{\"kind\":\"default\"}')", [result.insertId, username]);
      await ensureRequiredAdminFollow(sql, result.insertId);
      await sql.commit(); rememberCreator(result.insertId, username);
      return { id: result.insertId, username, email, role: 'user' };
    } catch (error) { await sql.rollback(); throw error; }
  });
}

export function installAccountSettings(app, sql, requireUser) {
  app.get('/api/account/settings', requireUser, async (req, res) => {
    res.set('Cache-Control', 'private, no-store'); res.vary('Cookie');
    try {
      if (!await accountFoundationReady(sql)) throw unavailable();
      res.json(await readAccountSettings(sql, req.user.id));
    } catch (error) {
      if (error.code === 'ACCOUNT_SETTINGS_NOT_READY' || error.code === 'ER_NO_SUCH_TABLE') return res.status(503).json({ error: unavailable().message, code: 'ACCOUNT_SETTINGS_NOT_READY' });
      throw error;
    }
  });
}

export async function readAccountSettings(sql, userId) {
  const [[row]] = await sql.execute(`SELECT u.id,u.username,u.email,COALESCE(p.display_name,u.username) display_name,a.followers_visibility,a.following_visibility,a.revision,
 DATE_FORMAT(a.display_name_changed_at,'%Y-%m-%dT%H:%i:%s.%fZ') last_changed_at,
 DATE_FORMAT(DATE_ADD(a.display_name_changed_at,INTERVAL 168 HOUR),'%Y-%m-%dT%H:%i:%s.%fZ') next_change_at,
 a.display_name_changed_at IS NULL OR UTC_TIMESTAMP(6)>=DATE_ADD(a.display_name_changed_at,INTERVAL 168 HOUR) allowed
 FROM users u JOIN account_settings a ON a.user_id=u.id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?`, [userId]);
  if (!row) throw unavailable();
  return { revision: Number(row.revision), account: { id: row.id, username: row.username, email: row.email, display_name: row.display_name, display_name_change: { last_changed_at: row.last_changed_at, next_change_at: row.next_change_at, allowed: !!Number(row.allowed) } }, privacy: { followers_list: row.followers_visibility, following_list: row.following_visibility, counts_public: true } };
}
