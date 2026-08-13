// Minimal zero-dependency .env loader + typed config.
// Reads ./.env (if present) into process.env without overwriting real env vars.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadDotenv() {
  try {
    const raw = readFileSync(join(root, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env file — fine, everything is optional */
  }
}

loadDotenv();

const env = process.env;

export const config = {
  root,
  port: Number(env.PORT) || 8787,
  corsOrigin: env.CORS_ORIGIN || '*',
  pagespeed: {
    key: env.PAGESPEED_API_KEY || '',
    enabled: Boolean(env.PAGESPEED_API_KEY),
  },
  // Google Gemini — business interpretation + screenshot/vision analysis.
  // Flash 2.5 with thinking disabled keeps the scan fast (≤ ~3s per call).
  gemini: {
    key: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-2.5-flash',
    enabled: Boolean(env.GEMINI_API_KEY),
  },
  supabase: {
    url: env.SUPABASE_URL || '',
    key: env.SUPABASE_SERVICE_KEY || '',
    table: env.SUPABASE_LEADS_TABLE || 'xray_leads',
    contactsTable: env.SUPABASE_CONTACTS_TABLE || 'xray_contacts',
    enabled: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY),
  },
  screenshot: {
    // 'pagespeed' (free, reuses the Lighthouse screenshot) is always tried first.
    // 'microlink' is a keyless fallback; 'none' disables the extra provider.
    provider: (env.SCREENSHOT_PROVIDER || 'microlink').toLowerCase(),
  },
  // Hard caps to keep V1 cheap and safe (blueprint §16: no enterprise crawl).
  limits: {
    fetchTimeoutMs: 12000,
    maxRedirects: 5,
    maxHtmlBytes: 3_000_000, // 3 MB — plenty for one page, blocks abuse
  },
};

export function capabilities() {
  return {
    pagespeed: config.pagespeed.enabled,
    ai: config.gemini.enabled,
    // Vision needs Gemini (multimodal) + at least one screenshot source.
    vision: config.gemini.enabled && (config.pagespeed.enabled || config.screenshot.provider !== 'none'),
    crm: config.supabase.enabled ? 'supabase' : 'file',
  };
}
