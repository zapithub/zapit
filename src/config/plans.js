// ZAPIT — Single Source of Truth for Plans & Limits
// Phase 2: previously duplicated in index.js, index.html, pricing.html
// Import this everywhere. Pricing is derived from location at runtime.

export const PLAN_LIMITS = {
  free: {
    whatsapp_replies: 100, whatsapp_broadcasts: 0, whatsapp_contacts: 100,
    products_limit: 5, knowledge_base_limit: 20,
    video_generations: 3, image_generations: 5, text_posts: 10,
    scheduled_posts_limit: 10, schedule_days_ahead: 7, max_social_platforms: 2,
    ai_video_enabled: false, ai_image_enabled: true, analytics_enabled: false,
    brand_voice_enabled: false, excel_import_enabled: false,
    priority_support: false, remove_watermark: false, white_label: false,
    price: { NGN: 0, GHS: 0, KES: 0, ZAR: 0, USD: 0 },
  },
  creator: {
    whatsapp_replies: 1000, whatsapp_broadcasts: 200, whatsapp_contacts: 1000,
    products_limit: 30, knowledge_base_limit: 100,
    video_generations: 30, image_generations: 60, text_posts: 100,
    scheduled_posts_limit: 50, schedule_days_ahead: 15, max_social_platforms: 4,
    ai_video_enabled: true, ai_image_enabled: true, analytics_enabled: true,
    brand_voice_enabled: true, excel_import_enabled: false,
    priority_support: false, remove_watermark: true, white_label: false,
    price: { NGN: 10000, GHS: 150, KES: 1500, ZAR: 220, USD: 12 },
  },
  growth: {
    whatsapp_replies: 5000, whatsapp_broadcasts: 1000, whatsapp_contacts: 5000,
    products_limit: 150, knowledge_base_limit: 500,
    video_generations: 100, image_generations: 200, text_posts: 300,
    scheduled_posts_limit: 150, schedule_days_ahead: 30, max_social_platforms: 6,
    ai_video_enabled: true, ai_image_enabled: true, analytics_enabled: true,
    brand_voice_enabled: true, excel_import_enabled: true,
    priority_support: true, remove_watermark: true, white_label: false,
    price: { NGN: 25000, GHS: 375, KES: 3750, ZAR: 550, USD: 30 },
  },
  agency: {
    whatsapp_replies: 99999, whatsapp_broadcasts: 9999, whatsapp_contacts: 99999,
    products_limit: 9999, knowledge_base_limit: 9999,
    video_generations: 500, image_generations: 1000, text_posts: 1000,
    scheduled_posts_limit: 500, schedule_days_ahead: 30, max_social_platforms: 7,
    ai_video_enabled: true, ai_image_enabled: true, analytics_enabled: true,
    brand_voice_enabled: true, excel_import_enabled: true,
    priority_support: true, remove_watermark: true, white_label: true,
    price: { NGN: 50000, GHS: 750, KES: 7500, ZAR: 1100, USD: 60 },
  },
};

export const PLAN_ORDER = ['free', 'creator', 'growth', 'agency'];
export const PLAN_ICON = { free: '🎁', creator: '🚀', growth: '📈', agency: '🏢' };
export const PLAN_DESC = {
  free: 'Test the waters with zero risk',
  creator: 'For solo hustlers ready to scale',
  growth: 'For growing teams and busy stores',
  agency: 'For agencies managing multiple brands'
};

export const CURRENCY_SYMBOLS = { NGN:'₦', GHS:'GH₵', KES:'KSh', ZAR:'R', USD:'$', GBP:'£', EUR:'€' };
export const COUNTRY_CURRENCY = {
  NG:'NGN', GH:'GHS', KE:'KES', ZA:'ZAR',
  US:'USD', GB:'GBP', CA:'USD', AU:'USD', DE:'EUR', FR:'EUR', NL:'EUR'
};
export const COUNTRY_NAMES = {
  NG:'Nigeria', GH:'Ghana', KE:'Kenya', ZA:'South Africa',
  US:'the United States', GB:'the United Kingdom', CA:'Canada', AU:'Australia', DE:'Germany', FR:'France', NL:'the Netherlands'
};

export function formatPrice(amount, currency) {
  const sym = CURRENCY_SYMBOLS[currency] || currency;
  return `${sym}${new Intl.NumberFormat('en-US', { minimumFractionDigits:0, maximumFractionDigits:2 }).format(amount)}`;
}

// ── B-05: the charge currency is not always the display currency ───
// Paystack settles NGN, GHS, ZAR, KES and USD only. GBP/EUR are NOT supported,
// so a UK/EU visitor is charged the USD list price and must SEE USD — showing
// "£9.60" next to a $12 charge (the old `price[GBP] ?? price.USD`) both misled
// the customer and would have failed at the gateway.
export const PAYSTACK_CURRENCIES = ['NGN', 'GHS', 'ZAR', 'KES', 'USD'];

export function isChargeableCurrency(currency) {
  return PAYSTACK_CURRENCIES.includes(String(currency || '').toUpperCase());
}

/**
 * Single source of truth for "what does this plan cost, in which currency".
 * @returns {{amount:number, currency:string, requested_currency:string, converted:boolean}|null}
 */
export function resolvePlanPrice(plan, currency) {
  const data = PLAN_LIMITS[plan];
  if (!data || plan === 'free') return null;
  const wanted = String(currency || 'USD').toUpperCase();
  const table  = data.price || {};
  if (isChargeableCurrency(wanted) && Number.isFinite(table[wanted])) {
    return { amount: table[wanted], currency: wanted, requested_currency: wanted, converted: false };
  }
  if (!Number.isFinite(table.USD)) return null;
  return { amount: table.USD, currency: 'USD', requested_currency: wanted, converted: wanted !== 'USD' };
}

export function getPricingForLocation(location) {
  const requested = String(location?.currency || 'USD').toUpperCase();
  const plans = {};
  for (const [name, data] of Object.entries(PLAN_LIMITS)) {
    const resolved = name === 'free'
      ? { amount: 0, currency: isChargeableCurrency(requested) ? requested : 'USD', requested_currency: requested, converted: !isChargeableCurrency(requested) }
      : resolvePlanPrice(name, requested);
    const raw = resolved.amount;
    plans[name] = {
      name, ...data,
      price_raw: raw,
      price_formatted: formatPrice(raw, resolved.currency),
      price_annual: Math.round(raw * 12 * 0.80),
      price_annual_formatted: formatPrice(raw * 12 * 0.80, resolved.currency),
      // `currency` stays the DISPLAY currency actually charged, never a symbol we cannot settle.
      currency: resolved.currency,
      currency_symbol: CURRENCY_SYMBOLS[resolved.currency] || resolved.currency,
      requested_currency: resolved.requested_currency,
      currency_converted: resolved.converted,
      billing_note: resolved.converted && raw > 0 ? `Billed in USD — ${resolved.requested_currency} is not supported by our payment provider.` : null,
    };
  }
  return { location, plans, annual_discount: 0.20 };
}
