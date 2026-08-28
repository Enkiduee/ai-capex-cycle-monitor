import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT_DIR,
  fetchJson,
  now,
  parseArgs,
  readJson,
  round,
  rowsFromColumnar,
  setActionOutput,
  sleep,
  writeJsonIfChanged
} from './lib/refresh-utils.mjs';

const US_COMPANIES = Object.freeze([
  { ticker: 'CRWV', cik: '0001769628' },
  { ticker: 'NBIS', cik: '0001513845' },
  { ticker: 'AAOI', cik: '0001158114' },
  { ticker: 'LITE', cik: '0001633978' },
  { ticker: 'AXTI', cik: '0001051627' },
  { ticker: 'ASTS', cik: '0001780312' },
  { ticker: 'INTC', cik: '0000050863' },
  { ticker: 'GLW', cik: '0000024741' }
]);

const CN_COMPANIES = Object.freeze([
  { ticker: '002436', orgId: '9900012934' },
  { ticker: '002916', orgId: '9900022488' },
  { ticker: '002156', orgId: '9900003427' }
]);

const ACTIVE_NOTICE_DAYS = 7;
const SEC_LIVE_START = '2026-07-01';
const DEFAULT_SEC_ARCHIVE_PREFIX = 'https://www.sec.gov/Archives';
const args = parseArgs();
const market = String(args.market || process.env.MARKET || 'auto').toLowerCase();
const dryRun = Boolean(args['dry-run']);
const force = Boolean(args.force);
const fixtureDirectory = args['fixture-dir'] ? path.resolve(ROOT_DIR, args['fixture-dir']) : '';
const dataDirectory = args['data-dir'] ? path.resolve(ROOT_DIR, args['data-dir']) : path.join(ROOT_DIR, 'data');
const dataFile = (name) => path.join(dataDirectory, name);
const checkedAt = now();
const checkedAtIso = checkedAt.toISOString();
const SEC_USER_AGENT = String(process.env.SEC_USER_AGENT || '').trim();
const SEC_ARCHIVE_PREFIX = String(process.env.SEC_ARCHIVE_URL_PREFIX || DEFAULT_SEC_ARCHIVE_PREFIX).replace(/\/$/, '');

function plainText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlTagPattern(name, flags = 'i') {
  return new RegExp(`<(?:[a-z0-9_-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${name}>`, flags);
}

function xmlValue(xml, name) {
  const match = String(xml || '').match(xmlTagPattern(name));
  return plainText(match && match[1]);
}

function xmlBlocks(xml, name) {
  const pattern = xmlTagPattern(name, 'gi');
  return Array.from(String(xml || '').matchAll(pattern), (match) => match[1]);
}

function normalizeUsDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

