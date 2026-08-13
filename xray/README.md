# RIXZA X-Ray™ — Diagnostic Engine

The lead-generation core from the RIXZA blueprint (§6, §14–17): turn a visitor's
URL into a **Digital Performance Score /100**, six weighted dimensions, three
prioritized opportunities, and a path to a strategic call.

Built as a **zero-dependency Node.js service** (Node 20+, built-in `fetch`). It
runs fully with **no API keys** using deterministic checks + heuristic
performance estimation, and lights up further when keys are provided — matching
the blueprint's "maximize perceived intelligence, minimize custom infrastructure"
goal (§14) and the "what NOT to build in V1" list (§16).

## Quick start

```bash
cd xray
node server.js          # → http://localhost:8787
# optional, for keys/CRM: cp .env.example .env  &&  edit
```

One-shot analysis from the terminal:

```bash
node cli.js https://stripe.com "Stripe" "Services professionnels"
npm test                # end-to-end smoke test + report-shape assertions
```

## The flow (blueprint §15)

```
URL → fetch (server-side) → robots/sitemap → HTML signals → PageSpeed
    → weighted scoring engine → opportunities → AI interpretation
    → teaser (score gate) → lead capture → full report → CRM
```

## API

| Method | Route | Body | Returns |
|---|---|---|---|
| `GET`  | `/api/xray/health` | — | status + capabilities |
| `POST` | `/api/xray/analyze` | `{ url, company?, industry? }` | `{ id, teaser }` |
| `POST` | `/api/xray/unlock`  | `{ id, name, email }` | `{ full, lead }` |

`analyze` returns only the **score + dimension bars** (the priorities, findings,
and actions are withheld). `unlock` captures the lead and returns the full
report — this is the email/name gate from §6.1 (steps 4–6) and §17 ("use the
audit result as the moment to capture email/name"). Add `?full=1` to `analyze`
to bypass the gate for testing.

Example:

```bash
curl -s localhost:8787/api/xray/analyze \
  -H 'content-type: application/json' \
  -d '{"url":"github.com","company":"GitHub"}'
```

## Scoring (blueprint §6.2 / §6.3)

| Dimension | Weight | Signals |
|---|---|---|
| Performance | 15% | HTTPS, TTFB, page weight, mixed content, PageSpeed/CWV |
| SEO Visibility | 20% | title, meta, H1, headings, canonical, indexability, schema, robots/sitemap, content depth |
| Conversion | 25% | CTAs, forms, booking, phone, WhatsApp, social proof, email path |
| Brand Authority | 15% | value-prop H1, Open Graph, content depth, credibility signals, favicon |
| User Experience | 15% | viewport, lang, internal nav, image alt, hierarchy, charset |
| Growth Infrastructure | 10% | analytics, Tag Manager, pixels, chat, connected booking |

Levels: **ELITE** 90–100 · **ADVANCED** 75–89 · **GROWTH** 60–74 · **REBUILD** 40–59 · **CRITICAL** 0–39.

A single weighted check list is the source of truth for **both** the dimension
scores and the technical findings, so the number and the "why" always agree.

## Optional integrations (all graceful — absence never breaks a scan)

- **`PAGESPEED_API_KEY`** — real Lighthouse performance + Core Web Vitals.
  Without it: performance is estimated from TTFB, page weight, and asset counts.
- **`GEMINI_API_KEY`** — Gemini (`gemini-2.5-flash`, multimodal, thinking off for
  speed) writes the executive interpretation and the screenshot/vision analysis.
  Without it: a deterministic, business-oriented summary is synthesized, vision skipped.
- **`SUPABASE_URL` + `SUPABASE_SERVICE_KEY`** — leads stored via Supabase REST.
  Without them: leads append to `./data/leads.jsonl`.

### Supabase table

```sql
create table xray_leads (
  id bigint generated always as identity primary key,
  name text, email text, company text, industry text, website text,
  score int, level text, source text default 'xray',
  created_at timestamptz default now()
);
```

## Frontend wiring

The site (`RIXZA Website v2 (FR).dc.html`) is already connected: `runScan()`
calls `/api/xray/analyze`, and unlocking the report calls `/api/xray/unlock`
(capturing the lead). If the backend is unreachable, the audit falls back to a
seeded local simulation so the page still demos offline. Point the frontend at a
deployed engine with:

```html
<script>window.RIXZA_XRAY_API = 'https://xray.rixza.com';</script>
```

## Safety / cost controls

- SSRF guard: private, loopback, and link-local hosts are blocked.
- Caps: 12 s fetch timeout, 3 MB HTML, 5 redirects (§16 — no enterprise crawl).
- In-memory rate limit (20 analyses / 10 min / IP) and 30-min report cache.
```
