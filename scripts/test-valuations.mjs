import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { trailingValue, extractFinancials, calculateFinancialModel, validFinancialModel } from './lib/financial-model.mjs';
import { refreshCoverage, normalizeHistory } from './build-valuation-coverage.mjs';

const fact = (start, end, val, filed = '2026-08-01') => ({ start, end, val, filed, form: '10-Q', accn: '0001', tag: 'test' });
const annual = fact('2025-01-01', '2025-12-31', 100);
const ytd = fact('2026-01-01', '2026-06-30', 80);
const prior = fact('2025-01-01', '2025-06-30', 40);
assert.equal(trailingValue([annual, ytd, prior], '2026-06-30').value, 140);
assert.equal(trailingValue([annual, ytd], '2026-06-30'), null, 'Missing comparative YTD must not be guessed');
assert.equal(trailingValue([annual, ytd, prior, { ...ytd, val: 90, filed: '2026-08-02' }], '2026-06-30').value, 150, 'Amended inputs must replace earlier facts');
assert.equal(trailingValue([annual], '2026-06-30'), null, 'Never silently use an old report');
const assumptions = { pe: [12, 20, 30], revenue: [1, 3, 5], cashHaircuts: [0.5, 0.75, 1], cashBurnYears: 1 };
const f = { eps: { value: -1 }, operatingIncome: { value: -20 }, revenue: { value: 100 }, cash: 80, liabilities: 30, shares: 10, operatingCashFlow: { value: -20 } };
const loss = calculateFinancialModel(f, assumptions);
assert.deepEqual(loss.prices, [13, 33, 53]);
assert.deepEqual(calculateFinancialModel({ ...f, shares: 20 }, assumptions).prices, [6.5, 16.5, 26.5], 'Dilution must lower prices');
assert.deepEqual(calculateFinancialModel({ ...f, revenue: { value: 200 } }, assumptions).prices, [23, 63, 103], 'New revenue must recalculate prices');
assert.throws(() => calculateFinancialModel({ ...f, liabilities: null }, assumptions));
assert.deepEqual(calculateFinancialModel({ ...f, liabilities: 1000 }, assumptions).prices, [0, 0, 0], 'No artificial positive price floors');
assert.equal(calculateFinancialModel({ ...f, revenue: { value: 0 } }, assumptions).kind, 'cash-runway');
assert.deepEqual(calculateFinancialModel({ ...f, eps: { value: 2 }, operatingIncome: { value: 10 } }, assumptions).prices, [24, 40, 60]);
assert.throws(() => calculateFinancialModel({ ...f, eps: { value: 2 }, operatingIncome: { value: 10 } }, assumptions, { kind: 'pe', eps: { accountingBasis: 'non-GAAP' } }), /须复核/);
assert(validFinancialModel(loss));
assert(!validFinancialModel({ kind: 'pe', prices: [20, 10, 30] }));
const payload = { facts: { 'us-gaap': {
  RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [annual, ytd, prior] } },
  CashAndCashEquivalentsAtCarryingValue: { units: { USD: [{ end: '2026-06-30', val: 70, filed: '2026-08-01', form: '10-Q', accn: '0001' }, { end: '2026-09-30', val: 999, filed: '2026-11-01', form: '10-Q', accn: '0002' }] } }
} } };
assert.equal(extractFinancials(payload, '2026-09-05').periodEnd, '2026-06-30', 'Never include future filings');
assert.equal(extractFinancials(payload, '2026-09-05').cash, 70);
const row = { ticker: 'TEST', name: 'Test', market: 'us', exchange: 'NASDAQ', securityType: '股票', currency: 'USD' };
const history = { symbol: 'TEST', referencePrice: 20, referencePriceDate: '2026-09-04', historyStart: '2026-01-01', historyEnd: '2026-09-04', prices: Array.from({ length: 200 }, (_, i) => 10 + i / 20) };
const previous = { entries: [{ ...row, referencePrice: 10, referencePriceDate: '2026-07-30', safety: { low: 1, high: 2 }, reasonable: { low: 3, high: 4 }, aggressive: { low: 5, high: 6 } }] };
const output = await refreshCoverage({ dryRun: true, previous, directory: [row], load: async () => history });
assert.equal(output.entries[0].referencePrice, 20);
assert.equal(output.entries[0].referencePriceDate, '2026-09-04');
const second = { ...row, ticker: 'FAIL' };
const mixed = await refreshCoverage({ dryRun: true, previous: { entries: [...previous.entries, { ...previous.entries[0], ticker: 'FAIL' }] }, directory: [row, second], load: async entry => { if (entry.ticker === 'FAIL') throw new Error('HTTP 429'); return history; } });
assert.equal(mixed.entries[1].referencePriceDate, '2026-07-30');
assert.equal(mixed.entries[1].refresh.status, 'error');
await assert.rejects(() => refreshCoverage({ dryRun: true, previous, directory: [row], load: async () => { throw new Error('offline'); } }), /全部历史行情请求失败/);
await assert.rejects(() => refreshCoverage({ dryRun: true, previous, directory: [row], load: async () => ({ ...history, referencePriceDate: '2025-01-01' }) }), /全部历史行情请求失败/);
const chart = { chart: { result: [{ meta: { currency: 'USD', regularMarketPrice: 4, regularMarketTime: 1788471000 }, timestamp: [1, 2, 3, 4, 5], indicators: { quote: [{ close: [10, 20, 30, 40, 50] }], adjclose: [{ adjclose: [5, 10, 15, 20, 25] }] } }] } };
assert.deepEqual(normalizeHistory(chart, row, 'TEST').prices, [10, 20, 30, 40, 50], 'Adjusted history must use current price units');
const workflow = await readFile(new URL('../.github/workflows/refresh-data.yml', import.meta.url), 'utf8');
assert(workflow.includes('node scripts/refresh-financial-models.mjs'));
assert(workflow.includes('git add -- data/events.json data/valuation-bands.json data/sec-filings-state.json data/valuation-coverage.json data/financial-valuations.json'));
console.log('valuation tests passed: TTM, amendments, missing/future data, losses, cash burn, dilution, refresh failures and report publishing');