function normalizeOwner(value) {
  return plainText(value)
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function formatCompactUsd(value) {
  const amount = Number(value || 0);
  return amount >= 1e9 ? `$${(amount / 1e9).toFixed(2)}B` : `$${(amount / 1e6).toFixed(2)}M`;
}

export function parseForm4Xml(xml, metadata = {}) {
  const owner = xmlValue(xml, 'rptownername');
  const isPlan = ['1', 'true', 'yes'].includes(xmlValue(xml, 'aff10b5one').toLowerCase());
  const transactions = [];
  for (const block of xmlBlocks(xml, 'nonderivativetransaction')) {
    if (xmlValue(block, 'transactioncode').toUpperCase() !== 'S') continue;
    const amountBlock = xmlBlocks(block, 'transactionamounts')[0] || block;
    if (xmlValue(amountBlock, 'transactionacquireddisposedcode').toUpperCase() !== 'D') continue;
    const date = normalizeUsDate(xmlValue(xmlBlocks(block, 'transactiondate')[0], 'value'));
    const shares = Number(xmlValue(xmlBlocks(amountBlock, 'transactionshares')[0], 'value'));
    const price = Number(xmlValue(xmlBlocks(amountBlock, 'transactionpricepershare')[0], 'value'));
    if (!date || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price < 0) continue;
    transactions.push({
      date,
      ticker: metadata.ticker || xmlValue(xml, 'issuertradingsymbol').toUpperCase(),
      owner,
      ownerKey: normalizeOwner(owner),
      shares: Math.round(shares),
      valueUsd: round(shares * price, 2),
      valueCny: 0,
      planValueUsd: isPlan ? round(shares * price, 2) : 0,
      accessionNumber: metadata.accessionNumber || '',
      filingDate: metadata.filingDate || '',
      sourceUrl: metadata.sourceUrl || ''
    });
  }
  return { owner, isPlan, transactions };
}

export function parseForm144Xml(xml, metadata = {}) {
  const owner = xmlValue(xml, 'nameofpersonforwhoseaccountthesecuritiesaretobesold');
  const notices = [];
  for (const block of xmlBlocks(xml, 'securitiesinformation')) {
    const date = normalizeUsDate(xmlValue(block, 'approxsaledate'));
    const shares = Number(xmlValue(block, 'noofunitssold'));
    const valueUsd = Number(xmlValue(block, 'aggregatemarketvalue'));
    if (!date || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(valueUsd) || valueUsd < 0) continue;
    notices.push({
      date,
      ticker: metadata.ticker || '',
      owner,
      ownerKey: normalizeOwner(owner),
      shares: Math.round(shares),
      valueUsd: round(valueUsd, 2),
      accessionNumber: metadata.accessionNumber || '',
      filingDate: metadata.filingDate || '',
      sourceUrl: metadata.sourceUrl || ''
    });
  }
  return { owner, notices };
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function zonedParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday,
    minutes: Number(map.hour) * 60 + Number(map.minute)
  };
}

function previousWeekday(date) {
  let candidate = addDays(date, -1);
  while (['Sat', 'Sun'].includes(zonedParts(new Date(`${candidate}T12:00:00Z`), 'UTC').weekday)) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

export function lastClosedSessionDate(value, marketId) {
  const config = marketId === 'cn'
    ? { timezone: 'Asia/Shanghai', closeMinutes: 15 * 60 }
    : { timezone: 'America/New_York', closeMinutes: 16 * 60 };
  const parts = zonedParts(value, config.timezone);
  if (!['Sat', 'Sun'].includes(parts.weekday) && parts.minutes >= config.closeMinutes) return parts.date;
  return previousWeekday(parts.date);
}

function selectedMarkets() {
  if (!['auto', 'all', 'cn', 'us'].includes(market)) throw new Error(`--market 仅支持 auto、all、cn 或 us，当前为 ${market}`);
  if (market === 'all') return ['cn', 'us'];
  if (market === 'cn' || market === 'us') return [market];
  const cn = zonedParts(checkedAt, 'Asia/Shanghai');
  const us = zonedParts(checkedAt, 'America/New_York');
  const picked = [];
  if (!['Sat', 'Sun'].includes(cn.weekday) && cn.minutes >= 15 * 60 && cn.minutes < 17 * 60) picked.push('cn');
  if (!['Sat', 'Sun'].includes(us.weekday) && us.minutes >= 16 * 60 && us.minutes < 19 * 60) picked.push('us');
  if (!picked.length && force) return ['cn', 'us'];
  return picked;
}

async function fetchText(url, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 3;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: options.headers,
        signal: AbortSignal.timeout(options.timeoutMs || 25000)
      });
      if (response.ok) return await response.text();
      if (response.status !== 429 && response.status < 500) throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
      if (attempt >= retries) throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
    } catch (error) {
      if (attempt >= retries) throw error;
    }
    await sleep(Math.min(8000, 700 * (2 ** attempt)));
  }
  throw new Error(`请求失败：${url}`);
}

function archiveUrl(company, row) {
  const cik = String(Number(company.cik));
  const accession = String(row.accessionNumber || '');
  const compact = accession.replaceAll('-', '');
  const document = path.posix.basename(String(row.primaryDocument || ''));
  return `${SEC_ARCHIVE_PREFIX}/edgar/data/${cik}/${compact}/${document}`;
}

function officialArchiveUrl(company, row) {
  const cik = String(Number(company.cik));
  const accession = String(row.accessionNumber || '');
  const compact = accession.replaceAll('-', '');
  const document = path.posix.basename(String(row.primaryDocument || ''));
  return `${DEFAULT_SEC_ARCHIVE_PREFIX}/edgar/data/${cik}/${compact}/${document}`;
}

