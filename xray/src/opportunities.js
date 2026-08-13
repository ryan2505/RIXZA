// Turn failed/weak checks into the three highest-priority opportunities
// (blueprint §6.4). Priority = business impact × dimension weight × how much the
// check is failing. This keeps urgency real, not artificial (§17).
import { DIMENSIONS } from './scoring.js';

const IMPACT_WEIGHT = { 'élevé': 3, 'moyen': 2, 'faible': 1 };
const EFFORT = {
  // Rough implementation effort per check id — feeds the IMPACT/EFFORT badge.
  cv_booking: 'moyen', cv_form: 'faible', cv_cta: 'faible', cv_proof: 'moyen',
  seo_title: 'faible', seo_desc: 'faible', seo_h1: 'faible', seo_schema: 'moyen',
  seo_sitemap: 'faible', gr_analytics: 'faible', gr_gtm: 'faible', perf_ttfb: 'élevé',
  perf_weight: 'moyen', ux_viewport: 'moyen',
};

const DIM_LABEL = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.label]));
const DIM_WEIGHT = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.weight]));

export function buildOpportunities(checks, dimScores) {
  const candidates = checks
    .filter((c) => c.credit < 1) // failing or partial only
    .map((c) => {
      const gap = 1 - c.credit; // 1 for fail, 0.5 for warn
      const priority = (IMPACT_WEIGHT[c.impact] || 2) * DIM_WEIGHT[c.dimension] * gap;
      return { ...c, gap, priority };
    })
    .sort((a, b) => b.priority - a.priority);

  const top = candidates.slice(0, 3).map((c, i) => ({
    rank: '0' + (i + 1),
    dimension: c.dimension,
    dimensionLabel: DIM_LABEL[c.dimension],
    title: opportunityTitle(c),
    body: c.detail || defaultBody(c),
    action: c.fix,
    impact: c.impact,
    effort: EFFORT[c.id] || 'moyen',
  }));

  return top;
}

function opportunityTitle(c) {
  // Reframe the failed check as a gain, not a defect.
  const T = {
    cv_cta: 'Clarifier et renforcer l’appel à l’action',
    cv_form: 'Ajouter un parcours de capture de leads',
    cv_booking: 'Activer la prise de rendez-vous en ligne',
    cv_phone: 'Rendre le contact téléphonique immédiat',
    cv_whatsapp: 'Ouvrir un canal WhatsApp direct',
    cv_proof: 'Installer la preuve sociale près des CTA',
    cv_email: 'Créer une voie de contact e-mail',
    seo_title: 'Optimiser la balise title',
    seo_desc: 'Rédiger des meta descriptions percutantes',
    seo_h1: 'Structurer un H1 unique et vendeur',
    seo_schema: 'Déployer les données structurées',
    seo_sitemap: 'Publier un sitemap XML',
    seo_indexable: 'Débloquer l’indexation des pages',
    seo_content: 'Étoffer le contenu stratégique',
    br_h1value: 'Affirmer la proposition de valeur',
    br_og: 'Soigner l’aperçu social (Open Graph)',
    br_proof: 'Renforcer les signaux de crédibilité',
    ux_viewport: 'Optimiser l’expérience mobile',
    ux_nav: 'Clarifier la navigation',
    ux_alt: 'Rendre les images accessibles',
    gr_analytics: 'Installer la mesure d’audience',
    gr_gtm: 'Déployer un Tag Manager',
    gr_pixel: 'Activer le remarketing publicitaire',
    perf_ttfb: 'Accélérer le temps de réponse serveur',
    perf_weight: 'Alléger le poids des pages',
    perf_https: 'Sécuriser le site en HTTPS',
    perf_mixed: 'Éliminer le contenu mixte',
  };
  return T[c.id] || `Améliorer : ${c.label}`;
}

function defaultBody(c) {
  return `${c.label} — point d’amélioration détecté sur la dimension ${DIM_LABEL[c.dimension]}.`;
}

// Recommended actions list (§6.4) — deduplicated fixes, priority order.
export function recommendedActions(opportunities, checks) {
  const seen = new Set();
  const actions = [];
  for (const o of opportunities) if (o.action && !seen.has(o.action)) { seen.add(o.action); actions.push(o.action); }
  // Top up from other failing checks so we always show a few.
  for (const c of checks) {
    if (actions.length >= 6) break;
    if (c.credit < 1 && c.fix && !seen.has(c.fix)) { seen.add(c.fix); actions.push(c.fix); }
  }
  return actions;
}
