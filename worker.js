/**
 * RCLoot Visualizer — Cloudflare Worker
 *
 * Secrets (set via wrangler secret put):
 *   GUILD_PASSWORD  — read-only access (list + load sessions)
 *   ADMIN_PASSWORD  — full access (list + load + save + rename + delete)
 *
 * Binding:
 *   LOOT_BUCKET — R2 bucket
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Guild-Password',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function err(message, status = 400) {
  return json({ error: message }, status);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── AUTH ────────────────────────────────────────────────────────────────
    const supplied = request.headers.get('X-Guild-Password') || '';
    const isAdmin  = env.ADMIN_PASSWORD  && supplied === env.ADMIN_PASSWORD;
    const isMember = env.GUILD_PASSWORD  && supplied === env.GUILD_PASSWORD;

    if (!isAdmin && !isMember) {
      return err('Invalid password', 401);
    }

    // ── /me — return role so the UI can show/hide admin controls ────────────
    const url    = new URL(request.url);
    const method = request.method;

    if (url.pathname === '/me' && method === 'GET') {
      return json({ role: isAdmin ? 'admin' : 'member' });
    }

    // ── ROUTE ───────────────────────────────────────────────────────────────
    const parts = url.pathname.replace(/^\/+/, '').split('/');
    if (parts[0] !== 'sessions') return err('Not found', 404);
    const key = parts.slice(1).join('/');

    // Writes require admin
    if ((method === 'PUT' || method === 'DELETE') && !isAdmin) {
      return err('Admin access required', 403);
    }

    // LIST
    if (method === 'GET' && !key) {
      const list     = await env.LOOT_BUCKET.list();
      const sessions = list.objects
        .sort((a, b) => b.key.localeCompare(a.key))
        .map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded }));
      return json(sessions);
    }

    // GET ONE
    if (method === 'GET' && key) {
      const obj = await env.LOOT_BUCKET.get(key);
      if (!obj) return err('Session not found', 404);
      return new Response(await obj.text(), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // SAVE
    if (method === 'PUT' && key) {
      const body = await request.text();
      try { JSON.parse(body); } catch { return err('Invalid JSON'); }
      await env.LOOT_BUCKET.put(key, body, {
        httpMetadata: { contentType: 'application/json' },
      });
      return json({ saved: key });
    }

    // DELETE
    if (method === 'DELETE' && key) {
      await env.LOOT_BUCKET.delete(key);
      return json({ deleted: key });
    }

    return err('Method not allowed', 405);
  },
};