async function loadSubmission(company) {
  if (fixtureDirectory) {
    return JSON.parse(await readFile(path.join(fixtureDirectory, `${company.ticker}-submissions.json`), 'utf8'));
  }
  return fetchJson(`https://data.sec.gov/submissions/CIK${company.cik}.json`, {
    retries: 3,
    timeoutMs: 25000,
    headers: { 'User-Agent': SEC_USER_AGENT, 'Accept-Encoding': 'gzip, deflate' }
  });
}

async function loadSecXml(company, row) {
  if (fixtureDirectory) {
    return readFile(path.join(fixtureDirectory, `${row.accessionNumber}.xml`), 'utf8');
  }
  const headers = SEC_ARCHIVE_PREFIX.startsWith('https://r.jina.ai/')
    ? { 'X-No-Cache': 'true', 'X-Return-Format': 'html' }
    : { 'User-Agent': SEC_USER_AGENT, Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5' };
  return fetchText(archiveUrl(company, row), { headers, retries: 3, timeoutMs: 30000 });
}

async function refreshSecState(state, sessionDate) {
  const existingForm4 = new Map((state.secFilings || []).map((filing) => [filing.accessionNumber, filing]));
  const existingForm144 = new Map((state.form144Filings || []).map((filing) => [filing.accessionNumber, filing]));
  const activeStart = addDays(sessionDate, -(ACTIVE_NOTICE_DAYS + 14));
  let fetchedForms = 0;

  for (const company of US_COMPANIES) {
    const submission = await loadSubmission(company);
    const rows = rowsFromColumnar(submission?.filings?.recent);
    const form4Rows = rows.filter((row) => String(row.form).toUpperCase() === '4' && row.filingDate >= SEC_LIVE_START);
    const form144Rows = rows.filter((row) => String(row.form).toUpperCase() === '144' && row.filingDate >= activeStart);

    for (const row of form4Rows) {
      if (existingForm4.has(row.accessionNumber)) continue;
      const sourceUrl = officialArchiveUrl(company, row);
      const xml = await loadSecXml(company, row);
      const parsed = parseForm4Xml(xml, { ticker: company.ticker, accessionNumber: row.accessionNumber, filingDate: row.filingDate, sourceUrl });
      existingForm4.set(row.accessionNumber, {
        ticker: company.ticker,
        accessionNumber: row.accessionNumber,
        filingDate: row.filingDate,
        sourceUrl,
        owner: parsed.owner,
        isPlan: parsed.isPlan,
        transactions: parsed.transactions
      });
      fetchedForms += 1;
      await sleep(140);
    }

    for (const row of form144Rows) {
      if (existingForm144.has(row.accessionNumber)) continue;
      const sourceUrl = officialArchiveUrl(company, row);
      const xml = await loadSecXml(company, row);
      const parsed = parseForm144Xml(xml, { ticker: company.ticker, accessionNumber: row.accessionNumber, filingDate: row.filingDate, sourceUrl });
      existingForm144.set(row.accessionNumber, {
        ticker: company.ticker,
        accessionNumber: row.accessionNumber,
        filingDate: row.filingDate,
        sourceUrl,
        owner: parsed.owner,
        notices: parsed.notices
      });
      fetchedForms += 1;
      await sleep(140);
    }
    await sleep(450);
  }

  state.secFilings = [...existingForm4.values()]
    .filter((filing) => filing.filingDate >= SEC_LIVE_START)
    .sort((left, right) => left.filingDate.localeCompare(right.filingDate) || left.accessionNumber.localeCompare(right.accessionNumber));
  state.form144Filings = [...existingForm144.values()]
    .filter((filing) => filing.filingDate >= activeStart)
    .sort((left, right) => left.filingDate.localeCompare(right.filingDate) || left.accessionNumber.localeCompare(right.accessionNumber));
  state.lastSecCheckAt = checkedAtIso;
  state.lastSecSessionDate = sessionDate;
  return fetchedForms;
}

async function loadCninfoAnnouncements(company, start, end) {
  if (fixtureDirectory) {
    return JSON.parse(await readFile(path.join(fixtureDirectory, `${company.ticker}-cninfo.json`), 'utf8'));
  }
  const body = new URLSearchParams({
    pageNum: '1', pageSize: '50', tabName: 'fulltext', column: 'szse',
    stock: `${company.ticker},${company.orgId}`, searchkey: '减持', seDate: `${start}~${end}`,
    sortName: '', sortType: ''
  });
  return fetchJson('https://www.cninfo.com.cn/new/hisAnnouncement/query', {
    method: 'POST',
    body: body.toString(),
    retries: 3,
    timeoutMs: 25000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (compatible; AI-CapEx-Cycle-Monitor/1.0)',
      Referer: 'https://www.cninfo.com.cn/'
    }
  });
}

