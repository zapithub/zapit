// Phase 8.3 — W-03: the 24h service window, templates, and scheduled broadcasts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SERVICE_WINDOW_MS, lastInboundAt, isInServiceWindow, partitionByWindow,
  validateTemplate, renderTemplateBody, templatePayload, renderFreeText,
  planBroadcast, broadcastOutcomeMessage,
} from '../../src/utils/broadcast.js';

console.log('▶ broadcast.test (Phase 8.3 — W-03)');

const INDEX = fs.readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
const MIGRATION = fs.readFileSync(new URL('../../supabase/migrations/20261013_phase8_03_templates_and_broadcast_runs.sql', import.meta.url), 'utf8');

const NOW = new Date('2026-10-01T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000).toISOString();
const CONTACTS = [
  { id: 'c1', name: 'Ada', phone: '2348000000001', last_message_date: hoursAgo(1) },   // in window
  { id: 'c2', name: 'Bola', phone: '2348000000002', last_message_date: hoursAgo(23.9) }, // just inside
  { id: 'c3', name: 'Chidi', phone: '2348000000003', last_message_date: hoursAgo(25) },  // outside
  { id: 'c4', name: 'Dayo', phone: '2348000000004', last_message_date: null },           // never messaged
  { id: 'c5', name: 'Eka', phone: '2348000000005', last_inbound_at: hoursAgo(2) },       // alternate column
];

// ── the window ──────────────────────────────────────────────────
{
  assert.equal(SERVICE_WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.equal(isInServiceWindow(CONTACTS[0], NOW), true);
  assert.equal(isInServiceWindow(CONTACTS[1], NOW), true);       // 23.9h — still open
  assert.equal(isInServiceWindow(CONTACTS[2], NOW), false);      // 25h — closed
  assert.equal(isInServiceWindow(CONTACTS[3], NOW), false);      // never messaged
  assert.equal(isInServiceWindow({ last_inbound_at: hoursAgo(1) }, NOW), true);
  // a clock-skewed future timestamp must not open a window
  assert.equal(isInServiceWindow({ last_message_date: new Date(NOW.getTime() + 60000).toISOString() }, NOW), false);
  assert.equal(isInServiceWindow({}, NOW), false);
  assert.equal(lastInboundAt({ last_message_date: 'not-a-date' }), null);
  assert.equal(lastInboundAt({ last_message_date: hoursAgo(1) }), NOW.getTime() - 3600 * 1000);
  // exactly 24h is still inside; one milli after is not
  assert.equal(isInServiceWindow({ last_message_date: new Date(NOW.getTime() - SERVICE_WINDOW_MS).toISOString() }, NOW), true);
  assert.equal(isInServiceWindow({ last_message_date: new Date(NOW.getTime() - SERVICE_WINDOW_MS - 1).toISOString() }, NOW), false);

  const { inWindow, outOfWindow } = partitionByWindow(CONTACTS, NOW);
  assert.deepEqual(inWindow.map(c => c.id), ['c1', 'c2', 'c5']);
  assert.deepEqual(outOfWindow.map(c => c.id), ['c3', 'c4']);
}

// ── template validation ─────────────────────────────────────────
{
  const good = validateTemplate({ name: 'promo_october', language: 'en', body: 'Hi {{1}}, we have a sale!', category: 'marketing' });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.variables, [1]);
  assert.equal(good.value.status, 'approved');

  assert.equal(validateTemplate({ name: 'Promo October', language: 'en', body: 'x' }).ok, false);
  assert.equal(validateTemplate({ name: 'promo', language: 'en-US', body: 'x' }).ok, false);
  assert.equal(validateTemplate({ name: 'promo', language: 'en', body: '' }).ok, false);
  assert.equal(validateTemplate({ name: 'promo', language: 'en', body: 'x', category: 'spam' }).ok, false);
  assert.match(validateTemplate({ name: 'Promo October', language: 'en', body: 'x' }).errors.join(' '), /name/);
  assert.match(validateTemplate({ name: 'promo', language: 'en-US', body: 'x' }).errors.join(' '), /language/);
  const many = validateTemplate({ name: 'promo', language: 'en', body: Array.from({ length: 11 }, (_, i) => `{{${i + 1}}}`).join(' ') });
  assert.equal(many.ok, false);
  assert.equal(validateTemplate({ name: 'promo_en', language: 'en_US', body: 'Hello' }).ok, true);
}

// ── rendering ───────────────────────────────────────────────────
{
  const template = { name: 'promo_october', language: 'en', body: 'Hi {{1}}, {{2}} is back!' };
  assert.equal(renderTemplateBody(template, ['Ada', 'Rice']), 'Hi Ada, Rice is back!');
  assert.equal(renderTemplateBody(template, ['Ada']), 'Hi Ada,  is back!');   // missing param → empty, never "{{2}}"
  assert.equal(renderTemplateBody({ body: 'no placeholders' }, ['x']), 'no placeholders');

  const payload = templatePayload(template, '2348000000001', ['Ada', 'Rice']);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.to, '2348000000001');
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.name, 'promo_october');
  assert.equal(payload.template.language.code, 'en');
  assert.deepEqual(payload.template.components[0].parameters, [{ type: 'text', text: 'Ada' }, { type: 'text', text: 'Rice' }]);
  // no parameters → no components (Meta rejects an empty body component)
  assert.equal(templatePayload(template, '2348000000001', []).template.components, undefined);
  // the payload carries a type, never a free-text body outside the window
  assert.equal(payload.text, undefined);

  assert.equal(renderFreeText('Hello {name}, welcome!', CONTACTS[0]), 'Hello Ada, welcome!');
  assert.equal(renderFreeText('Hello {name}', {}), 'Hello there');
}

