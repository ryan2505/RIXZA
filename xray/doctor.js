// Verifies that configured keys actually work — a live ping to PageSpeed and
// OpenAI (cheap), plus a capability summary. Run after editing .env:
//   node doctor.js
import { config, capabilities } from './src/config.js';

const line = (ok, label, extra = '') =>
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  — ' + extra : ''}`);

console.log('\n  RIXZA X-Ray — diagnostic\n');
const cap = capabilities();
console.log('  Capabilities:', JSON.stringify(cap), '\n');

// --- PageSpeed ---
if (config.pagespeed.enabled) {
  try {
    const u = new URLSearchParams({ url: 'https://example.com', key: config.pagespeed.key, strategy: 'mobile', category: 'performance' });
    const r = await fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + u);
    if (r.ok) {
      const j = await r.json();
      const score = Math.round((j.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
      const shot = Boolean(j.lighthouseResult?.fullPageScreenshot?.screenshot?.data || j.lighthouseResult?.audits?.['final-screenshot']?.details?.data);
      line(true, 'PageSpeed key valid', `example.com perf=${score}, screenshot=${shot ? 'yes' : 'no'}`);
    } else {
      const t = await r.text();
      line(false, 'PageSpeed key rejected', `HTTP ${r.status}: ${t.slice(0, 120)}`);
    }
  } catch (e) {
    line(false, 'PageSpeed check failed', e.message);
  }
} else {
  line(false, 'PageSpeed not configured', 'performance will use the heuristic');
}

// --- Google Gemini (text + vision) ---
if (config.gemini.enabled) {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 8, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (r.ok) {
      line(true, 'Gemini key valid', `model=${config.gemini.model}`);
      line(true, 'Vision', cap.vision ? 'enabled (screenshot + Gemini multimodal)' : 'no screenshot source (set PAGESPEED_API_KEY or SCREENSHOT_PROVIDER)');
    } else {
      const t = await r.text();
      line(false, 'Gemini key rejected', `HTTP ${r.status}: ${t.slice(0, 140)}`);
    }
  } catch (e) {
    line(false, 'Gemini check failed', e.message);
  }
} else {
  line(false, 'Gemini not configured', 'interpretation is deterministic; vision skipped');
}

// --- Supabase (live table check) ---
if (config.supabase.enabled) {
  try {
    // HEAD with an exact count verifies the URL, key, AND that the table exists.
    const r = await fetch(`${config.supabase.url}/rest/v1/${config.supabase.table}?select=id`, {
      method: 'HEAD',
      headers: {
        apikey: config.supabase.key,
        authorization: `Bearer ${config.supabase.key}`,
        prefer: 'count=exact',
      },
    });
    if (r.ok) {
      const count = (r.headers.get('content-range') || '').split('/')[1] || '0';
      line(true, 'Supabase reachable', `table '${config.supabase.table}' OK — ${count} lead(s)`);
    } else if (r.status === 404) {
      line(false, 'Supabase table missing', `run supabase-schema.sql (table '${config.supabase.table}' not found)`);
    } else if (r.status === 401 || r.status === 403) {
      line(false, 'Supabase key rejected', `HTTP ${r.status} — check SUPABASE_SERVICE_KEY (use the service_role key)`);
    } else {
      line(false, 'Supabase error', `HTTP ${r.status}`);
    }
  } catch (e) {
    line(false, 'Supabase check failed', e.message);
  }
} else {
  line(false, 'Supabase not configured', 'leads stored in ./data/leads.jsonl');
}

console.log('\n  Done.\n');
