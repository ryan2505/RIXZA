// Performance signal. If a PageSpeed Insights key is configured we use Google's
// Lighthouse-based data (real Core Web Vitals + performance score). Otherwise we
// estimate from what we already measured during fetch (TTFB, page weight, asset
// counts) so the dimension is never empty and V1 stays free.
import { config } from './config.js';

const PSI = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export async function getPerformance(page, signals) {
  if (config.pagespeed.enabled) {
    try {
      return await runPageSpeed(page.finalUrl);
    } catch (err) {
      // Fall through to heuristic on any PSI failure (quota, timeout, etc.)
      const est = estimate(page, signals);
      est.note = 'Estimation (PageSpeed indisponible).';
      return est;
    }
  }
  return estimate(page, signals);
}

async function runPageSpeed(url) {
  const params = new URLSearchParams({
    url,
    key: config.pagespeed.key,
    strategy: 'mobile',
    category: 'performance',
  });
  // Single bounded attempt keeps total scan time predictable (blueprint: fast
  // scan). Lighthouse can take 10–40s; we cap at 40s and fall back to the
  // heuristic rather than retry (a retry could double worst-case latency).
  const data = await psiFetch(`${PSI}?${params}`, 40000);

  const lh = data.lighthouseResult || {};
  const audits = lh.audits || {};
  const perfScore = Math.round((lh.categories?.performance?.score ?? 0) * 100);

  const cwv = data.loadingExperience?.metrics || {};
  const metric = (a) => audits[a]?.numericValue ?? null;

  // Lighthouse ships a rendered screenshot — reuse it for vision (free).
  const shot =
    lh.fullPageScreenshot?.screenshot?.data ||
    audits['final-screenshot']?.details?.data ||
    null;

  return {
    source: 'pagespeed',
    screenshot: shot, // data URI (image/jpeg) or null
    score: clamp(perfScore),
    metrics: {
      lcpMs: metric('largest-contentful-paint'),
      cls: metric('cumulative-layout-shift'),
      tbtMs: metric('total-blocking-time'),
      fcpMs: metric('first-contentful-paint'),
      speedIndexMs: metric('speed-index'),
      inpMs: cwv.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    },
    fieldData: cwv.LARGEST_CONTENTFUL_PAINT_MS
      ? {
          lcpMs: cwv.LARGEST_CONTENTFUL_PAINT_MS.percentile,
          cls: cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile / 100,
          inpMs: cwv.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
        }
      : null,
    note: null,
  };
}

async function psiFetch(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error('PSI ' + res.status + (data.error ? ' ' + data.error.message : ''));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Heuristic performance score from cheap signals we already have.
function estimate(page, signals) {
  let score = 100;
  const notes = [];

  // TTFB (server responsiveness)
  const ttfb = page.ttfbMs || 0;
  if (ttfb > 1500) { score -= 22; notes.push('serveur lent'); }
  else if (ttfb > 800) { score -= 12; }
  else if (ttfb > 400) { score -= 5; }

  // Page weight (HTML transfer size — a proxy for total heaviness)
  const kb = page.htmlBytes / 1024;
  if (kb > 1200) { score -= 20; notes.push('HTML très lourd'); }
  else if (kb > 500) { score -= 12; }
  else if (kb > 250) { score -= 5; }

  // Image discipline
  if (signals.imagesTotal > 40) { score -= 10; notes.push('beaucoup d’images'); }
  else if (signals.imagesTotal > 20) { score -= 5; }

  // HTTPS / mixed content
  if (!page.isHttps) { score -= 20; notes.push('pas de HTTPS'); }
  if (signals.mixedContent) { score -= 8; notes.push('contenu mixte'); }

  // Viewport (mobile readiness)
  if (!signals.hasViewport) { score -= 12; notes.push('viewport mobile manquant'); }

  // Compression / caching headers
  const enc = (page.headers['content-encoding'] || '').toLowerCase();
  if (!/gzip|br|deflate/.test(enc)) { score -= 6; }

  return {
    source: 'heuristic',
    score: clamp(Math.round(score)),
    metrics: { ttfbMs: ttfb, htmlKb: Math.round(kb) },
    fieldData: null,
    note: notes.length ? 'Signaux : ' + notes.join(', ') + '.' : null,
  };
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n || 0)));
}
