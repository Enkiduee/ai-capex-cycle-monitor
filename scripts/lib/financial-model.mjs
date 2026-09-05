import { round } from './refresh-utils.mjs';

const DAY = 86400000;
const duration = row => (Date.parse(row.end) - Date.parse(row.start)) / DAY + 1;
const difference = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;
const forms = /^(10-[KQ]|20-F|40-F)(\/A)?$/;

export function factsFor(payload, tags, unit, asOf) {
  let best = [];
  for (const tag of tags) {
    const [taxonomy, name] = tag.includes(':') ? tag.split(':') : ['us-gaap', tag];
    const rows = payload.facts?.[taxonomy]?.[name]?.units?.[unit] || [];
    const valid = rows.filter(row => typeof row.val === 'number' && Number.isFinite(row.val)
      && row.end && row.filed && row.filed <= asOf && row.end <= asOf && forms.test(row.form));
    if (valid.length && (!best.length || valid.map(row => row.end).sort().at(-1) > best.map(row => row.end).sort().at(-1))) best = valid.map(row => ({ ...row, tag }));
  }
  return best;
}

// Select the latest disclosure of each exact period, including amendments/restatements.
function latestPeriods(rows) {
  const map = new Map();
  for (const row of [...rows].sort((a, b) => a.filed.localeCompare(b.filed) || a.accn.localeCompare(b.accn))) {
    map.set(`${row.start || ''}:${row.end}`, row);
  }
  return [...map.values()];
}

function evidence(row) {
  return { tag: row.tag, value: row.val, start: row.start || null, end: row.end, filed: row.filed, accession: row.accn };
}

export function trailingValue(rows, periodEnd) {
  const values = latestPeriods(rows.filter(row => row.start));
  const annual = values.filter(row => duration(row) >= 350 && duration(row) <= 380);
  const current = values.filter(row => row.end === periodEnd).sort((a, b) => duration(b) - duration(a));
  for (const row of current) {
    if (duration(row) >= 350 && duration(row) <= 380) {
      return { value: row.val, periodEnd, calculation: `${row.start} 至 ${row.end} 完整财年`, evidence: [evidence(row)] };
    }
    if (duration(row) < 60 || duration(row) > 300) continue;
    const priorYear = annual.filter(a => a.end < row.end && difference(row.start, a.end) <= 10)
      .sort((a, b) => b.end.localeCompare(a.end))[0];
    if (!priorYear) continue;
    const priorYtd = values.find(a => difference(a.start, priorYear.start) <= 7
      && Math.abs(duration(a) - duration(row)) <= 8 && difference(a.end, row.end) >= 350
      && difference(a.end, row.end) <= 380);
    if (priorYtd) return {
      value: round(priorYear.val + row.val - priorYtd.val, 6), periodEnd,
      calculation: `${priorYear.val}（上财年） + ${row.val}（本年累计） − ${priorYtd.val}（上年同期累计）`,
      evidence: [evidence(priorYear), evidence(row), evidence(priorYtd)]
    };
  }
  // Four contiguous, non-overlapping quarters; never sum overlapping YTD facts.
  const quarters = values.filter(row => duration(row) >= 70 && duration(row) <= 105);
  const selected = [];
  let end = periodEnd;
  for (let i = 0; i < 4; i++) {
    const row = quarters.find(item => item.end === end);
    if (!row) break;
    selected.unshift(row);
    end = new Date(Date.parse(row.start) - DAY).toISOString().slice(0, 10);
  }
  if (selected.length === 4 && difference(selected[0].start, periodEnd) >= 349
    && difference(selected[0].start, periodEnd) <= 379) return {
    value: round(selected.reduce((sum, row) => sum + row.val, 0), 6), periodEnd,
    calculation: selected.map(row => `${row.val}（${row.start}–${row.end}）`).join(' + '), evidence: selected.map(evidence)
  };
  return null;
}

function instant(rows, periodEnd) {
  return latestPeriods(rows).filter(row => !row.start && row.end === periodEnd)
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];
}

