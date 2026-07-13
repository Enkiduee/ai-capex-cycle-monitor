import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT_DIR,
  dateOnly,
  fetchJson,
  isoNow,
  normalizeForm,
  parseArgs,
  readJson,
  rowsFromColumnar,
  setActionOutput,
  sleep,
  writeJsonIfChanged
} from './lib/refresh-utils.mjs';

const args = parseArgs();
const mode = String(args.mode || 'events').toLowerCase();
const dryRun = Boolean(args['dry-run']);
const fixtureDirectory = args['fixture-dir'] ? path.resolve(ROOT_DIR, args['fixture-dir']) : '';
const dataDirectory = args['data-dir'] ? path.resolve(ROOT_DIR, args['data-dir']) : path.join(ROOT_DIR, 'data');
const dataFile = (name) => path.join(dataDirectory, name);
const checkedAt = isoNow();
const SEC_USER_AGENT = String(process.env.SEC_USER_AGENT || '').trim();

const financialForms = new Set(['10-K', '10-Q', '10-KT', '10-QT', '20-F', '40-F']);
const majorForms = new Set(['8-K', '6-K', 'NT 10-K', 'NT 10-Q', 'NT 20-F']);

if (!['daily', 'events', 'full', 'bootstrap'].includes(mode)) {
  throw new Error(`不支持的 SEC 扫描模式：${mode}`);
}
if (!/^[^\s].*\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?:\s|$)/i.test(SEC_USER_AGENT)) {
  throw new Error('SEC_USER_AGENT 必须包含“项目/组织名 + 可联系邮箱”。');
}

function filingClassification(row) {
  const rawForm = String(row.form || '').trim().toUpperCase();
  const baseForm = normalizeForm(rawForm);
  const items = String(row.items || '').split(/[,\s]+/).filter(Boolean);
  if (financialForms.has(baseForm)) {
    return { kind: 'earnings', label: '财报披露', form: rawForm, baseForm, items };
  }
  if (baseForm === '8-K' && items.includes('2.02')) {
    return { kind: 'earnings', label: '业绩披露', form: rawForm, baseForm, items };
  }
  if (majorForms.has(baseForm)) {
    const label = baseForm === '6-K'
      ? '境外发行人披露'
      : baseForm.startsWith('NT ')
        ? '财报延期申报'
        : '重大事项申报';
    return { kind: baseForm === '6-K' ? 'disclosure' : 'major', label, form: rawForm, baseForm, items };
  }
  return null;
}

function secIndexUrl(cik, accessionNumber) {
  const cikNumber = String(Number(cik));
  const compactAccession = String(accessionNumber).replaceAll('-', '');
  return `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${compactAccession}/${accessionNumber}-index.html`;
}

function buildEvent(company, row, classification) {
  const accessionNumber = String(row.accessionNumber || '');
  const filingDate = dateOnly(row.filingDate) || dateOnly(row.acceptanceDateTime) || dateOnly(checkedAt);
  const itemText = classification.items.length ? `，申报项目 ${classification.items.join('、')}` : '';
  return {
    id: `sec-${String(company.ticker).toLowerCase()}-${accessionNumber.toLowerCase()}`,
    date: filingDate,
    entity: company.name,
    title: `${company.name} 提交 ${classification.form} ${classification.label}`,
    type: classification.label,
    sentiment: 'neutral',
    affectedSegments: [company.segment],
    riskScoreChange: 0,
    description: `SEC EDGAR 于 ${filingDate} 收录 ${classification.form}${itemText}。系统仅记录官方披露并将 EPS 与 P/E 情景标记为待复核，不自动判断利好利空，也不自动调整风险分数或估值价格。`,
    sourceName: `SEC EDGAR 官方披露 · ${classification.form}`,
    sourceUrl: secIndexUrl(company.secCik, accessionNumber),
    isAutomated: true,
    filingKind: classification.kind,
    form: classification.form,
    accessionNumber,
    acceptedAt: row.acceptanceDateTime || '',
    secItems: classification.items
  };
}

async function loadSubmission(company) {
  if (fixtureDirectory) {
    const fixturePath = path.join(fixtureDirectory, `${company.ticker}-submissions.json`);
    return JSON.parse(await readFile(fixturePath, 'utf8'));
  }
  const cik = String(company.secCik || '').padStart(10, '0');
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const payload = await fetchJson(url, {
    retries: 3,
    timeoutMs: 20000,
    headers: {
      'User-Agent': SEC_USER_AGENT,
      'Accept-Encoding': 'gzip, deflate'
    }
  });
  await sleep(550);
  return payload;
}

