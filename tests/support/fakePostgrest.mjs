// Minimal in-memory PostgREST stand-in — enough of the REST surface for the
// Phase 8.2 order loop (select/insert/update/upsert/delete + one RPC).
import http from 'node:http';

const db = {
  business_settings: [{
    user_id: 'u1', business_name: 'Ada Foods', connection_method: 'individual',
    wa_phone_number_id: '555000111',
    // Encrypted with the dev ENCRYPTION_KEY used by the smoke runner, so the
    // individual-channel send path runs for real (the graph call itself fails —
    // the sandbox has no egress — but the outbound text is produced and stored).
    wa_access_token: process.env.SEED_WA_TOKEN || null, auto_reply: true,
    welcome_message: 'Welcome {name}! How can we help?', reply_count: 0,
    delivery_fee: 500, bank_details: 'GTBank\n0123456789\nAda Foods Ltd',
    paystack_secret_key: null, payment_methods: ['cash'],
    paystack_public_key: 'pk_test_tenant',
  }],
  products: [
    { id: 'p1', user_id: 'u1', name: 'Rice', price: 2500, currency: 'NGN', is_active: true, stock_quantity: 100 },
    { id: 'p2', user_id: 'u1', name: 'Beans', price: 1800, currency: 'NGN', is_active: true, stock_quantity: 50 },
  ],
  subscriptions: [{ id: 's1', user_id: 'u1', plan: 'free', status: 'active', billing_cycle: 'free' }],
  contacts: [], conversations: [], messages: [], order_drafts: [], orders: [], webhook_events: [], usage_counters: [], transactions: [],
};
const seq = {};
const nextId = (t) => { seq[t] = (seq[t] || 0) + 1; return `${t}-${seq[t]}`; };
const log = [];

function matches(row, params) {
  for (const [k, v] of params) {
    if (['select', 'limit', 'offset', 'order', 'on_conflict', 'columns'].includes(k)) continue;
    if (!v.startsWith('eq.')) continue;
    const want = v.slice(3);
    if (String(row[k]) !== want) return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const params = [...url.searchParams.entries()];
  const single = String(req.headers.accept || '').includes('vnd.pgrst.object');
  const inserted = [];
  const respond = (data, code = 200, extra = {}) => {
    const payload = single ? (Array.isArray(data) ? data[0] ?? null : data) : (Array.isArray(data) ? data : [data]);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max((data?.length || 1) - 1, 0)}/*`, ...extra });
    res.end(payload === null ? '' : JSON.stringify(payload));
  };

  if (!db[table] && !table.startsWith('rpc/')) { respond([]); return; }

  try {
    if (table.startsWith('rpc/')) {
      const fn = table.slice(4);
      log.push({ method: req.method, fn, body: body ? JSON.parse(body) : null });
      if (fn === 'consume_usage') { respond({ allowed: true, used: 1, limit: 100 }); return; }
      respond({ ok: true }); return;
    }
    log.push({ method: req.method, table, params, body: body ? JSON.parse(body) : null });

    if (req.method === 'GET') {
      let rows = db[table].filter(r => matches(r, params));
      const limit = Number(params.find(p => p[0] === 'limit')?.[1] || 0);
      if (limit) rows = rows.slice(0, limit);
      respond(rows); return;
    }
    if (req.method === 'POST') {
      const payload = JSON.parse(body || '[]');
      const rows = Array.isArray(payload) ? payload : [payload];
      const upsert = String(req.headers.prefer || '').includes('merge-duplicates');
      const out = [];
      for (const r of rows) {
        if (upsert) {
          const key = { order_drafts: ['user_id', 'contact_id'], business_settings: ['user_id'], subscriptions: ['user_id'] }[table];
          const hit = key && db[table].find(x => key.every(k => x[k] === r[k]));
          if (hit) { Object.assign(hit, r); out.push(hit); continue; }
        }
        const row = { id: r.id || nextId(table), created_at: r.created_at || new Date().toISOString(), ...r };
        db[table].push(row); out.push(row);
      }
      inserted.push(...out);
      respond(out, 201, { Prefer: 'return=representation' }); return;
    }
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body || '{}');
      const rows = db[table].filter(r => matches(r, params));
      rows.forEach(r => Object.assign(r, patch));
      respond(rows); return;
    }
    if (req.method === 'DELETE') {
      const keep = db[table].filter(r => !matches(r, params));
      const removed = db[table].length - keep.length;
      db[table] = keep;
      respond(removed); return;
    }
    respond([]);
  } catch (e) { res.writeHead(500); res.end(JSON.stringify({ message: e.message, code: 'FAKE' })); }
});

export function start(port = 54321) {
  // Read the seed token at start time (the caller sets it just before starting).
  db.business_settings[0].wa_access_token = process.env.SEED_WA_TOKEN || db.business_settings[0].wa_access_token || null;
  db.business_settings[0].paystack_secret_key = process.env.SEED_PAYSTACK_KEY || db.business_settings[0].paystack_secret_key || null;
  return new Promise(resolve => server.listen(port, '0.0.0.0', () => resolve({
    db, log,
    stop: () => new Promise(r => server.close(r)),
  })));
}
