// Server-side website fetch. Client browsers can't fetch arbitrary origins
// (CORS), so this is the piece that makes real analysis possible.
// Normalizes the URL, follows redirects manually (to measure the chain),
// records timing, and returns HTML + headers + metadata.
import { config } from './config.js';

// Identifying UA by default; a browser-like UA is used as a fallback only when a
// site actively blocks the crawler (403/429/503/999), so scans stay reliable.
const UA =
  'Mozilla/5.0 (compatible; RIXZA-XRay/1.0; +https://rixza.com/audit) AppleWebKit/537.36';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BLOCK_STATUSES = new Set([401, 403, 406, 429, 503, 999]);

export function normalizeUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new HttpError('URL manquante.', 'EMPTY_URL');
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError('URL invalide.', 'BAD_URL');
  }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError('Protocole non supporté.', 'BAD_PROTOCOL');
  // Block requests to private / loopback hosts (basic SSRF guard).
  const host = u.hostname.toLowerCase();
  if (isPrivateHost(host)) throw new HttpError('Hôte non autorisé.', 'BLOCKED_HOST');
  u.hash = '';
  return u;
}

function isPrivateHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (/^127\./.test(host) || host === '0.0.0.0' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true; // link-local
  const m = host.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (!host.includes('.')) return true; // bare hostnames
  return false;
}

export class HttpError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Public entry: normalize, then attempt the crawl with sensible retries so real
// sites don't fail spuriously (apex-domain DNS, bot blocks). Never falls back to
// fabricated data — on genuine failure it throws a precise, user-facing error.
export async function fetchSite(inputUrl) {
  const start = normalizeUrl(inputUrl);

  try {
    return await crawl(start, UA);
  } catch (err) {
    // 1) Apex domain has no DNS but "www." often does (e.g. example.com fails,
    //    www.example.com resolves). Retry once with the www. host.
    if (err.code === 'DNS' && !/^www\./i.test(start.hostname)) {
      const www = new URL(start.href);
      www.hostname = 'www.' + start.hostname;
      try {
        return await crawl(www, UA);
      } catch { /* fall through to original error */ }
    }
    // 2) The site is actively blocking the crawler — retry with a browser UA.
    if (err.code && err.code.startsWith('HTTP_') && BLOCK_STATUSES.has(Number(err.code.slice(5)))) {
      try {
        return await crawl(start, BROWSER_UA);
      } catch { /* fall through */ }
    }
    throw err;
  }
}

// Fetch a page, following redirects manually so we can see the final URL,
// whether it upgraded to HTTPS, and how many hops it took.
async function crawl(start, ua) {
  const { fetchTimeoutMs, maxRedirects, maxHtmlBytes } = config.limits;

  let current = start;
  const chain = [];
  let httpsUpgrade = false;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': ua,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'fr,en;q=0.8',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError')
        throw new HttpError('Le site n’a pas répondu à temps.', 'TIMEOUT', 504);
      const cause = err.cause?.code || err.code;
      if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN')
        throw new HttpError('Domaine introuvable — vérifiez l’adresse.', 'DNS', 400);
      if (cause === 'ECONNREFUSED')
        throw new HttpError('Connexion refusée par le serveur.', 'REFUSED', 502);
      if (cause === 'CERT_HAS_EXPIRED' || cause === 'DEPTH_ZERO_SELF_SIGNED_CERT' || cause === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
        throw new HttpError('Certificat HTTPS invalide sur le site.', 'TLS', 502);
      throw new HttpError('Impossible de joindre le site.', 'UNREACHABLE', 502);
    }
    const ttfb = Date.now() - t0;
    clearTimeout(timer);
    chain.push({ url: current.href, status: res.status, ttfb });

    // Redirect?
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current);
      if (current.protocol === 'http:' && next.protocol === 'https:') httpsUpgrade = true;
      if (isPrivateHost(next.hostname.toLowerCase()))
        throw new HttpError('Redirection vers un hôte non autorisé.', 'BLOCKED_HOST');
      current = next;
      current.hash = '';
      continue;
    }

    if (res.status >= 400)
      throw new HttpError(`Le site renvoie une erreur (${res.status}).`, 'HTTP_' + res.status, 502);

    // Read body with a byte cap.
    const html = await readCapped(res, maxHtmlBytes);
    const totalMs = Date.now() - t0;

    return {
      requestedUrl: start.href,
      finalUrl: current.href,
      finalHost: current.hostname,
      isHttps: current.protocol === 'https:',
      httpsUpgrade,
      status: res.status,
      redirectHops: chain.length - 1,
      chain,
      ttfbMs: chain[0].ttfb,
      totalMs,
      headers: headersToObject(res.headers),
      contentType: res.headers.get('content-type') || '',
      htmlBytes: Buffer.byteLength(html, 'utf8'),
      html,
    };
  }
  throw new HttpError('Trop de redirections.', 'TOO_MANY_REDIRECTS', 502);
}

async function readCapped(res, maxBytes) {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(value);
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {}
      break;
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

function headersToObject(headers) {
  const o = {};
  for (const [k, v] of headers.entries()) o[k.toLowerCase()] = v;
  return o;
}

// Lightweight sibling fetch (robots.txt, sitemap) — best effort, never throws.
export async function fetchText(url, timeoutMs = 6000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': UA },
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, status: res.status, text: '' };
    const text = (await res.text()).slice(0, 200_000);
    return { ok: true, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: '' };
  }
}
