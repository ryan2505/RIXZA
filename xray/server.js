// RIXZA X-Ray HTTP API.
// Endpoints (CORS-enabled so the existing frontend can call it directly):
//   GET  /api/xray/health              -> engine status + capabilities
//   POST /api/xray/analyze  {url,...}  -> { id, teaser }   (score gate open)
//   POST /api/xray/unlock   {id,name,email} -> { full }    (captures lead)
// The full report is held in a short-lived in-memory cache keyed by id, so
// unlocking after lead capture doesn't trigger a second scan.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { config, capabilities } from './src/config.js';
import { analyze } from './src/analyze.js';
import { saveLead, saveContact } from './src/store.js';
import { HttpError } from './src/fetcher.js';

const cache = new Map(); // id -> { full, expires }
const CACHE_TTL = 30 * 60 * 1000;
const rate = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT = 20; // analyses per window
const RATE_WINDOW = 10 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
  for (const [k, v] of rate) if (v.resetAt < now) rate.delete(k);
}
setInterval(sweep, 60_000).unref();

function cors(res, origin) {
  const allow = config.corsOrigin === '*' ? '*' : config.corsOrigin;
  res.setHeader('access-control-allow-origin', allow === '*' ? '*' : origin && allow.includes(origin) ? origin : allow.split(',')[0]);
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('vary', 'origin');
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(new HttpError('Requête trop volumineuse.', 'TOO_LARGE', 413));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError('JSON invalide.', 'BAD_JSON', 400));
      }
    });
    req.on('error', reject);
  });
}

function checkRate(ip) {
  const now = Date.now();
  let r = rate.get(ip);
  if (!r || r.resetAt < now) { r = { count: 0, resetAt: now + RATE_WINDOW }; rate.set(ip, r); }
  r.count++;
  if (r.count > RATE_LIMIT)
    throw new HttpError('Trop de requêtes. Réessayez dans quelques minutes.', 'RATE_LIMITED', 429);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  cors(res, origin);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

  try {
    if (req.method === 'GET' && (path === '/' || path === '/api/xray/health')) {
      return send(res, 200, {
        service: 'rixza-xray',
        status: 'ok',
        capabilities: capabilities(),
        version: '1.0.0',
      });
    }

    if (req.method === 'POST' && path === '/api/xray/analyze') {
      checkRate(ip);
      const body = await readBody(req);
      if (!body.url) throw new HttpError('Le champ « url » est requis.', 'MISSING_URL', 400);
      const { teaser, full } = await analyze({
        url: String(body.url),
        company: body.company ? String(body.company).slice(0, 200) : '',
        industry: body.industry ? String(body.industry).slice(0, 100) : '',
      });
      const id = randomUUID();
      cache.set(id, { full, expires: Date.now() + CACHE_TTL });
      // Allow ?full=1 for CLI/testing to skip the gate.
      if (url.searchParams.get('full') === '1') return send(res, 200, { id, full });
      return send(res, 200, { id, teaser });
    }

    // Shareable report by id — only serves reports that were unlocked (email
    // captured), so this can't bypass the lead-capture gate.
    if (req.method === 'GET' && path.startsWith('/api/xray/report/')) {
      const id = decodeURIComponent(path.slice('/api/xray/report/'.length));
      const entry = id ? cache.get(id) : null;
      if (!entry || !entry.unlocked) throw new HttpError('Rapport expiré ou introuvable.', 'NOT_FOUND', 404);
      return send(res, 200, { full: entry.full });
    }

    if (req.method === 'POST' && path === '/api/xray/unlock') {
      const body = await readBody(req);
      const entry = body.id ? cache.get(body.id) : null;
      if (!entry) throw new HttpError('Rapport introuvable ou expiré. Relancez l’analyse.', 'NOT_FOUND', 404);
      if (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email)))
        throw new HttpError('E-mail invalide.', 'BAD_EMAIL', 400);
      entry.unlocked = true; // enable the shareable /rapport?id=… URL for this report

      let leadStatus = 'skipped';
      try {
        const r = await saveLead({
          name: body.name,
          email: body.email,
          company: entry.full.meta.company,
          industry: entry.full.meta.industry,
          website: entry.full.meta.finalUrl,
          score: entry.full.overall,
          level: entry.full.level.key,
        });
        leadStatus = r.stored;
      } catch (err) {
        // Never block the report on a CRM hiccup — log and continue.
        console.error('[lead] save failed:', err.message);
        leadStatus = 'error';
      }
      return send(res, 200, { full: entry.full, lead: leadStatus });
    }

    // Strategic-call request from the "Parler à RIXZA" contact form (§11).
    if (req.method === 'POST' && path === '/api/xray/contact') {
      checkRate(ip);
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim();
      if (name.length < 2) throw new HttpError('Nom requis.', 'BAD_NAME', 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError('E-mail invalide.', 'BAD_EMAIL', 400);

      const clip = (v, n) => (v ? String(v).slice(0, n) : '');
      const r = await saveContact({
        name: clip(name, 200),
        company: clip(body.company, 200),
        email: clip(email, 200),
        phone: clip(body.phone, 60),
        website: clip(body.website, 300),
        need: clip(body.need, 120),
        message: clip(body.message, 4000),
        timeline: clip(body.timeline, 60),
      });
      return send(res, 200, { ok: true, stored: r.stored });
    }

    return send(res, 404, { error: 'Route inconnue.', code: 'NOT_FOUND' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const code = err.code || 'INTERNAL';
    if (status >= 500) console.error('[xray]', err);
    return send(res, status, { error: err.message || 'Erreur interne.', code });
  }
});

server.listen(config.port, () => {
  const cap = capabilities();
  console.log(`\n  RIXZA X-Ray  →  http://localhost:${config.port}`);
  console.log(`  PageSpeed: ${cap.pagespeed ? 'API' : 'heuristique'}  |  IA: ${cap.ai ? 'Gemini' : 'déterministe'}  |  Vision: ${cap.vision ? 'on' : 'off'}  |  CRM: ${cap.crm}\n`);
});
