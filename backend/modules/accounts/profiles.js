// ALTEGO necesita resolver los perfiles públicos y su edición autorizada.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import {profileUploadPath} from '../../infrastructure/storage/storage-identity.js';
import {changeDisplayName} from './display-name.js';
import {productPublicFilter} from '../administration/admin-audit.js';
import {isVerifiedCreator,verificationReady} from '../verification/verification-status.js';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { requireUser } from './auth.js';
import { safeStoragePath, readVerifiedStorageFile, validAssetId } from '../../infrastructure/storage/storage-resolver.js';
import { profileInput, imageBytes } from './profile-validation.js';
import { robloxAvatars } from './profile-roblox.js';
import {engagementReady,followState} from '../social/social-notifications.js';
import { decorateProduct } from '../products/product-dto.js';
const parse = v => typeof v === 'string' ? JSON.parse(v) : v, hash = b => createHash('sha256').update(b).digest('hex'), fail = (message, status = 400) => Object.assign(new Error(message), { status });
const defaults = { avatar: { kind: 'default' }, banner: { kind: 'default' } };
export const profileMediaPath = (media, role) => { if (!validAssetId(media.id) || !Number.isSafeInteger(media.owner_id) || media.owner_id <= 0 || !['png', 'jpg', 'webp'].includes(media.extension) || !['original', 'display'].includes(role))
    throw fail('Invalid profile image.'); return profileUploadPath(media.owner_id,media.id,role === 'original' ? 'original.' + media.extension : 'display.webp'); };
export {isVerifiedCreator};

export async function publicCreator(sql, id, viewerId = null) {
    const [users] = await sql.execute('SELECT id,username,created_at FROM users WHERE id=?', [id]);
    if (!users.length)
        throw fail('Creator not found.', 404);
    const [profiles] = await sql.execute('SELECT * FROM user_profiles WHERE user_id=?', [id]), user = users[0], p = profiles[0];
    const [rows] = await sql.execute("SELECT p.id,p.owner_id,u.username AS creator_name,p.status,p.current_version_id,pv.snapshot,pv.created_at AS published_at,pv.version_number,c.nombre AS category FROM productos p JOIN product_versions pv ON pv.id=p.current_version_id AND pv.product_id=p.id JOIN users u ON u.id=p.owner_id JOIN categorias c ON c.id=COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pv.snapshot,'$.category_id')),p.categoria_id) WHERE p.owner_id=? AND p.status='Published' AND p.purged_at IS NULL" + await productPublicFilter(sql) + " ORDER BY pv.created_at DESC,pv.id DESC,p.id DESC", [id]);
    const verified=await isVerifiedCreator(sql,id);
    const products = rows.map((row, index) => decorateProduct({ ...parse(row.snapshot), creator_name: row.creator_name, verified_creator: verified, owner_id: row.owner_id, category: row.category, status: row.status, current_version_id: row.current_version_id, version_number: row.version_number, published_at: row.published_at, profile_order: index }));
    const pinned = products.find(item => item.id === p?.pinned_product_id) || null;
    if (pinned)
        products.splice(products.indexOf(pinned), 1), products.unshift(pinned);
    const avatar = p ? parse(p.avatar) : defaults.avatar, banner = p ? parse(p.banner) : defaults.banner;
    const follows = await engagementReady(sql) ? await followState(sql,id,viewerId) : null;
    return { id: user.id, ...(follows ? {viewer_follows:follows.viewer_follows,follow_required:follows.required} : {}), username: user.username, display_name: p?.display_name || user.username, bio: p?.bio || null, avatar_url: avatar.media_id ? '/api/profile-media/' + avatar.media_id + '/display' : null, banner_url: banner.media_id ? '/api/profile-media/' + banner.media_id + '/display' : null, avatar, banner, created_at: user.created_at || null, revision: p?.revision || 0, pinned_product_id: pinned?.id || (viewerId === id ? p?.pinned_product_id || null : null), pinned_item: pinned ? { ...pinned, thumbnail_url: p?.pinned_thumbnail_id ? '/api/profile-media/' + p.pinned_thumbnail_id + '/display' : null } : null, verified_creator: verified, public_links: p ? parse(p.socials) : [], stats: { published_items: products.length, followers: follows?.followers ?? null, following: follows?.following ?? null }, availability: { profile_editing: true, following: !!follows, reporting: false, blocking: true, verification: await verificationReady(sql) }, products };
}

