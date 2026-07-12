import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT_DIR, serializeJson } from './lib/refresh-utils.mjs';

const execFileAsync = promisify(execFile);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'ai-capex-sec-test-'));
const dataDirectory = path.join(temporaryRoot, 'data');
const fixtureDirectory = path.join(temporaryRoot, 'fixtures');
const monitorScript = path.join(ROOT_DIR, 'scripts', 'check-sec-filings.mjs');

function fixtureRow(company, overrides = {}) {
  return {
    accessionNumber: `${company.secCik}-26-000001`,
    filingDate: '2026-07-10',
    reportDate: '2026-06-30',
    acceptanceDateTime: '2026-07-10T12:00:00.000Z',
    form: company.ticker === 'NBIS' ? '6-K' : '10-Q',
    items: '',
    primaryDocument: `${company.ticker.toLowerCase()}-filing.htm`,
    ...overrides
  };
}

function columnar(rows) {
  const keys = ['accessionNumber', 'filingDate', 'reportDate', 'acceptanceDateTime', 'form', 'items', 'primaryDocument'];
  return Object.fromEntries(keys.map((key) => [key, rows.map((row) => row[key] || '')]));
}

async function writeFixture(company, rows) {
  const payload = {
    cik: company.secCik,
    name: company.name,
    tickers: [company.ticker],
    filings: { recent: columnar(rows), files: [] }
  };
  await writeFile(path.join(fixtureDirectory, `${company.ticker}-submissions.json`), serializeJson(payload), 'utf8');
}

