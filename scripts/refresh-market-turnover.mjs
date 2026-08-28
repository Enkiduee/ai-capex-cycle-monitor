import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dateOnly,
  now,
  parseArgs,
  readJson,
  setActionOutput,
  sleep,
  writeJsonIfChanged
} from './lib/refresh-utils.mjs';

const OUTPUT_FILE = 'data/market-turnover.json';
const MAX_OBSERVATIONS = 260;
const DEFAULT_BACKFILL = 1;
const USER_AGENT = 'Mozilla/5.0 (compatible; AI-CapEx-Cycle-Monitor/1.0)';
const MONTHS = Object.freeze({
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
});

const MARKET_METADATA = Object.freeze({
  cn: {
    id: 'cn',
    name: 'A 股',
    currency: 'CNY',
    timezone: 'Asia/Shanghai',
    closeTime: '15:00',
    definition: '上交所主板 A 股与科创板成交额，加上深交所股票成交额；不含上交所 B 股。',
    sourceLabel: '上海证券交易所 + 深圳证券交易所',
    sourceUrl: 'https://www.sse.com.cn/market/stockdata/overview/day/',
    secondarySourceUrl: 'https://www.szse.cn/market/stock/situation/daily/index.html'
  },
  hk: {
    id: 'hk',
    name: '港股',
    currency: 'HKD',
    timezone: 'Asia/Hong_Kong',
    closeTime: '16:00',
    definition: '恒生指数行情口径附带的港股主板成交额；不含 GEM，使用第三方日线快照。',
    sourceLabel: '东方财富港股主板日线快照',
    sourceUrl: 'https://quote.eastmoney.com/zsHSI.html'
  },
  nasdaq: {
    id: 'nasdaq',
    name: '纳斯达克',
    currency: 'USD',
    timezone: 'America/New_York',
    closeTime: '16:00',
    definition: 'Nasdaq 上市证券在所有交易场所成交的 consolidated dollar volume。',
    sourceLabel: 'Nasdaq Trader Daily Market Statistics',
    sourceUrl: 'https://www.nasdaqtrader.com/Trader.aspx?id=DailyMarketFiles'
  }
});