// ── planning a broadcast ────────────────────────────────────────
{
  const template = { name: 'promo_october', language: 'en', body: 'Hi {{1}}, sale!', variables: [1] };

  // No template: only in-window contacts are sent to, the rest are SKIPPED and
  // reported (the old code free-texted them and counted gateway refusals).
  const withoutTemplate = planBroadcast({ contacts: CONTACTS, message: 'Hi {name}!', now: NOW });
  assert.deepEqual(withoutTemplate.send.map(s => s.contact.id), ['c1', 'c2', 'c5']);
  assert.ok(withoutTemplate.send.every(s => s.mode === 'text'));
  assert.equal(withoutTemplate.send[0].text, 'Hi Ada!');
  assert.deepEqual(withoutTemplate.skipped.map(s => s.contact.id), ['c3', 'c4']);
  assert.ok(withoutTemplate.skipped.every(s => s.reason === 'outside_24h_window'));
  assert.deepEqual(withoutTemplate.counts, { total: 5, text: 3, template: 0, skipped_window: 2 });

  // With a template: outside-the-window contacts get the template.
  const withTemplate = planBroadcast({ contacts: CONTACTS, message: 'Hi {name}!', template, now: NOW });
  assert.deepEqual(withTemplate.send.map(s => `${s.contact.id}:${s.mode}`), ['c1:text', 'c2:text', 'c5:text', 'c3:template', 'c4:template']);
  assert.deepEqual(withTemplate.skipped, []);
  assert.equal(withTemplate.counts.template, 2);
  const chidi = withTemplate.send.find(s => s.contact.id === 'c3');
  assert.equal(chidi.payload.type, 'template');
  assert.deepEqual(chidi.payload.template.components[0].parameters, [{ type: 'text', text: 'Chidi' }]);
  assert.equal(chidi.text, 'Hi Chidi, sale!');       // what we record as sent

  // Everybody outside the window and no template → nothing to send at all.
  const allCold = planBroadcast({ contacts: CONTACTS.filter(c => c.id === 'c3'), message: 'hi', now: NOW });
  assert.equal(allCold.send.length, 0);
  assert.equal(allCold.counts.skipped_window, 1);

  const summary = broadcastOutcomeMessage({ counts: withTemplate.counts, sent: 4, failed: 1 });
  assert.match(summary, /Sent to 4\/5/);
  assert.match(summary, /2 via template/);
  const skippedSummary = broadcastOutcomeMessage({ counts: withoutTemplate.counts, sent: 3, failed: 0 });
  assert.match(skippedSummary, /2 skipped \(outside the 24h window/);
}

// ── the migration ───────────────────────────────────────────────
{
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS wa_templates/);
  assert.match(MIGRATION, /UNIQUE \(user_id, name, language\)/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  for (const col of ['template_id', 'failed_count', 'skipped_count', 'results', 'started_at', 'updated_at']) {
    assert.ok(MIGRATION.includes(`ADD COLUMN IF NOT EXISTS ${col}`), `broadcasts.${col} must be added`);
  }
  assert.match(MIGRATION, /idx_broadcasts_due/);
  assert.match(MIGRATION, /prune_wa_templates_unused/);
}

// ── wiring: the product actually uses all of this ───────────────
{
  assert.ok(INDEX.includes("from './src/utils/broadcast.js'"), 'broadcast utils are imported');
  assert.match(INDEX, /async function sendWATemplate\(/);
  assert.match(INDEX, /templatePayload\(template, to, params\)/);
  assert.match(INDEX, /async function runBroadcast\(/);
  assert.match(INDEX, /planBroadcast\(\{ contacts, message, template, now:new Date\(\) \}\)/);
  assert.match(INDEX, /loadBroadcastAudience/);
  assert.ok(INDEX.includes("eq('opted_out', false)") && INDEX.includes("eq('is_blocked', false)"), 'broadcasts never target opted-out contacts');
  assert.ok(INDEX.includes("app.get('/whatsapp/templates'") && INDEX.includes("app.post('/whatsapp/templates'") && INDEX.includes("app.delete('/whatsapp/templates/:id'"));
  assert.ok(INDEX.includes('validateTemplate(req.body || {})'));
  // scheduled broadcasts are executed, with a lease
  assert.ok(INDEX.includes("cron:send-broadcasts"));
  assert.match(INDEX, /\.eq\('status','scheduled'\)\.lte\('scheduled_for', nowIso\)/);
  assert.match(INDEX, /\.eq\('id', b\.id\)\.eq\('status','scheduled'\)\.select\(\)/);
  // no new .catch on builders (W-14 stays 0)
  assert.equal((INDEX.match(/\.catch\(/g) || []).length, 0);
}

console.log('✅ broadcast.test passed');
