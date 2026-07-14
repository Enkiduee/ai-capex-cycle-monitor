import { readJson } from './lib/refresh-utils.mjs';

const files = [
  'data/risk-score.json',
  'data/hyperscalers.json',
  'data/supply-chain.json',
  'data/market-quotes.json',
  'data/valuation-bands.json',
  'data/macro.json',
  'data/events.json'
];

const payloads = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readJson(file)])));
const supply = payloads['data/supply-chain.json'];
const marketQuotes = payloads['data/market-quotes.json'];
const valuation = payloads['data/valuation-bands.json'];
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

const supplyTickers = (supply.companies || []).map((company) => company.ticker);
const valuationTickers = (valuation.companies || []).map((company) => company.ticker);
assert(JSON.stringify(supplyTickers) === JSON.stringify(valuationTickers), '供应链与估值公司的 ticker/顺序必须完全一致');
assert(new Set(valuationTickers).size === valuationTickers.length, '估值 ticker 不能重复');
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
assert(manualEntries.length === 12, '重点标的买入区间必须包含 12 家公司');
assert(JSON.stringify(manualEntries.map((entry) => entry.ticker)) === JSON.stringify(expectedManualTickers), '重点标的买入区间必须包含指定股票并保持约定顺序');
const manualTickers = new Set();
for (const entry of manualEntries) {
  const ticker = String(entry && entry.ticker || '');
  assert(/^(?:[A-Z][A-Z0-9.-]{0,9}|\d{6})$/.test(ticker), `手工区间 ticker 无效：${ticker}`);
  assert(!manualTickers.has(ticker), `手工区间 ticker 重复：${ticker}`);
  manualTickers.add(ticker);
  assert(typeof entry.name === 'string' && entry.name.trim(), `${ticker}.name 不能为空`);
  assert(typeof entry.market === 'string' && entry.market.trim(), `${ticker}.market 不能为空`);
  assert(typeof entry.segment === 'string' && entry.segment.trim(), `${ticker}.segment 不能为空`);
  assert(['USD', 'CNY'].includes(entry.currency), `${ticker}.currency 必须是 USD 或 CNY`);
  assert(/^(?:NASDAQ|NYSE|SZSE):(?:[A-Z][A-Z0-9.-]{0,9}|\d{6})$/.test(String(entry.tradingViewSymbol || '')), `${ticker}.tradingViewSymbol 无效`);
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

assert(marketQuotes.version === 1, 'market-quotes.version 必须为 1');
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
  assert(validIso(quote.quoteTime), `${ticker}.quoteTime 无效`);
  assert(validDate(quote.quoteDate), `${ticker}.quoteDate 无效`);
  assert(validIso(quote.fetchedAt), `${ticker}.fetchedAt 无效`);
  try {
    const sourceUrl = new URL(quote.sourceUrl);
    assert(sourceUrl.protocol === 'https:', `${ticker}.sourceUrl 必须使用 HTTPS`);
  } catch (error) {
    errors.push(`${ticker}.sourceUrl 无效`);
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
