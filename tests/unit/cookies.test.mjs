// Phase 7.2 — S-09: httpOnly cookie auth path + double-submit CSRF
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AUTH_ACCESS_COOKIE, AUTH_REFRESH_COOKIE, CSRF_COOKIE, CSRF_HEADER, REFRESH_COOKIE_PATH,
  cookieSecurity, isMutating, newCsrfToken, serializeCookie, parseCookies, csrfMatches,
  authCookieHeaders, clearAuthCookieHeaders,
} from '../../src/utils/cookies.js';

console.log('▶ cookies.test (Phase 7.2 — S-09)');

// ── serialisation ────────────────────────────────────────────────
{
  const c = serializeCookie('a', 'b c', { maxAge:900, secure:true, sameSite:'lax', path:'/' });
  assert.ok(c.startsWith('a=b%20c;'), 'value is URL-encoded');
  assert.ok(c.includes('Path=/'));
  assert.ok(c.includes('HttpOnly'));
  assert.ok(c.includes('Secure'));
  assert.ok(c.includes('SameSite=Lax'));
  assert.ok(c.includes('Max-Age=900'));

  const plain = serializeCookie('n', 'v', { httpOnly:false, sameSite:null });
  assert.ok(!plain.includes('HttpOnly') && !plain.includes('SameSite'), 'opt-outs respected');
  assert.ok(serializeCookie('d', 'v', { domain:'zapit.ng' }).includes('Domain=zapit.ng'));
  assert.ok(serializeCookie('z', 'v', { maxAge:-5 }).includes('Max-Age=0'), 'negative max-age floors at 0');
  assert.ok(!serializeCookie('e', 'v', {}).includes('Max-Age'), 'no Max-Age when not finite');
}

// ── parsing ──────────────────────────────────────────────────────
{
  const cookies = parseCookies('zapit_at=abc; zapit_csrf=x%2By; empty=; junk');
  assert.equal(cookies.zapit_at, 'abc');
  assert.equal(cookies.zapit_csrf, 'x+y', 'values are decoded');
  assert.equal(cookies.empty, '');
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies('=nokey'), {});
}

// ── CSRF: double submit, timing-safe, mutating only ──────────────
{
  assert.equal(isMutating('POST'), true);
  assert.equal(isMutating('put'), true);
  assert.equal(isMutating('PATCH'), true);
  assert.equal(isMutating('DELETE'), true);
  assert.equal(isMutating('GET'), false);
  assert.equal(isMutating('HEAD'), false);
  assert.equal(isMutating('OPTIONS'), false);
  assert.equal(isMutating(undefined), false, 'missing method treated as safe');

  const token = newCsrfToken();
  assert.match(token, /^[A-Za-z0-9_-]{32}$/, '192 bits, URL-safe');
  assert.notEqual(newCsrfToken(), token);

  const req = (header, method = 'POST') => ({ method, headers: header ? { [CSRF_HEADER]: header } : {} });
  const jar = { [CSRF_COOKIE]: token };
  assert.equal(csrfMatches(req(token), jar), true);
  assert.equal(csrfMatches(req(token + 'x'), jar), false, 'mismatch rejected');
  assert.equal(csrfMatches(req(token.slice(0, 10)), jar), false, 'length mismatch rejected');
  assert.equal(csrfMatches(req(undefined), jar), false, 'missing header rejected');
  assert.equal(csrfMatches(req(token), {}), false, 'missing cookie rejected');
  assert.equal(csrfMatches({ method:'POST', headers:{ 'x-requested-with': token } }, jar), true, 'XHR fallback header accepted');
}

