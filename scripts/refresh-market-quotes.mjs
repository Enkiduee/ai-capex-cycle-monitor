import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT_DIR,
  dateOnly,
  fetchJson,
  now,
  parseArgs,
  readJson,
  round,
  setActionOutput,
  sleep,
  writeJsonIfChanged
} from './lib/refresh-utils.mjs';

export const MARKET_CONFIG = Object.freeze({
  cn: {
    id: 'cn',
    label: 'A 股',
    timezone: 'Asia/Shanghai',
    intradayWindows: [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]],
    afterCloseWindow: [15 * 60, 16 * 60]
  },
  us: {
    id: 'us',
    label: '美股',
    timezone: 'America/New_York',
    intradayWindows: [[9 * 60 + 30, 16 * 60]],
    afterCloseWindow: [16 * 60, 18 * 60]
  }
});

function zonedParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday,
    minutes: Number(map.hour) * 60 + Number(map.minute)
  };
}

export function marketPhase(value, marketId) {
  const config = MARKET_CONFIG[marketId];
  if (!config) throw new Error(`未知市场：${marketId}`);
  const parts = zonedParts(value, config.timezone);
  if (['Sat', 'Sun'].includes(parts.weekday)) {
    return { phase: 'closed', sessionDate: parts.date, timezone: config.timezone };
  }
  const isIntraday = config.intradayWindows.some(([start, end]) => parts.minutes >= start && parts.minutes < end);
  if (isIntraday) {
    return { phase: 'intraday', sessionDate: parts.date, timezone: config.timezone };
  }
  const [closeStart, closeEnd] = config.afterCloseWindow;
  if (parts.minutes >= closeStart && parts.minutes < closeEnd) {
    return { phase: 'after_close', sessionDate: parts.date, timezone: config.timezone };
  }
  return { phase: 'closed', sessionDate: parts.date, timezone: config.timezone };
}

export function yahooSymbol(entry) {
  const override = String(entry.marketDataSymbol || '').trim();
  if (override) return override;
  const tradingViewSymbol = String(entry.tradingViewSymbol || '').trim();
  const [exchange, symbol] = tradingViewSymbol.split(':');
  if (!exchange || !symbol) return '';
  if (exchange === 'SZSE') return `${symbol}.SZ`;
  if (exchange === 'SSE') return `${symbol}.SS`;
  if (['NASDAQ', 'NYSE'].includes(exchange)) return symbol;
  return '';
}

function marketIdForEntry(entry) {
  const tradingViewSymbol = String(entry.tradingViewSymbol || '');
  if (entry.currency === 'CNY' || /^(?:SZSE|SSE):/.test(tradingViewSymbol)) return 'cn';
  return 'us';
}

