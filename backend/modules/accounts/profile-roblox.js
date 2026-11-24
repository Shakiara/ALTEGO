// ALTEGO necesita resolver los enlaces permitidos al perfil de Roblox.
// Este módulo reúne las operaciones y estructuras que atienden esa responsabilidad.
import { randomUUID } from 'node:crypto';
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
export function robloxAvatars(fetcher = fetch) {
    const cache = new Map(), tickets = new Map(), attempts = new Map();
    async function limited(url, options = {}, max = 128 * 1024) { const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) }); if (!response.ok)
        throw fail(response.status === 404 ? 'Roblox account was not found.' : response.status === 429 ? 'Roblox is busy. Please try again later.' : 'Roblox is temporarily unavailable.', response.status === 404 ? 404 : response.status === 429 ? 429 : 502); const chunks = []; let size = 0; for await (const chunk of response.body) {
        size += chunk.length;
        if (size > max)
            throw fail('Roblox returned an oversized response.');
        chunks.push(chunk);
    } return Buffer.concat(chunks); }
    async function json(url, options) { try {
        return JSON.parse((await limited(url, options)).toString());
    }
    catch (e) {
        if (e.status)
            throw e;
        throw fail('Roblox returned an incomplete response.');
    } }
    async function lookup(owner, query) {
        if (typeof query !== 'string' || !query.trim() || query.length > 30)
            throw fail('Enter a Roblox username or numeric User ID.', 400);
        query = query.trim();
        const numeric = /^\d+$/.test(query);
        if (numeric && (!Number.isSafeInteger(Number(query)) || Number(query) <= 0) || !numeric && !/^[A-Za-z0-9_]{3,20}$/.test(query))
            throw fail('Enter a valid Roblox username or User ID.', 400);
        const now = Date.now();
        for (const [k, v] of tickets)
            if (v.until < now)
                tickets.delete(k);
        for (const [k, v] of cache)
            if (v.until < now)
                cache.delete(k);
        const old = attempts.get(owner);
        const count = old && old.until > now ? old : { count: 0, until: now + 60000 };
        if (++count.count > 10)
            throw fail('Too many avatar searches. Try again in a minute.', 429);
        attempts.set(owner, count);
        const key = query.toLowerCase();
        let value = cache.get(key);
        if (!value) {
            try {
                let user;
                if (numeric)
                    user = await json('https://users.roblox.com/v1/users/' + Number(query));
                else {
                    const data = await json('https://users.roblox.com/v1/usernames/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usernames: [query], excludeBannedUsers: true }) });
                    const found = data.data?.[0];
                    if (!found)
                        throw fail('Roblox username was not found.', 404);
                    user = await json('https://users.roblox.com/v1/users/' + found.id);
                }
                if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.name !== 'string' || user.isBanned)
                    throw fail('This Roblox account is not available.', 404);
                const thumbnails = await json('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + user.id + '&size=420x420&format=Png&isCircular=false'), headshot = thumbnails.data?.find(t => t.targetId === user.id);
                if (headshot?.state !== 'Completed' || typeof headshot.imageUrl !== 'string')
                    throw fail('This Roblox headshot is not available yet.', 422);
                const url = new URL(headshot.imageUrl);
                if (url.protocol !== 'https:' || url.port || url.username || url.password || !(url.hostname === 'rbxcdn.com' || url.hostname.endsWith('.rbxcdn.com')))
                    throw fail('Roblox returned an invalid headshot address.');
                const bytes = await limited(url.href, {}, 5 * 1024 * 1024);
                value = { id: user.id, username: user.name, display_name: typeof user.displayName === 'string' ? user.displayName : user.name, bytes, until: now + 600000 };
                if (cache.size >= 30)
                    cache.delete(cache.keys().next().value);
                cache.set(key, value);
                cache.set(String(user.id), value);
            }
            catch (e) {
                if (e.status)
                    throw e;
                throw fail('Could not contact Roblox. Please try again.');
            }
        }
        if (tickets.size >= 60)
            tickets.delete(tickets.keys().next().value);
        const token = randomUUID();
        tickets.set(token, { ...value, owner, until: now + 900000 });
        return { token, id: value.id, username: value.username, display_name: value.display_name, preview_url: '/api/profile/roblox/previews/' + token };
    }
    function ticket(owner, token) { const value = tickets.get(token); if (!value || value.owner !== owner || value.until < Date.now())
        throw fail('The Roblox selection expired. Search again.', 400); return value; }
    return { lookup, ticket };
}