async function refreshCninfoState(state, sessionDate) {
  const start = addDays(sessionDate, -364);
  const previousIds = new Set(state.cninfoKnownAnnouncementIds || []);
  const current = [];
  for (const company of CN_COMPANIES) {
    const payload = await loadCninfoAnnouncements(company, start, sessionDate);
    for (const item of payload?.announcements || []) {
      current.push({
        ticker: company.ticker,
        announcementId: String(item.announcementId || ''),
        date: new Date(Number(item.announcementTime)).toISOString().slice(0, 10),
        title: plainText(item.announcementTitle),
        sourceUrl: `https://static.cninfo.com.cn/${item.adjunctUrl}`
      });
    }
    await sleep(350);
  }

  const currentIds = current.map((item) => item.announcementId).filter(Boolean);
  if (previousIds.size) {
    const queuedIds = new Set((state.cninfoReviewQueue || []).map((item) => item.announcementId));
    for (const item of current) {
      if (!previousIds.has(item.announcementId) && !queuedIds.has(item.announcementId)) {
        state.cninfoReviewQueue = [...(state.cninfoReviewQueue || []), item];
      }
    }
  }
  state.cninfoKnownAnnouncementIds = Array.from(new Set([...(state.cninfoKnownAnnouncementIds || []), ...currentIds])).sort();
  state.cninfoAnnouncements = current.sort((left, right) => right.date.localeCompare(left.date));
  state.lastCninfoCheckAt = checkedAtIso;
  state.lastCninfoSessionDate = sessionDate;
  return current.length;
}

