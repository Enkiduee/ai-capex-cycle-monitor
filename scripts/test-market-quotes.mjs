import assert from 'node:assert/strict';
import {
  marketCapSymbol,
  marketPhase,
  normalizeMarketCaps,
  normalizeQuote,
  normalizeUsdCnyFx,
  yahooSymbol
} from './refresh-market-quotes.mjs';

assert.deepEqual(
  marketPhase(new Date('2026-07-14T01:31:00.000Z'), 'cn'),
  { phase: 'intraday', sessionDate: '2026-07-14', timezone: 'Asia/Shanghai' }
);
assert.equal(marketPhase(new Date('2026-07-14T04:00:00.000Z'), 'cn').phase, 'closed', 'A 股午间休市不能刷新');
assert.equal(marketPhase(new Date('2026-07-14T07:17:00.000Z'), 'cn').phase, 'after_close', 'A 股收盘后窗口应刷新');
assert.equal(marketPhase(new Date('2026-07-18T02:00:00.000Z'), 'cn').phase, 'closed', '周末不能按交易日刷新');

assert.equal(marketPhase(new Date('2026-07-14T14:00:00.000Z'), 'us').phase, 'intraday', '美股夏令时盘中应刷新');
assert.equal(marketPhase(new Date('2026-01-14T15:00:00.000Z'), 'us').phase, 'intraday', '美股冬令时盘中应刷新');
assert.equal(marketPhase(new Date('2026-07-14T20:17:00.000Z'), 'us').phase, 'after_close', '美股收盘后窗口应刷新');

assert.equal(yahooSymbol({ tradingViewSymbol: 'NASDAQ:AAOI' }), 'AAOI');
assert.equal(yahooSymbol({ tradingViewSymbol: 'SZSE:002436' }), '002436.SZ');
assert.equal(yahooSymbol({ tradingViewSymbol: 'SSE:688981' }), '688981.SS');
assert.equal(yahooSymbol({ marketDataSymbol: 'CUSTOM', tradingViewSymbol: 'NASDAQ:AAOI' }), 'CUSTOM');
assert.equal(marketCapSymbol({ marketCapSymbol: 'NASDAQ:SKHY', tradingViewSymbol: 'NYSE:SKHY' }), 'NASDAQ:SKHY');

const quote = normalizeQuote({
  chart: {
    result: [{
      meta: {
        currency: 'USD',
        regularMarketPrice: 105,
        chartPreviousClose: 100,
        regularMarketTime: Date.parse('2026-07-14T19:45:00.000Z') / 1000
      },
      timestamp: []
    }],
    error: null
  }
}, {
  ticker: 'AAOI',
  currency: 'USD',
  tradingViewSymbol: 'NASDAQ:AAOI'
}, '2026-07-14T19:46:00.000Z');

assert.equal(quote.symbol, 'AAOI');
assert.equal(quote.market, 'us');
assert.equal(quote.price, 105);
assert.equal(quote.previousClose, 100);
assert.equal(quote.change, 5);
assert.equal(quote.changePercent, 5);
assert.equal(quote.quoteDate, '2026-07-14');
assert.equal(quote.quoteTime, '2026-07-14T19:45:00.000Z');

const marketCaps = normalizeMarketCaps({
  data: [
    { s: 'NASDAQ:AAOI', d: ['AAOI', 105, 7_000_000_000, 'USD'] },
    { s: 'SZSE:002436', d: ['002436', 40, 65_000_000_000, 'CNY'] }
  ]
}, [
  { ticker: 'AAOI', tradingViewSymbol: 'NASDAQ:AAOI' },
  { ticker: '002436', tradingViewSymbol: 'SZSE:002436' }
], '2026-07-14T19:46:00.000Z');
assert.equal(marketCaps.length, 2);
assert.equal(marketCaps[0].marketCap, 7_000_000_000);
assert.equal(marketCaps[0].marketCapCurrency, 'USD');
assert.equal(marketCaps[1].marketCapCurrency, 'CNY');

const fx = normalizeUsdCnyFx({
  chart: {
    result: [{ meta: { regularMarketPrice: 6.7695, regularMarketTime: 1_784_041_131 } }],
    error: null
  }
}, '2026-07-14T19:46:00.000Z');
assert.equal(fx.pair, 'USD/CNY');
assert.equal(fx.rate, 6.7695);
assert.equal(fx.quoteTime, '2026-07-14T14:58:51.000Z');

console.log('validated market windows, symbols, quotes, company market caps, and USD/CNY normalization');