// ── cookie security profile is operator-configurable ────────────
{
  assert.deepEqual(cookieSecurity({ NODE_ENV:'production' }), { secure:true, sameSite:'lax', domain:null });
  assert.deepEqual(cookieSecurity({ NODE_ENV:'development' }), { secure:false, sameSite:'lax', domain:null });
  assert.equal(cookieSecurity({ NODE_ENV:'production', AUTH_COOKIE_SECURE:'false' }).secure, false, 'explicit override wins');
  assert.equal(cookieSecurity({ AUTH_COOKIE_SAMESITE:'None' }).sameSite, 'none', 'case-insensitive');
  assert.equal(cookieSecurity({ AUTH_COOKIE_SAMESITE:'bogus' }).sameSite, 'lax', 'invalid falls back to lax');
  assert.equal(cookieSecurity({ AUTH_COOKIE_DOMAIN:'api.zapit.ng' }).domain, 'api.zapit.ng');
}

// ── headers: access+refresh unreadable, CSRF readable, refresh scoped ──
{
  const env = { NODE_ENV:'production' };
  const headers = authCookieHeaders({ accessToken:'AT', refreshToken:'RT', accessMaxAge:900, refreshMaxAge:2592000, csrfToken:'CS', env });
  assert.equal(headers.length, 3);

  const access  = headers.find(h => h.startsWith(AUTH_ACCESS_COOKIE + '='));
  const refresh = headers.find(h => h.startsWith(AUTH_REFRESH_COOKIE + '='));
  const csrf    = headers.find(h => h.startsWith(CSRF_COOKIE + '='));

  assert.ok(access.includes('HttpOnly') && access.includes('Path=/') && access.includes('Max-Age=900'));
  assert.ok(refresh.includes('HttpOnly') && refresh.includes(`Path=${REFRESH_COOKIE_PATH}`), 'refresh cookie only reaches /auth');
  assert.ok(!csrf.includes('HttpOnly'), 'CSRF cookie must be readable by JS');
  for (const h of headers) { assert.ok(h.includes('Secure'), 'Secure in production'); assert.ok(h.includes('SameSite=Lax')); }

  const cleared = clearAuthCookieHeaders({ env });
  assert.equal(cleared.length, 3);
  for (const h of cleared) assert.ok(h.includes('Max-Age=0'), 'logout expires every cookie');
  assert.ok(authCookieHeaders({ accessToken:'a', refreshToken:'r', env:{ NODE_ENV:'development' } }).every(h => !h.includes('Secure')), 'no Secure on http dev');
}

// ── wiring: API accepts cookies, frontend stops leaking tokens ───
{
  const src = fs.readFileSync('index.js', 'utf8');
  assert.ok(src.includes('parseCookies(req.headers.cookie)'), 'API reads the cookie jar');
  assert.ok(src.includes('const token       = bearer || cookieToken'), 'cookie is a first-class credential');
  assert.ok(src.includes('!bearer && isMutating(req.method) && !csrfMatches(req, cookies)'), 'cookie auth enforces CSRF on writes');
  assert.ok(src.includes('setAuthCookies(res,') && src.includes('clearAuthCookies(res)'), 'cookies are issued and cleared');
  assert.ok(src.includes("req.authVia = bearer ? 'bearer' : 'cookie'"), 'auth carrier is recorded');
  assert.ok(src.includes('req.body?.refresh_token || parseCookies(req.headers.cookie)[AUTH_REFRESH_COOKIE]'), 'refresh accepts the httpOnly cookie');

  const dash = fs.readFileSync('dashboard.html', 'utf8');
  assert.ok(dash.includes("credentials: 'include'"), 'dashboard sends cookies');
  assert.ok(dash.includes("h['X-CSRF-Token'] = csrf"), 'dashboard echoes the CSRF token');
  assert.ok(dash.includes('await tryRefreshToken()'), 'reload bootstraps through the cookie refresh');
  assert.ok(dash.includes('await bootstrapSession()'), 'bootstrap is awaited');
  assert.ok(!dash.includes("params.get('token')") || dash.includes('Legacy ?token= hand-off'), 'URL tokens are legacy-only');

  const login = fs.readFileSync('login.html', 'utf8');
  assert.ok(!login.includes("params.toString()"), 'login no longer builds ?token= URLs');
  assert.ok(login.includes("credentials: 'include'"), 'login receives the cookies');
  assert.ok(!/dashboard\.html\?/.test(login), 'login redirects to a clean dashboard URL');
}

console.log('✅ cookies.test passed');
