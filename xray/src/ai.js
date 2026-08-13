// Business-oriented interpretation layer (blueprint §6.4: "business-oriented
// explanations"). With a Google Gemini key we ask for a short, executive-grade
// read of the diagnostic. Without one, we synthesize a solid deterministic
// summary so the report is always complete and costs nothing.
import { config } from './config.js';

export async function interpret(ctx) {
  if (config.gemini.enabled) {
    try {
      return await withGemini(ctx);
    } catch {
      return deterministic(ctx);
    }
  }
  return deterministic(ctx);
}

async function withGemini(ctx) {
  const dimText = ctx.dimensions.map((d) => `${d.label}: ${ctx.dimScores[d.key]}/100`).join(', ');
  const oppText = ctx.opportunities.map((o) => `${o.rank} ${o.title}`).join('; ');
  const visionText =
    ctx.visionObservations && ctx.visionObservations.length
      ? `\nConstats visuels : ${ctx.visionObservations.join('; ')}.`
      : '';

  const system =
    'Tu es un consultant senior en stratégie digitale chez RIXZA. Tu parles à un dirigeant. ' +
    'Ton : précis, autoritaire, orienté business, jamais générique. ' +
    'Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni bloc de code.';
  const user =
    `Entreprise: ${ctx.company || 'non précisée'} (secteur: ${ctx.industry || 'non précisé'}).\n` +
    `Score global RIXZA: ${ctx.overall}/100 — niveau ${ctx.level.name}.\n` +
    `Dimensions: ${dimText}.\n` +
    `Priorités détectées: ${oppText}.${visionText}\n` +
    `Rends un JSON: { "headline": string (max 90 car., le constat business central), ` +
    `"summary": string (2-3 phrases orientées enjeux et opportunité, pas de jargon technique), ` +
    `"dimensionNotes": { "<key>": string } pour chaque dimension (1 phrase business). }`;

  const parsed = await callGemini({ system, parts: [{ text: user }], maxTokens: 700 });
  return {
    source: 'gemini',
    headline: parsed.headline,
    summary: parsed.summary,
    dimensionNotes: parsed.dimensionNotes || {},
  };
}

// Google Gemini generateContent (raw HTTP — keeps the engine dependency-free).
// Flash 2.5 with thinkingBudget:0 + native JSON output keeps latency low.
// `parts` is the user content array (text and/or inline_data image blocks).
// Returns the parsed JSON object from Gemini's response.
export async function callGemini({ system, parts, maxTokens = 700, timeoutMs = 12000 }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': config.gemini.key,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 }, // disable thinking → faster
      },
    }),
  });
  clearTimeout(timer);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Gemini ' + res.status + ': ' + body.slice(0, 160));
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('');
  return parseJson(text);
}

// Gemini returns JSON text — strip any code fences and extract the object.
function parseJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function deterministic(ctx) {
  const sorted = [...ctx.dimensions].sort((a, b) => ctx.dimScores[a.key] - ctx.dimScores[b.key]);
  const weakest = sorted[0];
  const strongest = sorted[sorted.length - 1];
  const who = ctx.company ? ctx.company : 'Votre entreprise';

  const headline = ctx.overall >= 75
    ? `${who} dispose d’une base digitale solide à optimiser`
    : ctx.overall >= 60
    ? `${who} laisse des opportunités de croissance sur la table`
    : ctx.overall >= 40
    ? `La présence digitale de ${who} freine sa croissance`
    : `L’infrastructure digitale de ${who} demande une action immédiate`;

  const summary =
    `Score global de ${ctx.overall}/100 (${ctx.level.name}). ` +
    `Le point fort actuel est « ${strongest.label} » (${ctx.dimScores[strongest.key]}/100), ` +
    `tandis que « ${weakest.label} » (${ctx.dimScores[weakest.key]}/100) pèse le plus sur les résultats. ` +
    `Les trois priorités ci-dessous concentrent l’essentiel du potentiel de conversion et de visibilité à court terme.`;

  const dimensionNotes = {};
  for (const d of ctx.dimensions) {
    const v = ctx.dimScores[d.key];
    dimensionNotes[d.key] =
      v >= 80 ? 'Atout — à préserver.' :
      v >= 60 ? 'Correct, marge d’optimisation.' :
      v >= 40 ? 'Sous le niveau attendu — impact direct sur les résultats.' :
      'Faiblesse critique — priorité d’action.';
  }

  return { source: 'deterministic', headline, summary, dimensionNotes };
}
