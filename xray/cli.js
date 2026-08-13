// Quick local runner:  node cli.js <url> [company] [industry]
import { analyze } from './src/analyze.js';

const [, , url, company, industry] = process.argv;
if (!url) {
  console.error('Usage: node cli.js <url> [company] [industry]');
  process.exit(1);
}

const { full } = await analyze({ url, company, industry });

const bar = (n) => '█'.repeat(Math.round(n / 5)).padEnd(20, '·');
console.log(`\n  ${full.meta.finalUrl}`);
console.log(`  ${full.headline}\n`);
console.log(`  SCORE  ${full.overall}/100   ${full.level.name}`);
console.log(`  ${full.summary}\n`);
for (const d of full.dimensions) {
  console.log(`  ${d.label.padEnd(30)} ${bar(d.score)} ${String(d.score).padStart(3)}  (${d.weight}%)`);
}
console.log('\n  PRIORITÉS');
for (const o of full.opportunities) {
  console.log(`  ${o.rank}  ${o.title}  [impact ${o.impact} · effort ${o.effort}]`);
  console.log(`      → ${o.action}`);
}
console.log(`\n  meta: perf=${full.meta.performanceSource} ai=${full.meta.aiSource} ${full.meta.elapsedMs}ms\n`);
