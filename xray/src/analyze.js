// Orchestrates the full RIXZA X-Ray technical flow (blueprint §15):
// fetch → robots/sitemap → HTML signals → performance → weighted scoring →
// opportunities → AI interpretation → report (teaser + full).
import { fetchSite, fetchText } from './fetcher.js';
import { parseHtml } from './parse.js';
import { getPerformance } from './pagespeed.js';
import { runChecks, DIMENSIONS } from './scoring.js';
import { buildOpportunities, recommendedActions } from './opportunities.js';
import { interpret } from './ai.js';
import { capabilities } from './config.js';
import { normalizeUrl } from './fetcher.js';
import { getScreenshot } from './screenshot.js';
import { analyzeVisual } from './vision.js';

// Short-lived, URL-keyed result cache. Guarantees the same site returns an
// identical report within the window (no network-timing drift) and keeps V1
// cheap by avoiding duplicate fetch/PageSpeed/AI work (blueprint §14).
const RESULT_TTL = 10 * 60 * 1000;
const results = new Map(); // key -> { data, expires }

function cacheKey(input) {
  let host = '';
  try { host = normalizeUrl(input.url).href.toLowerCase(); } catch { host = String(input.url).toLowerCase(); }
  return host + '|' + (input.company || '').toLowerCase() + '|' + (input.industry || '').toLowerCase();
}

export async function analyze(input) {
  const key = cacheKey(input);
  const hit = results.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;

  const data = await runAnalysis(input);
  results.set(key, { data, expires: Date.now() + RESULT_TTL });
  if (results.size > 500) for (const [k, v] of results) if (v.expires < Date.now()) results.delete(k);
  return data;
}

async function runAnalysis(input) {
  const t0 = Date.now();
  const page = await fetchSite(input.url);
  const signals = parseHtml(page.html, page);
  const origin = new URL(page.finalUrl).origin;

  // Run the slow PageSpeed call and the robots/sitemap probes concurrently.
  const [perf, robots] = await Promise.all([
    getPerformance(page, signals),
    loadRobots(origin),
  ]);
  page.robots = robots;

  // Screenshot → vision (blueprint §14). Screenshot may reuse the free
  // Lighthouse capture; vision runs only if a screenshot + multimodal AI exist.
  const shot = await getScreenshot(page, perf);
  const vision = await analyzeVisual(shot, {
    company: input.company,
    industry: input.industry,
    host: page.finalHost,
  });

  const { overall, level, dimScores, checks } = runChecks(page, signals, perf, vision);
  const opportunities = buildOpportunities(checks, dimScores);
  const actions = recommendedActions(opportunities, checks);

  const ai = await interpret({
    company: input.company,
    industry: input.industry,
    overall,
    level,
    dimScores,
    opportunities,
    dimensions: DIMENSIONS,
    visionObservations: vision ? vision.observations : [],
  });

  const dimensions = DIMENSIONS.map((d) => ({
    key: d.key,
    label: d.label,
    weight: d.weight,
    score: dimScores[d.key],
    note: ai.dimensionNotes[d.key] || '',
  }));

  // Technical findings for the report (§6.4 "selected technical findings").
  const findings = checks.map((c) => ({
    id: c.id,
    dimension: c.dimension,
    label: c.label,
    state: c.credit === 1 ? 'OK' : c.credit === 0.5 ? 'PARTIEL' : 'ÉCART',
    detail: c.detail,
  }));

  const meta = {
    requestedUrl: page.requestedUrl,
    finalUrl: page.finalUrl,
    host: page.finalHost,
    company: input.company || null,
    industry: input.industry || null,
    isHttps: page.isHttps,
    httpsUpgrade: page.httpsUpgrade,
    redirectHops: page.redirectHops,
    ttfbMs: page.ttfbMs,
    htmlKb: Math.round(page.htmlBytes / 1024),
    performanceSource: perf.source,
    aiSource: ai.source,
    visionSource: vision ? vision.source : null,
    capabilities: capabilities(),
    elapsedMs: Date.now() - t0,
    scannedAt: new Date().toISOString(),
  };

  // "Analyse visuelle" section (§6.4 business-oriented explanations, visual).
  const visual = vision
    ? {
        available: true,
        scores: vision.scores,
        observations: vision.observations,
        redFlags: vision.redFlags,
      }
    : { available: false };

  const full = {
    meta,
    overall,
    level: { key: level.key, name: level.name, blurb: level.blurb },
    headline: ai.headline,
    summary: ai.summary,
    dimensions,
    opportunities,
    findings,
    recommendedActions: actions,
    performance: perf,
    visual,
  };

  // Teaser = score + level + dimension bars, but priorities/actions/findings
  // are withheld until lead capture (blueprint §6.1 steps 4–6, §17).
  const teaser = {
    meta,
    overall,
    level: full.level,
    headline: ai.headline,
    dimensions: dimensions.map((d) => ({ key: d.key, label: d.label, weight: d.weight, score: d.score })),
    lockedCount: {
      opportunities: opportunities.length,
      findings: findings.length,
      actions: actions.length,
    },
  };

  return { teaser, full };
}

// robots.txt + sitemap presence (best effort). Runs in parallel with PageSpeed.
async function loadRobots(origin) {
  const robotsRes = await fetchText(origin + '/robots.txt');
  const robotsText = robotsRes.ok ? robotsRes.text : '';
  const hasSitemap =
    /sitemap:/i.test(robotsText) || (await fetchText(origin + '/sitemap.xml')).ok;
  return { hasRobots: robotsRes.ok && robotsText.trim().length > 0, hasSitemap };
}
