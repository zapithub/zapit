// Phase 8.1 — W-02/W-04: every inbound message is processed, welcome is once,
// opt-out/opt-in are honoured and a human takeover silences the bot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractInboundMessages, messageTextOf, normalizeKeyword, classifyOptKeyword, isGreetingOnly,
  shouldWelcome, isBotPaused, takeoverFields, resumeFields, optOutFields, optInFields,
  STOP_CONFIRMATION, START_CONFIRMATION, MAX_MESSAGES_PER_DELIVERY, TAKEOVER_PAUSE_HOURS,
} from '../../src/utils/inbound.js';

console.log('▶ inbound.test (Phase 8.1 — W-02/W-04)');

const msg = (id, from, body, type = 'text') => (
  type === 'text'
    ? { id, from, type, text: { body } }
    : { id, from, type, [type]: { caption: body } }
);
const delivery = (phoneNumberId, messages, name = 'Ada') => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA',
    changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ profile: { name }, wa_id: messages[0]?.from }],
      messages,
    } }],
  }],
});

// ── W-04: a batch is fully unpacked, in order ───────────────────
{
  const one = extractInboundMessages(delivery('555', [msg('w1', '234800', 'hello')]));
  assert.equal(one.length, 1);
  assert.equal(one[0].msgId, 'w1');
  assert.equal(one[0].phoneNumberId, '555');
  assert.equal(one[0].customerName, 'Ada');
  assert.equal(one[0].from, '234800');

  // The regression: the old handler read only entry[0].changes[0].value.messages[0]
  const burst = {
    object: 'whatsapp_business_account',
    entry: [
      { id: 'A', changes: [
        { field: 'messages', value: { metadata: { phone_number_id: '555' }, contacts: [{ profile: { name: 'Ada' } }], messages: [msg('a1', '234800', 'hi'), msg('a2', '234800', 'how much is rice?')] } },
        { field: 'messages', value: { metadata: { phone_number_id: '555' }, contacts: [{ profile: { name: 'Ada' } }], messages: [msg('a3', '234800', 'and beans?')] } },
      ] },
      { id: 'B', changes: [
        { field: 'messages', value: { metadata: { phone_number_id: '556' }, contacts: [{ profile: { name: 'Bola' } }], messages: [msg('b1', '234900', 'hello there')] } },
      ] },
    ],
  };
  const all = extractInboundMessages(burst);
  assert.equal(all.length, 4, 'every message in every entry/change is processed');
  assert.deepEqual(all.map(m => m.msgId), ['a1', 'a2', 'a3', 'b1'], 'in delivery order');
  assert.deepEqual(all.map(m => m.phoneNumberId), ['555', '555', '555', '556']);
  assert.equal(all[3].customerName, 'Bola');

  // Status-only deliveries carry no messages
  const statuses = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'read' }], metadata: { phone_number_id: '555' } } }] }] };
  assert.deepEqual(extractInboundMessages(statuses), []);

  // Unusable messages are skipped; garbage never throws
  const junk = { entry: [{ changes: [{ value: { messages: [{ type: 'text' }, null, msg('ok', '234', 'hi')], metadata: { phone_number_id: '555' } } }] }] };
  assert.deepEqual(extractInboundMessages(junk).map(m => m.msgId), ['ok']);
  assert.deepEqual(extractInboundMessages(undefined), []);
  assert.deepEqual(extractInboundMessages({}), []);
  assert.deepEqual(extractInboundMessages({ entry: 'nope' }), []);

  // A flood is capped (a delivery is never unbounded work)
  const flood = delivery('555', Array.from({ length: 250 }, (_, i) => msg(`f${i}`, '234800', 'hi')));
  assert.equal(extractInboundMessages(flood).length, MAX_MESSAGES_PER_DELIVERY);
  assert.equal(MAX_MESSAGES_PER_DELIVERY, 100);
}

