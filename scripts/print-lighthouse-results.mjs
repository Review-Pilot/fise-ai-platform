import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const device of ['mobile', 'desktop']) {
  const result = JSON.parse(readFileSync('lighthouse-' + device + '.json', 'utf8'));
  assert.ok(!result.runtimeError, device + ': ' + JSON.stringify(result.runtimeError));
  const audits = result.audits;
  const metrics = {
    device,
    url: result.finalDisplayedUrl,
    performanceScore: Math.round(result.categories.performance.score * 100),
    firstContentfulPaintMs: Math.round(audits['first-contentful-paint'].numericValue),
    largestContentfulPaintMs: Math.round(audits['largest-contentful-paint'].numericValue),
    totalBlockingTimeMs: Math.round(audits['total-blocking-time'].numericValue),
    cumulativeLayoutShift: audits['cumulative-layout-shift'].numericValue,
  };
  assert.ok(metrics.url.startsWith('https://fise-ai-platform.seb-slabbert1.workers.dev/'));
  console.log(JSON.stringify(metrics));
}