const valuation = await readJson(dataFile('valuation-bands.json'));
const events = await readJson(dataFile('events.json'));
let state;
try {
  state = await readJson(dataFile('sec-filings-state.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = {
    version: 1,
    initializedAt: null,
    companies: {}
  };
}

const companies = Array.isArray(valuation.companies) ? valuation.companies : [];
const invalidCompany = companies.find((company) => !/^[A-Z][A-Z0-9.-]{0,9}$/.test(company.ticker) || !/^\d{10}$/.test(String(company.secCik || '')));
if (invalidCompany) {
  throw new Error(`估值公司缺少有效 ticker 或 10 位 secCik：${invalidCompany.ticker || 'unknown'}`);
}

const nextState = structuredClone(state);
const nextValuation = structuredClone(valuation);
const nextEvents = structuredClone(events);
const existingEventIds = new Set((nextEvents.events || []).map((event) => event.id));
const failures = [];
const detectedEvents = [];
let baselineCount = 0;

for (let index = 0; index < companies.length; index += 1) {
  const company = companies[index];
  try {
    const submission = await loadSubmission(company);
    const rows = rowsFromColumnar(submission && submission.filings && submission.filings.recent)
      .map((row) => ({ row, classification: filingClassification(row) }))
      .filter((item) => item.classification && item.row.accessionNumber);
    const previous = nextState.companies[company.ticker];
    const currentAccessions = rows.map((item) => String(item.row.accessionNumber));

    if (!previous || !Array.isArray(previous.seenAccessions) || String(previous.cik) !== String(company.secCik)) {
      nextState.companies[company.ticker] = {
        cik: String(company.secCik),
        initializedAt: checkedAt,
        seenAccessions: currentAccessions
      };
      baselineCount += 1;
      continue;
    }

    const seen = new Set(previous.seenAccessions);
    const newRows = rows.filter((item) => !seen.has(String(item.row.accessionNumber)));
    newRows.sort((left, right) => String(left.row.acceptanceDateTime || left.row.filingDate).localeCompare(String(right.row.acceptanceDateTime || right.row.filingDate)));

    for (const item of newRows) {
      const event = buildEvent(company, item.row, item.classification);
      if (!existingEventIds.has(event.id)) {
        detectedEvents.push(event);
        existingEventIds.add(event.id);
      }

      const target = nextValuation.companies.find((entry) => entry.ticker === company.ticker);
      if (target) {
        target.reviewStatus = 'needs-review';
        target.reviewReason = `发现新的 SEC ${item.classification.form} 披露（${event.date}），现有 EPS 与 P/E 情景已标记为待人工复核。`;
        target.latestSecFiling = {
          form: item.classification.form,
          filingDate: event.date,
          accessionNumber: event.accessionNumber,
          sourceUrl: event.sourceUrl
        };
      }
    }

    nextState.companies[company.ticker] = {
      ...previous,
      cik: String(company.secCik),
      seenAccessions: Array.from(new Set([...currentAccessions, ...previous.seenAccessions]))
    };
  } catch (error) {
    failures.push({ ticker: company.ticker, message: error.message });
  }
}

if (failures.length) {
  await setActionOutput('failed_companies', failures.map((item) => item.ticker).join(','));
  throw new Error(`SEC 扫描失败，未写入任何文件：${failures.map((item) => `${item.ticker}: ${item.message}`).join(' | ')}`);
}

if (!nextState.initializedAt && baselineCount === companies.length) {
  nextState.initializedAt = checkedAt;
}

if (!nextValuation.automation || typeof nextValuation.automation !== 'object') {
  nextValuation.automation = {};
}
nextValuation.automation.dailySchedule = '每天 09:23（Asia/Shanghai，GitHub Actions 可能延迟）';
nextValuation.automation.eventSchedule = '每 4 小时检查 SEC EDGAR；发现新披露时额外更新';
nextValuation.automation.marketPriceMode = 'TradingView 组件自动更新，仓库不抓取或保存当前行情';
nextValuation.automation.valuationRangeMode = 'P/E 情景仅在财报与重大事件后人工复核更新';

if (['daily', 'full', 'bootstrap'].includes(mode)) {
  nextValuation.automation.lastDailyCheckAt = checkedAt;
  nextValuation.automation.lastDailySecCheckAt = checkedAt;
}

if (detectedEvents.length) {
  nextEvents.events = [...detectedEvents, ...(nextEvents.events || [])];
  nextEvents.updatedAt = dateOnly(checkedAt);
  nextEvents.lastAutomatedEventAt = checkedAt;
  nextValuation.automation.lastEventDetectedAt = checkedAt;
  nextValuation.updatedAt = dateOnly(checkedAt);
}

const eventsChanged = detectedEvents.length
  ? await writeJsonIfChanged(dataFile('events.json'), nextEvents, { dryRun })
  : false;
const valuationChanged = await writeJsonIfChanged(dataFile('valuation-bands.json'), nextValuation, { dryRun });
const stateChanged = await writeJsonIfChanged(dataFile('sec-filings-state.json'), nextState, { dryRun });
const changed = stateChanged || valuationChanged || eventsChanged;

await setActionOutput('changed', changed);
await setActionOutput('new_filings', detectedEvents.length);
await setActionOutput('baseline_companies', baselineCount);
await setActionOutput('failed_companies', '');

console.log(JSON.stringify({
  mode,
  dryRun,
  checkedAt,
  trackedCompanies: companies.length,
  baselineCompanies: baselineCount,
  newFilings: detectedEvents.length,
  changed
}, null, 2));
