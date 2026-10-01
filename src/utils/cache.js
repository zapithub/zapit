// Simple in-memory LRU cache for hot reads (e.g., getUserSubscription)
// Phase 2: avoids 16k QPS to Supabase on every authenticated request.
// Not distributed — per-instance, 60s TTL, invalidated on upgrade/webhook.

class LRU {
  constructor(max=1000, ttlMs=60_000) {
    this.max = max; this.ttl = ttlMs; this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.t > this.ttl) { this.map.delete(key); return undefined; }
    // refresh LRU order
    this.map.delete(key); this.map.set(key, e);
    return e.v;
  }
  set(key, v) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
    this.map.set(key, { v, t: Date.now() });
  }
  del(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

export const subscriptionCache = new LRU(2000, 60_000);
export const pricingCache = new LRU(500, 300_000); // 5m
