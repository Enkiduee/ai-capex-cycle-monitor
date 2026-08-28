import assert from 'node:assert/strict';
import {
  normalizeHkexReport,
  normalizeEastmoneyHkFile,
  normalizeNasdaqFile,
  normalizeSseTurnover,
  normalizeSzseTurnover
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
    { zbmc: '成交量（亿）', gp: '614.78' },
    { zbmc: '成交金额（亿元）', gp: '11,170.60' }
  ]
}], '2026-08-27');
assert.equal(szse.turnover, 1_117_060_000_000);

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

const nasdaq = normalizeNasdaqFile(`"Date","Volume","DolVol"
8/24/2026 0:00:00,7628670194.00,439846811052.00
8/25/2026 0:00:00,7772096156.00,385124684516.00`);
assert.deepEqual(nasdaq, [
  {
    date: '2026-08-24',
    turnover: 439_846_811_052,
    breakdown: { shareVolume: 7_628_670_194 }
  },
  {
    date: '2026-08-25',
    turnover: 385_124_684_516,
    breakdown: { shareVolume: 7_772_096_156 }
  }
]);

console.log('validated SSE, SZSE, HKEX, and Nasdaq daily turnover normalization');
