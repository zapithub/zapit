// ────────────────────────────────────────────────────────────────
// ZAPIT — Inbound WhatsApp ingestion rules (Phase 8.1 — W-02/W-04)
//
// Pure logic for the webhook: unpack every message Meta sent (a single POST can
// carry many entries/changes/messages), recognise opt-out/opt-in keywords,
// decide when the welcome may be sent, and gate the bot while a human is in the
// conversation. No I/O here so the behaviour is unit-testable.
// ────────────────────────────────────────────────────────────────

/** WhatsApp's + our own opt-out vocabulary (the *whole* message must match). */
export const OPT_OUT_KEYWORDS = [
  'stop', 'stop all', 'stop messages', 'stop sending', 'unsubscribe', 'unsubscribe me',
  'opt out', 'optout', 'opt-out', 'do not message', 'dont message', "don't message",
  'no more messages', 'remove me', 'leave me alone', 'cancel messages',
];

export const OPT_IN_KEYWORDS = [
  'start', 'resume', 'unstop', 'subscribe', 'subscribe me', 'opt in', 'optin', 'opt-in',
  'message me again', 'send messages', 'yes i want messages',
];

export const STOP_CONFIRMATION =
  'You have been unsubscribed and will no longer receive messages from us. Reply START to opt back in.';

export const START_CONFIRMATION =
  'Welcome back — you are subscribed again and we will reply to your messages. 🙌';

/** How long the bot stays quiet after the business replies by hand. */
export const TAKEOVER_PAUSE_HOURS = 24;

/** A single webhook delivery is processed for at most this many messages. */
export const MAX_MESSAGES_PER_DELIVERY = 100;

/**
 * Unpack every inbound message from a Meta webhook payload.
 * Status-only deliveries (sent/delivered/read receipts) are ignored.
 * @returns {Array<{message:object, contact:object|null, phoneNumberId:string|null, customerName:string, from:string, msgId:string}>}
 */
export function extractInboundMessages(body, { maxMessages = MAX_MESSAGES_PER_DELIVERY } = {}) {
  const out = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      if (!messages.length) continue;                       // statuses-only
      const phoneNumberId = value?.metadata?.phone_number_id || null;
      const contact = Array.isArray(value?.contacts) ? value.contacts[0] : null;
      const customerName = contact?.profile?.name || 'Customer';
      for (const message of messages) {
        if (!message?.id || !message?.from) continue;       // nothing to dedup or answer
        out.push({ message, contact, phoneNumberId, customerName, from: message.from, msgId: message.id });
        if (out.length >= maxMessages) return out;
      }
    }
  }
  return out;
}

/** Text of any message type we can act on (text, button, interactive, captioned media). */
export function messageTextOf(message) {
  if (!message || typeof message !== 'object') return '';
  switch (message.type) {
    case 'text':        return message.text?.body || '';
    case 'button':      return message.button?.text || '';
    case 'interactive': return message.interactive?.button_reply?.title
                             || message.interactive?.list_reply?.title || '';
    case 'image': case 'video': case 'document': case 'audio':
      return message[message.type]?.caption || `[${message.type} received]`;
    default:            return '';
  }
}

/** Lower-case, punctuation/emoji-free, single-spaced. */
export function normalizeKeyword(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify a message as an opt-out / opt-in keyword.
 * The *whole* (normalised) message must be the keyword — "please stop by the
 * shop tomorrow" is a sentence, not an unsubscribe.
 */
export function classifyOptKeyword(text) {
  const norm = normalizeKeyword(text);
  if (!norm || norm.length > 40) return { type: null, keyword: null };
  if (OPT_OUT_KEYWORDS.includes(norm)) return { type: 'opt_out', keyword: norm };
  if (OPT_IN_KEYWORDS.includes(norm))  return { type: 'opt_in',  keyword: norm };
  return { type: null, keyword: null };
}

/** A bare greeting — used to avoid a welcome + AI reply double-message. */
export function isGreetingOnly(text) {
  const norm = normalizeKeyword(text);
  if (!norm) return false;
  return /^(hi|hey|hello|howdy|yo|good (morning|afternoon|evening|day)|hiya|sup|start|menu|main menu|help)( (there|please|pls))?$/.test(norm);
}

/**
 * Welcome exactly once, on the customer's first inbound message.
 * `welcomed_at` is authoritative; `message_count <= 1` is the legacy fallback
 * (the old code re-read a stale row and welcomed message #2 again — W-02).
 */
export function shouldWelcome({ welcomeMessage, contact } = {}) {
  if (!welcomeMessage || !String(welcomeMessage).trim()) return false;
  if (!contact) return true;
  if (contact.welcomed_at) return false;
  return Number(contact.message_count || 0) <= 1;
}

/** True while a human has taken over (explicit flag, or an unexpired pause). */
export function isBotPaused(conversation, now = new Date()) {
  if (!conversation) return false;
  if (conversation.human_takeover === true) return true;
  if (!conversation.bot_paused_until) return false;
  const until = new Date(conversation.bot_paused_until).getTime();
  return Number.isFinite(until) && until > now.getTime();
}

/** Fields written when the business replies by hand. */
export function takeoverFields(now = new Date(), hours = TAKEOVER_PAUSE_HOURS) {
  return {
    human_takeover: true,
    bot_paused_until: new Date(now.getTime() + hours * 3600 * 1000).toISOString(),
    last_message_at: now.toISOString(),
  };
}

/** Fields written when the bot is handed the conversation back. */
export function resumeFields(now = new Date()) {
  return { human_takeover: false, bot_paused_until: null, last_message_at: now.toISOString() };
}

export function optOutFields(now = new Date(), reason = 'keyword_stop') {
  return {
    opted_out: true,
    opted_out_at: now.toISOString(),
    opt_out_reason: String(reason).slice(0, 40),
    last_message_date: now.toISOString(),
  };
}

export function optInFields(now = new Date()) {
  return {
    opted_out: false,
    opted_out_at: null,
    opt_out_reason: null,
    last_message_date: now.toISOString(),
  };
}
