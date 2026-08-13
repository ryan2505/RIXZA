// The RIXZA scoring engine. Every dimension is a set of weighted checks derived
// from real signals. A single check list is the source of truth for BOTH the
// dimension scores and the technical findings shown in the report — so the score
// and the "why" always agree.
//
// Dimension weights and level bands are taken verbatim from the blueprint
// (§6.2 Six Scoring Dimensions, §6.3 Score Levels).

export const DIMENSIONS = [
  { key: 'performance', label: 'Performance', weight: 15 },
  { key: 'seo', label: 'Visibilité SEO', weight: 20 },
  { key: 'conversion', label: 'Conversion', weight: 25 },
  { key: 'authority', label: 'Crédibilité de marque', weight: 15 },
  { key: 'experience', label: 'Expérience utilisateur', weight: 15 },
  { key: 'growth', label: 'Infrastructure de croissance', weight: 10 },
];

export const LEVELS = [
  { min: 90, key: 'ELITE', name: 'RIXZA ELITE', blurb: 'Présence digitale hautement optimisée.' },
  { min: 75, key: 'ADVANCED', name: 'RIXZA ADVANCED', blurb: 'Base solide avec des optimisations à fort impact.' },
  { min: 60, key: 'GROWTH', name: 'RIXZA GROWTH', blurb: 'Opportunités importantes détectées.' },
  { min: 40, key: 'REBUILD', name: 'RIXZA REBUILD', blurb: 'Faiblesses digitales majeures détectées.' },
  { min: 0, key: 'CRITICAL', name: 'RIXZA CRITICAL', blurb: 'L’infrastructure digitale nécessite une action immédiate.' },
];

// A check: pass (ok) contributes full weight; warn contributes half; fail zero.
// `impact` labels the business stakes; `fix` seeds the recommended action.
function check(id, dim, weight, state, label, opts = {}) {
  return {
    id,
    dimension: dim,
    weight,
    // state: true = pass, 'warn' = partial, false = fail
    state,
    credit: state === true ? 1 : state === 'warn' ? 0.5 : 0,
    label,
    impact: opts.impact || 'moyen',
    detail: opts.detail || '',
    fix: opts.fix || '',
  };
}

// Vision score → check state (true / 'warn' / false).
function vstate(v) {
  return v == null ? null : v >= 70 ? true : v >= 45 ? 'warn' : false;
}