async function runMonitor(mode, includeUserAgent = true) {
  const environment = {
    ...process.env,
    REFRESH_NOW: '2026-07-11T01:23:00.000Z'
  };
  if (includeUserAgent) {
    environment.SEC_USER_AGENT = 'AI-CapEx-Cycle-Monitor test@example.com';
  } else {
    delete environment.SEC_USER_AGENT;
  }
  return execFileAsync(process.execPath, [
    monitorScript,
    '--mode', mode,
    '--data-dir', dataDirectory,
    '--fixture-dir', fixtureDirectory
  ], {
    cwd: ROOT_DIR,
    env: environment,
    maxBuffer: 1024 * 1024
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await mkdir(dataDirectory, { recursive: true });
  await mkdir(fixtureDirectory, { recursive: true });

  for (const name of ['valuation-bands.json', 'events.json', 'sec-filings-state.json']) {
    const source = await readFile(path.join(ROOT_DIR, 'data', name), 'utf8');
    await writeFile(path.join(dataDirectory, name), source, 'utf8');
  }

  const valuation = JSON.parse(await readFile(path.join(dataDirectory, 'valuation-bands.json'), 'utf8'));
  const baselineRows = new Map();
  for (const company of valuation.companies) {
    const rows = company.ticker === 'NVDA'
      ? Array.from({ length: 501 }, (_, index) => fixtureRow(company, {
        accessionNumber: `${company.secCik}-26-${String(index + 1).padStart(6, '0')}`
      }))
      : [fixtureRow(company)];
    baselineRows.set(company.ticker, rows);
    await writeFixture(company, rows);
  }

  let missingUserAgentFailed = false;
  try {
    await runMonitor('events', false);
  } catch (error) {
    missingUserAgentFailed = true;
  }
  assert(missingUserAgentFailed, '缺少项目名 + 联系邮箱的 SEC_USER_AGENT 时必须安全失败');

  const baseline = await runMonitor('bootstrap');
  assert(baseline.stdout.includes('"baselineCompanies": 11'), '首次运行必须为 11 家公司建立基线');
  assert(baseline.stdout.includes('"newFilings": 0'), '首次运行不能把历史申报误报为新事件');
  const stateAfterBaseline = JSON.parse(await readFile(path.join(dataDirectory, 'sec-filings-state.json'), 'utf8'));
  assert(stateAfterBaseline.companies.NVDA.seenAccessions.length === 501, '基线必须保留全部相关 accession，不能截断 500 条');

  const baselineRepeat = await runMonitor('events');
  assert(baselineRepeat.stdout.includes('"newFilings": 0') && baselineRepeat.stdout.includes('"changed": false'), '超过 500 条的重复基线扫描必须 no-op');

  const eventsBefore = JSON.parse(await readFile(path.join(dataDirectory, 'events.json'), 'utf8'));
  const nvda = valuation.companies.find((company) => company.ticker === 'NVDA');
  const nbis = valuation.companies.find((company) => company.ticker === 'NBIS');
  const newAccession = `${nvda.secCik}-26-999999`;
  const newNbisAccession = `${nbis.secCik}-26-999998`;
  await writeFixture(nvda, [
    fixtureRow(nvda, {
      accessionNumber: newAccession,
      filingDate: '2026-07-11',
      acceptanceDateTime: '2026-07-11T16:00:00.000Z',
      form: '8-K/A',
      items: '2.02,9.01',
      primaryDocument: 'nvda-8k.htm'
    }),
    ...baselineRows.get('NVDA')
  ]);
  await writeFixture(nbis, [
    fixtureRow(nbis, {
      accessionNumber: newNbisAccession,
      filingDate: '2026-07-11',
      acceptanceDateTime: '2026-07-11T17:00:00.000Z',
      form: '6-K',
      items: '',
      primaryDocument: 'nbis-6k.htm'
    }),
    ...baselineRows.get('NBIS')
  ]);

  const detected = await runMonitor('events');
  assert(detected.stdout.includes('"newFilings": 2'), '新 8-K/A 与 6-K 必须各生成一条新事件');
  const eventsAfter = JSON.parse(await readFile(path.join(dataDirectory, 'events.json'), 'utf8'));
  assert(eventsAfter.events.length === eventsBefore.events.length + 2, '事件总数应增加 2');
  const automatedEvent = eventsAfter.events.find((event) => event.accessionNumber === newAccession);
  assert(automatedEvent && automatedEvent.sentiment === 'neutral' && automatedEvent.riskScoreChange === 0, '自动 SEC 事件必须保持 neutral / 0');
  assert(automatedEvent.form === '8-K/A', '修订表单必须保留 /A，不能伪装成原始 8-K');
  const nbisEvent = eventsAfter.events.find((event) => event.accessionNumber === newNbisAccession);
  assert(nbisEvent && nbisEvent.form === '6-K' && nbisEvent.type === '境外发行人披露' && nbisEvent.filingKind === 'disclosure', '6-K 必须使用中性的境外发行人披露标签');

  const valuationAfter = JSON.parse(await readFile(path.join(dataDirectory, 'valuation-bands.json'), 'utf8'));
  assert(valuationAfter.companies.find((company) => company.ticker === 'NVDA').reviewStatus === 'needs-review', '新披露必须把 NVDA 标记为需复核');
  assert(valuationAfter.companies.find((company) => company.ticker === 'NBIS').reviewStatus === 'needs-review', '新披露必须把 NBIS 标记为需复核');

  const beforeRepeat = await Promise.all(['valuation-bands.json', 'events.json', 'sec-filings-state.json'].map((name) => readFile(path.join(dataDirectory, name), 'utf8')));
  const repeated = await runMonitor('events');
  assert(repeated.stdout.includes('"newFilings": 0'), '重复扫描不能重复生成事件');
  assert(repeated.stdout.includes('"changed": false'), '无新披露的事件扫描必须 no-op');
  const afterRepeat = await Promise.all(['valuation-bands.json', 'events.json', 'sec-filings-state.json'].map((name) => readFile(path.join(dataDirectory, name), 'utf8')));
  assert(beforeRepeat.every((value, index) => value === afterRepeat[index]), '幂等扫描不能改写任何数据文件');

  await writeFile(path.join(fixtureDirectory, 'NBIS-submissions.json'), '{ invalid json', 'utf8');
  let failedAsExpected = false;
  try {
    await runMonitor('events');
  } catch (error) {
    failedAsExpected = true;
  }
  assert(failedAsExpected, '任一公司抓取或解析失败时，整次扫描必须失败');
  const afterFailure = await Promise.all(['valuation-bands.json', 'events.json', 'sec-filings-state.json'].map((name) => readFile(path.join(dataDirectory, name), 'utf8')));
  assert(afterRepeat.every((value, index) => value === afterFailure[index]), '扫描失败时三个数据文件必须保持字节不变');

  console.log('SEC monitor fixtures passed: UA guard, >500 baseline, amended filing, 6-K label, review flag, idempotency, failure safety');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
