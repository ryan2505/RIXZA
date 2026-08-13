// Vision analysis. Sends the site screenshot to Gemini (multimodal) and gets
// structured visual signals a text/HTML pass can't see: hero clarity, visual
// hierarchy, perceived credibility, mobile readiness, brand feel. These feed
// real checks in Conversion / Brand Authority / User Experience and a dedicated
// "Analyse visuelle" section. Fully optional — returns null if Gemini or a
// screenshot is unavailable.
import { config } from './config.js';
import { callGemini } from './ai.js';

export async function analyzeVisual(shot, ctx) {
  if (!config.gemini.enabled || !shot || !shot.image) return null;
  try {
    return await withGeminiVision(shot, ctx);
  } catch {
    return null; // never block a scan on the vision step
  }
}

async function withGeminiVision(shot, ctx) {
  const system =
    'Tu es un directeur artistique et expert conversion chez RIXZA. Tu évalues la ' +
    'capture d’écran d’un site (haut de page). Sois précis, orienté business, sans complaisance. ' +
    'Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni bloc de code.';

  const instruction =
    `Site: ${ctx.company || ctx.host} (secteur: ${ctx.industry || 'non précisé'}).\n` +
    `Évalue la capture et rends un JSON:\n` +
    `{ "heroClarity": 0-100, "visualHierarchy": 0-100, "credibility": 0-100, ` +
    `"mobileReadiness": 0-100, "ctaVisibility": 0-100, "brandFeel": 0-100, ` +
    `"observations": [string, ...max 4, constats business concrets], ` +
    `"redFlags": [string, ...max 3, problèmes visuels majeurs] }.\n` +
    `Note bas si le rendu paraît générique, daté, confus, ou sans proposition de valeur visible.`;

  const inline = await toInlineData(shot);
  if (!inline) return null;

  const parts = [{ text: instruction }, { inline_data: inline }];
  const v = await callGemini({ system, parts, maxTokens: 600, timeoutMs: 15000 });

  const num = (x) => (typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : null);
  return {
    source: shot.source,
    scores: {
      heroClarity: num(v.heroClarity),
      visualHierarchy: num(v.visualHierarchy),
      credibility: num(v.credibility),
      mobileReadiness: num(v.mobileReadiness),
      ctaVisibility: num(v.ctaVisibility),
      brandFeel: num(v.brandFeel),
    },
    observations: Array.isArray(v.observations) ? v.observations.slice(0, 4) : [],
    redFlags: Array.isArray(v.redFlags) ? v.redFlags.slice(0, 3) : [],
  };
}

// Gemini needs base64 inline data ({ mime_type, data }). PageSpeed gives a data
// URI (parse it); Microlink gives a URL (fetch the bytes, best effort).
async function toInlineData(shot) {
  if (shot.kind === 'dataUri') {
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(shot.image);
    if (m) return { mime_type: m[1], data: m[2] };
    return { mime_type: 'image/jpeg', data: shot.image };
  }
  // URL → download and base64.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(shot.image, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4_000_000) return null; // keep the request light
    return { mime_type: mime, data: buf.toString('base64') };
  } catch {
    return null;
  }
}