export function runChecks(page, signals, perf, vision) {
  const checks = [];

  // ---------- PERFORMANCE (score comes from PageSpeed/heuristic module) ----------
  // We still emit findings so the report explains the performance number.
  checks.push(
    check('perf_https', 'performance', 3, page.isHttps, 'HTTPS et certificat valides', {
      impact: 'élevé',
      detail: page.isHttps ? '' : 'Le site n’est pas servi en HTTPS.',
      fix: 'Activer HTTPS sur l’ensemble du site et forcer la redirection.',
    }),
    check('perf_ttfb', 'performance', 3, page.ttfbMs < 800 ? true : page.ttfbMs < 1500 ? 'warn' : false,
      'Réponse serveur rapide (TTFB)', {
        impact: 'moyen',
        detail: `TTFB mesuré : ${page.ttfbMs} ms.`,
        fix: 'Optimiser l’hébergement / la mise en cache pour réduire le temps de réponse.',
      }),
    check('perf_weight', 'performance', 2, page.htmlBytes < 250_000 ? true : page.htmlBytes < 600_000 ? 'warn' : false,
      'Poids de page maîtrisé', {
        impact: 'moyen',
        detail: `Document HTML : ${Math.round(page.htmlBytes / 1024)} Ko.`,
        fix: 'Réduire le poids des pages (images, scripts, code inutilisé).',
      }),
    check('perf_mixed', 'performance', 2, !signals.mixedContent, 'Aucun contenu mixte (http sur https)', {
      impact: 'moyen',
      fix: 'Servir toutes les ressources en HTTPS pour éviter les blocages navigateur.',
    })
  );

  // ---------- SEO VISIBILITY ----------
  const titleOk = signals.titleLength >= 15 && signals.titleLength <= 65;
  checks.push(
    check('seo_title', 'seo', 4, signals.title ? (titleOk ? true : 'warn') : false, 'Balise title optimisée', {
      impact: 'élevé',
      detail: signals.title ? `« ${signals.title} » (${signals.titleLength} car.)` : 'Aucune balise title.',
      fix: 'Rédiger un title unique de 50–60 caractères avec le mot-clé principal.',
    }),
    check('seo_desc', 'seo', 3,
      signals.metaDescription ? (signals.metaDescriptionLength >= 70 && signals.metaDescriptionLength <= 165 ? true : 'warn') : false,
      'Meta description présente et calibrée', {
        impact: 'moyen',
        detail: signals.metaDescription ? `${signals.metaDescriptionLength} caractères.` : 'Aucune meta description.',
        fix: 'Ajouter une meta description de 140–160 caractères orientée bénéfice + CTA.',
      }),
    check('seo_h1', 'seo', 3, signals.h1Count === 1 ? true : signals.h1Count === 0 ? false : 'warn',
      'Un seul H1 clair', {
        impact: 'élevé',
        detail: `${signals.h1Count} balise(s) H1 détectée(s).`,
        fix: 'Utiliser un H1 unique portant la proposition de valeur.',
      }),
    check('seo_headings', 'seo', 2, signals.h2Count >= 2 ? true : signals.h2Count === 1 ? 'warn' : false,
      'Structure de titres (H2/H3)', {
        impact: 'faible',
        fix: 'Structurer le contenu avec des H2/H3 hiérarchisés.',
      }),
    check('seo_canonical', 'seo', 2, signals.hasCanonical, 'URL canonique déclarée', {
      impact: 'faible',
      fix: 'Ajouter une balise canonical pour consolider les signaux d’indexation.',
    }),
    check('seo_indexable', 'seo', 3, !signals.noindex, 'Page indexable (pas de noindex)', {
      impact: 'élevé',
      detail: signals.noindex ? 'La page bloque l’indexation (noindex).' : '',
      fix: 'Retirer la directive noindex des pages à référencer.',
    }),
    check('seo_schema', 'seo', 2, signals.hasStructuredData ? true : 'warn',
      'Données structurées (schema.org)', {
        impact: 'moyen',
        detail: signals.schemaTypes.length ? 'Types : ' + signals.schemaTypes.join(', ') : 'Aucune donnée structurée détectée.',
        fix: 'Implémenter Organization + WebSite (+ Service / FAQPage si éligible).',
      }),
    check('seo_robots', 'seo', 1, page.robots?.hasRobots ? true : 'warn', 'robots.txt accessible', {
      impact: 'faible',
      fix: 'Publier un robots.txt qui référence le sitemap.',
    }),
    check('seo_sitemap', 'seo', 2, page.robots?.hasSitemap, 'Sitemap XML déclaré', {
      impact: 'moyen',
      fix: 'Générer un sitemap.xml et le déclarer dans robots.txt.',
    }),
    check('seo_content', 'seo', 2, signals.words >= 400 ? true : signals.words >= 150 ? 'warn' : false,
      'Contenu textuel suffisant', {
        impact: 'moyen',
        detail: `${signals.words} mots détectés sur la page.`,
        fix: 'Étoffer le contenu (≥ 500 mots) pour couvrir l’intention de recherche.',
      })
  );

  // ---------- CONVERSION (highest weight — 25%) ----------
  checks.push(
    check('cv_cta', 'conversion', 5, signals.ctaCount >= 2 ? true : signals.ctaCount === 1 ? 'warn' : false,
      'Appel à l’action clair et répété', {
        impact: 'élevé',
        detail: `${signals.ctaCount} CTA détecté(s).`,
        fix: 'Placer un CTA primaire visible dans le hero et le répéter dans la page.',
      }),
    check('cv_form', 'conversion', 4, signals.formCount >= 1 ? true : false, 'Formulaire de contact / capture', {
      impact: 'élevé',
      detail: signals.formCount ? `${signals.formCount} formulaire(s).` : 'Aucun formulaire détecté.',
      fix: 'Ajouter un formulaire court (nom, e-mail, besoin) au parcours principal.',
    }),
    check('cv_booking', 'conversion', 4, signals.booking ? true : 'warn', 'Prise de rendez-vous en ligne', {
      impact: 'élevé',
      detail: signals.booking ? '' : 'Aucun outil de réservation détecté.',
      fix: 'Intégrer un calendrier de réservation (Calendly/Cal.com) au CTA principal.',
    }),
    check('cv_phone', 'conversion', 3, signals.telLinks >= 1 || signals.phonePattern ? true : false,
      'Numéro de téléphone cliquable', {
        impact: 'moyen',
        fix: 'Afficher un numéro cliquable (tel:) en en-tête et pied de page.',
      }),
    check('cv_whatsapp', 'conversion', 2, signals.hasWhatsApp ? true : 'warn', 'Contact WhatsApp direct', {
      impact: 'moyen',
      detail: signals.hasWhatsApp ? '' : 'Pas de lien WhatsApp détecté.',
      fix: 'Ajouter un contact WhatsApp (wa.me) pour réduire la friction.',
    }),
    check('cv_proof', 'conversion', 4, signals.socialProofHits >= 2 ? true : signals.socialProofHits === 1 ? 'warn' : false,
      'Preuve sociale (avis, témoignages, logos)', {
        impact: 'élevé',
        detail: `${signals.socialProofHits} signal(aux) de preuve sociale.`,
        fix: 'Ajouter témoignages, notes clients et logos de confiance près des CTA.',
      }),
    check('cv_email', 'conversion', 3, signals.hasEmailInput || signals.mailtoLinks >= 1 ? true : 'warn',
      'Voie de contact e-mail', {
        impact: 'moyen',
        fix: 'Proposer une capture e-mail ou un contact e-mail visible.',
      })
  );

  // ---------- BRAND AUTHORITY ----------
  checks.push(
    check('br_h1value', 'authority', 4,
      signals.h1Count >= 1 && (signals.h1[0] || '').length >= 20 ? true : signals.h1Count >= 1 ? 'warn' : false,
      'Proposition de valeur explicite dans le H1', {
        impact: 'élevé',
        detail: signals.h1[0] ? `« ${truncate(signals.h1[0], 90)} »` : 'Aucun H1 exploitable.',
        fix: 'Formuler une promesse claire et différenciante dans le titre principal.',
      }),
    check('br_og', 'authority', 3, signals.og.title && signals.og.image ? true : signals.og.title || signals.og.image ? 'warn' : false,
      'Aperçu social soigné (Open Graph)', {
        impact: 'moyen',
        fix: 'Renseigner og:title, og:description et og:image (partages / crédibilité).',
      }),
    check('br_content', 'authority', 3, signals.words >= 500 ? true : signals.words >= 200 ? 'warn' : false,
      'Contenu qui démontre l’expertise', {
        impact: 'moyen',
        fix: 'Publier du contenu de fond (méthode, résultats, cas clients).',
      }),
    check('br_proof', 'authority', 3, signals.socialProofHits >= 2 ? true : signals.socialProofHits >= 1 ? 'warn' : false,
      'Éléments de crédibilité et de confiance', {
        impact: 'moyen',
        fix: 'Mettre en avant certifications, partenaires et résultats mesurables.',
      }),
    check('br_favicon', 'authority', 2, signals.hasFavicon, 'Identité visuelle (favicon)', {
      impact: 'faible',
      fix: 'Ajouter un favicon de marque.',
    })
  );

  // ---------- USER EXPERIENCE ----------
  const altRatio = signals.imagesTotal ? 1 - signals.imagesMissingAlt / signals.imagesTotal : 1;
  checks.push(
    check('ux_viewport', 'experience', 4, signals.hasViewport, 'Site adapté au mobile (viewport)', {
      impact: 'élevé',
      detail: signals.hasViewport ? '' : 'Balise viewport absente — rendu mobile compromis.',
      fix: 'Déclarer <meta name="viewport"> et vérifier le responsive.',
    }),
    check('ux_lang', 'experience', 2, signals.lang ? true : 'warn', 'Langue du document déclarée', {
      impact: 'faible',
      fix: 'Ajouter l’attribut lang à la balise <html>.',
    }),
    check('ux_nav', 'experience', 3, signals.linksInternal >= 4 ? true : signals.linksInternal >= 1 ? 'warn' : false,
      'Navigation interne suffisante', {
        impact: 'moyen',
        detail: `${signals.linksInternal} lien(s) interne(s).`,
        fix: 'Structurer une navigation claire vers les pages clés.',
      }),
    check('ux_alt', 'experience', 2, altRatio >= 0.9 ? true : altRatio >= 0.5 ? 'warn' : false,
      'Images accessibles (attribut alt)', {
        impact: 'faible',
        detail: `${signals.imagesMissingAlt}/${signals.imagesTotal} image(s) sans alt.`,
        fix: 'Renseigner un texte alternatif descriptif sur les images.',
      }),
    check('ux_hierarchy', 'experience', 2, signals.h2Count >= 2 && signals.words >= 200 ? true : 'warn',
      'Hiérarchie de lecture lisible', {
        impact: 'faible',
        fix: 'Aérer le contenu avec des sections et sous-titres clairs.',
      }),
    check('ux_charset', 'experience', 2, signals.hasCharset, 'Encodage déclaré (charset)', {
      impact: 'faible',
      fix: 'Déclarer <meta charset="utf-8"> en tête de document.',
    })
  );

  // ---------- GROWTH INFRASTRUCTURE ----------
  const a = signals.analytics;
  const pixelCount = [a.metaPixel, a.linkedin, a.tiktok].filter(Boolean).length;
  checks.push(
    check('gr_analytics', 'growth', 4, a.ga4 || a.plausible || a.matomo || a.segment ? true : 'warn',
      'Analytics installé', {
        impact: 'élevé',
        detail: a.ga4 ? 'Google Analytics 4 détecté.' : a.plausible ? 'Plausible détecté.' : a.matomo ? 'Matomo détecté.' : 'Aucun analytics détecté.',
        fix: 'Installer GA4 (ou équivalent) pour mesurer le trafic et les conversions.',
      }),
    check('gr_gtm', 'growth', 2, a.gtm ? true : 'warn', 'Tag Manager pour piloter le tracking', {
      impact: 'moyen',
      fix: 'Déployer Google Tag Manager pour gérer les balises sans redéploiement.',
    }),
    check('gr_pixel', 'growth', 2, pixelCount >= 1 ? true : 'warn', 'Pixel publicitaire (remarketing)', {
      impact: 'moyen',
      fix: 'Installer un pixel (Meta/LinkedIn) pour le remarketing et l’attribution.',
    }),
    check('gr_chat', 'growth', 1, signals.chat ? true : 'warn', 'Chat / messagerie de conversion', {
      impact: 'faible',
      fix: 'Ajouter un chat ou WhatsApp pour capter les intentions chaudes.',
    }),
    check('gr_booking', 'growth', 1, signals.booking, 'Réservation connectée au parcours', {
      impact: 'moyen',
      fix: 'Relier la prise de rendez-vous au CRM / calendrier.',
    })
  );

  // ---------- VISION (only when a screenshot + multimodal AI are available) ----------
  // These checks see what HTML can't: the actual rendered impression. They are
  // added only when vision ran, so their absence never penalizes a score.
  if (vision && vision.scores) {
    const vs = vision.scores;
    const push = (id, dim, weight, val, label, opts) => {
      const st = vstate(val);
      if (st !== null) checks.push(check(id, dim, weight, st, label, opts));
    };
    push('vz_hero', 'conversion', 3, vs.heroClarity, 'Clarté du hero (analyse visuelle)', {
      impact: 'élevé',
      detail: vs.heroClarity != null ? `Score visuel ${vs.heroClarity}/100.` : '',
      fix: 'Rendre la proposition de valeur et le CTA principal évidents dès le premier écran.',
    });
    push('vz_cta', 'conversion', 3, vs.ctaVisibility, 'Visibilité du CTA (analyse visuelle)', {
      impact: 'élevé',
      fix: 'Rendre le bouton d’action contrasté et visible sans défilement.',
    });
    push('vz_cred', 'authority', 3, vs.credibility, 'Crédibilité perçue (analyse visuelle)', {
      impact: 'élevé',
      fix: 'Renforcer la qualité visuelle et les signaux de confiance en haut de page.',
    });
    push('vz_brand', 'authority', 2, vs.brandFeel, 'Cohérence de marque (analyse visuelle)', {
      impact: 'moyen',
      fix: 'Uniformiser typographie, couleurs et imagerie pour une identité premium.',
    });
    push('vz_hierarchy', 'experience', 3, vs.visualHierarchy, 'Hiérarchie visuelle (analyse visuelle)', {
      impact: 'moyen',
      fix: 'Structurer la page (espaces, tailles, contrastes) pour guider le regard.',
    });
    push('vz_mobile', 'experience', 2, vs.mobileReadiness, 'Rendu mobile (analyse visuelle)', {
      impact: 'moyen',
      fix: 'Adapter le rendu mobile : lisibilité, zones tactiles, mise en page.',
    });
  }

  return scoreFromChecks(checks, perf);
}

