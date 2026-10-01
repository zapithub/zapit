// ────────────────────────────────────────────────────────────────
// ZAPIT — WhatsApp broadcast planning (Phase 8.3 — W-03)
//
// WhatsApp only allows free-form (session) messages inside the 24 hours that
// follow a customer's last inbound message. Outside it, the business must send
// an approved *template*. The old broadcast path ignored this entirely: it
// free-texted everyone and counted the gateway's refusals as "sent" failures,
// and a broadcast with `scheduled_for` was inserted and never executed.
//
// This module is the pure brain: who can be reached now, with what, and what the
// template payload must look like. All I/O stays in index.js.
// ────────────────────────────────────────────────────────────────

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** When was this contact last heard from? (accepts either column name) */
export function lastInboundAt(contact) {
  const raw = contact?.last_inbound_at || contact?.last_message_date || null;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Is the free-form (session) window still open? */
export function isInServiceWindow(contact, now = new Date()) {
  const t = lastInboundAt(contact);
  if (t === null) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= SERVICE_WINDOW_MS;
}

/** Split an audience into who can be free-texted now and who cannot. */
export function partitionByWindow(contacts = [], now = new Date()) {
  const inWindow = [];
  const outOfWindow = [];
  for (const c of contacts) (isInServiceWindow(c, now) ? inWindow : outOfWindow).push(c);
  return { inWindow, outOfWindow };
}

const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_RE = /^[a-z]{2}(?:_[A-Z]{2})?$/;

/**
 * Validate a template definition before it is stored or used.
 * `body` is our own record of the approved template (the gateway owns approval);
 * `{{1}}`… placeholders are substituted per recipient.
 * @returns {{ok: boolean, errors: string[], value?: object}}
 */
export function validateTemplate(input = {}) {
  const errors = [];
  const name = String(input.name || '').trim();
  const language = String(input.language || '').trim();
  const body = String(input.body || '').trim();
  const category = String(input.category || 'marketing').trim().toLowerCase();

  if (!TEMPLATE_NAME_RE.test(name)) errors.push('name must be lowercase letters, digits or underscores (max 512).');
  if (!LANGUAGE_RE.test(language)) errors.push("language must look like 'en' or 'en_US'.");
  if (body.length < 1 || body.length > 1024) errors.push('body is required (max 1024 characters).');
  if (!['marketing', 'utility', 'authentication'].includes(category)) errors.push('category must be marketing, utility or authentication.');

  const variables = body.match(/\{\{\s*(\d{1,3})\s*\}\}/g) || [];
  if (variables.length > 10) errors.push('a template body may use at most 10 variables.');

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    value: {
      name, language, body, category,
      variables: variables.map(v => Number(v.replace(/[^0-9]/g, ''))),
      status: ['approved', 'pending', 'rejected'].includes(String(input.status || '')) ? String(input.status) : 'approved',
    },
  };
}

/**
 * Fill a template body for one recipient. Positional `{{1}}`… are replaced by
 * params in order; missing params become '' so the gateway never receives the
 * literal placeholder (which it would reject).
 */
export function renderTemplateBody(template, params = []) {
  const body = String(template?.body || '');
  return body.replace(/\{\{\s*(\d{1,3})\s*\}\}/g, (_m, n) => {
    const value = params[Number(n) - 1];
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * The exact Cloud API payload for a template message.
 * @returns {{messaging_product:string, to:string, type:string, template:object}}
 */
export function templatePayload(template, to, params = []) {
  const components = params.length
    ? [{ type: 'body', parameters: params.map(text => ({ type: 'text', text: String(text ?? '') })) }]
    : [];
  return {
    messaging_product: 'whatsapp',
    to: String(to),
    type: 'template',
    template: {
      name: String(template?.name || ''),
      language: { code: String(template?.language || 'en') },
      ...(components.length ? { components } : {}),
    },
  };
}

/** Personalise free text the way the old broadcast did. */
export function renderFreeText(message, contact) {
  return String(message || '').replace(/\{name\}/g, contact?.name || 'there');
}

/**
 * Decide, per recipient, what to send now.
 *
 * @param {{contacts: object[], message?: string, template?: object|null, now?: Date}} args
 * @returns {{
 *   send: Array<{contact: object, mode: 'text'|'template', text?: string, payload?: object}>,
 *   skipped: Array<{contact: object, reason: 'outside_24h_window'}>,
 *   counts: {total: number, text: number, template: number, skipped_window: number}
 * }}
 */
export function planBroadcast({ contacts = [], message = '', template = null, now = new Date() }) {
  const { inWindow, outOfWindow } = partitionByWindow(contacts, now);
  const send = [];
  const skipped = [];

  for (const contact of inWindow) {
    send.push({ contact, mode: 'text', text: renderFreeText(message, contact) });
  }
  if (template) {
    for (const contact of outOfWindow) {
      const params = (template.variables || []).map(() => contact.name || 'there');
      send.push({
        contact, mode: 'template', payload: templatePayload(template, contact.phone, params.length ? params : [contact.name || 'there']),
        text: renderTemplateBody(template, params.length ? params : [contact.name || 'there']),
      });
    }
  } else {
    for (const contact of outOfWindow) skipped.push({ contact, reason: 'outside_24h_window' });
  }

  // Send to the people we can reach regardless of order, but keep it stable.
  return {
    send, skipped,
    counts: {
      total: contacts.length,
      text: send.filter(s => s.mode === 'text').length,
      template: send.filter(s => s.mode === 'template').length,
      skipped_window: skipped.length,
    },
  };
}

/** A short, honest status line for the dashboard/broadcast record. */
export function broadcastOutcomeMessage({ counts, sent, failed }) {
  const parts = [`Sent to ${sent}/${counts.total}`];
  if (counts.template) parts.push(`${counts.template} via template`);
  if (counts.skipped_window) parts.push(`${counts.skipped_window} skipped (outside the 24h window — attach a template to reach them)`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}