export function normalizeQuote(payload, entry, fetchedAt) {
  const chart = payload && payload.chart;
  if (chart && chart.error) {
    throw new Error(`${entry.ticker} 行情接口错误：${chart.error.description || chart.error.code || 'unknown'}`);
  }
  const result = chart && Array.isArray(chart.result) ? chart.result[0] : null;
  const meta = result && result.meta;
  if (!meta) throw new Error(`${entry.ticker} 行情响应缺少 meta`);

  const price = Number(meta.regularMarketPrice);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose);
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp.filter(Number.isFinite) : [];
  const quoteEpoch = Number(meta.regularMarketTime || timestamps.at(-1));
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quoteEpoch) || quoteEpoch <= 0) {
    throw new Error(`${entry.ticker} 行情价格或时间无效`);
  }

  const quoteTime = new Date(quoteEpoch * 1000).toISOString();
  const marketId = marketIdForEntry(entry);
  const timezone = MARKET_CONFIG[marketId].timezone;
  const change = Number.isFinite(previousClose) ? price - previousClose : null;
  const changePercent = Number.isFinite(previousClose) && previousClose > 0 ? (change / previousClose) * 100 : null;
  const symbol = yahooSymbol(entry);

  return {
    ticker: entry.ticker,
    symbol,
    market: marketId,
    currency: String(meta.currency || entry.currency || '').toUpperCase(),
    price: round(price, 4),
    previousClose: Number.isFinite(previousClose) ? round(previousClose, 4) : null,
    change: change === null ? null : round(change, 4),
    changePercent: changePercent === null ? null : round(changePercent, 3),
    quoteTime,
    quoteDate: zonedParts(new Date(quoteTime), timezone).date,
    fetchedAt,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`
  };
}

function selectedMarkets(requestedMarket, force, checkedAt) {
  const requested = requestedMarket === 'all' ? ['cn', 'us'] : requestedMarket === 'auto' ? ['cn', 'us'] : [requestedMarket];
  return requested.map((marketId) => {
    if (!MARKET_CONFIG[marketId]) throw new Error(`--market 仅支持 auto、all、cn 或 us，当前为 ${requestedMarket}`);
    const state = marketPhase(checkedAt, marketId);
    return force && state.phase === 'closed' ? { marketId, ...state, phase: 'manual' } : { marketId, ...state };
  }).filter((state) => force || state.phase !== 'closed');
}

async function loadPayload(entry, fixtureDirectory) {
  if (fixtureDirectory) {
    const fixturePath = path.join(fixtureDirectory, `${entry.ticker}-chart.json`);
    return JSON.parse(await readFile(fixturePath, 'utf8'));
  }
  const symbol = yahooSymbol(entry);
  if (!symbol) throw new Error(`${entry.ticker} 缺少可用的行情代码`);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  return fetchJson(url, {
    retries: 3,
    timeoutMs: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AI-CapEx-Cycle-Monitor/1.0)',
      'Accept-Language': 'en-US,en;q=0.8'
    }
  });
}

function quoteChanged(previous, next) {
  if (!previous) return true;
  return previous.quoteTime !== next.quoteTime
    || previous.price !== next.price
    || previous.previousClose !== next.previousClose
    || previous.currency !== next.currency;
}

export async function refreshMarketQuotes(options = {}) {
  const requestedMarket = String(options.market || 'auto').toLowerCase();
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const fixtureDirectory = options.fixtureDirectory ? path.resolve(ROOT_DIR, options.fixtureDirectory) : '';
  const checkedAtDate = options.checkedAt instanceof Date ? options.checkedAt : now();
  const checkedAt = checkedAtDate.toISOString();
  const targets = selectedMarkets(requestedMarket, force, checkedAtDate);

  if (!targets.length) {
    await setActionOutput('changed', false);
    await setActionOutput('markets', 'none');
    console.log(JSON.stringify({ checkedAt, requestedMarket, reason: 'outside-market-windows', changed: false }, null, 2));
    return { changed: false, markets: [], updatedTickers: [] };
  }

  const valuation = await readJson('data/valuation-bands.json');
  const current = await readJson('data/market-quotes.json');
  const entries = valuation.manualBuyZones && Array.isArray(valuation.manualBuyZones.entries)
    ? valuation.manualBuyZones.entries
    : [];
  const targetIds = new Set(targets.map((target) => target.marketId));
  const targetEntries = entries.filter((entry) => targetIds.has(marketIdForEntry(entry)));
  if (!targetEntries.length) throw new Error('没有找到需要刷新的重点标的行情配置。');

  const failures = [];
  const stale = [];
  const incoming = [];
  for (const entry of targetEntries) {
    try {
      const payload = await loadPayload(entry, fixtureDirectory);
      const quote = normalizeQuote(payload, entry, checkedAt);
      const target = targets.find((item) => item.marketId === quote.market);
      if (!force && quote.quoteDate !== target.sessionDate) {
        stale.push(entry.ticker);
      } else {
        incoming.push(quote);
      }
      if (!fixtureDirectory) await sleep(250);
    } catch (error) {
      failures.push({ ticker: entry.ticker, message: error.message });
    }
  }

  if (failures.length) {
    await setActionOutput('failed_tickers', failures.map((item) => item.ticker).join(','));
    throw new Error(`行情抓取失败，未写入数据：${failures.map((item) => `${item.ticker}: ${item.message}`).join(' | ')}`);
  }

  const completedAt = options.checkedAt instanceof Date ? checkedAt : now().toISOString();
  incoming.forEach((quote) => {
    quote.fetchedAt = completedAt;
  });

  const existingByTicker = new Map((current.quotes || []).map((quote) => [quote.ticker, quote]));
  const updates = incoming.filter((quote) => quoteChanged(existingByTicker.get(quote.ticker), quote));
  if (!updates.length) {
    await setActionOutput('changed', false);
    await setActionOutput('markets', targets.map((target) => target.marketId).join(','));
    await setActionOutput('updated_tickers', '');
    console.log(JSON.stringify({ checkedAt, requestedMarket, stale, reason: 'no-new-quotes', changed: false }, null, 2));
    return { changed: false, markets: targets.map((target) => target.marketId), updatedTickers: [] };
  }

  updates.forEach((quote) => existingByTicker.set(quote.ticker, quote));
  const entryOrder = new Map(entries.map((entry, index) => [entry.ticker, index]));
  const next = structuredClone(current);
  next.updatedAt = dateOnly(completedAt);
  next.fetchedAt = completedAt;
  next.quotes = Array.from(existingByTicker.values()).sort(
    (left, right) => (entryOrder.get(left.ticker) ?? 999) - (entryOrder.get(right.ticker) ?? 999)
  );
  next.sessions = next.sessions && typeof next.sessions === 'object' ? next.sessions : { cn: null, us: null };
  for (const target of targets) {
    const marketUpdates = updates.filter((quote) => quote.market === target.marketId);
    if (!marketUpdates.length) continue;
    next.sessions[target.marketId] = {
      phase: target.phase,
      sessionDate: target.sessionDate,
      timezone: target.timezone,
      refreshedAt: completedAt,
      quoteCount: marketUpdates.length,
      staleTickers: stale.filter((ticker) => targetEntries.some((entry) => entry.ticker === ticker && marketIdForEntry(entry) === target.marketId))
    };
  }

  const changed = await writeJsonIfChanged('data/market-quotes.json', next, { dryRun });
  await setActionOutput('changed', changed);
  await setActionOutput('markets', targets.map((target) => target.marketId).join(','));
  await setActionOutput('updated_tickers', updates.map((quote) => quote.ticker).join(','));
  await setActionOutput('failed_tickers', '');

  console.log(JSON.stringify({
    checkedAt,
    requestedMarket,
    dryRun,
    force,
    markets: targets.map((target) => ({ id: target.marketId, phase: target.phase, sessionDate: target.sessionDate })),
    updatedTickers: updates.map((quote) => quote.ticker),
    stale,
    changed
  }, null, 2));
  return { changed, markets: targets.map((target) => target.marketId), updatedTickers: updates.map((quote) => quote.ticker) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = parseArgs();
  await refreshMarketQuotes({
    market: args.market || 'auto',
    dryRun: Boolean(args['dry-run']),
    force: Boolean(args.force),
    fixtureDirectory: args['fixture-dir'] || ''
  });
}
