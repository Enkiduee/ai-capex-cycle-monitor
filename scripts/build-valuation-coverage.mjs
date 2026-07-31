import {
  dateOnly,
  fetchJson,
  now,
  readJson,
  round,
  writeJsonIfChanged
} from './lib/refresh-utils.mjs';

const OUTPUT_PATH = 'data/valuation-coverage.json';
const CONCURRENCY = 10;
const USER_AGENT = 'Mozilla/5.0 (compatible; AI-CapEx-Cycle-Monitor/1.0)';

const SPECIAL_REFERENCES = Object.freeze({
  'hk:HKEX:BK2526': {
    referencePrice: 6198.78,
    referencePriceDate: '2026-07-31',
    sourceLabel: '用户提供截图',
    sourceUrl: ''
  },
  'us:THEME:BK1582': {
    referencePrice: 1461.55,
    referencePriceDate: '2026-07-31',
    sourceLabel: '用户提供截图',
    sourceUrl: ''
  },
  'us:NYSE:NEE-U': {
    referencePrice: 24.21,
    referencePriceDate: '2026-07-31',
    sourceLabel: '用户提供截图',
    sourceUrl: ''
  }
});

function marketGroup(value, currency) {
  const market = String(value || '').toLowerCase();
  if (market === 'hk' || market.includes('港股') || currency === 'HKD') return 'hk';
  if (market === 'cn' || market.includes('a 股') || market.includes('沪') || market.includes('深') || currency === 'CNY') {
    return 'cn';
  }
  return 'us';
}

function directoryKey(entry) {
  return `${entry.market}:${entry.exchange}:${entry.ticker}`;
}

function directoryEntries(stockWatchlist, hkWatchlist, usWatchlist) {
  const cn = stockWatchlist.entries.map((entry) => ({
    ticker: entry.ticker,
    name: entry.name,
    exchange: entry.exchange,
    market: 'cn',
    securityType: { stock: '股票', etf: 'ETF', index: '指数' }[entry.type] || '证券',
    category: '',
    currency: entry.currency
  }));
  const hk = hkWatchlist.entries.map((entry) => ({
    ticker: entry.ticker,
    name: entry.name,
    exchange: entry.exchange,
    market: 'hk',
    securityType: entry.securityType,
    category: entry.category,
    currency: entry.currency
  }));
  const us = usWatchlist.entries.map((entry) => ({
    ticker: entry.ticker,
    name: entry.name,
    exchange: entry.exchange,
    market: 'us',
    securityType: entry.securityType,
    category: entry.category,
    currency: entry.currency
  }));
  return [...cn, ...hk, ...us];
}

export function yahooHistorySymbol(entry) {
  if (entry.market === 'cn') {
    return `${entry.ticker}.${entry.exchange === 'SH' ? 'SS' : 'SZ'}`;
  }
  if (entry.market === 'hk') {
    if (entry.ticker.startsWith('BK')) return '';
    const ticker = entry.ticker.startsWith('0') ? entry.ticker.slice(1) : entry.ticker;
    return `${ticker}.HK`;
  }
  if (entry.ticker === '.NDX') return '^NDX';
  if (entry.ticker === '.IXIC') return '^IXIC';
  if (entry.ticker === 'BRK.B') return 'BRK-B';
  if (entry.ticker === 'BK1582' || entry.ticker === 'NEE-U') return '';
  return entry.ticker;
}

function quantile(sortedValues, percentile) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return sortedValues[lowerIndex] + ((sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight);
}

function average(values) {
  const numeric = values.filter(Number.isFinite);
  if (!numeric.length) return null;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function annualizedVolatility(values) {
  const returns = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] > 0 && values[index] > 0) {
      returns.push(Math.log(values[index] / values[index - 1]));
    }
  }
  if (returns.length < 2) return null;
  const mean = average(returns);
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function priceDecimals(referencePrice) {
  if (referencePrice >= 1) return 2;
  if (referencePrice >= 0.1) return 3;
  return 4;
}