function isoDateInTimezone(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function shiftDate(date, offset) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function isWeekday(date) {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function compactDate(date) {
  return date.replaceAll('-', '').slice(2);
}

function numeric(value) {
  const number = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(number) ? number : null;
}

async function fetchText(url, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 2;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 25000;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/plain,text/html,*/*', 'User-Agent': USER_AGENT, ...options.headers },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok) return await response.text();
      if (response.status !== 404 && response.status < 500) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
      }
      if (attempt >= retries) return '';
    } catch (error) {
      if (attempt >= retries) throw error;
      console.warn(`[turnover] 请求失败，准备重试 ${attempt + 1}/${retries}: ${url} (${error.message})`);
    }
    await sleep(700 * (attempt + 1));
  }
  return '';
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers }
  });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败：${url} (${error.message})`);
  }
}

function sseUrl(date = '') {
  const url = new URL('https://query.sse.com.cn/commonQuery.do');
  url.searchParams.set('sqlId', 'COMMON_SSE_SJ_GPSJ_CJGK_MRGK_C');
  url.searchParams.set('PRODUCT_CODE', '01,02,03,11,17');
  url.searchParams.set('type', 'inParams');
  url.searchParams.set('SEARCH_DATE', date);
  return url;
}

export function normalizeSseTurnover(payload, expectedDate = '') {
  const rows = payload && Array.isArray(payload.result) ? payload.result : [];
  const aShareRows = rows.filter((row) => ['01', '03'].includes(String(row.PRODUCT_CODE)));
  if (aShareRows.length !== 2) return null;
  const rawDate = String(aShareRows[0].TRADE_DATE || '');
  const date = /^\d{8}$/.test(rawDate)
    ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}`
    : '';
  if (!date || (expectedDate && date !== expectedDate)) return null;
  const mainBoardYi = numeric(aShareRows.find((row) => String(row.PRODUCT_CODE) === '01')?.TRADE_AMT);
  const starMarketYi = numeric(aShareRows.find((row) => String(row.PRODUCT_CODE) === '03')?.TRADE_AMT);
  if (![mainBoardYi, starMarketYi].every((value) => value !== null && value >= 0)) return null;
  return {
    date,
    turnover: Math.round((mainBoardYi + starMarketYi) * 1e8),
    breakdown: {
      sseMainBoardA: Math.round(mainBoardYi * 1e8),
      sseStarMarket: Math.round(starMarketYi * 1e8)
    }
  };
}

export function normalizeSzseTurnover(payload, expectedDate) {
  const report = Array.isArray(payload) ? payload[0] : null;
  const rows = report && Array.isArray(report.data) ? report.data : [];
  const amountRow = rows.find((row) => String(row.zbmc || '').includes('成交金额'));
  const amountYi = numeric(amountRow && amountRow.gp);
  const reportedDate = report && report.metadata && Array.isArray(report.metadata.conditions)
    ? report.metadata.conditions.find((condition) => condition.name === 'txtQueryDate')?.defaultValue
    : '';
  if (!amountRow || amountYi === null || amountYi < 0 || reportedDate !== expectedDate) return null;
  return {
    date: expectedDate,
    turnover: Math.round(amountYi * 1e8)
  };
}

async function loadCnObservation(date = '') {
  const ssePayload = await fetchJson(sseUrl(date), {
    headers: { Referer: 'https://www.sse.com.cn/' }
  });
  const sse = normalizeSseTurnover(ssePayload, date);
  if (!sse) return null;

  const szseUrl = new URL('https://www.szse.cn/api/report/ShowReport/data');
  szseUrl.searchParams.set('SHOWTYPE', 'JSON');
  szseUrl.searchParams.set('CATALOGID', 'scsj_gprdgk_after');
  szseUrl.searchParams.set('TABKEY', 'tab1');
  szseUrl.searchParams.set('txtQueryDate', sse.date);
  const szsePayload = await fetchJson(szseUrl, {
    headers: { Referer: MARKET_METADATA.cn.secondarySourceUrl }
  });
  const szse = normalizeSzseTurnover(szsePayload, sse.date);
  if (!szse) return null;

  return {
    date: sse.date,
    turnover: sse.turnover + szse.turnover,
    breakdown: { ...sse.breakdown, szseStocks: szse.turnover }
  };
}

function hkexDateFromText(text) {
  const match = String(text || '').match(/DATE:\s*(\d{2})\s+([A-Z]{3})\s+(\d{4})/i);
  if (!match) return '';
  const month = MONTHS[match[2].toUpperCase()];
  return month ? `${match[3]}-${month}-${match[1]}` : '';
}

export function normalizeHkexReport(text, expectedDate = '') {
  const date = hkexDateFromText(text);
  if (!date || (expectedDate && date !== expectedDate)) return null;
  const turnoverMatch = String(text || '').match(/Today's Turnover:[\s\S]{0,180}?\(HK\$\):\s*([\d,]+)/i);
  const cnyMatch = String(text || '').match(/Renminbi Products Turnover \(CNY\):\s*([\d,]+)/i);
  const turnover = numeric(turnoverMatch && turnoverMatch[1]);
  const cnyTurnover = numeric(cnyMatch && cnyMatch[1]);
  if (turnover === null || turnover < 0) return null;
  return { date, turnover: Math.round(turnover), cnyTurnover: Math.round(cnyTurnover || 0) };
}

async function loadHkObservation(date) {
  const code = compactDate(date);
  const mainUrl = `https://www.hkex.com.hk/eng/stat/smstat/dayquot/d${code}e.htm`;
  const gemUrl = `https://www.hkex.com.hk/eng/stat/smstat/dayquot/GEM/e_G${code}.htm`;
  const [mainText, gemText] = await Promise.all([
    fetchText(mainUrl, { retries: 1 }),
    fetchText(gemUrl, { retries: 1 })
  ]);
  const main = normalizeHkexReport(mainText, date);
  const gem = normalizeHkexReport(gemText, date);
  if (!main || !gem) return null;
  return {
    date,
    turnover: main.turnover + gem.turnover,
    breakdown: {
      mainBoardHkd: main.turnover,
      gemHkd: gem.turnover,
      renminbiProductsCny: main.cnyTurnover + gem.cnyTurnover
    }
  };
}

export function normalizeEastmoneyHkFile(payload) {
  const rows = payload && payload.data && Array.isArray(payload.data.klines) ? payload.data.klines : [];
  return rows.flatMap((line) => {
    const columns = String(line || '').split(',');
    const date = columns[0];
    const shareVolume = numeric(columns[5]);
    const turnover = numeric(columns[6]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || turnover === null || turnover <= 0) return [];
    return [{
      date,
      turnover: Math.round(turnover),
      breakdown: { shareVolume: Math.round(shareVolume || 0) }
    }];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

async function loadHkObservations(referenceDate, backfill) {
  const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
  url.searchParams.set('secid', '100.HSI');
  url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
  url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
  url.searchParams.set('klt', '101');
  url.searchParams.set('fqt', '1');
  url.searchParams.set('beg', shiftDate(referenceDate, -Math.max(backfill * 3, 15)).replaceAll('-', ''));
  url.searchParams.set('end', referenceDate.replaceAll('-', ''));
  return normalizeEastmoneyHkFile(await fetchJson(url));
}

function csvColumns(line) {
  return String(line || '').split(',').map((value) => value.replace(/^"|"$/g, '').trim());
}

export function normalizeNasdaqFile(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = csvColumns(lines[0]);
  const dateIndex = headers.indexOf('Date');
  const volumeIndex = headers.indexOf('Volume');
  const dollarVolumeIndex = headers.indexOf('DolVol');
  if ([dateIndex, volumeIndex, dollarVolumeIndex].some((index) => index < 0)) return [];

  return lines.slice(1).flatMap((line) => {
    const columns = csvColumns(line);
    const match = columns[dateIndex]?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const turnover = numeric(columns[dollarVolumeIndex]);
    const shareVolume = numeric(columns[volumeIndex]);
    if (!match || turnover === null || turnover <= 0 || shareVolume === null || shareVolume <= 0) return [];
    const date = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    return [{
      date,
      turnover: Math.round(turnover),
      breakdown: { shareVolume: Math.round(shareVolume) }
    }];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

async function loadNasdaqObservations(referenceDate) {
  const years = [Number(referenceDate.slice(0, 4))];
  if (referenceDate.slice(5, 7) === '01') years.push(years[0] - 1);
  const batches = await Promise.all(years.map(async (year) => {
    const url = `https://www.nasdaqtrader.com/dynamic/dailyfiles/daily${year}.txt`;
    return normalizeNasdaqFile(await fetchText(url));
  }));
  return batches.flat().sort((left, right) => left.date.localeCompare(right.date));
}

function mergeObservations(existing, incoming) {
  const byDate = new Map((Array.isArray(existing) ? existing : []).map((item) => [item.date, item]));
  incoming.forEach((item) => byDate.set(item.date, item));
  return Array.from(byDate.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-MAX_OBSERVATIONS);
}

async function scanWeekdays(startDate, targetCount, loader, options = {}) {
  const observations = [];
  const maxCalendarDays = Math.max(targetCount * 3, 12);
  for (let offset = 0; offset < maxCalendarDays && observations.length < targetCount; offset += 1) {
    const date = shiftDate(startDate, -offset);
    if (!isWeekday(date)) continue;
    try {
      const observation = await loader(date);
      if (observation) observations.push(observation);
    } catch (error) {
      console.warn(`[turnover] ${options.label || '市场'} ${date} 暂不可用：${error.message}`);
    }
    if (options.delayMs) await sleep(options.delayMs);
  }
  return observations.sort((left, right) => left.date.localeCompare(right.date));
}

function selectedMarkets(requested) {
  const normalized = String(requested || 'all').toLowerCase();
  if (normalized === 'all') return ['cn', 'hk', 'nasdaq'];
  if (normalized === 'asia') return ['cn', 'hk'];
  if (Object.hasOwn(MARKET_METADATA, normalized)) return [normalized];
  throw new Error(`--market 仅支持 all、asia、cn、hk 或 nasdaq，当前为 ${requested}`);
}

function basePayload(current) {
  const existingById = new Map((current && Array.isArray(current.markets) ? current.markets : []).map((market) => [market.id, market]));
  return {
    version: 1,
    updatedAt: current?.updatedAt || dateOnly(now()),
    fetchedAt: current?.fetchedAt || null,
    isDemoData: false,
    methodology: {
      comparison: '趋势图以各市场最近最多 20 个有效交易日的平均成交额为 100；卡片和明细表保留各市场原币种。',
      retention: `每个市场最多保留最近 ${MAX_OBSERVATIONS} 个交易日。`,
      caveat: '三地统计范围不同，适合观察各自流动性变化，不适合直接比较绝对金额大小。'
    },
    markets: Object.keys(MARKET_METADATA).map((id) => ({
      ...MARKET_METADATA[id],
      observations: existingById.get(id)?.observations || []
    }))
  };
}

export async function refreshMarketTurnover(options = {}) {
  const requestedMarket = options.market || 'all';
  const dryRun = Boolean(options.dryRun);
  const requestedBackfill = Number(options.backfill ?? DEFAULT_BACKFILL);
  const backfill = Number.isInteger(requestedBackfill) && requestedBackfill > 0
    ? Math.min(requestedBackfill, MAX_OBSERVATIONS)
    : DEFAULT_BACKFILL;
  const checkedAtDate = options.checkedAt instanceof Date ? options.checkedAt : now();
  const checkedAt = checkedAtDate.toISOString();
  const targets = selectedMarkets(requestedMarket);
  const current = await readJson(OUTPUT_FILE).catch(() => null);
  const next = basePayload(current);
  const marketById = new Map(next.markets.map((market) => [market.id, market]));
  const updatedMarkets = [];

  for (const marketId of targets) {
    const market = marketById.get(marketId);
    let incoming = [];
    try {
      if (marketId === 'cn') {
        const latest = await loadCnObservation();
        if (latest) {
          incoming = backfill > 1
            ? await scanWeekdays(latest.date, backfill, loadCnObservation, { label: 'A 股', delayMs: 120 })
            : [latest];
        }
      } else if (marketId === 'hk') {
        const localDate = isoDateInTimezone(checkedAtDate, MARKET_METADATA.hk.timezone);
        incoming = (await loadHkObservations(localDate, backfill)).slice(-backfill);
      } else if (marketId === 'nasdaq') {
        const localDate = isoDateInTimezone(checkedAtDate, MARKET_METADATA.nasdaq.timezone);
        incoming = (await loadNasdaqObservations(localDate)).slice(-backfill);
      }
    } catch (error) {
      console.warn(`[turnover] ${MARKET_METADATA[marketId].name} 上游请求失败，保留最近有效快照：${error.message}`);
      continue;
    }

    if (!incoming.length) {
      console.warn(`[turnover] ${MARKET_METADATA[marketId].name} 没有取得新的有效日终数据，保留现有快照。`);
      continue;
    }
    const previousSnapshot = JSON.stringify(market.observations);
    market.observations = mergeObservations(market.observations, incoming);
    if (JSON.stringify(market.observations) !== previousSnapshot) {
      updatedMarkets.push(marketId);
    }
  }

  if (!next.markets.every((market) => market.observations.length > 0)) {
    throw new Error('三地市场至少各需要一条有效成交额记录，未写入不完整数据。');
  }

  if (!updatedMarkets.length) {
    await setActionOutput('changed', false);
    await setActionOutput('markets', targets.join(','));
    await setActionOutput('latest_dates', next.markets.map((market) => `${market.id}:${market.observations.at(-1)?.date}`).join(','));
    console.log(JSON.stringify({
      checkedAt,
      requestedMarket,
      backfill,
      dryRun,
      updatedMarkets: [],
      changed: false,
      reason: 'no-new-turnover-records'
    }, null, 2));
    return { changed: false, markets: targets, updatedMarkets: [] };
  }

  const latestDates = next.markets.map((market) => market.observations.at(-1)?.date).filter(Boolean).sort();
  next.updatedAt = latestDates.at(-1) || dateOnly(checkedAt);
  next.fetchedAt = checkedAt;
  const changed = await writeJsonIfChanged(OUTPUT_FILE, next, { dryRun });
  await setActionOutput('changed', changed);
  await setActionOutput('markets', targets.join(','));
  await setActionOutput('latest_dates', next.markets.map((market) => `${market.id}:${market.observations.at(-1)?.date}`).join(','));

  console.log(JSON.stringify({
    checkedAt,
    requestedMarket,
    backfill,
    dryRun,
    updatedMarkets,
    changed,
    latestDates: Object.fromEntries(next.markets.map((market) => [market.id, market.observations.at(-1)?.date]))
  }, null, 2));
  return { changed, markets: targets, updatedMarkets };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = parseArgs();
  await refreshMarketTurnover({
    market: args.market || 'all',
    backfill: args.backfill || DEFAULT_BACKFILL,
    dryRun: Boolean(args['dry-run'])
  });
}