function scoreFromChecks(checks, perf) {
  const dimScores = {};
  for (const d of DIMENSIONS) {
    if (d.key === 'performance') {
      // Blend the performance module (70%) with our HTTPS/weight/mixed checks (30%).
      const perfChecks = checks.filter((c) => c.dimension === 'performance');
      const cw = perfChecks.reduce((s, c) => s + c.weight, 0);
      const cc = perfChecks.reduce((s, c) => s + c.credit * c.weight, 0);
      const checkScore = cw ? (cc / cw) * 100 : 100;
      dimScores.performance = Math.round(perf.score * 0.7 + checkScore * 0.3);
      continue;
    }
    const list = checks.filter((c) => c.dimension === d.key);
    const w = list.reduce((s, c) => s + c.weight, 0);
    const got = list.reduce((s, c) => s + c.credit * c.weight, 0);
    dimScores[d.key] = w ? Math.round((got / w) * 100) : 0;
  }

  let overall = 0;
  for (const d of DIMENSIONS) overall += dimScores[d.key] * (d.weight / 100);
  overall = Math.max(0, Math.min(100, Math.round(overall)));

  const level = LEVELS.find((l) => overall >= l.min) || LEVELS[LEVELS.length - 1];

  return { overall, level, dimScores, checks };
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