// ── message types ───────────────────────────────────────────────
{
  assert.equal(messageTextOf(msg('1', '2', 'hello')), 'hello');
  assert.equal(messageTextOf({ type: 'button', button: { text: 'Buy now' } }), 'Buy now');
  assert.equal(messageTextOf({ type: 'interactive', interactive: { button_reply: { title: 'Yes' } } }), 'Yes');
  assert.equal(messageTextOf({ type: 'interactive', interactive: { list_reply: { title: 'Rice' } } }), 'Rice');
  assert.equal(messageTextOf(msg('1', '2', 'Look at this', 'image')), 'Look at this');
  assert.equal(messageTextOf({ type: 'image', image: {} }), '[image received]');
  assert.equal(messageTextOf({ type: 'contacts' }), '');
  assert.equal(messageTextOf(null), '');
}

// ── opt-out / opt-in keywords (W-04) ────────────────────────────
{
  assert.equal(normalizeKeyword('  STOP!  '), 'stop');
  assert.equal(normalizeKeyword('Opt-Out'), 'opt-out');
  assert.equal(normalizeKeyword('Do   Not   Message'), 'do not message');
  for (const t of ['STOP', 'stop', 'Stop!', '  unsubscribe ', 'UNSUBSCRIBE', 'opt out', 'Opt-Out', 'do not message', "Don't message", 'remove me', 'stop all']) {
    assert.equal(classifyOptKeyword(t).type, 'opt_out', `${t} → opt_out`);
  }
  for (const t of ['START', 'start', 'resume', 'subscribe', 'opt in']) {
    assert.equal(classifyOptKeyword(t).type, 'opt_in', `${t} → opt_in`);
  }
  // Sentences are not keywords — never unsubscribe a customer by accident
  for (const t of [
    'please stop by the shop tomorrow',
    'where can I stop to buy rice?',
    'I want to start selling on WhatsApp',
    'can you subscribe me to the newsletter?',
    'hello',
    '',
    null,
  ]) {
    assert.equal(classifyOptKeyword(t).type, null, `${JSON.stringify(t)} must not be a keyword`);
  }
  assert.equal(classifyOptKeyword('🙏 stop 🙏').type, 'opt_out', 'emoji/punctuation are stripped');
  assert.equal(classifyOptKeyword('x'.repeat(60)).type, null, 'a long message is never a bare keyword');
  assert.ok(STOP_CONFIRMATION.includes('START'), 'the STOP confirmation tells the customer how to return');
  assert.ok(START_CONFIRMATION.length > 10);
}

// ── greetings ───────────────────────────────────────────────────
{
  for (const t of ['hi', 'Hello', 'hey!', 'Good morning', 'good afternoon please', 'main menu']) {
    assert.equal(isGreetingOnly(t), true, `${t} is a greeting`);
  }
  for (const t of ['how much is rice?', 'hi do you deliver to Abuja?', 'stop']) {
    assert.equal(isGreetingOnly(t), false, `${t} needs an answer`);
  }
}

// ── W-02: welcome exactly once (the stale-row regression) ───────
{
  const settings = { welcomeMessage: 'Welcome to Ada Foods, {name}!' };
  assert.equal(shouldWelcome({ ...settings, contact: null }), true, 'brand-new contact gets the welcome');
  assert.equal(shouldWelcome({ ...settings, contact: { message_count: 1, welcomed_at: null } }), true, 'first message gets it');
  // The bug: the old handler kept the contact row read *before* the increment,
  // so message #2 looked like the first message and was welcomed again.
  const stale = { message_count: 1, welcomed_at: null };
  const fresh = { message_count: 2, welcomed_at: null };
  assert.equal(shouldWelcome({ ...settings, contact: stale }), true, 'the stale row is exactly what the old code used');
  assert.equal(shouldWelcome({ ...settings, contact: fresh }), false, 'the fixed path uses the incremented count');
  assert.equal(shouldWelcome({ ...settings, contact: { message_count: 5, welcomed_at: '2026-10-01T00:00:00Z' } }), false, 'welcomed_at is authoritative');
  assert.equal(shouldWelcome({ welcomeMessage: '   ', contact: null }), false, 'no welcome configured → nothing to send');
  assert.equal(shouldWelcome({ contact: null }), false);
}