function aggregate(items, keys) {
  const grouped = new Map();
  for (const item of items) {
    const key = keys.map((name) => item[name]).join('|');
    const group = grouped.get(key) || {
      ...Object.fromEntries(keys.map((name) => [name, item[name]])),
      date: item.date,
      shares: 0,
      valueUsd: 0,
      valueCny: 0,
      planValueUsd: 0,
      accessionNumbers: new Set(),
      owners: new Set(),
      sourceUrl: item.sourceUrl || ''
    };
    group.date = group.date > item.date ? group.date : item.date;
    group.shares += Number(item.shares || 0);
    group.valueUsd += Number(item.valueUsd || 0);
    group.valueCny += Number(item.valueCny || 0);
    group.planValueUsd += Number(item.planValueUsd || 0);
    if (item.accessionNumber) group.accessionNumbers.add(item.accessionNumber);
    if (item.owner) group.owners.add(item.owner);
    if (item.sourceUrl) group.sourceUrl = item.sourceUrl;
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

function noticeSnapshot(notices, executed, endDate) {
  const activeStart = addDays(endDate, -(ACTIVE_NOTICE_DAYS - 1));
  return notices
    .filter((notice) => notice.date >= activeStart && notice.date <= endDate)
    .map((notice) => {
      const matchedShares = executed
        .filter((sale) => sale.ticker === notice.ticker && sale.date === notice.date && sale.ownerKey === notice.ownerKey)
        .reduce((sum, sale) => sum + Number(sale.shares || 0), 0);
      const pendingShares = Math.max(0, notice.shares - matchedShares);
      return {
        ...notice,
        pendingShares,
        pendingValueUsd: notice.shares ? round(notice.valueUsd * (pendingShares / notice.shares), 2) : 0
      };
    });
}

function buildSaleTimeline(executed, pending) {
  const usMonthly = aggregate(
    executed.filter((item) => /^\D/.test(item.ticker)).map((item) => ({ ...item, month: item.date.slice(0, 7) })),
    ['month', 'ticker']
  ).map((group) => {
    const plannedPct = group.valueUsd ? (group.planValueUsd / group.valueUsd) * 100 : 0;
    return {
      date: group.date,
      ticker: group.ticker,
      person: group.owners.size === 1 ? [...group.owners][0] : '多位申报人（月度合并）',
      kind: group.planValueUsd === 0 ? 'executed-discretionary' : 'executed',
      shares: group.shares,
      valueUsd: round(group.valueUsd, 2),
      valueCny: 0,
      label: group.planValueUsd === 0 ? '月度公开市场出售' : '月度 Form 4 出售',
      detail: `${group.month} 月交易代码 S 合并；${group.planValueUsd ? `10b5-1 标记金额约占 ${plannedPct.toFixed(1)}%。` : '未标记 10b5-1。'}`,
      sourceUrl: group.sourceUrl
    };
  });

  const cn = executed.filter((item) => /^\d/.test(item.ticker)).map((item) => ({
    date: item.date,
    ticker: item.ticker,
    person: item.owner,
    kind: 'executed',
    shares: item.shares,
    valueUsd: item.valueUsd,
    valueCny: item.valueCny,
    valueEstimated: Boolean(item.valueEstimated),
    label: item.label || 'A 股已实施减持',
    detail: item.detail,
    sourceUrl: item.sourceUrl
  }));

  const pendingRows = aggregate(pending.filter((item) => item.pendingShares > 0).map((item) => ({
    ...item,
    shares: item.pendingShares,
    valueUsd: item.pendingValueUsd,
    valueCny: 0
  })), ['date', 'ticker']).map((group) => ({
    date: group.date,
    ticker: group.ticker,
    person: group.owners.size === 1 ? [...group.owners][0] : '多位申报人',
    kind: 'pending',
    shares: group.shares,
    valueUsd: round(group.valueUsd, 2),
    valueCny: 0,
    label: 'Form 144 待确认',
    detail: `最近 ${ACTIVE_NOTICE_DAYS} 日拟售通知中尚未被同日、同申报人 Form 4 匹配的部分。`,
    sourceUrl: group.sourceUrl
  }));
  return [...pendingRows, ...usMonthly, ...cn].sort((left, right) => right.date.localeCompare(left.date) || left.ticker.localeCompare(right.ticker));
}

function recalculateFinancing(financing, start, end) {
  const next = structuredClone(financing || {});
  next.window = { start, end, label: '公司融资（滚动 12 个月）' };
  next.events = (next.events || []).filter((event) => event.date >= start && event.date <= end);
  const equity = next.events.filter((event) => event.channel === 'equity');
  const debt = next.events.filter((event) => event.channel !== 'equity');
  const sum = (items, key) => items.reduce((total, item) => total + Number(item[key] || 0), 0);
  next.scope.totalCompanies = 12;
  next.scope.enteredCompanies = new Set(next.events.map((event) => event.ticker)).size;
  next.summary = {
    equityValueUsd: sum(equity, 'amountUsd'),
    equityValueEur: sum(equity, 'amountEur'),
    debtAndConvertibleValueUsd: sum(debt, 'amountUsd'),
    debtAndConvertibleValueEur: sum(debt, 'amountEur'),
    equityEventCount: equity.length,
    debtAndConvertibleEventCount: debt.length,
    eventCount: next.events.length
  };
  return next;
}

export function rebuildRadar(data, state) {
  const end = [state.lastSecSessionDate, state.lastCninfoSessionDate, data.window?.end].filter(Boolean).sort().at(-1);
  const start = addDays(end, -364);
  const historical = (state.historicalTransactions || []).filter((item) => item.date < SEC_LIVE_START);
  const live = (state.secFilings || []).flatMap((filing) => filing.transactions || []);
  const cn = state.cnTransactions || [];
  const executed = [...historical, ...live, ...cn].filter((item) => item.date >= start && item.date <= end);
  const notices = (state.form144Filings || []).flatMap((filing) => filing.notices || []);
  const pending = noticeSnapshot(notices, executed, end);
  const companyTotals = new Map();

  for (const item of executed) {
    const total = companyTotals.get(item.ticker) || { shares: 0, valueUsd: 0, valueCny: 0, planValueUsd: 0, accessions: new Set() };
    total.shares += Number(item.shares || 0);
    total.valueUsd += Number(item.valueUsd || 0);
    total.valueCny += Number(item.valueCny || 0);
    total.planValueUsd += Number(item.planValueUsd || 0);
    if (item.accessionNumber) total.accessions.add(item.accessionNumber);
    companyTotals.set(item.ticker, total);
  }

  const noticeTotals = new Map();
  for (const item of pending) {
    const total = noticeTotals.get(item.ticker) || { shares: 0, valueUsd: 0, filings: new Set(), pendingShares: 0, pendingValueUsd: 0 };
    total.shares += item.shares;
    total.valueUsd += item.valueUsd;
    total.pendingShares += item.pendingShares;
    total.pendingValueUsd += item.pendingValueUsd;
    total.filings.add(item.accessionNumber);
    noticeTotals.set(item.ticker, total);
  }

  const companies = data.companies.map((company) => {
    if (company.coverage !== 'covered') return company;
    const sales = companyTotals.get(company.ticker) || { shares: 0, valueUsd: 0, valueCny: 0, planValueUsd: 0, accessions: new Set() };
    const notice = noticeTotals.get(company.ticker) || { shares: 0, valueUsd: 0, filings: new Set(), pendingShares: 0, pendingValueUsd: 0 };
    const status = notice.pendingShares > 0 ? 'pending' : sales.shares > 0 ? 'sold' : 'clear';
    const currency = /^\d/.test(company.ticker) && sales.valueCny > 0 ? ` / ¥${(sales.valueCny / 1e6).toFixed(2)}M 原值` : '';
    return {
      ...company,
      status,
      executed: { shares: sales.shares, valueUsd: round(sales.valueUsd, 2), valueCny: round(sales.valueCny, 2), filingCount: sales.accessions.size },
      notices: { shares: notice.shares, valueUsd: round(notice.valueUsd, 2), filingCount: notice.filings.size },
      pending: { shares: notice.pendingShares, valueUsd: round(notice.pendingValueUsd, 2), filingCount: notice.filings.size },
      planExecutedValueUsd: round(sales.planValueUsd, 2),
      note: sales.shares > 0
        ? `滚动一年已售 ${new Intl.NumberFormat('zh-CN').format(sales.shares)} 股，美元可比金额约 ${formatCompactUsd(sales.valueUsd)}${currency}。${notice.pendingShares > 0 ? '期末仍有未匹配 Form 144。' : '期末无活跃未匹配拟售。'}`
        : `截至最近收盘扫描，滚动一年未检出纳入口径的已实施减持。${notice.pendingShares > 0 ? '存在未匹配 Form 144。' : ''}`
    };
  });

  const comparable = companies.filter((company) => company.coverage === 'covered');
  const executedValueUsd = comparable.reduce((sum, company) => sum + Number(company.executed?.valueUsd || 0), 0);
  const executedValueCny = comparable.reduce((sum, company) => sum + Number(company.executed?.valueCny || 0), 0);
  const usExecutedValueUsd = comparable.filter((company) => /^\D/.test(company.ticker)).reduce((sum, company) => sum + Number(company.executed?.valueUsd || 0), 0);
  const planExecutedValueUsd = comparable.reduce((sum, company) => sum + Number(company.planExecutedValueUsd || 0), 0);
  const top = comparable.reduce((best, company) => Number(company.executed?.valueUsd || 0) > Number(best.executed?.valueUsd || 0) ? company : best, comparable[0]);
  const reviewCount = (state.cninfoReviewQueue || []).length;

  return {
    ...data,
    updatedAt: end,
    window: { start, end, label: '近一年（滚动 12 个月）' },
    companies,
    summary: {
      executedShares: comparable.reduce((sum, company) => sum + Number(company.executed?.shares || 0), 0),
      executedValueUsd: round(executedValueUsd, 2),
      executedValueCny: round(executedValueCny, 2),
      usExecutedValueUsd: round(usExecutedValueUsd, 2),
      noticeShares: comparable.reduce((sum, company) => sum + Number(company.notices?.shares || 0), 0),
      noticeValueUsd: round(comparable.reduce((sum, company) => sum + Number(company.notices?.valueUsd || 0), 0), 2),
      pendingShares: comparable.reduce((sum, company) => sum + Number(company.pending?.shares || 0), 0),
      pendingValueUsd: round(comparable.reduce((sum, company) => sum + Number(company.pending?.valueUsd || 0), 0), 2),
      companiesWithSales: comparable.filter((company) => Number(company.executed?.shares || 0) > 0).length,
      companiesWithPendingNotices: comparable.filter((company) => Number(company.pending?.shares || 0) > 0).length,
      plannedExecutionSharePct: usExecutedValueUsd ? round((planExecutedValueUsd / usExecutedValueUsd) * 100, 2) : 0,
      topCompanyTicker: top?.ticker || '',
      topCompanyConcentrationPct: executedValueUsd ? round((Number(top?.executed?.valueUsd || 0) / executedValueUsd) * 100, 2) : 0,
      valueBasis: '美元金额 + A 股人民币成交按交易日参考汇率折算；人民币原值另列'
    },
    financing: recalculateFinancing(data.financing, start, end),
    timeline: buildSaleTimeline(executed, pending),
    automation: {
      enabled: true,
      schedule: 'A 股 15:47 Asia/Shanghai；美股 16:47 America/New_York（交易日）',
      lastSuccessfulRefreshAt: checkedAtIso,
      secLastCheckedAt: state.lastSecCheckAt || '',
      secSessionDate: state.lastSecSessionDate || '',
      cninfoLastCheckedAt: state.lastCninfoCheckAt || '',
      cninfoSessionDate: state.lastCninfoSessionDate || '',
      cninfoReviewCount: reviewCount,
      status: reviewCount ? 'A 股发现新减持公告，等待金额复核' : '最近收盘扫描完成',
      disclosureLagNotice: 'Form 4 通常在成交后两个工作日内提交；每日刷新扫描最新披露，不等于成交当日即可见。'
    }
  };
}

async function run() {
  if (!fixtureDirectory && !/^[^\s].*\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?:\s|$)/i.test(SEC_USER_AGENT) && selectedMarkets().includes('us')) {
    throw new Error('SEC_USER_AGENT 必须包含“项目/组织名 + 可联系邮箱”。');
  }
  const selected = selectedMarkets();
  if (!selected.length) {
    console.log(JSON.stringify({ checkedAt: checkedAtIso, selectedMarkets: [], changed: false, reason: '不在收盘刷新窗口' }, null, 2));
    return;
  }

  const data = await readJson(dataFile('insider-sales.json'));
  const state = await readJson(dataFile('insider-sales-state.json'));
  const nextState = structuredClone(state);
  let fetchedForms = 0;
  let cninfoAnnouncements = 0;
  if (selected.includes('us')) fetchedForms = await refreshSecState(nextState, lastClosedSessionDate(checkedAt, 'us'));
  if (selected.includes('cn')) cninfoAnnouncements = await refreshCninfoState(nextState, lastClosedSessionDate(checkedAt, 'cn'));
  nextState.updatedAt = checkedAtIso;
  const nextData = rebuildRadar(data, nextState);
  const stateChanged = await writeJsonIfChanged(dataFile('insider-sales-state.json'), nextState, { dryRun });
  const dataChanged = await writeJsonIfChanged(dataFile('insider-sales.json'), nextData, { dryRun });
  const changed = stateChanged || dataChanged;

  await setActionOutput('changed', changed);
  await setActionOutput('markets', selected.join(','));
  await setActionOutput('fetched_forms', fetchedForms);
  await setActionOutput('cninfo_announcements', cninfoAnnouncements);
  await setActionOutput('window_end', nextData.window.end);
  console.log(JSON.stringify({ checkedAt: checkedAtIso, selectedMarkets: selected, fetchedForms, cninfoAnnouncements, window: nextData.window, changed, dryRun }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await run();
