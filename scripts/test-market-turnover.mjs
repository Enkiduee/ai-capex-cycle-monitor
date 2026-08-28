import assert from 'node:assert/strict';
import {
  normalizeHkexReport,
  normalizeEastmoneyHkFile,
  normalizeEastmoneyBseSnapshot,
  normalizeEcbFxHistory,
  normalizeCboeMarketHistory,
  normalizeSseTurnover,
  normalizeSzseTurnover,
  normalizeTdxDayFile
} from './refresh-market-turnover.mjs';

const sse = normalizeSseTurnover({
  result: [
    { PRODUCT_CODE: '01', TRADE_DATE: '20260827', TRADE_AMT: '6849.36' },
    { PRODUCT_CODE: '02', TRADE_DATE: '20260827', TRADE_AMT: '2.19' },
    { PRODUCT_CODE: '03', TRADE_DATE: '20260827', TRADE_AMT: '3263.63' },
    { PRODUCT_CODE: '17', TRADE_DATE: '20260827', TRADE_AMT: '10115.18' }
  ]
}, '2026-08-27');
assert.equal(sse.date, '2026-08-27');
assert.equal(sse.turnover, 1_011_299_000_000);
assert.equal(sse.breakdown.sseMainBoardA, 684_936_000_000);

const szse = normalizeSzseTurnover([{
  metadata: { conditions: [{ name: 'txtQueryDate', defaultValue: '2026-08-27' }] },
  data: [
    { zbmc: '成交量（亿）', gp: '614.78', cy: '192.44' },
    { zbmc: '成交金额（亿元）', gp: '11,170.60', cy: '5,464.74' }
  ]
}], '2026-08-27');
assert.equal(szse.turnover, 1_117_060_000_000);
assert.equal(szse.breakdown.szseChiNext, 546_474_000_000);

const bse = normalizeEastmoneyBseSnapshot([
  { f12: '920992', f6: 6_450_055.23, f124: 1787902639 },
  { f12: '920985', f6: 10_847_995.53, f124: 1787902639 },
  { f12: '920982', f6: '-', f124: 1787902639 }
]);
assert.equal(bse.date, '2026-08-28');
assert.equal(bse.turnover, 17_298_051);

const tdxDay = Buffer.alloc(64);
tdxDay.writeUInt32LE(20260826, 0);
tdxDay.writeFloatLE(12_345_678, 20);
tdxDay.writeUInt32LE(20260827, 32);
tdxDay.writeFloatLE(23_456_789, 52);
assert.deepEqual(normalizeTdxDayFile(tdxDay, '2026-08-27'), [
  { date: '2026-08-27', turnover: 23_456_788 }
]);

const hk = normalizeHkexReport(`
  DATE: 27 AUG 2026 (THURSDAY)
  Today's Turnover:
  (HK$):    233,514,818,711
  (Shares): 242,881,532,164
  Renminbi Products Turnover (CNY): 104,393,015
`, '2026-08-27');
assert.equal(hk.turnover, 233_514_818_711);
assert.equal(hk.cnyTurnover, 104_393_015);

const eastmoneyHk = normalizeEastmoneyHkFile({
  data: {
    klines: [
      '2026-08-26,25635.24,25652.97,25800.22,25615.94,13442982144,254823563264.00,0.72,0.56,141.87,0.00',
      '2026-08-27,25774.87,25565.74,25792.01,25500.96,12245992960,233514827776.00,1.13,-0.34,-87.23,0.00'
    ]
  }
});
assert.equal(eastmoneyHk[1].turnover, 233_514_827_776);
assert.equal(eastmoneyHk[1].breakdown.shareVolume, 12_245_992_960);

const us = normalizeCboeMarketHistory(`Day,Market Participant,Tape A Shares,Tape B Shares,Tape C Shares,Total Shares,Tape A Notional,Tape B Notional,Tape C Notional,Total Notional
2026-08-25,NASDAQ,1,2,300,303,10,20,4000,4030
2026-08-25,NYSE Arca,4,5,600,609,40,50,7000,7090
2026-08-24,NASDAQ,7,8,900,915,70,80,10000,10150`);
assert.deepEqual(us.all, [
  {
    date: '2026-08-24',
    turnover: 10_150,
    breakdown: { shareVolume: 915, tapeCNotional: 10_000 }
  },
  {
    date: '2026-08-25',
    turnover: 11_120,
    breakdown: { shareVolume: 912, tapeCNotional: 11_000 }
  }
]);
assert.deepEqual(us.tapeC, [
  {
    date: '2026-08-24',
    turnover: 10_000,
    breakdown: { shareVolume: 900 }
  },
  {
    date: '2026-08-25',
    turnover: 11_000,
    breakdown: { shareVolume: 900 }
  }
]);

const fx = normalizeEcbFxHistory(`<?xml version="1.0"?>
<Cube>
  <Cube time="2026-08-27"><Cube currency="USD" rate="1.1645"/><Cube currency="CNY" rate="7.8258"/><Cube currency="HKD" rate="9.1282"/></Cube>
  <Cube time="2026-08-26"><Cube currency="USD" rate="1.1600"/><Cube currency="CNY" rate="7.8010"/><Cube currency="HKD" rate="9.0900"/></Cube>
</Cube>`, '2026-08-28T08:00:00.000Z');
assert.equal(fx.base, 'USD');
assert.equal(fx.basis, 'daily_reference_rate');
assert.equal(fx.rates.CNY.pair, 'USD/CNY');
assert.equal(fx.rates.CNY.rate, 6.720309);
assert.equal(fx.rates.CNY.quoteTime, '2026-08-27T00:00:00.000Z');
assert.deepEqual(fx.rates.CNY.observations, [
  { date: '2026-08-26', rate: 6.725 },
  { date: '2026-08-27', rate: 6.720309 }
]);
assert.equal(fx.rates.HKD.rate, 7.838729);

console.log('validated SSE, SZSE, BSE, HKEX, Cboe all-market/Tape C, and ECB daily USD FX normalization');
