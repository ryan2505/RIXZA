// Smoke test: exercises the engine end-to-end against a real site and asserts
// the report shape matches the blueprint (§6.4). Run: npm test
import assert from 'node:assert';
import { analyze } from './src/analyze.js';
import { DIMENSIONS } from './src/scoring.js';

const TARGET = process.argv[2] || 'https://example.com';

console.log(`\n  Testing X-Ray engine against ${TARGET} ...\n`);
const { teaser, full } = await analyze({ url: TARGET, company: 'Test Co', industry: 'Autre' });

function ok(name, cond) {
  assert.ok(cond, name);
  console.log(`  ✓ ${name}`);
}

// Overall score
ok('overall score is 0..100', Number.isInteger(full.overall) && full.overall >= 0 && full.overall <= 100);
ok('level assigned', full.level && full.level.name);

// Six dimensions, each valid
ok('exactly six dimensions', full.dimensions.length === 6);
for (const d of DIMENSIONS) {
  const dim = full.dimensions.find((x) => x.key === d.key);
  ok(`dimension ${d.key} present & scored`, dim && dim.score >= 0 && dim.score <= 100);
}

// Weights sum to 100 (blueprint invariant)
ok('dimension weights sum to 100', DIMENSIONS.reduce((s, d) => s + d.weight, 0) === 100);

// Three priority opportunities
ok('up to three opportunities', full.opportunities.length >= 1 && full.opportunities.length <= 3);
ok('opportunities have action + impact', full.opportunities.every((o) => o.title && o.action && o.impact));

// Findings + actions
ok('technical findings present', full.findings.length >= 5);
ok('recommended actions present', full.recommendedActions.length >= 1);
ok('headline + summary present', Boolean(full.headline && full.summary));

// Teaser gating: score visible, priorities hidden
ok('teaser exposes score', teaser.overall === full.overall);
ok('teaser hides opportunities', teaser.opportunities === undefined);
ok('teaser reports locked counts', teaser.lockedCount.opportunities >= 1);

// Recompute overall from dimensions to confirm the weighted math
const recomputed = Math.round(
  DIMENSIONS.reduce((s, d) => s + full.dimensions.find((x) => x.key === d.key).score * (d.weight / 100), 0)
);
ok('overall matches weighted dimensions (±1)', Math.abs(recomputed - full.overall) <= 1);

console.log(`\n  All checks passed — score ${full.overall}/100 (${full.level.name}), perf=${full.meta.performanceSource}, ai=${full.meta.aiSource}\n`);
