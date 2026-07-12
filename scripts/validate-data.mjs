import { readJson } from './lib/refresh-utils.mjs';

const files = [
  'data/risk-score.json',
  'data/hyperscalers.json',
  'data/supply-chain.json',
  'data/valuation-bands.json',
  'data/macro.json',
  'data/events.json'
];

const payloads = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readJson(file)])));
const supply = payloads['data/supply-chain.json'];
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

for (const [file, payload] of Object.entries(payloads)) {
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), `${file} 顶层必须是对象`);
  assert(validDate(payload.updatedAt), `${file}.updatedAt 必须是 YYYY-MM-DD`);
}

const supplyTickers = (supply.companies || []).map((company) => company.ticker);
const valuationTickers = (valuation.companies || []).map((company) => company.ticker);
assert(JSON.stringify(supplyTickers) === JSON.stringify(valuationTickers), '供应链与估值公司的 ticker/顺序必须完全一致');
assert(new Set(valuationTickers).size === valuationTickers.length, '估值 ticker 不能重复');

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
  for (const key of ['observationRange', 'fairValueRange']) {
    const range = company[key];
    assert(range && Number.isFinite(Number(range.low)) && Number.isFinite(Number(range.high)), `${company.ticker}.${key} 必须包含有限数值`);
    assert(Number(range && range.low) > 0 && Number(range && range.high) >= Number(range && range.low), `${company.ticker}.${key} 必须满足 0 < low <= high`);
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