export async function validateProfilePin(sql,userId,productId,before,{allowHidden=false,hasThumbnail=false,requireThumbnail=false}={}){
 if(productId===null)return;
 const [eligible]=await sql.execute("SELECT p.id FROM productos p WHERE p.id=? AND p.owner_id=? AND p.status='Published' AND p.purged_at IS NULL AND p.current_version_id IS NOT NULL"+await productPublicFilter(sql)+" FOR UPDATE",[productId,userId]);
 if(!eligible.length){
  const [owned]=await sql.execute('SELECT owner_id FROM productos WHERE id=?',[productId]);
  if(!allowHidden||hasThumbnail||productId!==before?.pinned_product_id||owned[0]?.owner_id!==userId)throw fail('Pin one of your own published items.');
 }
 if(requireThumbnail&&productId!==before?.pinned_product_id&&!hasThumbnail)throw fail('Wait for the real item thumbnail before selecting the pin.');
}
async function journal(sql) { const c = sql.connection.config; return mysql.createConnection(Object.fromEntries(['host', 'port', 'user', 'password', 'database', 'socketPath', 'ssl', 'timezone'].filter(k => c[k] !== undefined).map(k => [k, c[k]]))); }
export function installProfiles(app, pool, { robloxFetch = fetch } = {}) {
    const roblox = robloxAvatars(robloxFetch), upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 3, fields: 1, fieldSize: 32768, parts: 4 } }).fields([{ name: 'avatar_file', maxCount: 1 }, { name: 'banner_file', maxCount: 1 }, { name: 'pin_thumbnail', maxCount: 1 }]);
    app.post('/api/profile/roblox', requireUser, async (req, res) => { const found = await roblox.lookup(req.user.id, req.body?.query); await imageBytes(roblox.ticket(req.user.id, found.token).bytes, 'avatar', { zoom: 1, x: 50, y: 50 }); res.json(found); });
    app.get('/api/profile/roblox/previews/:token', requireUser, async (req, res) => { if (!validAssetId(req.params.token))
        throw fail('Roblox preview not found.', 404); const selected = roblox.ticket(req.user.id, req.params.token), image = await imageBytes(selected.bytes, 'avatar', { zoom: 1, x: 50, y: 50 }); res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).type(image.mime).send(selected.bytes); });
    app.get('/api/profile-media/:mediaId/:representation', async (req, res) => { if (!validAssetId(req.params.mediaId) || !['original', 'display'].includes(req.params.representation))
        throw fail('Profile image not found.', 404); const [rows] = await pool.execute(`SELECT * FROM profile_media WHERE id=? AND COALESCE(JSON_EXTRACT(metadata,'$.permanently_deleted'),FALSE)=FALSE AND COALESCE(JSON_EXTRACT(metadata,'$.permanent_deletion_pending'),FALSE)=FALSE`, [req.params.mediaId]); const media = rows[0]; if (!media)
        throw fail('Profile image not found.', 404); const role = req.params.representation; if (role === 'original') {
        if (req.user?.id !== media.owner_id)
            throw fail('Profile original is private.', 403);
    }
    else {
        const [refs] = await pool.execute("SELECT up.user_id FROM user_profiles up LEFT JOIN productos p ON p.id=up.pinned_product_id WHERE JSON_UNQUOTE(JSON_EXTRACT(up.avatar,'$.media_id'))=? OR JSON_UNQUOTE(JSON_EXTRACT(up.banner,'$.media_id'))=? OR (up.pinned_thumbnail_id=? AND p.owner_id=up.user_id AND p.status='Published' AND p.purged_at IS NULL AND p.current_version_id IS NOT NULL"+await productPublicFilter(pool)+")", [media.id, media.id, media.id]);
        if (!refs.length)
            throw fail('Profile image not found.', 404);
    } const bytes = await readVerifiedStorageFile(profileMediaPath(media, role), { sha256: role === 'original' ? media.original_sha256 : media.display_sha256, byte_size: role === 'original' ? media.original_size : media.display_size }); res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': role === 'original' || media.slot === 'pin' ? 'no-store' : 'public, max-age=3600' }).type(role === 'original' ? media.mime : 'image/webp').send(bytes); });

    app.put('/api/profile/pin',requireUser,async(req,res)=>{
      const body=req.body;
      if(!body||Object.keys(body).some(key=>!['revision','pinned_product_id'].includes(key))||!Number.isSafeInteger(body.revision)||body.revision<0||body.pinned_product_id!==null&&(!Number.isSafeInteger(body.pinned_product_id)||body.pinned_product_id<=0))throw fail('Invalid pin request.');
      const sql=await pool.getConnection(),userId=req.user.id;
      try{
        await sql.beginTransaction();
        const [[user]]=await sql.execute('SELECT id,username FROM users WHERE id=? FOR UPDATE',[userId]);
        if(!user)throw fail('Account not found.',404);
        const [[before]]=await sql.execute('SELECT * FROM user_profiles WHERE user_id=? FOR UPDATE',[userId]);
        if((before?.revision||0)!==body.revision)throw fail('Your profile changed in another session. Reload before trying again.',409);
        await validateProfilePin(sql,userId,body.pinned_product_id,before);
        const thumbnail=body.pinned_product_id!==null&&body.pinned_product_id===before?.pinned_product_id?before.pinned_thumbnail_id:null;
        await sql.execute('INSERT INTO user_profiles(user_id,display_name,bio,socials,avatar,banner,pinned_product_id,pinned_thumbnail_id,revision) VALUES (?,?,?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE pinned_product_id=VALUES(pinned_product_id),pinned_thumbnail_id=VALUES(pinned_thumbnail_id),revision=revision+1',[userId,user.username,'','[]',JSON.stringify(defaults.avatar),JSON.stringify(defaults.banner),body.pinned_product_id,thumbnail]);
        await sql.commit();
      }catch(error){await sql.rollback();throw error;}finally{sql.release();}
      res.json(await publicCreator(pool,userId,userId));
    });
    app.put('/api/profile', requireUser, (req, res, next) => upload(req, res, error => error ? res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Image exceeds the 20 MB upload limit.' : 'Invalid profile upload.' }) : next()), async (req, res) => {
        let raw;
        try {
            raw = JSON.parse(req.body?.profile);
        }
        catch {
            throw fail('Invalid profile data.');
        }
        const input = profileInput(raw), userId = req.user.id, prepared = [], reused = {};
        for (const slot of ['avatar', 'banner']) {
            const config = input[slot], file = req.files?.[slot + '_file']?.[0];
            if (file && config.kind !== 'upload')
                throw fail('Image upload does not match its selection.');
            if (config.kind === 'upload' || config.kind === 'roblox') {
                let bytes, sourceInfo = {};
                if (file)
                    bytes = file.buffer;
                else if (config.kind === 'roblox' && config.roblox_token) {
                    const ticket = roblox.ticket(userId, config.roblox_token);
                    bytes = ticket.bytes;
                    sourceInfo = { roblox_user_id: ticket.id, roblox_username: ticket.username };
                }
                else if (config.media_id) {
                    const [rows] = await pool.execute(`SELECT * FROM profile_media WHERE id=? AND owner_id=? AND slot=? AND COALESCE(JSON_EXTRACT(metadata,'$.permanently_deleted'),FALSE)=FALSE AND COALESCE(JSON_EXTRACT(metadata,'$.permanent_deletion_pending'),FALSE)=FALSE`, [config.media_id, userId, slot]);
                    if (!rows.length || rows[0].source !== config.kind)
                        throw fail('The image does not belong to this profile.', 403);
                    const m = rows[0];
                    if (slot === 'banner' || ['zoom', 'x', 'y'].every(k => parse(m.metadata).crop?.[k] === config.crop?.[k])) {
                        await readVerifiedStorageFile(profileMediaPath(m, 'display'), { sha256: m.display_sha256, byte_size: m.display_size });
                        reused[slot] = { ...config, ...(m.source === 'roblox' ? { roblox_user_id: parse(m.metadata).roblox_user_id, roblox_username: parse(m.metadata).roblox_username } : {}) };
                        continue;
                    }
                    bytes = await readVerifiedStorageFile(profileMediaPath(m, 'original'), { sha256: m.original_sha256, byte_size: m.original_size });
                    sourceInfo = parse(m.metadata);
                }
                else
                    throw fail('Select an image before saving.');
                const processed = await imageBytes(bytes, slot, config.crop);
                prepared.push({ slot, bytes, ...processed, metadata: { ...sourceInfo, crop: config.crop } });
            }
        }
        const pinFile = req.files?.pin_thumbnail?.[0];
        if (pinFile) {
            if (input.pinned_product_id === null || pinFile.buffer.length > 1024 * 1024)
                throw fail('Select a pinned item and a thumbnail up to 1 MB.');
            const image = await imageBytes(pinFile.buffer, 'avatar', { zoom: 1, x: 50, y: 50 });
            prepared.push({ slot: 'pin', bytes: pinFile.buffer, ...image, metadata: { product_id: input.pinned_product_id } });
        }

        const sql = await pool.getConnection(), operation = randomUUID(), created = [];
        let audit, committed = false, commitStarted = false;
        try {
            await sql.beginTransaction();
            const [users] = await sql.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
            if (!users.length)
                throw fail('Account not found.', 404);
            const [existing] = await sql.execute('SELECT * FROM user_profiles WHERE user_id=? FOR UPDATE', [userId]), before = existing[0];
            if ((before?.revision || 0) !== input.revision)
                throw fail('Your profile changed in another session. Reload before saving.', 409);
            await changeDisplayName(sql,userId,input.display_name);
            await validateProfilePin(sql,userId,input.pinned_product_id,before,{allowHidden:true,hasThumbnail:!!pinFile,requireThumbnail:true});
            const configurations = { avatar: reused.avatar || input.avatar, banner: reused.banner || input.banner };
            let thumbnail = input.pinned_product_id === null ? null : before?.pinned_thumbnail_id || null;
            for (const p of prepared) {
                const id = randomUUID(), media = { id, owner_id: userId, slot: p.slot, source: p.slot === 'pin' ? 'upload' : input[p.slot].kind, mime: p.mime, extension: p.extension, original_sha256: hash(p.bytes), original_size: p.bytes.length, display_sha256: hash(p.display), display_size: p.display.length, width: p.width, height: p.height, metadata: p.metadata };
                created.push({ media, original: p.bytes, display: p.display });
                if (p.slot === 'pin')
                    thumbnail = id;
                else
                    configurations[p.slot] = { kind: media.source, media_id: id, crop: input[p.slot].crop, ...(media.source === 'roblox' ? { roblox_user_id: p.metadata.roblox_user_id, roblox_username: p.metadata.roblox_username } : {}) };
            }
            if (created.length) {
                audit = await journal(sql);
                await audit.execute("INSERT INTO profile_media_operations(id,owner_id,state,descriptor) VALUES (?,?,'preparing',?)", [operation, userId, JSON.stringify(created.map(c => c.media))]);
            }
            for (const entry of created) {
                for (const role of ['original', 'display']) {
                    const file = await safeStoragePath(profileMediaPath(entry.media, role), { createParents: true }), handle = await fs.open(file, 'wx');
                    try {
                        await handle.writeFile(entry[role]);
                        await handle.sync();
                    }
                    finally {
                        await handle.close();
                    }
                    await readVerifiedStorageFile(profileMediaPath(entry.media, role), { sha256: role === 'original' ? entry.media.original_sha256 : entry.media.display_sha256, byte_size: entry[role].length });
                }
                const m = entry.media;
                await sql.execute('INSERT INTO profile_media(id,owner_id,slot,source,mime,extension,original_sha256,original_size,display_sha256,display_size,width,height,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [m.id, m.owner_id, m.slot, m.source, m.mime, m.extension, m.original_sha256, m.original_size, m.display_sha256, m.display_size, m.width, m.height, JSON.stringify(m.metadata)]);
            }
            await sql.execute('INSERT INTO user_profiles(user_id,display_name,bio,socials,avatar,banner,pinned_product_id,pinned_thumbnail_id,revision) VALUES (?,?,?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),bio=VALUES(bio),socials=VALUES(socials),avatar=VALUES(avatar),banner=VALUES(banner),pinned_product_id=VALUES(pinned_product_id),pinned_thumbnail_id=VALUES(pinned_thumbnail_id),revision=revision+1', [userId, input.display_name, input.bio, JSON.stringify(input.socials), JSON.stringify(configurations.avatar), JSON.stringify(configurations.banner), input.pinned_product_id, thumbnail]);                                                                                        
            commitStarted = true;
            await sql.commit();
            committed = true;
            if (audit)
                await audit.execute("UPDATE profile_media_operations SET state='committed',last_error=NULL WHERE id=?", [operation]).catch(() => console.warn('Profile journal recovery pending:', operation));
            res.json(await publicCreator(pool, userId, userId));
        }
        catch (error) {
            await sql.rollback().catch(() => { });
            if (audit && !committed && !commitStarted) {
                const [refs] = await audit.execute('SELECT id FROM profile_media WHERE id IN (' + (created.length ? created.map(() => '?').join(',') : 'NULL') + ')', created.map(c => c.media.id));
                if (!refs.length) {
                    for (const entry of created)
                        for (const role of ['original', 'display']) {
                            try {
                                await fs.unlink(await safeStoragePath(profileMediaPath(entry.media, role)));
                            }
                            catch (e) {
                                if (e.code !== 'ENOENT')
                                    console.error('Profile preparation needs recovery:', operation);
                            }
                        }
                    await audit.execute("UPDATE profile_media_operations SET state='failed',last_error=? WHERE id=?", [String(error.code || 'SAVE_FAILED').slice(0, 100), operation]);
                }
            }
            throw error;
        }
        finally {
            await audit?.end();
            sql.release();
        }
    });
}
