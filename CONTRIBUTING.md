# Contributing — ZAPIT

Thanks for helping build Africa's #1 WhatsApp + Content Automation Platform! This doc keeps the 5-phase quality bar high.

## Quick start

```bash
git clone https://github.com/zapithub/zapit.git && cd zapit
cp .env.example .env
npm install
npm run generate:pricing
npm run dev
npm test && npm run security:check   # must pass before PR
```

## Branch & phases

We work on `arena/01a0f67b-zapit` (this session) tracking 5 phases in `PROGRESS.md`. **Finish Phase N before N+1.** See `CONSULTANT_REVIEW.md` for 47 findings.

## Single sources of truth

- **Pricing/limits:** `src/config/plans.js` → `public/pricing.json` (`npm run generate:pricing`) → `index.js` + `index.html`.
- **Tokens/design:** `public/shared.css` (linked in all HTML). Edit there, not inline.
- **Validation:** `src/utils/validation.js` (isValidEmail, sanitizeStr, SCHEMAS). Import in routes; don't inline regex.

## Tests

- Unit: `tests/unit/*.test.mjs` (Node `assert`, no deps). Run `npm test`. Add a test for every new helper/route.
- Integration: `tests/integration/*.test.mjs` — requires `PORT=3000 node index.js` running. Run `npm run test:integration`.
- Security: `npm run security:check` (18 invariants) must pass in CI. Never re-introduce `zapit-secret-change-me` or `cb(null,true)` CORS fail-open.

## Commits

Conventional: `feat(phase-N): ...`, `fix: ...`, `docs: ...`. One phase per commit, pushed to `arena/01a0f67b-zapit`.

## PR checklist

- [ ] `npm run check` (syntax) green
- [ ] `npm test` green
- [ ] `npm run security:check` 18/18
- [ ] `npm run generate:pricing` if `src/config/plans.js` changed
- [ ] No `TODO`, no default secrets, no `*` CORS
- [ ] Docs updated (`README.md`, `docs/`)

## Deploy

Render: Build `npm install`, Start `npm start`, health `GET /health`. Set `NODE_ENV=production` — app will refuse weak secrets.
Docker: `docker compose up --build`

See `SECURITY.md` for reporting vulns.
