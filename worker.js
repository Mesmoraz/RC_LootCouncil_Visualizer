/**
 * RCLoot Visualizer — Cloudflare Worker
 *
 * Bindings required (set in wrangler.toml + dashboard):
 *   env.LOOT_BUCKET  — R2 bucket binding
 *   env.GUILD_PASSWORD — Secret (set via: wrangler secret put GUILD_PASSWORD)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Guild-Password',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Auth — every request must carry the guild password
    const supplied = request.headers.get('X-Guild-Password');
    if (!supplied || supplied !== env.GUILD_PASSWORD) {
      return err('Invalid password', 401);
    }

    const url   = new URL(request.url);
    const parts = url.pathname.replace(/^\/+/, '').split('/');
    // Expected routes:
    //   GET    /sessions          — list all sessions
    //   GET    /sessions/:key     — fetch one session
    //   PUT    /sessions/:key     — save a session
    //   DELETE /sessions/:key     — delete a session

    if (parts[0] !== 'sessions') {
      return err('Not found', 404);
    }

    const key = parts.slice(1).join('/');

    // ── LIST ──────────────────────────────────────────────────────────────
    if (request.method === 'GET' && !key) {
      const list = await env.LOOT_BUCKET.list();
      const sessions = list.objects
        .sort((a, b) => b.key.localeCompare(a.key))
        .map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded }));
      return json(sessions);
    }

    // ── GET ONE ───────────────────────────────────────────────────────────
    if (request.method === 'GET' && key) {
      const obj = await env.LOOT_BUCKET.get(key);
      if (!obj) return err('Session not found', 404);
      const body = await obj.text();
      return new Response(body, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── SAVE ──────────────────────────────────────────────────────────────
    if (request.method === 'PUT' && key) {
      const body = await request.text();
      try { JSON.parse(body); } catch {
        return err('Request body is not valid JSON');
      }
      await env.LOOT_BUCKET.put(key, body, {
        httpMetadata: { contentType: 'application/json' },
      });
      return json({ saved: key });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (request.method === 'DELETE' && key) {
      await env.LOOT_BUCKET.delete(key);
      return json({ deleted: key });
    }

    return err('Method not allowed', 405);
  },
};
