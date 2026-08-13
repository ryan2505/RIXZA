// Zero-dependency HTML signal extraction.
// We don't need a full DOM — we need reliable presence/quality signals across
// the six RIXZA dimensions. Regex + targeted scans keep V1 cheap and fast
// (blueprint §16: no custom crawler / Lighthouse replacement).

const rx = {
  title: /<title[^>]*>([\s\S]*?)<\/title>/i,
  metaDesc: /<meta[^>]+name=["']description["'][^>]*>/i,
  contentAttr: /content=["']([\s\S]*?)["']/i,
  viewport: /<meta[^>]+name=["']viewport["'][^>]*>/i,
  charset: /<meta[^>]+charset=/i,
  canonical: /<link[^>]+rel=["']canonical["'][^>]*>/i,
  htmlLang: /<html[^>]+lang=["']([^"']+)["']/i,
  robotsMeta: /<meta[^>]+name=["']robots["'][^>]*>/i,
  favicon: /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i,
  ogTitle: /<meta[^>]+property=["']og:title["'][^>]*>/i,
  ogImage: /<meta[^>]+property=["']og:image["'][^>]*>/i,
  twitterCard: /<meta[^>]+name=["']twitter:card["'][^>]*>/i,
  ldjson: /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
};

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, metaRegex) {
  const tag = html.match(metaRegex);
  if (!tag) return null;
  const c = tag[0].match(rx.contentAttr);
  return c ? decodeEntities(c[1]) : null;
}

function countAll(html, regex) {
  const m = html.match(regex);
  return m ? m.length : 0;
}

// Strip scripts/styles/tags to approximate visible text for word count.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CTA_WORDS = [
  'book', 'get started', 'get a', 'contact', 'call us', 'request', 'demo', 'quote',
  'sign up', 'start', 'buy', 'subscribe', 'schedule', 'audit', 'free',
  'réserver', 'reserver', 'contact', 'devis', 'appeler', 'demander', 'commencer',
  'prendre rendez', 'rendez-vous', 'découvrir', 'obtenir', 'essai', 'gratuit', 'nous parler',
];

const SOCIAL_PROOF_WORDS = [
  'testimonial', 'review', 'rating', 'trusted by', 'clients', 'case study',
  'avis', 'témoignage', 'temoignage', 'note', 'étoile', 'etoile', 'satisfaction',
  'ils nous font confiance', 'certifié', 'certifie', 'partenaire',
];

export function parseHtml(html, page) {
  const lower = html.toLowerCase();
  const text = visibleText(html);
  const words = text ? text.split(' ').filter(Boolean).length : 0;

  const title = (() => {
    const m = html.match(rx.title);
    return m ? decodeEntities(m[1]) : null;
  })();
  const metaDescription = metaContent(html, rx.metaDesc);

  const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
    decodeEntities(m[1].replace(/<[^>]+>/g, ' '))
  );
  // Match <h2>, <h2 ...>, <h2/> — the previous [\b>] class matched backspace and
  // silently missed headings with attributes.
  const h2Count = countAll(html, /<h2[\s/>]/gi);
  const h3Count = countAll(html, /<h3[\s/>]/gi);

  // Links
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]);
  const host = page ? new URL(page.finalUrl).hostname : '';
  let internal = 0;
  let external = 0;
  for (const href of links) {
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    try {
      const u = new URL(href, page ? page.finalUrl : 'https://x');
      if (!host || u.hostname === host) internal++;
      else external++;
    } catch {
      internal++;
    }
  }

  // Images / alt
  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const imagesMissingAlt = imgTags.filter((t) => !/\balt=/.test(t) || /\balt=["']\s*["']/.test(t)).length;

  // Forms & inputs
  const formCount = countAll(html, /<form\b/gi);
  const hasEmailInput = /<input[^>]+type=["']email["']/i.test(html) || /name=["']email["']/i.test(html);
  const inputCount = countAll(html, /<input\b/gi);

  // Contact affordances
  const telLinks = countAll(html, /href=["']tel:/gi);
  const mailtoLinks = countAll(html, /href=["']mailto:/gi);
  const hasWhatsApp = /wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i.test(lower);
  const phonePattern = /(\+?\d[\d\s().-]{7,}\d)/.test(text);

  // CTA detection — scan anchor + button inner text
  const clickable = [
    ...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi),
    ...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi),
  ].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).toLowerCase());
  const ctaCount = clickable.filter((t) => t && CTA_WORDS.some((w) => t.includes(w))).length;

  // Social proof
  const socialProofHits = SOCIAL_PROOF_WORDS.filter((w) => lower.includes(w)).length;

  // Structured data
  const ldjsonBlocks = [...html.matchAll(rx.ldjson)].map((m) => m[1].trim());
  const schemaTypes = new Set();
  for (const block of ldjsonBlocks) {
    try {
      const json = JSON.parse(block);
      collectTypes(json, schemaTypes);
    } catch {
      const t = block.match(/"@type"\s*:\s*"([^"]+)"/);
      if (t) schemaTypes.add(t[1]);
    }
  }
  const hasMicrodata = /itemscope/i.test(html) && /itemtype=/i.test(html);

  // Analytics / growth infrastructure
  const analytics = {
    ga4: /gtag\(|googletagmanager\.com\/gtag|google-analytics\.com\/analytics|G-[A-Z0-9]{6,}/i.test(html),
    gtm: /googletagmanager\.com\/gtm|GTM-[A-Z0-9]{4,}/i.test(html),
    metaPixel: /connect\.facebook\.net|fbq\(|facebook\.com\/tr\?/i.test(html),
    linkedin: /snap\.licdn\.com|_linkedin_partner_id/i.test(html),
    tiktok: /analytics\.tiktok\.com|ttq\./i.test(html),
    hotjar: /static\.hotjar\.com|hj\(/i.test(html),
    clarity: /clarity\.ms/i.test(html),
    segment: /cdn\.segment\.com|analytics\.js/i.test(html),
    plausible: /plausible\.io/i.test(html),
    matomo: /matomo|piwik/i.test(html),
  };
  const booking = /calendly\.com|cal\.com|acuityscheduling|savvycal|hubspot.*meetings|youcanbook/i.test(html);
  const chat = /intercom|crisp\.chat|drift\.com|tawk\.to|livechat|zendesk|hubspot.*conversations/i.test(html);

  // Mixed content: http resources embedded on an https page
  let mixedContent = false;
  if (page && page.isHttps) {
    mixedContent = /(?:src|href)=["']http:\/\//i.test(
      html.replace(/<a\b[^>]*>/gi, '') // ignore plain anchor links
    );
  }

  return {
    words,
    title,
    titleLength: title ? title.length : 0,
    metaDescription,
    metaDescriptionLength: metaDescription ? metaDescription.length : 0,
    hasViewport: rx.viewport.test(html),
    hasCharset: rx.charset.test(html),
    hasCanonical: rx.canonical.test(html),
    lang: (html.match(rx.htmlLang) || [])[1] || null,
    robotsMeta: metaContent(html, rx.robotsMeta),
    noindex: /noindex/i.test(metaContent(html, rx.robotsMeta) || ''),
    hasFavicon: rx.favicon.test(html),
    og: { title: rx.ogTitle.test(html), image: rx.ogImage.test(html) },
    twitterCard: rx.twitterCard.test(html),
    h1: h1Matches,
    h1Count: h1Matches.length,
    h2Count,
    h3Count,
    linksInternal: internal,
    linksExternal: external,
    imagesTotal: imgTags.length,
    imagesMissingAlt,
    formCount,
    inputCount,
    hasEmailInput,
    ctaCount,
    telLinks,
    mailtoLinks,
    hasWhatsApp,
    phonePattern,
    socialProofHits,
    schemaTypes: [...schemaTypes],
    hasStructuredData: schemaTypes.size > 0 || hasMicrodata,
    hasMicrodata,
    analytics,
    hasAnalytics: Object.values(analytics).some(Boolean),
    booking,
    chat,
    mixedContent,
  };
}

function collectTypes(node, set) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => collectTypes(n, set));
  if (node['@type']) {
    const t = node['@type'];
    if (Array.isArray(t)) t.forEach((x) => set.add(x));
    else set.add(t);
  }
  if (node['@graph']) collectTypes(node['@graph'], set);
  for (const v of Object.values(node)) if (v && typeof v === 'object') collectTypes(v, set);
}