function fallbackRanges(referencePrice, decimals) {
  const raw = [
    referencePrice * 0.64,
    referencePrice * 0.72,
    referencePrice * 0.78,
    referencePrice * 0.86,
    referencePrice * 0.92,
    referencePrice
  ];
  return strictRanges(raw, decimals);
}

function strictRanges(rawValues, decimals) {
  const tick = 10 ** (-decimals);
  const values = rawValues.map((value) => round(Math.max(value, tick), decimals));
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      values[index] = round(values[index - 1] + tick, decimals);
    }
  }
  return {
    safety: { low: values[0], high: values[1] },
    reasonable: { low: values[2], high: values[3] },
    aggressive: { low: values[4], high: values[5] }
  };
}

function percentileGrid(entry) {
  if (entry.securityType === '杠杆产品') return [0.05, 0.18, 0.30, 0.42, 0.52, 0.65];
  if (['ETF', '指数', '主题板块', '行业板块'].includes(entry.securityType)) {
    return [0.10, 0.25, 0.35, 0.50, 0.60, 0.75];
  }
  return [0.08, 0.22, 0.32, 0.47, 0.58, 0.74];
}

function buildRanges(entry, prices, referencePrice) {
  const decimals = priceDecimals(referencePrice);
  const sorted = [...prices].sort((left, right) => left - right);
  const low = quantile(sorted, 0.10);
  const high = quantile(sorted, 0.90);
  const median = quantile(sorted, 0.50);
  const hasUsefulSpread = Number.isFinite(low)
    && Number.isFinite(high)
    && Number.isFinite(median)
    && median > 0
    && (high - low) / median >= 0.04;
  if (!hasUsefulSpread) return fallbackRanges(referencePrice, decimals);
  return strictRanges(percentileGrid(entry).map((percentile) => quantile(sorted, percentile)), decimals);
}

function methodFor(entry, observationCount, usesFallbackReference = false) {
  if (usesFallbackReference) return 'reference-ladder-v1';
  if (observationCount < 60) return 'limited-history-v1';
  if (entry.securityType === '杠杆产品') return 'price-distribution-leveraged-v1';
  if (['ETF', '指数', '主题板块', '行业板块'].includes(entry.securityType)) {
    return 'price-distribution-pooled-v1';
  }
  return 'price-distribution-stock-v1';
}

function viewFor(entry, observationCount, usesFallbackReference = false) {
  if (usesFallbackReference) {
    return '缺少可复核的完整日线历史，暂按参考价折价阶梯建立低置信度区间；取得稳定历史后应重新计算。';
  }
  if (entry.securityType === '杠杆产品') {
    return '按近一年日线价格分布建立战术观察区间；杠杆产品存在每日复位与路径依赖，不作为长期内在价值判断。';
  }
  if (observationCount < 60) {
    return `仅有 ${observationCount} 个有效交易日，按现有价格分布建立低置信度区间；需随历史样本增加重新计算。`;
  }
  if (['ETF', '指数', '主题板块', '行业板块'].includes(entry.securityType)) {
    return '按近一年日线价格分布建立配置区间；该类标的不使用单家公司 P/E，需结合成分、权重和产品结构复核。';
  }
  return '按近一年日线价格分布建立量化买入区间；这是价格纪律工具，仍需结合财报、盈利质量和行业周期复核。';
}

function sourceUrlFor(symbol) {
  return symbol ? `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/` : '';
}

