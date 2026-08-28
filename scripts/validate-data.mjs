import { readJson } from './lib/refresh-utils.mjs';

const files = [
  'data/risk-score.json',
  'data/hyperscalers.json',
  'data/market-turnover.json',
  'data/supply-chain.json',
  'data/stock-watchlist.json',
  'data/hk-watchlist.json',
  'data/us-watchlist.json',
  'data/market-quotes.json',
  'data/valuation-coverage.json',
  'data/valuation-bands.json',
  'data/insider-sales.json',
  'data/macro.json',
  'data/events.json'
];

const payloads = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readJson(file)])));
const supply = payloads['data/supply-chain.json'];
const hyperscalers = payloads['data/hyperscalers.json'];
const marketTurnover = payloads['data/market-turnover.json'];
const stockWatchlist = payloads['data/stock-watchlist.json'];
const hkWatchlist = payloads['data/hk-watchlist.json'];
const usWatchlist = payloads['data/us-watchlist.json'];
const marketQuotes = payloads['data/market-quotes.json'];
const valuationCoverage = payloads['data/valuation-coverage.json'];
const valuation = payloads['data/valuation-bands.json'];
const insiderSales = payloads['data/insider-sales.json'];
const events = payloads['data/events.json'];
const risk = payloads['data/risk-score.json'];
const secState = await readJson('data/sec-filings-state.json');
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function validIso(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

for (const [file, payload] of Object.entries(payloads)) {
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), `${file} 顶层必须是对象`);
  assert(validDate(payload.updatedAt), `${file}.updatedAt 必须是 YYYY-MM-DD`);
}

assert(hyperscalers.units && hyperscalers.units.capex === '亿美元', '云巨头 CapEx 必须以亿美元为单位');
assert(!/(?:十|百|千|万)亿|(?:十|百|千)万/.test(JSON.stringify(payloads)), '数据文本不能使用复合中文数量级');

assert(marketTurnover.version === 3, 'market-turnover.version 必须为 3');
assert(marketTurnover.isDemoData === false, 'market-turnover 必须明确标为真实数据');
assert(validIso(marketTurnover.fetchedAt), 'market-turnover.fetchedAt 必须为 ISO UTC 时间');
assert(marketTurnover.fx && marketTurnover.fx.base === 'USD', 'market-turnover.fx.base 必须为 USD');
assert(marketTurnover.fx && marketTurnover.fx.basis === 'daily_reference_rate', 'market-turnover.fx.basis 必须为 daily_reference_rate');
assert(typeof (marketTurnover.fx && marketTurnover.fx.sourceLabel) === 'string' && marketTurnover.fx.sourceLabel.trim(), 'market-turnover.fx.sourceLabel 不能为空');
for (const currency of ['CNY', 'HKD']) {
  const snapshot = marketTurnover.fx && marketTurnover.fx.rates && marketTurnover.fx.rates[currency];
  assert(snapshot && snapshot.pair === `USD/${currency}`, `market-turnover.fx.rates.${currency}.pair 无效`);
  assert(Number.isFinite(snapshot && snapshot.rate) && snapshot.rate > 0, `market-turnover.fx.rates.${currency}.rate 必须为正数`);
  assert(validIso(snapshot && snapshot.quoteTime), `market-turnover.fx.rates.${currency}.quoteTime 必须为 ISO UTC 时间`);
  assert(validIso(snapshot && snapshot.fetchedAt), `market-turnover.fx.rates.${currency}.fetchedAt 必须为 ISO UTC 时间`);
  const fxObservations = Array.isArray(snapshot && snapshot.observations) ? snapshot.observations : [];
  assert(fxObservations.length >= 260 && fxObservations.length <= 400, `market-turnover.fx.rates.${currency}.observations 必须覆盖至少一年`);
  assert(new Set(fxObservations.map((item) => item.date)).size === fxObservations.length, `market-turnover.fx.rates.${currency}.observations 日期不能重复`);
  for (let index = 0; index < fxObservations.length; index += 1) {
    const item = fxObservations[index];
    assert(validDate(item.date), `market-turnover.fx.rates.${currency} 汇率日期无效：${item.date}`);
    assert(Number.isFinite(item.rate) && item.rate > 0, `market-turnover.fx.rates.${currency} ${item.date} 汇率必须为正数`);
    if (index > 0) assert(fxObservations[index - 1].date < item.date, `market-turnover.fx.rates.${currency}.observations 必须按日期升序`);
  }
  try {
    const sourceUrl = new URL(snapshot && snapshot.sourceUrl);
    assert(sourceUrl.protocol === 'https:', `market-turnover.fx.rates.${currency}.sourceUrl 必须使用 HTTPS`);
  } catch (error) {
    errors.push(`market-turnover.fx.rates.${currency}.sourceUrl 无效`);
  }
}
for (const key of ['comparison', 'retention', 'caveat']) {
  assert(
    typeof (marketTurnover.methodology && marketTurnover.methodology[key]) === 'string'
      && marketTurnover.methodology[key].trim(),
    `market-turnover.methodology.${key} 不能为空`
  );
}
const turnoverMarkets = Array.isArray(marketTurnover.markets) ? marketTurnover.markets : [];
assert(
  JSON.stringify(turnoverMarkets.map((market) => market.id)) === JSON.stringify(['cn', 'hk', 'nasdaq']),
  'market-turnover.markets 必须按 cn、hk、nasdaq 排列'
);
const turnoverCurrencies = { cn: 'CNY', hk: 'HKD', nasdaq: 'USD' };
const turnoverTimezones = { cn: 'Asia/Shanghai', hk: 'Asia/Hong_Kong', nasdaq: 'America/New_York' };
for (const market of turnoverMarkets) {
  const marketId = String(market && market.id || '');
  assert(typeof market.name === 'string' && market.name.trim(), `${marketId}.name 不能为空`);
  assert(market.currency === turnoverCurrencies[marketId], `${marketId}.currency 无效`);
  assert(market.timezone === turnoverTimezones[marketId], `${marketId}.timezone 无效`);
  assert(/^\d{2}:\d{2}$/.test(String(market.closeTime || '')), `${marketId}.closeTime 无效`);
  assert(typeof market.definition === 'string' && market.definition.trim(), `${marketId}.definition 不能为空`);
  assert(typeof market.sourceLabel === 'string' && market.sourceLabel.trim(), `${marketId}.sourceLabel 不能为空`);
  try {
    const sourceUrl = new URL(market.sourceUrl);
    assert(sourceUrl.protocol === 'https:', `${marketId}.sourceUrl 必须使用 HTTPS`);
  } catch (error) {
    errors.push(`${marketId}.sourceUrl 无效`);
  }
  const observations = Array.isArray(market.observations) ? market.observations : [];
  assert(observations.length >= 240 && observations.length <= 260, `${marketId}.observations 必须包含 240..260 条记录，以覆盖最近一年`);
  assert(new Set(observations.map((item) => item.date)).size === observations.length, `${marketId}.observations 日期不能重复`);
  for (let index = 0; index < observations.length; index += 1) {
    const item = observations[index];
    assert(validDate(item.date), `${marketId} 成交额日期无效：${item.date}`);
    assert(item.date <= marketTurnover.updatedAt, `${marketId} 成交额日期晚于 updatedAt：${item.date}`);
    if (index > 0) assert(observations[index - 1].date < item.date, `${marketId}.observations 必须按日期升序`);
    assert(Number.isSafeInteger(item.turnover) && item.turnover > 0, `${marketId} ${item.date} turnover 必须是安全正整数`);
    assert(item.breakdown && typeof item.breakdown === 'object' && !Array.isArray(item.breakdown), `${marketId} ${item.date} breakdown 必须是对象`);
    for (const [key, value] of Object.entries(item.breakdown || {})) {
      assert(Number.isSafeInteger(value) && value >= 0, `${marketId} ${item.date} breakdown.${key} 必须是安全非负整数`);
    }
  }
}

