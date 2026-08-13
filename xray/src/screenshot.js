// Screenshot acquisition for the vision step (blueprint §14 "screenshot/vision
// analysis"). Priority: (1) reuse the Lighthouse screenshot PageSpeed already
// returned — free, no extra call; (2) keyless Microlink fallback. Returns an
// image reference Gemini vision can consume (data URI or public URL), or null.
import { config } from './config.js';

export async function getScreenshot(page, perf) {
  // 1) Free: the screenshot Lighthouse already produced.
  if (perf && perf.screenshot) {
    return { image: perf.screenshot, kind: 'dataUri', source: 'pagespeed' };
  }

  // 2) Keyless provider fallback.
  if (config.screenshot.provider === 'microlink') {
    const url = await microlink(page.finalUrl);
    if (url) return { image: url, kind: 'url', source: 'microlink' };
  }

  return null;
}

async function microlink(target) {
  try {
    const api =
      'https://api.microlink.io/?url=' +
      encodeURIComponent(target) +
      '&screenshot=true&meta=false&viewport.width=1280&viewport.height=800&screenshot.type=jpeg';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(api, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.screenshot?.url || null;
  } catch {
    return null;
  }
}
