import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { fetchJson, readJson, writeJsonIfChanged, now, parseArgs, sleep } from './lib/refresh-utils.mjs';
import { extractFinancials, calculateFinancialModel, validFinancialModel } from './lib/financial-model.mjs';

const OUTPUT = 'data/financial-valuations.json';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function refreshFinancialModels({ dryRun = false, load, tickerMap, previous, onlyTickers } = {}) {
  const config = await readJson('data/financial-model-config.json');
  const watchlist = await readJson('data/us-watchlist.json');
  const valuation = await readJson('data/valuation-bands.json');
  const coverage = await readJson('data/valuation-coverage.json');
  previous ??= await readJson(OUTPUT).catch(error => { if (error.code === 'ENOENT') return { version: 1, entries: [] }; throw error; });
  const contact = process.env.SEC_USER_AGENT || '';
  if (!load && !/\S+@\S+\.\S+/.test(contact)) throw new Error('SEC_USER_AGENT 需包含真实联系邮箱；未写入财报快照');
  const request = async url => {
    await sleep(250);
    return fetchJson(url, { headers: { 'User-Agent': contact }, retries: 1, timeoutMs: 20000 });
  };
  const checkedAt = now().toISOString();
  let discoveryError = '';
  if (!tickerMap) {
    try {
      const payload = await request('https://www.sec.gov/files/company_tickers.json');
      tickerMap = Object.values(payload).map(item => ({ ticker: item.ticker.replace('-', '.'), cik: String(item.cik_str).padStart(10, '0') }));
    } catch (error) { tickerMap = []; discoveryError = 'SEC 股票代码目录请求失败，使用已核验的 CIK 配置'; }
  }
  const ciks = new Map(tickerMap.map(item => [item.ticker, item.cik]));
  for (const item of valuation.companies) ciks.set(item.ticker, item.secCik);
  for (const [ticker, item] of Object.entries(config.companies)) if (item.cik) ciks.set(ticker, item.cik);
  const previousByTicker = new Map(previous.entries.map(item => [item.ticker, item]));
  const loadFacts = load || (async cik => request(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`));
  const entries = [];
  let fetchedCount = 0;
  for (const company of watchlist.entries.filter(item => item.securityType === '股票' && (!onlyTickers || onlyTickers.includes(item.ticker)))) {
    const old = previousByTicker.get(company.ticker);
    const cik = ciks.get(company.ticker) || old?.cik;
    const base = { ticker: company.ticker, market: 'us', currency: 'USD', cik: cik || null, checkedAt };
    if (!cik) { entries.push({ ...base, status: 'unsupported', reason: discoveryError || '未匹配 SEC 发行人，待建立财报数据映射' }); continue; }
    try {
      const payload = await loadFacts(cik, company.ticker);
      if (String(Number(payload.cik)) !== String(Number(cik))) throw new Error('SEC 发行人 CIK 不匹配');
      fetchedCount++;
      const financials = extractFinancials(payload, checkedAt.slice(0, 10));
      if (new Date(checkedAt) - new Date(financials.periodEnd) > 200 * 86400000) throw new Error('最新可用财报超过 200 天，须复核披露是否中断');
      if (old?.financials && financials.periodEnd < old.financials.periodEnd) throw new Error('财报期倒退，保留历史模型待复核');
      const assumptions = { ...config.defaults, ...config.companies[company.ticker] };
      const reviewed = valuation.companies.find(item => item.ticker === company.ticker)?.valuationModel;
      const inputHash = hash({ financials, assumptions, reviewed });
      const quote = coverage.entries.find(item => item.market === 'us' && item.ticker === company.ticker);
      if (quote?.lastSplitDate && financials.evidence.some(item => item.filed < quote.lastSplitDate)) {
        throw new Error('近期拆并股后的财报每股口径尚未全部重述，需复核');
      }
      let model;
      try {
        if (assumptions.exclusionReason) throw new Error(assumptions.exclusionReason);
        model = calculateFinancialModel(financials, assumptions, reviewed); }
      catch (error) {
        entries.push({ ...base, status: 'needs-review', reason: error.message, financials,
          previousModel: old?.model || old?.previousModel || null });
        continue;
      }
      if (!validFinancialModel(model)) throw new Error('模型价格无效');
      const accession = financials.evidence.slice().sort((a, b) => b.filed.localeCompare(a.filed))[0].accession;
      entries.push({ ...base, status: 'ok', financials, model, assumptions,
        assumptionNotice: assumptions.assumption || config.notice,
        inputHash, calculatedAt: old?.inputHash === inputHash ? old.calculatedAt : checkedAt,
        sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-', '')}/${accession}-index.html` });
    } catch (error) {
      entries.push({ ...old, ...base, status: 'error', reason: error.message });
      console.warn(`[financials] ${company.ticker}: ${error.message}`);
    }
  }
  if (!fetchedCount) throw new Error('财报请求全部失败，未写入快照');
  const output = { version: 1, updatedAt: checkedAt.slice(0, 10), checkedAt, methodology: config.notice, discoveryError,
    schedule: '每日检查；财报/重大事件巡检后额外计算。数据源尚未结构化时保留待复核状态。', entries };
  await writeJsonIfChanged(OUTPUT, output, { dryRun });
  console.log(`financial models: ${entries.filter(item => item.status === 'ok').length} ready, ${entries.filter(item => item.status !== 'ok').length} awaiting review`);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  await refreshFinancialModels({ dryRun: Boolean(args['dry-run']) });
}