assert(insiderSales.version === 2, 'insider-sales.version 必须为 2');
assert(validDate(insiderSales.window && insiderSales.window.start), 'insider-sales.window.start 无效');
assert(validDate(insiderSales.window && insiderSales.window.end), 'insider-sales.window.end 无效');
assert(insiderSales.window.start <= insiderSales.window.end, '减持雷达观察窗口起始日不能晚于结束日');
const insiderWindowDays = Math.round((Date.parse(insiderSales.window.end) - Date.parse(insiderSales.window.start)) / 86400000) + 1;
assert(insiderWindowDays === 365, '减持雷达必须覆盖滚动 365 日');
const insiderCompanies = Array.isArray(insiderSales.companies) ? insiderSales.companies : [];
assert(insiderCompanies.length === 12, '减持雷达必须覆盖 12 只重点标的');
assert(new Set(insiderCompanies.map((company) => company.ticker)).size === insiderCompanies.length, '减持雷达 ticker 不能重复');
assert(insiderSales.scope && insiderSales.scope.total === insiderCompanies.length, '减持雷达 scope.total 必须与公司数一致');
const comparableInsiderCompanies = insiderCompanies.filter((company) => company.coverage === 'covered');
assert(insiderSales.scope.comparableCoverage === comparableInsiderCompanies.length, '减持雷达可比覆盖数不一致');
const executedShares = comparableInsiderCompanies.reduce((total, company) => total + Number(company.executed && company.executed.shares || 0), 0);
const executedValueUsd = comparableInsiderCompanies.reduce((total, company) => total + Number(company.executed && company.executed.valueUsd || 0), 0);
const executedValueCny = comparableInsiderCompanies.reduce((total, company) => total + Number(company.executed && company.executed.valueCny || 0), 0);
const pendingShares = comparableInsiderCompanies.reduce((total, company) => total + Number(company.pending && company.pending.shares || 0), 0);
const pendingValueUsd = comparableInsiderCompanies.reduce((total, company) => total + Number(company.pending && company.pending.valueUsd || 0), 0);
const noticeShares = comparableInsiderCompanies.reduce((total, company) => total + Number(company.notices && company.notices.shares || 0), 0);
const noticeValueUsd = comparableInsiderCompanies.reduce((total, company) => total + Number(company.notices && company.notices.valueUsd || 0), 0);
assert(insiderSales.summary.executedShares === executedShares, '减持雷达已售股份汇总不一致');
assert(Math.abs(insiderSales.summary.executedValueUsd - executedValueUsd) < 0.01, '减持雷达已售金额汇总不一致');
assert(Math.abs(insiderSales.summary.executedValueCny - executedValueCny) < 0.01, '减持雷达人民币已售金额汇总不一致');
assert(insiderSales.summary.pendingShares === pendingShares, '减持雷达待确认拟售股份汇总不一致');
assert(Math.abs(insiderSales.summary.pendingValueUsd - pendingValueUsd) < 0.01, '减持雷达待确认拟售金额汇总不一致');
assert(insiderSales.summary.noticeShares === noticeShares, '减持雷达拟售通知股份汇总不一致');
assert(Math.abs(insiderSales.summary.noticeValueUsd - noticeValueUsd) < 0.01, '减持雷达拟售通知金额汇总不一致');
for (const company of insiderCompanies) {
  assert(typeof company.ticker === 'string' && company.ticker.trim(), '减持雷达公司 ticker 不能为空');
  assert(typeof company.name === 'string' && company.name.trim(), `${company.ticker}.name 不能为空`);
  assert(['covered', 'excluded'].includes(company.coverage), `${company.ticker}.coverage 无效`);
  assert(typeof company.sourceUrl === 'string' && /^https:\/\//.test(company.sourceUrl), `${company.ticker}.sourceUrl 无效`);
}
const saleTimeline = Array.isArray(insiderSales.timeline) ? insiderSales.timeline : [];
assert(saleTimeline.length > 0, '减持雷达披露流水不能为空');
for (const item of saleTimeline) {
  assert(validDate(item.date), `减持流水日期无效：${item.date}`);
  assert(item.date >= insiderSales.window.start && item.date <= insiderSales.window.end, `减持流水超出观察窗口：${item.date}`);
  assert(['executed', 'executed-discretionary', 'pending'].includes(item.kind), `减持流水 kind 无效：${item.kind}`);
}
const timelineExecuted = saleTimeline.filter((item) => item.kind.startsWith('executed'));
const timelinePending = saleTimeline.filter((item) => item.kind === 'pending');
assert(timelineExecuted.reduce((total, item) => total + item.shares, 0) === executedShares, '减持流水已售股份与公司汇总不一致');
assert(Math.abs(timelineExecuted.reduce((total, item) => total + item.valueUsd, 0) - executedValueUsd) < 0.01, '减持流水已售金额与公司汇总不一致');
assert(Math.abs(timelineExecuted.reduce((total, item) => total + Number(item.valueCny || 0), 0) - executedValueCny) < 0.01, '减持流水人民币已售金额与公司汇总不一致');
assert(timelinePending.reduce((total, item) => total + item.shares, 0) === pendingShares, '减持流水待确认拟售股份与公司汇总不一致');
assert(Math.abs(timelinePending.reduce((total, item) => total + item.valueUsd, 0) - pendingValueUsd) < 0.01, '减持流水待确认拟售金额与公司汇总不一致');

const financing = insiderSales.financing || {};
assert(validDate(financing.window && financing.window.start), 'financing.window.start 无效');
assert(validDate(financing.window && financing.window.end), 'financing.window.end 无效');
assert(financing.window.start <= financing.window.end, '公司融资观察窗口起始日不能晚于结束日');
const financingEvents = Array.isArray(financing.events) ? financing.events : [];
assert(financingEvents.length > 0, '公司融资事件不能为空');
for (const event of financingEvents) {
  assert(validDate(event.date), `公司融资事件日期无效：${event.date}`);
  assert(event.date >= financing.window.start && event.date <= financing.window.end, `公司融资事件超出观察窗口：${event.date}`);
  assert(insiderCompanies.some((company) => company.ticker === event.ticker), `公司融资事件 ticker 不在重点标的中：${event.ticker}`);
  assert(['equity', 'debt', 'convertible'].includes(event.channel), `公司融资事件 channel 无效：${event.channel}`);
  assert(Number(event.amountUsd || 0) >= 0 && Number(event.amountEur || 0) >= 0, `公司融资事件金额无效：${event.ticker} ${event.date}`);
  assert(Number(event.amountUsd || 0) + Number(event.amountEur || 0) > 0, `公司融资事件金额不能为零：${event.ticker} ${event.date}`);
  assert(typeof event.sourceUrl === 'string' && /^https:\/\//.test(event.sourceUrl), `公司融资事件来源无效：${event.ticker} ${event.date}`);
}
const financingTickers = new Set(financingEvents.map((event) => event.ticker));
assert(financing.scope && financing.scope.totalCompanies === insiderCompanies.length, '公司融资 scope.totalCompanies 必须与重点标的数一致');
assert(financing.scope.enteredCompanies === financingTickers.size, '公司融资已录入公司数不一致');
const equityFinancing = financingEvents.filter((event) => event.channel === 'equity');
const debtFinancing = financingEvents.filter((event) => event.channel !== 'equity');
const sumFinancing = (events, currency) => events.reduce((total, event) => total + Number(event[currency] || 0), 0);
assert(financing.summary.eventCount === financingEvents.length, '公司融资事件汇总数不一致');
assert(financing.summary.equityEventCount === equityFinancing.length, '公司股权融资事件数不一致');
assert(financing.summary.debtAndConvertibleEventCount === debtFinancing.length, '公司债务与可转债事件数不一致');
assert(financing.summary.equityValueUsd === sumFinancing(equityFinancing, 'amountUsd'), '公司股权融资美元规模不一致');
assert(financing.summary.equityValueEur === sumFinancing(equityFinancing, 'amountEur'), '公司股权融资欧元规模不一致');
assert(financing.summary.debtAndConvertibleValueUsd === sumFinancing(debtFinancing, 'amountUsd'), '公司债务与可转债美元规模不一致');
assert(financing.summary.debtAndConvertibleValueEur === sumFinancing(debtFinancing, 'amountEur'), '公司债务与可转债欧元规模不一致');

assert(stockWatchlist.version === 2, 'stock-watchlist.version 必须为 2');
assert(stockWatchlist.source && typeof stockWatchlist.source.label === 'string' && stockWatchlist.source.label.trim(), 'stock-watchlist.source.label 不能为空');
assert(stockWatchlist.source && typeof stockWatchlist.source.notice === 'string' && stockWatchlist.source.notice.trim(), 'stock-watchlist.source.notice 不能为空');
const stockMarkets = Array.isArray(stockWatchlist.markets) ? stockWatchlist.markets : [];
assert(
  JSON.stringify(stockMarkets.map((market) => market.id)) === JSON.stringify(['cn', 'hk', 'us']),
  '股票观察池必须按 cn、hk、us 定义沪深、港股和美股分类'
);
const stockEntries = Array.isArray(stockWatchlist.entries) ? stockWatchlist.entries : [];
assert(stockEntries.length === 87, '股票资料目录必须包含 87 个沪深标的');
const stockEntryKeys = new Set();
for (const entry of stockEntries) {
  const key = `${entry.exchange}:${entry.ticker}`;
  assert(!stockEntryKeys.has(key), `股票观察池标的重复：${key}`);
  stockEntryKeys.add(key);
  assert(/^\d{6}$/.test(String(entry.ticker || '')), `${key}.ticker 必须是 6 位数字`);
  assert(typeof entry.name === 'string' && entry.name.trim(), `${key}.name 不能为空`);
  assert(['SH', 'SZ'].includes(entry.exchange), `${key}.exchange 必须是 SH 或 SZ`);
  assert(entry.market === 'cn', `${key}.market 必须是 cn`);
  assert(['stock', 'etf', 'index'].includes(entry.type), `${key}.type 无效`);
  assert(entry.currency === 'CNY', `${key}.currency 必须是 CNY`);
  for (const field of ['price', 'change', 'changePercent', 'volume', 'marketCapCnyYi', 'periodChangePercent']) {
    assert(!(field in entry), `${key} 不应保存截图行情字段 ${field}`);
  }
}

assert(hkWatchlist.version === 2, 'hk-watchlist.version 必须为 2');
assert(hkWatchlist.source && typeof hkWatchlist.source.label === 'string' && hkWatchlist.source.label.trim(), 'hk-watchlist.source.label 不能为空');
assert(hkWatchlist.source && typeof hkWatchlist.source.notice === 'string' && hkWatchlist.source.notice.trim(), 'hk-watchlist.source.notice 不能为空');
const hkEntries = Array.isArray(hkWatchlist.entries) ? hkWatchlist.entries : [];
const expectedHkTickers = [
  '07709', '07747', '02513', '09903', '00100', '00992', '01879', '06082', '01021', '03986', '06809',
  '09880', '06869', '89988', '02013', '03454', '09866', '00005', '09988', '00981', '00020', '01347',
  '00853', '00700', 'BK2526', '09626', '02512', '01093', '09992', '01211', '02015', '01768', '01810', '06880'
];
assert(hkEntries.length === 34, '港股资料目录必须包含 34 个不重复标的');
assert(
  JSON.stringify(hkEntries.map((entry) => entry.ticker)) === JSON.stringify(expectedHkTickers),
  '港股资料目录必须包含指定标的并保持录入顺序'
);
const hkEntryKeys = new Set();
for (const entry of hkEntries) {
  const ticker = String(entry && entry.ticker || '');
  assert(/^(?:\d{5}|BK\d{4})$/.test(ticker), `港股观察池 ticker 无效：${ticker}`);
  assert(!hkEntryKeys.has(ticker), `港股观察池标的重复：${ticker}`);
  hkEntryKeys.add(ticker);
  assert(typeof entry.name === 'string' && entry.name.trim(), `${ticker}.name 不能为空`);
  assert(entry.exchange === 'HKEX', `${ticker}.exchange 必须是 HKEX`);
  assert(entry.market === 'hk', `${ticker}.market 必须是 hk`);
  assert(['股票', 'ETF', '杠杆产品', '人民币柜台', '行业板块'].includes(entry.securityType), `${ticker}.securityType 无效`);
  assert(typeof entry.category === 'string' && entry.category.trim(), `${ticker}.category 不能为空`);
  assert(['HKD', 'CNY'].includes(entry.currency), `${ticker}.currency 必须是 HKD 或 CNY`);
  for (const field of ['price', 'change', 'changePercent', 'volumeLabel', 'marketCapLabel', 'performancePercent', 'delayed']) {
    assert(!(field in entry), `${ticker} 不应保存截图行情字段 ${field}`);
  }
}

assert(usWatchlist.version === 2, 'us-watchlist.version 必须为 2');
assert(usWatchlist.source && typeof usWatchlist.source.label === 'string' && usWatchlist.source.label.trim(), 'us-watchlist.source.label 不能为空');
assert(usWatchlist.source && typeof usWatchlist.source.notice === 'string' && usWatchlist.source.notice.trim(), 'us-watchlist.source.notice 不能为空');
const usEntries = Array.isArray(usWatchlist.entries) ? usWatchlist.entries : [];
const expectedUsTickers = [
  'IREN', 'NBIS', 'AXTI', 'BE', 'SNDK', 'CRWV', 'ALAB', 'SIVEF', 'CBRS', 'MU', 'LRCX', 'AAOI', 'SKHY', 'DRAM', 'MSFT',
  'WDC', 'LITE', 'ONTO', 'CRDO', 'SMR', 'AMD', 'RGTI', 'MRVL', 'COHR', 'XE', 'OKLO', 'STX', 'INTC', 'QBTS', 'RKLB',
  'ASTS', 'DELL', 'LAZR', 'GLW', 'SFTBY', 'NOK', 'TSM', 'LUNR', 'ARM', 'LAR', 'LAC', 'ASML', 'MRNA', 'KLAC', 'UBSFY',
  'SNOW', 'LAES', 'NET', 'AVGO', 'CRCL', 'BIRD', 'VST', 'AMZN', 'TSLA', 'ALB', '.NDX', 'SLV', '.IXIC', 'NVDA', 'BK1582',
  'CEG', 'NIO', 'NVAX', 'FGDL', 'SQM', 'WSE', 'BABA', 'BRK.B', 'NEE-U', 'SPCX', 'SNPS', 'PLTR', 'GOOG', 'GOOGL', 'PFE',
  'PDD', 'AZN', 'PYPL', 'LNVGY', 'AAPL', 'IBM', 'XIACY', 'LI', 'QCOM', 'WMT', 'HOOD', 'META'
];
assert(usEntries.length === 87, '美股资料目录必须包含 87 个不重复标的');
assert(
  JSON.stringify(usEntries.map((entry) => entry.ticker)) === JSON.stringify(expectedUsTickers),
  '美股资料目录必须包含指定标的并保持录入顺序'
);
const usEntryKeys = new Set();
for (const entry of usEntries) {
  const ticker = String(entry && entry.ticker || '');
  assert(/^(?:[A-Z][A-Z0-9.-]{0,9}|\.[A-Z0-9]{2,9})$/.test(ticker), `美股观察池 ticker 无效：${ticker}`);
  assert(!usEntryKeys.has(ticker), `美股观察池标的重复：${ticker}`);
  usEntryKeys.add(ticker);
  assert(typeof entry.name === 'string' && entry.name.trim(), `${ticker}.name 不能为空`);
  assert(['NASDAQ', 'NYSE', 'OTC', 'NYSEARCA', 'THEME'].includes(entry.exchange), `${ticker}.exchange 无效`);
  assert(entry.market === 'us', `${ticker}.market 必须是 us`);
  assert(['股票', 'ADR', 'ETF', '指数', '主题板块'].includes(entry.securityType), `${ticker}.securityType 无效`);
  assert(typeof entry.category === 'string' && entry.category.trim(), `${ticker}.category 不能为空`);
  assert(entry.currency === 'USD', `${ticker}.currency 必须是 USD`);
  for (const field of [
    'price', 'change', 'changePercent', 'premarketPrice', 'premarketChange', 'premarketChangePercent',
    'volumeLabel', 'marketCapLabel', 'performancePercent'
  ]) {
    assert(!(field in entry), `${ticker} 不应保存截图行情字段 ${field}`);
  }
}

const supplyTickers = (supply.companies || []).map((company) => company.ticker);
const valuationTickers = (valuation.companies || []).map((company) => company.ticker);
assert(JSON.stringify(supplyTickers) === JSON.stringify(valuationTickers), '供应链与估值公司的 ticker/顺序必须完全一致');
assert(new Set(valuationTickers).size === valuationTickers.length, '估值 ticker 不能重复');
for (const company of supply.companies || []) {
  const ticker = String(company && company.ticker || '');
  const quarter = company && company.latestQuarter;
  assert(quarter && typeof quarter === 'object' && !Array.isArray(quarter), `${ticker}.latestQuarter 必须是对象`);
  assert(typeof (quarter && quarter.fiscalPeriod) === 'string' && quarter.fiscalPeriod.trim(), `${ticker}.latestQuarter.fiscalPeriod 不能为空`);
  assert(validDate(quarter && quarter.periodEnd), `${ticker}.latestQuarter.periodEnd 无效`);
  assert(validDate(quarter && quarter.filedAt), `${ticker}.latestQuarter.filedAt 无效`);
  assert(String(quarter && quarter.filedAt) >= String(quarter && quarter.periodEnd), `${ticker}.latestQuarter.filedAt 不能早于财季截止日`);
  assert(String(quarter && quarter.filedAt) <= String(supply.updatedAt), `${ticker}.latestQuarter.filedAt 不能晚于数据更新时间`);
  assert(['10-Q', '10-K', '6-K', '20-F'].includes(quarter && quarter.form), `${ticker}.latestQuarter.form 无效`);
  const grossProfit = Number(quarter && quarter.grossProfitUsdMillions);
  const revenue = Number(quarter && quarter.revenueUsdMillions);
  assert(Number.isFinite(grossProfit), `${ticker}.latestQuarter.grossProfitUsdMillions 必须是有限数值`);
  assert(Number.isFinite(revenue) && revenue > 0, `${ticker}.latestQuarter.revenueUsdMillions 必须大于 0`);
  const grossMargin = (grossProfit / revenue) * 100;
  assert(Number.isFinite(grossMargin) && grossMargin <= 100 && grossMargin > -500, `${ticker} 最新季度毛利率超出合理校验范围`);
  assert(typeof (quarter && quarter.basis) === 'string' && quarter.basis.trim(), `${ticker}.latestQuarter.basis 不能为空`);
  try {
    const sourceUrl = new URL(quarter && quarter.sourceUrl);
    assert(sourceUrl.protocol === 'https:' && sourceUrl.hostname === 'www.sec.gov', `${ticker}.latestQuarter.sourceUrl 必须指向 SEC HTTPS 页面`);
    assert(sourceUrl.pathname.startsWith('/Archives/edgar/data/'), `${ticker}.latestQuarter.sourceUrl 必须指向 SEC EDGAR 申报文件`);
  } catch (error) {
    errors.push(`${ticker}.latestQuarter.sourceUrl 无效`);
  }
}
assert(valuation.methodologyVersion === 'pe-cycle-v1', '估值方法版本必须为 pe-cycle-v1');
const safetyDiscount = Number(valuation.methodology && valuation.methodology.safetyDiscount);
assert(Number.isFinite(safetyDiscount) && safetyDiscount > 0 && safetyDiscount < 1, '估值安全边际折扣必须在 0..1 之间');
for (const key of ['formula', 'safetyZone', 'reasonableZone', 'aggressiveZone', 'waitZone', 'eligibility', 'rounding']) {
  assert(typeof (valuation.methodology && valuation.methodology[key]) === 'string' && valuation.methodology[key].trim(), `估值方法缺少 ${key}`);
}

const manualBuyZones = valuation.manualBuyZones;
assert(manualBuyZones && typeof manualBuyZones === 'object' && !Array.isArray(manualBuyZones), '缺少 manualBuyZones 研究快照');
assert(validDate(manualBuyZones && manualBuyZones.updatedAt), 'manualBuyZones.updatedAt 无效');
for (const key of ['timeHorizon', 'sourceLabel', 'basis', 'notice']) {
  assert(typeof (manualBuyZones && manualBuyZones[key]) === 'string' && manualBuyZones[key].trim(), `manualBuyZones.${key} 不能为空`);
}
const manualEntries = Array.isArray(manualBuyZones && manualBuyZones.entries) ? manualBuyZones.entries : [];
const expectedManualTickers = ['AAOI', 'SKHY', 'LITE', '002436', '002916', '002156', 'AXTI', 'ASTS', 'INTC', 'NBIS', 'CRWV', 'GLW'];
const directoryEntries = [...stockEntries, ...hkEntries, ...usEntries];
const directoryTickers = new Set(directoryEntries.map((entry) => String(entry && entry.ticker || '')));
assert(directoryEntries.length === 208, '股票资料目录合计必须包含 208 个标的');
assert(manualEntries.length === 12, '重点标的买入区间必须包含 12 家公司');
assert(JSON.stringify(manualEntries.map((entry) => entry.ticker)) === JSON.stringify(expectedManualTickers), '重点标的买入区间必须包含指定股票并保持约定顺序');
const manualTickers = new Set();
for (const entry of manualEntries) {
  const ticker = String(entry && entry.ticker || '');
  assert(/^(?:[A-Z][A-Z0-9.-]{0,9}|\d{6})$/.test(ticker), `手工区间 ticker 无效：${ticker}`);
  assert(directoryTickers.has(ticker), `手工区间标的未录入股票资料目录：${ticker}`);
  assert(!manualTickers.has(ticker), `手工区间 ticker 重复：${ticker}`);
  manualTickers.add(ticker);
  assert(typeof entry.name === 'string' && entry.name.trim(), `${ticker}.name 不能为空`);
  assert(typeof entry.market === 'string' && entry.market.trim(), `${ticker}.market 不能为空`);
  assert(typeof entry.segment === 'string' && entry.segment.trim(), `${ticker}.segment 不能为空`);
  assert(['USD', 'CNY'].includes(entry.currency), `${ticker}.currency 必须是 USD 或 CNY`);
  assert(/^(?:NASDAQ|NYSE|SZSE):(?:[A-Z][A-Z0-9.-]{0,9}|\d{6})$/.test(String(entry.tradingViewSymbol || '')), `${ticker}.tradingViewSymbol 无效`);
  if (entry.marketCapSymbol !== undefined) {
    assert(/^(?:NASDAQ|NYSE|SZSE):(?:[A-Z][A-Z0-9.-]{0,9}|\d{6})$/.test(String(entry.marketCapSymbol || '')), `${ticker}.marketCapSymbol 无效`);
  }
  assert(Number.isFinite(Number(entry.referencePrice)) && Number(entry.referencePrice) > 0, `${ticker}.referencePrice 必须大于 0`);
  const safetyLow = Number(entry.safety && entry.safety.low);
  const safetyHigh = Number(entry.safety && entry.safety.high);
  const reasonableLow = Number(entry.reasonable && entry.reasonable.low);
  const reasonableHigh = Number(entry.reasonable && entry.reasonable.high);
  const aggressiveLow = Number(entry.aggressive && entry.aggressive.low);
  const aggressiveHigh = Number(entry.aggressive && entry.aggressive.high);
  assert(
    [safetyLow, safetyHigh, reasonableLow, reasonableHigh, aggressiveLow, aggressiveHigh].every(Number.isFinite),
    `${ticker} 三档区间必须是有限数值`
  );
  assert(
    safetyLow > 0 && safetyLow < safetyHigh
      && safetyHigh < reasonableLow && reasonableLow < reasonableHigh
      && reasonableHigh < aggressiveLow && aggressiveLow < aggressiveHigh,
    `${ticker} 三档区间必须满足 safety < reasonable < aggressive，且每档 low < high`
  );
  assert(typeof entry.view === 'string' && entry.view.trim(), `${ticker}.view 不能为空`);
  if (entry.confidence !== undefined) {
    assert(['high', 'medium', 'low', 'not_assessed'].includes(entry.confidence), `${ticker}.confidence 无效`);
  }
  if (entry.riskNote !== undefined) {
    assert(typeof entry.riskNote === 'string' && entry.riskNote.trim(), `${ticker}.riskNote 不能为空`);
  }
  if (entry.sources !== undefined) {
    assert(Array.isArray(entry.sources) && entry.sources.length > 0, `${ticker}.sources 必须是非空数组`);
    for (const source of entry.sources || []) {
      assert(typeof source.label === 'string' && source.label.trim(), `${ticker} 手工区间来源缺少 label`);
      try {
        const sourceUrl = new URL(source.url);
        assert(sourceUrl.protocol === 'https:', `${ticker} 手工区间来源必须使用 HTTPS`);
      } catch (error) {
        errors.push(`${ticker} 手工区间来源 URL 无效`);
      }
    }
  }
}

assert(valuationCoverage.version === 1, 'valuation-coverage.version 必须为 1');
assert(validIso(valuationCoverage.generatedAt), 'valuation-coverage.generatedAt 必须为 ISO UTC 时间');
for (const key of ['label', 'coverage', 'stockBands', 'pooledBands', 'leveragedBands', 'fallbackBands', 'notice']) {
  assert(
    typeof (valuationCoverage.methodology && valuationCoverage.methodology[key]) === 'string'
      && valuationCoverage.methodology[key].trim(),
    `valuation-coverage.methodology.${key} 不能为空`
  );
}
assert(
  valuationCoverage.source
    && typeof valuationCoverage.source.label === 'string'
    && valuationCoverage.source.label.trim(),
  'valuation-coverage.source.label 不能为空'
);
try {
  const coverageHomepage = new URL(valuationCoverage.source && valuationCoverage.source.homepage);
  assert(coverageHomepage.protocol === 'https:', 'valuation-coverage.source.homepage 必须使用 HTTPS');
} catch (error) {
  errors.push('valuation-coverage.source.homepage 无效');
}
const coverageEntries = Array.isArray(valuationCoverage.entries) ? valuationCoverage.entries : [];
assert(coverageEntries.length === 196, '全目录量化区间必须包含 196 个非重点标的');
const directoryKeys = new Set([
  ...stockEntries.map((entry) => `cn:${entry.exchange}:${entry.ticker}`),
  ...hkEntries.map((entry) => `hk:${entry.exchange}:${entry.ticker}`),
  ...usEntries.map((entry) => `us:${entry.exchange}:${entry.ticker}`)
]);
const manualDirectoryKeys = new Set();
for (const entry of manualEntries) {
  const market = entry.currency === 'CNY' ? 'cn' : entry.currency === 'HKD' ? 'hk' : 'us';
  const matches = [...directoryKeys].filter((key) => key.startsWith(`${market}:`) && key.endsWith(`:${entry.ticker}`));
  assert(matches.length === 1, `重点标的必须唯一匹配股票资料目录：${entry.ticker}`);
  if (matches[0]) manualDirectoryKeys.add(matches[0]);
}
const coverageKeys = new Set();
const coverageMethods = new Set([
  'price-distribution-stock-v1',
  'price-distribution-pooled-v1',
  'price-distribution-leveraged-v1',
  'limited-history-v1',
  'reference-ladder-v1'
]);
for (const entry of coverageEntries) {
  const ticker = String(entry && entry.ticker || '');
  const key = `${entry.market}:${entry.exchange}:${ticker}`;
  assert(directoryKeys.has(key), `量化区间标的未录入股票资料目录：${key}`);
  assert(!coverageKeys.has(key), `量化区间标的重复：${key}`);
  assert(!manualDirectoryKeys.has(key), `量化区间不得覆盖重点研究标的：${key}`);
  coverageKeys.add(key);
  assert(typeof entry.name === 'string' && entry.name.trim(), `${key}.name 不能为空`);
  assert(['cn', 'hk', 'us'].includes(entry.market), `${key}.market 无效`);
  assert(typeof entry.exchange === 'string' && entry.exchange.trim(), `${key}.exchange 不能为空`);
  assert(typeof entry.segment === 'string' && entry.segment.trim(), `${key}.segment 不能为空`);
  assert(typeof entry.securityType === 'string' && entry.securityType.trim(), `${key}.securityType 不能为空`);
  assert(['CNY', 'HKD', 'USD'].includes(entry.currency), `${key}.currency 无效`);
  assert(Number.isFinite(Number(entry.referencePrice)) && Number(entry.referencePrice) > 0, `${key}.referencePrice 必须大于 0`);
  assert(validDate(entry.referencePriceDate), `${key}.referencePriceDate 无效`);
  assert(typeof entry.referencePriceApproximate === 'boolean', `${key}.referencePriceApproximate 必须是布尔值`);
  assert(Number.isInteger(entry.observationCount) && entry.observationCount >= 0, `${key}.observationCount 必须是非负整数`);
  assert(coverageMethods.has(entry.method), `${key}.method 无效`);
  assert(['medium', 'low'].includes(entry.confidence), `${key}.confidence 必须是 medium 或 low`);
  const priceValues = [
    Number(entry.safety && entry.safety.low),
    Number(entry.safety && entry.safety.high),
    Number(entry.reasonable && entry.reasonable.low),
    Number(entry.reasonable && entry.reasonable.high),
    Number(entry.aggressive && entry.aggressive.low),
    Number(entry.aggressive && entry.aggressive.high)
  ];
  assert(
    priceValues.every(Number.isFinite)
      && priceValues[0] > 0
      && priceValues.every((value, index) => index === 0 || value > priceValues[index - 1]),
    `${key} 三档量化区间必须是严格递增的正数`
  );
  assert(typeof entry.view === 'string' && entry.view.trim(), `${key}.view 不能为空`);
  assert(typeof entry.sourceLabel === 'string' && entry.sourceLabel.trim(), `${key}.sourceLabel 不能为空`);
  if (entry.method === 'reference-ladder-v1') {
    assert(entry.observationCount === 0, `${key} 参考价阶梯不得伪造历史样本`);
    assert(entry.referencePriceApproximate === true, `${key} 参考价阶梯必须标为近似值`);
  } else {
    assert(entry.observationCount >= 5, `${key} 历史分布至少需要 5 个交易日`);
    assert(validDate(entry.historyStart) && validDate(entry.historyEnd), `${key} 历史区间日期无效`);
    assert(typeof entry.marketDataSymbol === 'string' && entry.marketDataSymbol.trim(), `${key}.marketDataSymbol 不能为空`);
    try {
      const sourceUrl = new URL(entry.sourceUrl);
      assert(sourceUrl.protocol === 'https:', `${key}.sourceUrl 必须使用 HTTPS`);
    } catch (error) {
      errors.push(`${key}.sourceUrl 无效`);
    }
  }
  assert(entry.metrics && typeof entry.metrics === 'object' && !Array.isArray(entry.metrics), `${key}.metrics 必须是对象`);
  for (const metric of ['percentile20', 'percentile50', 'percentile80', 'sma50', 'sma200', 'annualizedVolatility']) {
    const value = entry.metrics && entry.metrics[metric];
    assert(value === null || Number.isFinite(Number(value)), `${key}.metrics.${metric} 必须是数值或 null`);
  }
}
const allValuationKeys = new Set([...manualDirectoryKeys, ...coverageKeys]);
assert(allValuationKeys.size === 208, '估值买入区间必须完整覆盖 208 个股票资料目录标的');
assert(
  [...directoryKeys].every((key) => allValuationKeys.has(key)),
  '股票资料目录存在未建立估值买入区间的标的'
);

assert(marketQuotes.version === 2, 'market-quotes.version 必须为 2');
assert(marketQuotes.fx && marketQuotes.fx.pair === 'USD/CNY', 'market-quotes.fx.pair 必须为 USD/CNY');
assert(Number.isFinite(Number(marketQuotes.fx && marketQuotes.fx.rate)) && Number(marketQuotes.fx.rate) > 0, 'market-quotes.fx.rate 必须大于 0');
assert(validIso(marketQuotes.fx && marketQuotes.fx.quoteTime), 'market-quotes.fx.quoteTime 无效');
assert(validIso(marketQuotes.fx && marketQuotes.fx.fetchedAt), 'market-quotes.fx.fetchedAt 无效');
assert(marketQuotes.fetchedAt === null || validIso(marketQuotes.fetchedAt), 'market-quotes.fetchedAt 必须为 null 或 ISO UTC 时间');
assert(marketQuotes.source && typeof marketQuotes.source.label === 'string' && marketQuotes.source.label.trim(), 'market-quotes.source.label 不能为空');
assert(marketQuotes.source && typeof marketQuotes.source.dataNotice === 'string' && marketQuotes.source.dataNotice.trim(), 'market-quotes.source.dataNotice 不能为空');
try {
  const homepage = new URL(marketQuotes.source && marketQuotes.source.homepage);
  assert(homepage.protocol === 'https:', 'market-quotes.source.homepage 必须使用 HTTPS');
} catch (error) {
  errors.push('market-quotes.source.homepage 无效');
}
for (const marketId of ['cn', 'us']) {
  assert(typeof (marketQuotes.schedules && marketQuotes.schedules[marketId]) === 'string' && marketQuotes.schedules[marketId].trim(), `market-quotes.schedules.${marketId} 不能为空`);
  const session = marketQuotes.sessions && marketQuotes.sessions[marketId];
  if (session !== null && session !== undefined) {
    assert(session && typeof session === 'object' && !Array.isArray(session), `market-quotes.sessions.${marketId} 必须是对象或 null`);
    assert(['intraday', 'after_close', 'manual'].includes(session && session.phase), `market-quotes.sessions.${marketId}.phase 无效`);
    assert(validDate(session && session.sessionDate), `market-quotes.sessions.${marketId}.sessionDate 无效`);
    assert(session && session.timezone === (marketId === 'cn' ? 'Asia/Shanghai' : 'America/New_York'), `market-quotes.sessions.${marketId}.timezone 无效`);
    assert(validIso(session && session.refreshedAt), `market-quotes.sessions.${marketId}.refreshedAt 无效`);
    assert(Number.isInteger(session && session.quoteCount) && session.quoteCount >= 0, `market-quotes.sessions.${marketId}.quoteCount 必须是非负整数`);
    assert(Array.isArray(session && session.staleTickers), `market-quotes.sessions.${marketId}.staleTickers 必须是数组`);
  }
}

const quoteRows = Array.isArray(marketQuotes.quotes) ? marketQuotes.quotes : [];
assert(Array.isArray(marketQuotes.quotes), 'market-quotes.quotes 必须是数组');
assert(quoteRows.length === manualEntries.length, 'market-quotes 必须覆盖全部重点标的');
if (quoteRows.length) {
  assert(validIso(marketQuotes.fetchedAt), '有行情记录时 market-quotes.fetchedAt 必须是有效 ISO UTC 时间');
}
const quoteTickers = new Set();
for (const quote of quoteRows) {
  const ticker = String(quote && quote.ticker || '');
  const entry = manualEntries.find((item) => item.ticker === ticker);
  assert(Boolean(entry), `market-quotes 包含未知 ticker：${ticker}`);
  assert(!quoteTickers.has(ticker), `market-quotes ticker 重复：${ticker}`);
  quoteTickers.add(ticker);
  assert(['cn', 'us'].includes(quote.market), `${ticker}.market 必须是 cn 或 us`);
  assert(['USD', 'CNY'].includes(quote.currency), `${ticker}.currency 必须是 USD 或 CNY`);
  if (entry) {
    const expectedMarket = entry.currency === 'CNY' ? 'cn' : 'us';
    const [exchange, rawSymbol] = String(entry.tradingViewSymbol || '').split(':');
    const expectedSymbol = exchange === 'SZSE' ? `${rawSymbol}.SZ` : exchange === 'SSE' ? `${rawSymbol}.SS` : rawSymbol;
    assert(quote.market === expectedMarket, `${ticker}.market 与研究配置不一致`);
    assert(quote.currency === entry.currency, `${ticker}.currency 与研究配置不一致`);
    assert(quote.symbol === expectedSymbol, `${ticker}.symbol 与研究配置不一致`);
  }
  const price = Number(quote.price);
  const previousClose = quote.previousClose === null ? null : Number(quote.previousClose);
  const change = quote.change === null ? null : Number(quote.change);
  const changePercent = quote.changePercent === null ? null : Number(quote.changePercent);
  assert(Number.isFinite(price) && price > 0, `${ticker}.price 必须大于 0`);
  assert(previousClose === null || (Number.isFinite(previousClose) && previousClose > 0), `${ticker}.previousClose 必须为 null 或大于 0`);
  assert(change === null || Number.isFinite(change), `${ticker}.change 必须为 null 或有限数值`);
  assert(changePercent === null || Number.isFinite(changePercent), `${ticker}.changePercent 必须为 null 或有限数值`);
  assert(Number.isFinite(Number(quote.marketCap)) && Number(quote.marketCap) > 0, `${ticker}.marketCap 必须大于 0`);
  assert(['USD', 'CNY'].includes(quote.marketCapCurrency), `${ticker}.marketCapCurrency 必须是 USD 或 CNY`);
  assert(validIso(quote.marketCapFetchedAt), `${ticker}.marketCapFetchedAt 无效`);
  assert(validIso(quote.quoteTime), `${ticker}.quoteTime 无效`);
  assert(validDate(quote.quoteDate), `${ticker}.quoteDate 无效`);
  assert(validIso(quote.fetchedAt), `${ticker}.fetchedAt 无效`);
  try {
    const sourceUrl = new URL(quote.sourceUrl);
    assert(sourceUrl.protocol === 'https:', `${ticker}.sourceUrl 必须使用 HTTPS`);
  } catch (error) {
    errors.push(`${ticker}.sourceUrl 无效`);
  }
  try {
    const marketCapSourceUrl = new URL(quote.marketCapSourceUrl);
    assert(marketCapSourceUrl.protocol === 'https:', `${ticker}.marketCapSourceUrl 必须使用 HTTPS`);
  } catch (error) {
    errors.push(`${ticker}.marketCapSourceUrl 无效`);
  }
}

for (const company of valuation.companies || []) {
  assert(/^[A-Z][A-Z0-9.-]{0,9}$/.test(String(company.ticker || '')), `无效 ticker：${company.ticker}`);
  assert(/^(NASDAQ|NYSE):[A-Z][A-Z0-9.-]{0,9}$/.test(String(company.tradingViewSymbol || '')), `${company.ticker} 的 TradingView symbol 无效`);
  assert(/^\d{10}$/.test(String(company.secCik || '')), `${company.ticker} 缺少 10 位 SEC CIK`);
  assert(['demo', 'reviewed', 'needs-review'].includes(company.reviewStatus), `${company.ticker} reviewStatus 无效`);
  if (company.reviewStatus === 'reviewed') {
    assert(validDate(company.reviewedAt), `${company.ticker} reviewed 状态必须提供 reviewedAt`);
    assert(typeof company.reviewedBy === 'string' && company.reviewedBy.trim().length > 0, `${company.ticker} reviewed 状态必须提供 reviewedBy`);
    try {
      const evidenceUrl = new URL(company.reviewEvidenceUrl);
      assert(evidenceUrl.protocol === 'https:', `${company.ticker} reviewEvidenceUrl 必须使用 HTTPS`);
    } catch (error) {
      errors.push(`${company.ticker} reviewed 状态必须提供有效 reviewEvidenceUrl`);
    }
  }
  assert(validDate(company.updatedAt), `${company.ticker}.updatedAt 无效`);
  assert(['high', 'medium', 'low', 'not_assessed'].includes(company.confidence), `${company.ticker}.confidence 无效`);
  assert(Array.isArray(company.assumptions) && company.assumptions.length > 0, `${company.ticker}.assumptions 不能为空`);
  assert(typeof company.riskNote === 'string' && company.riskNote.trim(), `${company.ticker}.riskNote 不能为空`);

  const model = company.valuationModel;
  assert(model && ['pe', 'pe-not-meaningful'].includes(model.kind), `${company.ticker}.valuationModel.kind 无效`);
  const eps = model && model.eps;
  assert(eps && Number.isFinite(Number(eps.value)), `${company.ticker}.valuationModel.eps.value 必须是有限数值`);
  assert(eps && validDate(eps.periodEnd), `${company.ticker}.valuationModel.eps.periodEnd 无效`);
  assert(eps && ['GAAP', 'non-GAAP'].includes(eps.accountingBasis), `${company.ticker}.valuationModel.eps.accountingBasis 无效`);
  assert(eps && ['TTM', 'FY', 'Q'].includes(eps.periodType), `${company.ticker}.valuationModel.eps.periodType 无效`);
  for (const key of ['basis', 'calculation', 'gaapComparison']) {
    assert(typeof (eps && eps[key]) === 'string' && eps[key].trim(), `${company.ticker}.valuationModel.eps.${key} 不能为空`);
  }

  if (model && model.kind === 'pe') {
    assert(Number(eps && eps.value) > 0, `${company.ticker} 启用 P/E 时 EPS 必须大于 0`);
    const bear = Number(model.peScenarios && model.peScenarios.bear);
    const base = Number(model.peScenarios && model.peScenarios.base);
    const bull = Number(model.peScenarios && model.peScenarios.bull);
    assert(Number.isFinite(bear) && Number.isFinite(base) && Number.isFinite(bull), `${company.ticker} P/E 情景必须是有限数值`);
    assert(bear > 0 && bear < base && base < bull, `${company.ticker} P/E 必须满足 0 < bear < base < bull`);
    assert(['TTM', 'FY'].includes(eps && eps.periodType), `${company.ticker} 启用 P/E 时必须使用 TTM 或完整财年 EPS`);
    assert(Number(eps && eps.eligibleQuarterCount) >= 4, `${company.ticker} 启用 P/E 时必须提供至少四季覆盖证据`);
    assert(typeof (eps && eps.eligibilityEvidence) === 'string' && eps.eligibilityEvidence.trim(), `${company.ticker} 缺少 P/E 适用性证据`);
    assert(model.peScenarios.accountingBasis === eps.accountingBasis, `${company.ticker} EPS 与历史 P/E 会计口径必须一致`);
    assert(typeof model.historicalPeContext === 'string' && model.historicalPeContext.trim(), `${company.ticker} 缺少历史 P/E 背景`);
    assert(typeof model.scenarioRationale === 'string' && model.scenarioRationale.trim(), `${company.ticker} 缺少 P/E 情景理由`);
    assert((company.sources || []).some((source) => source.type === 'historical-valuation'), `${company.ticker} 启用 P/E 时必须提供历史估值来源`);
  }

  if (model && model.kind === 'pe-not-meaningful') {
    assert(!model.peScenarios, `${company.ticker} P/E 不适用时不能生成 P/E 情景`);
    for (const key of ['notMeaningfulReason', 'alternativeMetric', 'reentryRule']) {
      assert(typeof model[key] === 'string' && model[key].trim(), `${company.ticker}.${key} 不能为空`);
    }
  }

  assert(Array.isArray(company.sources) && company.sources.length > 0, `${company.ticker}.sources 不能为空`);
  for (const source of company.sources || []) {
    assert(typeof source.label === 'string' && source.label.trim(), `${company.ticker} 来源缺少 label`);
    try {
      const sourceUrl = new URL(source.url);
      assert(sourceUrl.protocol === 'https:', `${company.ticker} 来源必须使用 HTTPS`);
    } catch (error) {
      errors.push(`${company.ticker} 来源 URL 无效`);
    }
  }
  if (company.latestSecFiling) {
    assert(validDate(company.latestSecFiling.filingDate), `${company.ticker}.latestSecFiling.filingDate 无效`);
    assert(/^https:\/\/(www\.)?sec\.gov\//.test(String(company.latestSecFiling.sourceUrl || '')), `${company.ticker}.latestSecFiling 必须链接 SEC 官方域名`);
  }
}

assert(secState && secState.version === 1, 'SEC state version 必须为 1');
assert(secState.companies && typeof secState.companies === 'object' && !Array.isArray(secState.companies), 'SEC state companies 必须是对象');
for (const [ticker, companyState] of Object.entries(secState.companies || {})) {
  assert(valuationTickers.includes(ticker), `SEC state 包含未知 ticker：${ticker}`);
  assert(/^\d{10}$/.test(String(companyState.cik || '')), `${ticker} SEC state CIK 无效`);
  const valuationCompany = (valuation.companies || []).find((company) => company.ticker === ticker);
  assert(!valuationCompany || String(companyState.cik) === String(valuationCompany.secCik), `${ticker} SEC state CIK 与估值配置不一致`);
  assert(Array.isArray(companyState.seenAccessions), `${ticker} seenAccessions 必须是数组`);
  assert(new Set(companyState.seenAccessions || []).size === (companyState.seenAccessions || []).length, `${ticker} seenAccessions 不能重复`);
  for (const accession of companyState.seenAccessions || []) {
    assert(/^\d{10}-\d{2}-\d{6}$/.test(String(accession)), `${ticker} accession 格式无效：${accession}`);
  }
}

const eventIds = new Set();
for (const event of events.events || []) {
  assert(typeof event.id === 'string' && event.id.length > 0, '事件 id 不能为空');
  assert(!eventIds.has(event.id), `事件 id 重复：${event.id}`);
  eventIds.add(event.id);
  assert(validDate(event.date), `${event.id} 日期无效`);
  assert(['positive', 'neutral', 'negative'].includes(event.sentiment), `${event.id} sentiment 无效`);
  assert(Number.isFinite(Number(event.riskScoreChange)), `${event.id} riskScoreChange 必须是有限数值`);
  assert(Array.isArray(event.affectedSegments), `${event.id} affectedSegments 必须是数组`);
  if (event.sourceUrl) {
    try {
      const url = new URL(event.sourceUrl);
      assert(url.protocol === 'https:', `${event.id} 来源必须使用 HTTPS`);
      if (event.isAutomated) {
        assert(['sec.gov', 'www.sec.gov'].includes(url.hostname), `${event.id} 自动事件必须链接 SEC 官方域名`);
      }
    } catch (error) {
      errors.push(`${event.id} sourceUrl 无效`);
    }
  }
  if (event.isAutomated) {
    assert(/^sec-[a-z0-9.-]+-\d{10}-\d{2}-\d{6}$/.test(event.id), `${event.id} 自动 SEC 事件 id 格式无效`);
    assert(/^(10-K|10-Q|10-KT|10-QT|20-F|40-F|8-K|6-K|NT 10-K|NT 10-Q|NT 20-F)(\/A)?$/.test(String(event.form || '')), `${event.id} form 无效`);
    assert(Number(event.riskScoreChange) === 0 && event.sentiment === 'neutral', `${event.id} 自动 SEC 事件必须保持 neutral / 0`);
  }
}

const components = Array.isArray(risk.components) ? risk.components : [];
const weight = components.reduce((sum, component) => sum + Number(component.weight || 0), 0);
assert(Math.abs(weight - 1) < 0.0001, `风险权重合计必须为 1，当前为 ${weight}`);
for (const component of components) {
  assert(Number.isFinite(Number(component.score)) && Number(component.score) >= 0 && Number(component.score) <= 100, `${component.id || component.name} 风险分数必须在 0..100`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`validated ${files.length + 1} JSON files, ${valuationTickers.length} companies, ${eventIds.size} events`);
}