export function extractFinancials(payload, asOf) {
  const read = (tags, unit = 'USD') => factsFor(payload, tags, unit, asOf);
  const revenues = read(['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']);
  const epsRows = read(['EarningsPerShareDiluted'], 'USD/shares');
  const operating = read(['OperatingIncomeLoss']);
  const cashRows = read(['CashAndCashEquivalentsAtCarryingValue']);
  const liabilitiesRows = read(['Liabilities']);
  const cfoRows = read(['NetCashProvidedByUsedInOperatingActivities']);
  const ends = [...new Set([...revenues, ...epsRows, ...cashRows, ...liabilitiesRows].map(row => row.end))].sort();
  const periodEnd = ends.at(-1);
  if (!periodEnd) throw new Error('没有可核验的美元 GAAP 财报');
  // Do not silently fall back to an older report when the newest report is incomplete.
  const cash = instant(cashRows, periodEnd);
  const minority = instant(read(['MinorityInterest', 'MinorityInterestInJointVentures', 'NoncontrollingInterestInConsolidatedEntity']), periodEnd);
  const liabilities = instant(liabilitiesRows, periodEnd);
  const shares = instant(read(['CommonStockSharesOutstanding'], 'shares'), periodEnd);
  const revenue = trailingValue(revenues, periodEnd);
  const eps = trailingValue(epsRows, periodEnd);
  const operatingIncome = trailingValue(operating, periodEnd);
  const operatingCashFlow = trailingValue(cfoRows, periodEnd);
  const all = [cash, liabilities, shares].filter(Boolean).map(evidence)
    .concat(...[revenue, eps, operatingIncome, operatingCashFlow].filter(Boolean).map(x => x.evidence));
  return { periodEnd, filedAt: all.map(x => x.filed).sort().at(-1), cash: cash?.val ?? null,
    liabilities: liabilities?.val ?? null, minorityInterest: minority?.val ?? null, shares: shares?.val ?? null,
    revenue, eps, operatingIncome, operatingCashFlow, evidence: all };
}

export function calculateFinancialModel(financials, assumptions, reviewedModel) {
  const f = financials;
  const positive = x => Number.isFinite(x) && x > 0;
  if (positive(f.eps?.value) && positive(f.operatingIncome?.value)) {
    const sameBasis = reviewedModel?.kind === 'pe' && reviewedModel.eps.accountingBasis === 'GAAP'
      && reviewedModel.peScenarios?.accountingBasis === 'GAAP';
    const multiples = sameBasis
      ? ['bear', 'base', 'bull'].map(key => reviewedModel.peScenarios[key]) : assumptions.pe;
    // Research that deliberately normalizes exceptional earnings is not silently replaced.
    if (reviewedModel && (!sameBasis || reviewedModel.eps.periodType === 'FY')) {
      throw new Error('已有模型使用规范化、完整财年或 non-GAAP 盈利，须复核后更新');
    }
    const prices = multiples.map(multiple => round(f.eps.value * multiple, 4));
    return { kind: 'pe', label: 'GAAP 盈利情景', prices,
      formula: 'TTM GAAP 摊薄 EPS × P/E', multiples, multipleSource: sameBasis ? '已有同口径研究假设' : '默认研究假设',
      inputs: { eps: f.eps.value }, confidence: sameBasis ? 'medium' : 'low' };
  }
  if (!f.eps || !f.operatingIncome) throw new Error('缺少连续四季 EPS 或经营利润，无法判断盈利模型适用性');
  if (![f.cash, f.liabilities, f.shares, f.operatingCashFlow?.value, f.revenue?.value].every(Number.isFinite)
    || !positive(f.shares) || f.cash < 0 || f.liabilities < 0 || f.revenue.value < 0) {
    throw new Error('亏损模型缺少同一期收入、现金、总负债、股数或连续四季经营现金流');
  }
  if (Number.isFinite(f.minorityInterest) && f.minorityInterest > 0) throw new Error('存在少数股东权益，需要核验合并收入与普通股权益归属');
  const burn = Math.max(0, -f.operatingCashFlow.value) * assumptions.cashBurnYears;
  const inputs = { revenue: f.revenue.value, cash: f.cash, liabilities: f.liabilities, shares: f.shares, cashBurnReserve: burn };
  if (f.revenue.value === 0) {
    const prices = assumptions.cashHaircuts.map(haircut => round(Math.max(0, f.cash * haircut - f.liabilities - burn) / f.shares, 4));
    return { kind: 'cash-runway', label: '未商业化现金压力测试', prices, inputs,
      formula: 'max(0, 现金 × 情景折扣 − 总负债 − 一年现金消耗) ÷ 期末普通股数',
      multiples: assumptions.cashHaircuts, multipleSource: '现金折扣假设', confidence: 'low' };
  }
  const prices = assumptions.revenue.map(multiple => round(Math.max(0,
    f.revenue.value * multiple + f.cash - f.liabilities - burn) / f.shares, 4));
  return { kind: 'revenue-cash', label: '亏损股收入与现金情景', prices, inputs,
    formula: 'max(0, TTM 收入 × 倍数 + 现金 − 总负债 − 一年现金消耗) ÷ 期末普通股数',
    multiples: assumptions.revenue, multipleSource: '固定收入倍数假设', confidence: 'low' };
}

export function validFinancialModel(model) {
  return model && ['pe', 'revenue-cash', 'cash-runway'].includes(model.kind)
    && Array.isArray(model.prices) && model.prices.length === 3
    && model.prices.every((p, i) => Number.isFinite(p) && p >= 0 && (i === 0 || p >= model.prices[i - 1]));
}
