// PA Handbook: shared store for "จัดงานเข้าหมวด" (work-to-category assignments).
// GET  /api/works            -> { docs: { <code>: <doc> } }
// POST /api/works            -> body { changes: { <code>: { unsorted|condo|lowrise|items: string[] } } }
// No login by design (the team chose "anyone with the link can edit"); every write keeps a one-step backup.
const seed = require('../seed-works.json');

const KEY = 'works.json';
const PREV = 'works-prev.json';
const FIELDS = ['unsorted', 'condo', 'lowrise', 'items'];
const MAX_ITEMS = 400;
const MAX_LEN = 160;

async function readBlob(blob, key) {
  try {
    const meta = await blob.head(key);
    const res = await fetch(meta.url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function clean(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list) {
    if (typeof x !== 'string') return null;
    const t = x.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
    if (t) out.push(t);
  }
  return out.length <= MAX_ITEMS ? out : null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const blob = await import('@vercel/blob');
    let docs = await readBlob(blob, KEY);

    if (req.method === 'GET') {
      if (!docs) docs = seed;
      return res.status(200).json({ docs });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      const changes = body && body.changes;
      if (!changes || typeof changes !== 'object') return res.status(400).json({ error: 'bad_request' });
      const base = docs || JSON.parse(JSON.stringify(seed));
      const codes = Object.keys(changes);
      if (codes.length > 400) return res.status(400).json({ error: 'too_many' });
      for (const code of codes) {
        const d = base[code];
        if (!d) return res.status(400).json({ error: 'unknown_code', code });
        const patch = changes[code];
        if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'bad_patch', code });
        for (const f of Object.keys(patch)) {
          if (!FIELDS.includes(f)) return res.status(400).json({ error: 'bad_field', code, field: f });
          const v = clean(patch[f]);
          if (!v) return res.status(400).json({ error: 'bad_value', code, field: f });
        }
      }
      const next = JSON.parse(JSON.stringify(base));
      for (const code of codes) {
        for (const f of Object.keys(changes[code])) next[code][f] = clean(changes[code][f]);
      }
      const opts = { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 };
      if (docs) await blob.put(PREV, JSON.stringify(docs), opts);
      await blob.put(KEY, JSON.stringify(next), opts);
      return res.status(200).json({ ok: true, saved: codes.length });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error', message: String(e && e.message || e).slice(0, 200) });
  }
};