function normalizeHistory(payload, entry, symbol) {
  const chart = payload && payload.chart;
  if (chart && chart.error) {
    throw new Error(`${entry.ticker} 历史行情错误：${chart.error.description || chart.error.code || 'unknown'}`);
  }
  const result = chart && Array.isArray(chart.result) ? chart.result[0] : null;
  const meta = result && result.meta;
  const timestamps = Array.isArray(result && result.timestamp) ? result.timestamp : [];
  const closes = result && result.indicators && result.indicators.quote && result.indicators.quote[0]
    ? result.indicators.quote[0].close
    : [];
  const adjusted = result && result.indicators && result.indicators.adjclose && result.indicators.adjclose[0]
    ? result.indicators.adjclose[0].adjclose
    : [];
  const lastClose = [...closes].reverse().find((value) => Number.isFinite(value) && value > 0);
  const lastAdjusted = [...adjusted].reverse().find((value) => Number.isFinite(value) && value > 0);
  const adjustmentRatio = Number.isFinite(lastClose) && Number.isFinite(lastAdjusted) && lastAdjusted > 0
    ? lastClose / lastAdjusted
    : 1;
  const observations = timestamps.flatMap((timestamp, index) => {
    const adjustedValue = Number(adjusted[index]);
    const closeValue = Number(closes[index]);
    const price = Number.isFinite(adjustedValue) && adjustedValue > 0
      ? adjustedValue * adjustmentRatio
      : closeValue;
    return Number.isFinite(timestamp) && Number.isFinite(price) && price > 0
      ? [{ timestamp, price }]
      : [];
  });
  if (!meta || observations.length < 5) {
    throw new Error(`${entry.ticker} 缺少至少 5 个有效交易日`);
  }
  const metaPrice = Number(meta.regularMarketPrice);
  const referencePrice = Number.isFinite(metaPrice) && metaPrice > 0
    ? metaPrice
    : observations.at(-1).price;
  const referenceEpoch = Number(meta.regularMarketTime || observations.at(-1).timestamp);
  return {
    symbol,
    referencePrice,
    referencePriceDate: dateOnly(new Date(referenceEpoch * 1000)),
    historyStart: dateOnly(new Date(observations[0].timestamp * 1000)),
    historyEnd: dateOnly(new Date(observations.at(-1).timestamp * 1000)),
    prices: observations.map((observation) => observation.price)
  };
}

