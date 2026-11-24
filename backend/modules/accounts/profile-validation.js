// ALTEGO necesita resolver la validación de los datos de perfil.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
export const presets = ['rose', 'lavender', 'peach', 'mint', 'cloud', 'dusk'];
export const platforms = { instagram: ['instagram.com'], youtube: ['youtube.com', 'youtu.be'], tiktok: ['tiktok.com'], roblox: ['roblox.com'], x: ['x.com', 'twitter.com'], twitch: ['twitch.tv'], discord: ['discord.com', 'discord.gg'], custom: [] };
const fail = message => Object.assign(new Error(message), { status: 400 });
export const textLength = value => Array.from(value).length;
export function crop(value = { zoom: 1, x: 50, y: 50 }) { if (!value || !['zoom', 'x', 'y'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k])) || value.zoom < 1 || value.zoom > 4 || value.x < 0 || value.x > 100 || value.y < 0 || value.y > 100)
    throw fail('Invalid image framing.'); return { zoom: value.zoom, x: value.x, y: value.y }; }
export function profileInput(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['revision', 'display_name', 'bio', 'socials', 'avatar', 'banner', 'pinned_product_id'].includes(k)))
        throw fail('Only public profile fields can be edited.');
    if (!Number.isSafeInteger(body.revision) || body.revision < 0)
        throw fail('Reload the profile before saving.');
    if (typeof body.display_name !== 'string' || !body.display_name.trim() || textLength(body.display_name.trim()) > 30 || /[\x00-\x1f\x7f<>]/.test(body.display_name))
        throw fail('Display Name must contain 1–30 characters.');
    if (typeof body.bio !== 'string' || textLength(body.bio) > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body.bio))
        throw fail('Bio must contain at most 500 characters.');
    if (!Array.isArray(body.socials) || body.socials.length > 5)
        throw fail('Use up to five social links.');
    const seen = new Set();
    const socials = body.socials.map(link => { if (!link || !Object.hasOwn(platforms, link.platform) || typeof link.label !== 'string' || !link.label.trim() || textLength(link.label.trim()) > 40 || /[<>\x00-\x1f]/.test(link.label) || typeof link.url !== 'string' || link.url.length > 2048)
        throw fail('Enter a valid social link name and URL.'); let url; try {
        url = new URL(link.url);
    }
    catch {
        throw fail('Enter a valid HTTPS URL.');
    } if (url.protocol !== 'https:' || !url.hostname || url.username || url.password)
        throw fail('External links must use HTTPS without embedded credentials.'); if (link.platform !== 'custom' && !platforms[link.platform].some(host => url.hostname === host || url.hostname.endsWith('.' + host)))
        throw fail('The URL does not match the selected platform.'); const id = link.id || randomUUID(); if (!/^[a-f0-9-]{36}$/.test(id) || seen.has(id))
        throw fail('Social link identifiers must be unique.'); seen.add(id); return { id, platform: link.platform, label: link.label.trim(), url: url.href }; });
    function image(slot, value) { if (!value || !['default', 'upload', ...(slot === 'avatar' ? ['roblox'] : ['preset'])].includes(value.kind))
        throw fail('Choose a valid ' + slot + ' source.'); if (value.kind === 'default')
        return { kind: 'default' }; if (value.kind === 'preset') {
        if (!presets.includes(value.preset))
            throw fail('Choose an available banner preset.');
        return { kind: 'preset', preset: value.preset };
    } if (value.media_id != null && !/^[a-f0-9-]{36}$/.test(value.media_id))
        throw fail('Invalid profile image.'); if (value.roblox_token != null && !/^[a-f0-9-]{36}$/.test(value.roblox_token))
        throw fail('Invalid Roblox selection.'); return { kind: value.kind, media_id: value.media_id || null, crop: crop(value.crop), ...(value.roblox_token ? { roblox_token: value.roblox_token } : {}) }; }
    const pin = body.pinned_product_id;
    if (pin !== null && (!Number.isSafeInteger(pin) || pin <= 0))
        throw fail('Choose a valid pinned item.');
    return { revision: body.revision, display_name: body.display_name.trim(), bio: body.bio, socials, avatar: image('avatar', body.avatar), banner: image('banner', body.banner), pinned_product_id: pin };
}
export async function imageBytes(bytes, slot, framing) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > (slot === 'avatar' ? 10 : 20) * 1024 * 1024)
        throw fail(slot === 'avatar' ? 'Avatar images must be at most 10 MB.' : 'Banner images must be at most 20 MB.');
    const signature = bytes.subarray(0, 12);
    if (!(signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || signature[0] === 255 && signature[1] === 216 && signature[2] === 255 || signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP'))
        throw fail('Use a PNG, JPEG or WebP image.');
    try {
        const metadata = await sharp(bytes, { limitInputPixels: 40000000, failOn: 'warning' }).metadata();
        if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1)
            throw fail('Use a still PNG, JPEG or WebP image.');
        const normalized = await sharp(bytes, { limitInputPixels: 40000000, failOn: 'warning' }).rotate().toBuffer({ resolveWithObject: true });
        const { width, height } = normalized.info;
        if (width < 16 || height < 16)
            throw fail('Use an image at least 16 × 16 pixels.');
        let display;
        if (slot === 'avatar') {
            const c = crop(framing), side = Math.max(1, Math.floor(Math.min(width, height) / c.zoom)), left = Math.round((width - side) * c.x / 100), top = Math.round((height - side) * c.y / 100);
            display = await sharp(normalized.data).extract({ left, top, width: side, height: side }).resize(512, 512).webp({ quality: 90 }).toBuffer();
        }
        else
            display = await sharp(normalized.data).resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
        return { display, width, height, mime: 'image/' + metadata.format, extension: metadata.format === 'jpeg' ? 'jpg' : metadata.format };
    }
    catch (error) {
        if (error.status)
            throw error;
        throw fail('The image is invalid, incomplete or too large to decode.');
    }
}
