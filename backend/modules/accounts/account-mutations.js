// ALTEGO necesita resolver los cambios autorizados de datos de cuenta.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { changeDisplayName, validateDisplayName } from './display-name.js';
import { recordActivity } from './activity-events.js';
import { timingSafeEqual } from 'node:crypto';
import { requireLiveSession } from './auth.js';
import { accountFoundationReady, readAccountSettings, normalizeHandle, withAccountFoundationLock } from './account-settings.js';

const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
export function matchesCurrentPassword(stored, supplied) { if (typeof supplied !== 'string' || supplied.length > 128) return false; const a = Buffer.from(stored || ''), b = Buffer.from(supplied); return a.length === b.length && timingSafeEqual(a, b); }

export function installAccountMutations(app, pool, requireUser) {
    app.get('/api/handles/:username', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!/^[a-zA-Z0-9_]{3,30}$/.test(req.params.username)) return res.status(400).json({ error: 'Invalid username.', code: 'INVALID_USERNAME' });
        if (!await accountFoundationReady(pool)) return res.status(503).json({ error: 'Account settings are not ready.', code: 'ACCOUNT_SETTINGS_NOT_READY' });
        const [[row]] = await pool.execute('SELECT u.id,u.username FROM user_handles h JOIN users u ON u.id=h.user_id WHERE h.handle=?', [normalizeHandle(req.params.username)]);
        if (!row) return res.status(404).json({ error: 'Creator not found.', code: 'HANDLE_NOT_FOUND' });
        res.json({ id: row.id, username: row.username });
    });
    app.put('/api/account/username', requireUser, (req, res) => res.status(403).json({ error: 'Username is permanent and cannot be changed.', code: 'USERNAME_PERMANENT' }));
    for (const kind of ['display-name', 'email', 'privacy']) app.put('/api/account/' + kind, requireUser, async (req, res) => {
        res.set('Cache-Control', 'private, no-store'); res.vary('Cookie');
        try {
            const body = req.body, allowed = kind === 'privacy' ? ['revision', 'followers_list', 'following_list'] : ['revision', kind === 'display-name' ? 'display_name' : kind, 'current_password'];
            if (!body || Object.keys(body).some(k => !allowed.includes(k)) || !Number.isSafeInteger(body.revision) || body.revision < 1) throw fail(400, 'INVALID_SETTINGS', 'Invalid account settings request.');
            if (kind === 'display-name') validateDisplayName(body.display_name);
            const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
            if (kind === 'email' && (!email || email.length > 254 || !/^\S+@[^\s@]+\.[^\s@]+$/.test(email))) throw fail(400, 'INVALID_EMAIL', 'Enter a valid email address.');
            const fields = ['followers_list', 'following_list'].filter(k => Object.hasOwn(body, k));
            if (kind === 'privacy' && (fields.length !== 1 || !['public', 'private'].includes(body[fields[0]]))) throw fail(400, 'INVALID_PRIVACY', 'Choose Public or Private for one list.');
            const result = await withAccountFoundationLock(pool, async sql => {
                if (!await accountFoundationReady(sql)) throw fail(503, 'ACCOUNT_SETTINGS_NOT_READY', 'Account settings are not ready.');
                await sql.beginTransaction();
                try {
                    const [[user]] = await sql.execute('SELECT id,username,email,password,role FROM users WHERE id=? FOR UPDATE', [req.user.id]);
                    const [[settings]] = await sql.execute('SELECT revision FROM account_settings WHERE user_id=? FOR UPDATE', [req.user.id]);
                    if (!user) throw fail(401, 'AUTH_REQUIRED', 'Please log in to continue.');
                    await requireLiveSession(sql, req);
                    if (!settings) throw fail(503, 'ACCOUNT_SETTINGS_NOT_READY', 'Account settings are not ready.');
                    if (Number(settings.revision) !== body.revision) throw fail(409, 'SETTINGS_CHANGED', 'Your account settings changed. Please try again.');
                    if (kind !== 'privacy' && !matchesCurrentPassword(user.password, body.current_password)) throw fail(403, 'INVALID_PASSWORD', 'Your current password is incorrect.');
                    const beforePrivacy = kind === 'privacy' ? await readAccountSettings(sql, user.id) : null;
                    if (kind === 'display-name') {
                        await changeDisplayName(sql, user.id, body.display_name);
                        await sql.execute('UPDATE user_profiles SET display_name=?,revision=revision+1 WHERE user_id=?', [body.display_name.trim(), user.id]);
                    } else if (kind === 'email') {
                        if (email !== user.email) { await sql.execute('UPDATE users SET email=? WHERE id=?', [email, user.id]); await sql.execute('UPDATE account_settings SET revision=revision+1 WHERE user_id=?', [user.id]); }
                    } else {

                        const column = fields[0] === 'followers_list' ? 'followers_visibility' : 'following_visibility';
                        await sql.execute('UPDATE account_settings SET ' + column + '=?,revision=revision+1 WHERE user_id=?', [body[fields[0]], user.id]);
                    }
                    const data = await readAccountSettings(sql, user.id);
                    const response = { settings: data, user: { id: user.id, username: data.account.username, email: data.account.email, role: user.role } };
                    if (kind === 'email' && user.email !== data.account.email) await recordActivity(sql, { actor: user.id, type: 'account.email_changed', key: 'email:' + data.revision });
                    if (kind === 'privacy' && beforePrivacy.privacy[fields[0]] !== data.privacy[fields[0]]) await recordActivity(sql, { actor: user.id, type: 'account.privacy_changed', metadata: { list: fields[0] === 'followers_list' ? 'Followers' : 'Following', visibility: data.privacy[fields[0]] }, key: 'privacy:' + fields[0] + ':' + data.revision });
                    await sql.commit();
                    return response;
                } catch (error) { await sql.rollback(); throw error; }
            }); res.json(result);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: kind === 'email' ? 'This email is already in use.' : 'This username is reserved or already in use.', code: kind === 'email' ? 'EMAIL_EXISTS' : 'USERNAME_EXISTS' });
            if (error.status && error.code) return res.status(error.status).json({ error: error.message, code: error.code, ...(error.next_real_change_at ? { next_real_change_at: error.next_real_change_at } : {}) });
            if (error.code === 'ER_NO_SUCH_TABLE') return res.status(503).json({ error: 'Account settings are not ready.', code: 'ACCOUNT_SETTINGS_NOT_READY' });
            throw error;
        }
    });
}


export async function canViewAccountList(sql, ownerId, viewerId, list) {
    if (!['followers_list', 'following_list'].includes(list)) return false;
    const [[viewer]] = viewerId === null ? [[]] : await sql.execute('SELECT role FROM users WHERE id=? FOR SHARE', [viewerId]);
    const [[row]] = await sql.execute('SELECT followers_visibility,following_visibility FROM account_settings WHERE user_id=?', [ownerId]);
    return !!row && (viewerId !== null && Number(ownerId) === Number(viewerId) || ['admin', 'moderator'].includes(viewer?.role) || (list === 'followers_list' ? row.followers_visibility : row.following_visibility) === 'public');
}