// ── human takeover (W-04) ───────────────────────────────────────
{
  const now = new Date('2026-10-01T10:00:00Z');
  assert.equal(isBotPaused(null, now), false);
  assert.equal(isBotPaused({}, now), false);
  assert.equal(isBotPaused({ human_takeover: true }, now), true, 'explicit takeover always pauses');
  assert.equal(isBotPaused({ human_takeover: true, bot_paused_until: '2020-01-01T00:00:00Z' }, now), true, 'flag outlives the window');
  assert.equal(isBotPaused({ bot_paused_until: '2026-10-01T11:00:00Z' }, now), true);
  assert.equal(isBotPaused({ bot_paused_until: '2026-10-01T09:00:00Z' }, now), false, 'the pause expires');
  assert.equal(isBotPaused({ bot_paused_until: 'not-a-date' }, now), false, 'garbage never wedges the bot');
  assert.equal(isBotPaused({ human_takeover: false, bot_paused_until: null }, now), false);

  const take = takeoverFields(now);
  assert.equal(take.human_takeover, true);
  assert.equal(take.bot_paused_until, new Date(now.getTime() + TAKEOVER_PAUSE_HOURS * 3600 * 1000).toISOString());
  assert.equal(isBotPaused(take, now), true);
  assert.equal(isBotPaused(take, new Date(now.getTime() + 25 * 3600 * 1000)), true, 'until the merchant resumes');

  const resume = resumeFields(now);
  assert.equal(resume.human_takeover, false);
  assert.equal(resume.bot_paused_until, null);
  assert.equal(isBotPaused(resume, now), false);

  const out = optOutFields(now, 'keyword_stop');
  assert.equal(out.opted_out, true);
  assert.equal(out.opted_out_at, now.toISOString());
  assert.equal(out.opt_out_reason, 'keyword_stop');
  const back = optInFields(now);
  assert.equal(back.opted_out, false);
  assert.equal(back.opted_out_at, null);
}

// ── wiring: the webhook uses all of it ──────────────────────────
{
  const src = fs.readFileSync('index.js', 'utf8');
  assert.ok(src.includes('extractInboundMessages(body)'), 'the webhook unpacks the whole delivery');
  assert.ok(!src.includes("body.entry?.[0]?.changes?.[0]?.value"), 'the single-message read is gone');
  assert.ok(src.includes('for (const item of inbound)'), 'every message is processed');
  assert.ok(src.includes('async function handleInboundMessage('), 'one message = one handler');
  assert.ok(src.includes('claimWebhookEvent(supabase, \'whatsapp\''), 'per-message dedup (S-05) survives');
  assert.ok(src.includes('classifyOptKeyword(msgText)'), 'opt-out/opt-in keywords are honoured');
  assert.ok(src.includes('optOutFields(now,'), 'opt-out is recorded, not just flagged');
  assert.ok(src.includes('isBotPaused(conv, now)'), 'the bot respects a human takeover');
  assert.ok(src.includes('shouldWelcome({ welcomeMessage'), 'welcome is decided from the fresh count');
  assert.ok(src.includes("update({ welcomed_at:nowIso })"), 'welcome is marked as sent');
  assert.ok(src.includes("app.post('/whatsapp/conversations/:id/resume'"), 'a merchant can hand the chat back');
  assert.ok(src.includes('takeoverFields(new Date())'), 'a manual reply takes over the conversation');
  assert.ok(src.includes('metric:METRICS.REPLY'), 'reply quota accounting is unchanged (B-06)');

  const mig = fs.readFileSync('supabase/migrations/20261011_phase8_01_inbound_state.sql', 'utf8');
  for (const col of ['welcomed_at', 'opted_out_at', 'opt_out_reason', 'human_takeover', 'bot_paused_until']) {
    assert.ok(mig.includes(col), `migration adds ${col}`);
  }
  assert.ok(mig.includes('ADD COLUMN IF NOT EXISTS'), 'migration is idempotent');
}

console.log('✅ inbound.test passed');
