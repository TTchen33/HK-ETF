const assert = require('node:assert/strict');
const analytics = require('../analytics.js');

const candles = [
  { date: '2026-01-01', open: 99, high: 101, low: 98, close: 100, volume: 1000 },
  { date: '2026-01-02', open: 101, high: 121, low: 100, close: 120, volume: 2000 },
  { date: '2026-01-03', open: 119, high: 120, low: 89, close: 90, volume: 3000 },
  { date: '2026-01-04', open: 91, high: 109, low: 90, close: 108, volume: 4000 },
];

assert.equal(analytics.cumulativeReturn(candles, 3), 8);
assert.equal(analytics.maximumDrawdown(candles, 3), -25);
assert.equal(analytics.averageTurnover(candles, 2), 351000);
assert.equal(analytics.positiveDayRatio(candles, 3), 66.67);
assert.deepEqual(analytics.normalizedSeries(candles, 3).map((item) => item.value), [100, 120, 90, 108]);
assert.ok(analytics.annualizedVolatility(candles, 3) > 0);

const sixtyCandles = Array.from({ length: 60 }, (_, index) => ({
  date: `2026-01-${String(index + 1).padStart(2, '0')}`,
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100.5 + index,
  volume: 1000,
}));
const now = new Date('2026-03-01T12:00:00+08:00');
const report = analytics.reliabilityReport(
  { status: 'ok', yahooSymbol: '2806.HK', asOf: '2026-03-01T11:55:00+08:00', candles: sixtyCandles },
  { provider: 'Yahoo Finance via yfinance', fetchedAt: '2026-03-01T11:56:00+08:00' },
  { snapshot: { asOfDate: '2026-02-28' } },
  now,
);
assert.equal(report.score, 100);
assert.equal(report.band, 'excellent');
assert.equal(report.invalidCandles, 0);

const invalid = structuredClone(sixtyCandles);
invalid[2].high = 50;
const warning = analytics.reliabilityReport(
  { status: 'ok', yahooSymbol: '2806.HK', asOf: '2026-03-01T11:55:00+08:00', candles: invalid },
  { provider: 'Yahoo Finance via yfinance', fetchedAt: '2026-03-01T11:56:00+08:00' },
  { snapshot: { asOfDate: '2026-02-28' } },
  now,
);
assert.equal(warning.invalidCandles, 1);
assert.ok(warning.score < 100);

const premiumMarket = {
  fxRates: [
    { pair: 'USD/HKD', rates: [{ date: '2026-02-27', close: 7.8 }] },
    { pair: 'RMB/HKD', rates: [{ date: '2026-02-27', close: 1.1 }] },
  ],
};
const premiumRecord = { stockCode: 'TEST', currency: 'HKD', candles: [{ date: '2026-02-27', close: 78.78 }] };
const usdPremium = analytics.premiumDiscount(premiumRecord, { snapshot: { asOfDate: '2026-02-27', navPerShare: 10, navCurrency: 'USD' } }, premiumMarket);
assert.equal(usdPremium.status, 'matched');
assert.equal(usdPremium.navHkd, 78);
assert.equal(usdPremium.premiumPct, 1);
assert.equal(usdPremium.direction, 'premium');

const hkdDiscount = analytics.premiumDiscount(
  { stockCode: 'TEST', currency: 'HKD', candles: [{ date: '2026-02-27', close: 99 }] },
  { snapshot: { asOfDate: '2026-02-27', navPerShare: 100, navCurrency: 'HKD' } },
  premiumMarket,
);
assert.equal(hkdDiscount.premiumPct, -1);
assert.equal(hkdDiscount.direction, 'discount');

const missingDate = analytics.premiumDiscount(premiumRecord, { snapshot: { asOfDate: '2026-02-26', navPerShare: 10, navCurrency: 'USD' } }, premiumMarket);
assert.equal(missingDate.status, 'unavailable');

console.log('analytics tests passed');
