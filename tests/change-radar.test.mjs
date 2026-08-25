import assert from 'node:assert/strict';
import { diffCatalogs, mergeHistory } from '../scripts/build-change-radar.mjs';

const record = (code, overrides = {}) => ({
  etf: {
    issuer: 'Test Issuer',
    officialNameEn: `ETF ${code}`,
    issuerProductUrl: `https://example.com/${code}`,
    underlyingBenchmark: 'Index A',
    managementStyle: 'passive',
    ...overrides.etf,
  },
  listingCounter: { stockCode: code, status: 'active_unverified', ...overrides.listingCounter },
  snapshot: { totalNav: 100, totalNavCurrency: 'HKD', managementFeePct: .5, ongoingChargesPct: null, ...overrides.snapshot },
});

const previous = { collectedAt: '2026-01-01T00:00:00Z', records: [record('1000'), record('2000')] };
const current = {
  collectedAt: '2026-01-02T00:00:00Z',
  records: [
    record('1000', { etf: { underlyingBenchmark: 'Index B' }, snapshot: { totalNav: 130, managementFeePct: .6 } }),
    record('3000'),
  ],
};

const events = diffCatalogs(previous, current, current.collectedAt);
assert.equal(events.filter((event) => event.type === 'product_added').length, 1);
assert.equal(events.filter((event) => event.type === 'product_removed').length, 1);
assert.equal(events.filter((event) => event.type === 'benchmark_changed').length, 1);
assert.equal(events.filter((event) => event.type === 'fee_changed').length, 1);
assert.equal(events.filter((event) => event.type === 'aum_jump').length, 1);
assert.equal(events.find((event) => event.type === 'aum_jump').after.changePct, 30);

const merged = mergeHistory(events, events);
assert.equal(merged.length, events.length);
assert.equal(new Set(merged.map((event) => event.id)).size, events.length);

console.log('change radar tests passed');