async function loadHistory(entry) {
  const symbol = yahooHistorySymbol(entry);
  if (!symbol) return null;
  const payload = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=div%2Csplits`,
    {
      retries: 3,
      timeoutMs: 20000,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.8'
      }
    }
  );
  return normalizeHistory(payload, entry, symbol);
}

function buildCoverageEntry(entry, history, specialReference) {
  const usesFallbackReference = !history;
  const referencePrice = history ? history.referencePrice : specialReference.referencePrice;
  const prices = history ? history.prices : [];
  const observationCount = prices.length;
  const ranges = history
    ? buildRanges(entry, prices, referencePrice)
    : fallbackRanges(referencePrice, priceDecimals(referencePrice));
  const sorted = [...prices].sort((left, right) => left - right);
  const method = methodFor(entry, observationCount, usesFallbackReference);
  const confidence = !usesFallbackReference
    && observationCount >= 180
    && entry.securityType !== '杠杆产品'
    ? 'medium'
    : 'low';

  return {
    ticker: entry.ticker,
    name: entry.name,
    market: entry.market,
    exchange: entry.exchange,
    segment: entry.category || entry.securityType,
    securityType: entry.securityType,
    currency: entry.currency,
    marketDataSymbol: history ? history.symbol : '',
    referencePrice: round(referencePrice, priceDecimals(referencePrice)),
    referencePriceDate: history ? history.referencePriceDate : specialReference.referencePriceDate,
    referencePriceApproximate: usesFallbackReference,
    historyStart: history ? history.historyStart : '',
    historyEnd: history ? history.historyEnd : '',
    observationCount,
    method,
    confidence,
    safety: ranges.safety,
    reasonable: ranges.reasonable,
    aggressive: ranges.aggressive,
    metrics: {
      percentile20: prices.length ? round(quantile(sorted, 0.20), priceDecimals(referencePrice)) : null,
      percentile50: prices.length ? round(quantile(sorted, 0.50), priceDecimals(referencePrice)) : null,
      percentile80: prices.length ? round(quantile(sorted, 0.80), priceDecimals(referencePrice)) : null,
      sma50: prices.length ? round(average(prices.slice(-50)), priceDecimals(referencePrice)) : null,
      sma200: prices.length ? round(average(prices.slice(-200)), priceDecimals(referencePrice)) : null,
      annualizedVolatility: prices.length ? round(annualizedVolatility(prices), 4) : null
    },
    sourceLabel: history ? 'Yahoo Finance Historical Data' : specialReference.sourceLabel,
    sourceUrl: history ? sourceUrlFor(history.symbol) : specialReference.sourceUrl,
    view: viewFor(entry, observationCount, usesFallbackReference)
  };
}

const [stockWatchlist, hkWatchlist, usWatchlist, valuation] = await Promise.all([
  readJson('data/stock-watchlist.json'),
  readJson('data/hk-watchlist.json'),
  readJson('data/us-watchlist.json'),
  readJson('data/valuation-bands.json')
]);
const manualKeys = new Set((valuation.manualBuyZones && valuation.manualBuyZones.entries || []).map(
  (entry) => `${marketGroup(entry.market, entry.currency)}:${entry.ticker}`
));
const entries = directoryEntries(stockWatchlist, hkWatchlist, usWatchlist).filter(
  (entry) => !manualKeys.has(`${entry.market}:${entry.ticker}`)
);
const results = new Array(entries.length);
let cursor = 0;

async function worker() {
  while (cursor < entries.length) {
    const index = cursor;
    cursor += 1;
    const entry = entries[index];
    const specialReference = SPECIAL_REFERENCES[directoryKey(entry)];
    const history = await loadHistory(entry);
    if (!history && !specialReference) {
      throw new Error(`${directoryKey(entry)} 缺少历史行情和特殊参考价`);
    }
    results[index] = buildCoverageEntry(entry, history, specialReference);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

const generatedAt = now();
const output = {
  version: 1,
  updatedAt: dateOnly(generatedAt),
  generatedAt: generatedAt.toISOString(),
  methodology: {
    label: '全目录三档估值 / 买入区间覆盖',
    coverage: '12 个重点标的使用财报与业务研究区间；其余标的使用近一年日线价格分布，历史不足或特殊证券采用低置信度参考价阶梯。',
    stockBands: '普通股票与 ADR 使用近一年复权日线收盘价的 8%–22%、32%–47%、58%–74% 分位区间，依次对应安全、合理与激进档。',
    pooledBands: 'ETF、指数与主题板块使用 10%–25%、35%–50%、60%–75% 分位区间。',
    leveragedBands: '杠杆产品使用更保守的 5%–18%、30%–42%、52%–65% 分位区间，并统一标为低置信度。',
    fallbackBands: '无完整历史时，以参考价的 64%–72%、78%–86%、92%–100% 建立低置信度观察区间。',
    notice: '量化区间是基于历史价格分布的纪律工具，不等同于公司内在价值；历史表现不保证未来结果，使用前应复核最新财报、成分结构、流动性与产品条款。'
  },
  source: {
    label: 'Yahoo Finance Historical Data + 用户提供的特殊证券参考价',
    homepage: 'https://finance.yahoo.com/',
    dataNotice: '第三方行情可能延迟、缺失或调整；特殊证券参考价来自用户提供截图。'
  },
  entries: results
};

const changed = await writeJsonIfChanged(OUTPUT_PATH, output);
const confidenceCounts = results.reduce((counts, entry) => {
  counts[entry.confidence] = (counts[entry.confidence] || 0) + 1;
  return counts;
}, {});
console.log(
  `${changed ? 'updated' : 'unchanged'} ${OUTPUT_PATH}: ${results.length} entries, `
  + `${confidenceCounts.medium || 0} medium confidence, ${confidenceCounts.low || 0} low confidence`
);