const { refreshFinancialModels } = await import('./refresh-financial-models.mjs');
const fixtureFacts = { cik: 1822966, facts: { 'us-gaap': {} } };
for (const [tag, factor, unit] of [['RevenueFromContractWithCustomerExcludingAssessedTax', 1, 'USD'], ['EarningsPerShareDiluted', -0.01, 'USD/shares'], ['OperatingIncomeLoss', -0.1, 'USD'], ['NetCashProvidedByUsedInOperatingActivities', -0.2, 'USD']]) {
  fixtureFacts.facts['us-gaap'][tag] = { units: { [unit]: [annual, ytd, prior].map(row => ({ ...row, val: row.val * factor })) } };
}
for (const [tag, value, unit] of [['CashAndCashEquivalentsAtCarryingValue', 80, 'USD'], ['Liabilities', 30, 'USD'], ['CommonStockSharesOutstanding', 10, 'shares']]) {
  fixtureFacts.facts['us-gaap'][tag] = { units: { [unit]: [{ end: '2026-06-30', val: value, filed: '2026-08-01', form: '10-Q', accn: '0001822966-26-000001' }] } };
}
const beforeTime = process.env.REFRESH_NOW;
try {
  process.env.REFRESH_NOW = '2026-09-05T00:00:00Z';
  const options = { dryRun: true, onlyTickers: ['SMR'], tickerMap: [], load: async () => fixtureFacts };
  const initial = await refreshFinancialModels({ ...options, previous: { entries: [] } });
  assert.equal(initial.entries[0].model.kind, 'revenue-cash');
  process.env.REFRESH_NOW = '2026-09-06T00:00:00Z';
  const repeated = await refreshFinancialModels({ ...options, previous: initial });
  assert.equal(repeated.entries[0].calculatedAt, initial.entries[0].calculatedAt, 'A daily scan must not pretend to recalculate unchanged financials');
  fixtureFacts.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push({ ...ytd, val: 100, filed: '2026-09-06' });
  const revised = await refreshFinancialModels({ ...options, previous: initial });
  assert.notEqual(revised.entries[0].calculatedAt, initial.entries[0].calculatedAt);
  assert(revised.entries[0].model.prices[1] > initial.entries[0].model.prices[1], 'Amended revenue must change the published financial price');
  const partial = structuredClone(fixtureFacts);
  delete partial.facts['us-gaap'].Liabilities;
  const blocked = await refreshFinancialModels({ ...options, previous: revised, load: async () => partial });
  assert.equal(blocked.entries[0].status, 'needs-review');
  assert.equal(blocked.entries[0].model, undefined, 'Never label the old model as current when latest financial inputs are incomplete');
  await assert.rejects(() => refreshFinancialModels({ ...options, previous: revised, load: async () => { throw new Error('offline'); } }), /财报请求全部失败/);
} finally {
  if (beforeTime === undefined) delete process.env.REFRESH_NOW; else process.env.REFRESH_NOW = beforeTime;
}
console.log('financial refresh integration passed: first model, idempotency, revised report repricing, partial-data and outage safety');
