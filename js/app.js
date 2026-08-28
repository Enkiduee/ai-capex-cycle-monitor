'use strict';

(function () {
  const DATA_SOURCES = {
    risk: { path: './data/risk-score.json', label: '风险评分' },
    hyperscalers: { path: './data/hyperscalers.json', label: '云巨头 CapEx' },
    marketTurnover: { path: './data/market-turnover.json', label: '三地市场每日成交额' },
    supplyChain: { path: './data/supply-chain.json', label: '供应链风险' },
    stockWatchlist: { path: './data/stock-watchlist.json', label: '沪深股票资料' },
    hkWatchlist: { path: './data/hk-watchlist.json', label: '港股资料' },
    usWatchlist: { path: './data/us-watchlist.json', label: '美股资料' },
    marketQuotes: { path: './data/market-quotes.json', label: '自动行情快照' },
    valuationCoverage: { path: './data/valuation-coverage.json', label: '全目录估值区间' },
    valuation: { path: './data/valuation-bands.json', label: '价格与估值观察' },
    insiderSales: { path: './data/insider-sales.json', label: '内部人减持' },
    macro: { path: './data/macro.json', label: '宏观环境' },
    events: { path: './data/events.json', label: '重大事件' }
  };
  const DEFAULT_ROUTE = 'overview';
  const BASE_TITLE = 'AI CapEx Cycle Monitor';
  const ROUTES = Object.freeze({
    overview: { label: '周期总览', titleId: 'overview-title' },
    hyperscalers: { label: '云巨头 CapEx', titleId: 'hyperscalers-title' },
    turnover: { label: '三地市场每日成交额', titleId: 'turnover-title' },
    'supply-chain': { label: '供应链风险与估值', titleId: 'supply-chain-title' },
    'insider-sales': { label: '减持雷达', titleId: 'insider-sales-title' },
    macro: { label: '宏观与利率环境', titleId: 'macro-title' },
    events: { label: '重大事件时间线', titleId: 'events-title' },
    methodology: { label: '方法说明', titleId: 'methodology-title' }
  });

  const state = {
    data: {},
    routing: {
      active: DEFAULT_ROUTE,
      bound: false
    },
    supply: {
      segment: 'all',
      risk: 'all',
      sortKey: 'overallRisk',
      sortDirection: 'desc'
    },
    valuation: {
      ticker: 'NVDA'
    },
    buyZones: {
      sortDirection: 'desc',
      market: 'cn',
      query: ''
    },
    stocks: {
      market: 'cn',
      query: ''
    },
    insiderSales: {
      status: 'all',
      query: ''
    },
    events: {
      sentiment: 'all',
      entity: 'all'
    }
  };

  const riskFallback = {
    low: { key: 'low', label: '低风险', className: 'risk-low' },
    medium: { key: 'medium', label: '中风险', className: 'risk-medium' },
    high: { key: 'high', label: '高风险', className: 'risk-high' },
    critical: { key: 'critical', label: '严重风险', className: 'risk-critical' },
    unknown: { key: 'unknown', label: '待判断', className: 'risk-unknown' }
  };

  const sentimentLabels = {
    positive: '正面',
    neutral: '中性',
    negative: '负面'
  };

  const chartSeriesColors = ['#69d7df', '#f2c75c', '#f26f76', '#5bd39a', '#a991f7'];
  const valuationTickerPattern = /^(?:[A-Z][A-Z0-9.-]{0,9}|\d{6})$/;
  const tradingViewSymbolPattern = /^(?:NASDAQ|NYSE|SZSE):(?:[A-Z][A-Z0-9.-]{0,9}|\d{6})$/;
  const confidenceLabels = Object.freeze({
    high: '高',
    medium: '中',
    low: '低',
    not_assessed: '待评估',
    unknown: '待评估'
  });

  function confidenceLabel(value) {
    return confidenceLabels[value] || confidenceLabels.unknown;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function replaceRouteHash(route) {
    const nextUrl = `${window.location.pathname}${window.location.search}#/${route}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }

  function resolveRoute(hash = window.location.hash) {
    const value = String(hash || '');
    if (!value || value === '#') {
      return { route: DEFAULT_ROUTE, replace: true };
    }

    if (value.startsWith('#/')) {
      const route = value.slice(2).split(/[?&]/, 1)[0].replace(/\/+$/, '');
      return ROUTES[route]
        ? { route, replace: false }
        : { route: DEFAULT_ROUTE, replace: true };
    }

    const legacyRoute = value.slice(1);
    if (ROUTES[legacyRoute]) {
      return { route: legacyRoute, replace: true };
    }

    return { route: state.routing.active || DEFAULT_ROUTE, replace: false, isPageAnchor: true };
  }

  function refreshRouteMedia(route, options = {}) {
    const refreshValuation = options.refreshValuation !== false;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (state.routing.active !== route) return;
        if (route === 'hyperscalers' || route === 'turnover') {
          const chartApi = charts();
          if (chartApi && typeof chartApi.resizeAll === 'function') {
            chartApi.resizeAll();
          }
        }
        if (route === 'supply-chain' && refreshValuation && state.data.valuation) {
          try {
            renderSelectedValuation({ forceChart: true });
          } catch (error) {
            renderSectionError('valuation', DATA_SOURCES.valuation, error);
          }
        }
      });
    });
  }

  function applyRoute(route, options = {}) {
    const safeRoute = ROUTES[route] ? route : DEFAULT_ROUTE;
    const config = ROUTES[safeRoute];
    const shouldFocus = options.focus === true;
    const shouldAnimate = options.animate === true && !prefersReducedMotion();
    let activeSection = null;

    state.routing.active = safeRoute;
    document.querySelectorAll('.route-view').forEach((section) => {
      const isActive = section.dataset.route === safeRoute;
      section.hidden = !isActive;
      section.inert = !isActive;
      section.classList.remove('is-entering');
      if (isActive) {
        section.removeAttribute('aria-hidden');
        activeSection = section;
      } else {
        section.setAttribute('aria-hidden', 'true');
      }
    });

    let activeLink = null;
    document.querySelectorAll('.section-nav [data-route]').forEach((link) => {
      const isActive = link.dataset.route === safeRoute;
      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
        activeLink = link;
      } else {
        link.removeAttribute('aria-current');
      }
    });

    document.title = `${config.label}｜${BASE_TITLE}`;
    if (shouldAnimate && activeSection) {
      activeSection.classList.add('is-entering');
      activeSection.addEventListener('animationend', () => {
        activeSection.classList.remove('is-entering');
      }, { once: true });
    }

    if (shouldFocus) {
      const heading = byId(config.titleId);
      if (heading) heading.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    if (activeLink) {
      activeLink.scrollIntoView({
        block: 'nearest',
        inline: 'center',
        behavior: shouldFocus && !prefersReducedMotion() ? 'smooth' : 'auto'
      });
    }

    if (options.refreshMedia !== false) {
      refreshRouteMedia(safeRoute);
    }
  }

  function bindRouting() {
    if (state.routing.bound) return;
    state.routing.bound = true;

    const initial = resolveRoute();
    if (initial.replace) replaceRouteHash(initial.route);
    applyRoute(initial.route, { focus: false, animate: false, refreshMedia: false });
    delete document.documentElement.dataset.initialRoute;

    window.addEventListener('hashchange', () => {
      const resolved = resolveRoute();
      if (resolved.isPageAnchor) return;
      if (resolved.replace) replaceRouteHash(resolved.route);
      applyRoute(resolved.route, { focus: true, animate: true, refreshMedia: true });
    });

    const skipLink = document.querySelector('.skip-link');
    const main = byId('main-content');
    if (skipLink && main) {
      skipLink.addEventListener('click', (event) => {
        event.preventDefault();
        main.focus({ preventScroll: true });
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      });
    }
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function utils() {
    return window.CapExUtils;
  }

  function scoring() {
    return window.CapExScoring;
  }

  function charts() {
    return window.CapExCharts;
  }

  function escapeHTML(value) {
    const api = utils();
    if (api && typeof api.escapeHTML === 'function') {
      return api.escapeHTML(value);
    }
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatDate(value) {
    const api = utils();
    return api && typeof api.formatDate === 'function' ? api.formatDate(value) : String(value || '—');
  }

  function formatNumber(value, decimals, suffix) {
    const api = utils();
    if (api && typeof api.formatNumber === 'function') {
      return api.formatNumber(value, decimals, suffix);
    }
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(decimals)}${suffix || ''}` : '—';
  }

  function normalizeRiskMeta(meta, fallbackLevel) {
    const fallback = riskFallback[fallbackLevel] || riskFallback.unknown;
    if (!meta || typeof meta !== 'object') {
      return fallback;
    }
    const rawKey = String(meta.key || meta.level || fallback.key).toLowerCase();
    const safeKey = ['low', 'medium', 'high', 'critical', 'unknown', 'normal', 'watch', 'elevated', 'bear'].includes(rawKey)
      ? rawKey
      : fallback.key;
    return {
      key: safeKey,
      label: String(meta.label || meta.text || fallback.label),
      className: String(meta.className || meta.cssClass || `risk-${safeKey}`)
    };
  }

  function getRiskMeta(level) {
    const api = utils();
    if (api && typeof api.getRiskMeta === 'function') {
      return normalizeRiskMeta(api.getRiskMeta(level), String(level || 'unknown').toLowerCase());
    }
    return riskFallback[String(level || 'unknown').toLowerCase()] || riskFallback.unknown;
  }

  function getScoreMeta(score) {
    const api = scoring();
    if (api && typeof api.scoreToRisk === 'function') {
      return normalizeRiskMeta(api.scoreToRisk(score), 'unknown');
    }
    if (!Number.isFinite(Number(score))) return riskFallback.unknown;
    if (score <= 24) return { key: 'normal', label: '正常扩张', className: 'risk-normal' };
    if (score <= 49) return { key: 'watch', label: '扩张偏热', className: 'risk-watch' };
    if (score <= 69) return { key: 'elevated', label: '增长减速', className: 'risk-elevated' };
    if (score <= 84) return { key: 'high', label: '高风险', className: 'risk-high' };
    return { key: 'bear', label: '熊市确认', className: 'risk-bear' };
  }

  function setRiskBadge(element, meta, text) {
    if (!element) return;
    element.className = `risk-badge ${meta.className}`;
    element.textContent = text || meta.label;
  }

  function renderRiskBadge(level, text) {
    const meta = getRiskMeta(level);
    return `<span class="risk-badge ${escapeHTML(meta.className)}">${escapeHTML(text || meta.label)}</span>`;
  }

  function trendClass(value) {
    const text = String(value || '');
    if (/增长|改善|复苏|上升|扩张/.test(text) && !/放缓|波动/.test(text)) return 'trend-up';
    if (/下滑|下降|承压|恶化|减速|放缓/.test(text)) return 'trend-down';
    return 'trend-flat';
  }

  function safeExternalUrl(value) {
    if (!value) return '';
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (error) {
      console.warn('忽略无效的外部来源链接：', value, error);
      return '';
    }
  }

  function renderOverview(data) {
    const scoreApi = scoring();
    const calculation = scoreApi.calculateWeightedScore(data.components);
    const score = calculation.score;
    const meta = getScoreMeta(score);

    if (typeof scoreApi.compareManualScore === 'function') {
      scoreApi.compareManualScore(data.manualScore, score);
    }

    byId('overall-risk-score').textContent = String(score);
    setRiskBadge(byId('overall-risk-badge'), meta);
    byId('overall-risk-caption').textContent = `五项加权计算 · 有效权重 ${formatNumber(calculation.weight * 100, 0, '%')}`;

    const overallBar = byId('overall-risk-bar');
    overallBar.style.width = `${Math.min(100, Math.max(0, score))}%`;
    overallBar.className = `bar-${meta.key}`;

    byId('cycle-stage').textContent = data.stage || '待判断';
    byId('cycle-stage-caption').textContent = `${meta.label} · 研究框架演示状态`;
    byId('judgement-title').textContent = `AI 基础设施：${data.stage || meta.label}`;
    byId('cycle-summary-text').textContent = data.summary || '暂无综合判断。';

    const headerStatus = byId('header-cycle-status');
    setRiskBadge(headerStatus, meta, `${data.stage || '待判断'} · ${meta.label}`);

    const credit = data.components.find((item) => item.id === 'neocloudCreditRisk');
    if (credit) {
      const creditMeta = getScoreMeta(credit.score);
      byId('credit-pressure').textContent = `${credit.score} / 100`;
      byId('credit-pressure-caption').textContent = `${creditMeta.label} · Neocloud 融资与杠杆压力`;
    }

    const container = byId('risk-components');
    container.innerHTML = data.components.map((component) => {
      const componentMeta = getScoreMeta(component.score);
      const contribution = Number(component.score) * Number(component.weight);
      const barClass = `bar-${componentMeta.key}`;
      return `
        <article class="risk-component">
          <div class="component-name">
            <strong>${escapeHTML(component.name)}</strong>
            <span>权重 ${formatNumber(Number(component.weight) * 100, 0, '%')} · 贡献 ${formatNumber(contribution, 1, ' 分')}</span>
          </div>
          <div class="component-visual">
            <div class="component-track" aria-label="${escapeHTML(component.name)}风险分数 ${escapeHTML(component.score)} 分">
              <span class="${barClass}" style="width: ${Math.min(100, Math.max(0, Number(component.score)))}%"></span>
            </div>
            <span class="component-description">${escapeHTML(component.description)}</span>
          </div>
          <div class="component-score">${escapeHTML(component.score)}<small>/100</small></div>
          ${renderRiskBadge(componentMeta.key, componentMeta.label)}
        </article>
      `;
    }).join('');
  }

  function renderHyperscalers(data) {
    const capexGrowth = Array.isArray(data.totalCapexGrowth) ? data.totalCapexGrowth : [];
    const revenueGrowth = Array.isArray(data.cloudRevenueGrowth) ? data.cloudRevenueGrowth : [];
    const latest = toFiniteNumber(capexGrowth.at(-1));
    const previous = toFiniteNumber(capexGrowth.at(-2));
    const delta = latest !== null && previous !== null ? latest - previous : null;

    if (latest !== null) {
      byId('capex-momentum').textContent = `${latest >= 0 ? '+' : ''}${formatNumber(latest, 1, '% YoY')}`;
      if (delta !== null) {
        const direction = delta < 0 ? '回落' : delta > 0 ? '上升' : '持平';
        byId('capex-momentum-caption').textContent = `较上季 ${direction} ${formatNumber(Math.abs(delta), 1, ' 个百分点')} · 演示数据`;
      } else {
        byId('capex-momentum-caption').textContent = '上季对比数据缺失 · 演示数据';
      }
    }

    const chartApi = charts();
    let capexChartReady = false;
    if (chartApi) {
      capexChartReady = Boolean(chartApi.initCapexChart(data));
      chartApi.initGrowthChart(data);
    }
    renderCapexSeriesControls(data.companies, capexChartReady);

    const scoreApi = scoring();
    const diagnostic = scoreApi.diagnoseGrowthGap(capexGrowth, revenueGrowth);
    const allowedDiagnosticClasses = ['diagnostic-low', 'diagnostic-medium', 'diagnostic-high', 'diagnostic-critical', 'diagnostic-unknown'];
    const diagnosticClass = allowedDiagnosticClasses.includes(diagnostic.className)
      ? diagnostic.className
      : 'diagnostic-unknown';
    const allowedDiagnosticIcons = ['✓', '!', '△', '—'];
    const diagnosticIcon = allowedDiagnosticIcons.includes(diagnostic.icon) ? diagnostic.icon : '—';
    const diagnosticElement = byId('growth-diagnostic');
    diagnosticElement.className = `diagnostic ${diagnosticClass}`;
    diagnosticElement.innerHTML = `
      <span class="diagnostic-icon" aria-hidden="true">${diagnosticIcon}</span>
      <div>
        <strong>${escapeHTML(diagnostic.title || '投入与收入增速诊断')}</strong>
        <p>${escapeHTML(diagnostic.message || diagnostic.description || '暂无可用诊断。')}</p>
      </div>
    `;
  }

  function renderCapexSeriesControls(companies, chartReady) {
    const container = byId('capex-series-controls');
    container.replaceChildren();

    const label = document.createElement('span');
    label.className = 'series-controls-label';
    label.textContent = chartReady ? '键盘图例' : '图表不可用';
    container.append(label);

    (Array.isArray(companies) ? companies : []).forEach((company, index) => {
      const name = String(company && company.name ? company.name : `公司 ${index + 1}`);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'series-toggle';
      button.dataset.series = name;
      button.setAttribute('aria-controls', 'capex-chart');
      button.setAttribute('aria-pressed', 'true');
      button.style.setProperty('--series-color', chartSeriesColors[index % chartSeriesColors.length]);
      button.textContent = name;
      button.disabled = !chartReady;
      button.addEventListener('click', () => {
        const nextVisible = button.getAttribute('aria-pressed') !== 'true';
        const chartApi = charts();
        if (chartApi && chartApi.setCapexSeriesVisible(name, nextVisible)) {
          button.setAttribute('aria-pressed', String(nextVisible));
        }
      });
      container.append(button);
    });
  }

  function normalizedTurnoverObservations(market) {
    return (Array.isArray(market && market.observations) ? market.observations : [])
      .map((item) => ({
        date: String(item && item.date || ''),
        turnover: toFiniteNumber(item && item.turnover)
      }))
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && item.turnover !== null && item.turnover > 0)
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  function turnoverAmountLabel(value, currency) {
    const amount = toFiniteNumber(value);
    if (amount === null) return '—';
    const scaled = amount / 1e8;
    const decimals = scaled >= 1000 ? 0 : scaled >= 100 ? 1 : 2;
    const unit = currency === 'CNY' ? '亿元' : currency === 'HKD' ? '亿港元' : '亿美元';
    return `${new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(scaled)} ${unit}`;
  }

  function turnoverFxRate(data, currency) {
    if (currency === 'USD') return 1;
    const rate = toFiniteNumber(data && data.fx && data.fx.rates && data.fx.rates[currency] && data.fx.rates[currency].rate);
    return rate !== null && rate > 0 ? rate : null;
  }

  function turnoverUsdAmount(value, currency, data) {
    const amount = toFiniteNumber(value);
    const rate = turnoverFxRate(data, currency);
    return amount !== null && rate !== null ? amount / rate : null;
  }

  function rollingQuarterStartDate(latestDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(latestDate || ''))) return '';
    const value = new Date(`${latestDate}T00:00:00.000Z`);
    const day = value.getUTCDate();
    value.setUTCDate(1);
    value.setUTCMonth(value.getUTCMonth() - 3);
    const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
    value.setUTCDate(Math.min(day, lastDay));
    return value.toISOString().slice(0, 10);
  }

  function rollingQuarterObservations(observations) {
    const latestDate = observations.at(-1)?.date;
    const startDate = rollingQuarterStartDate(latestDate);
    return startDate ? observations.filter((item) => item.date >= startDate) : observations;
  }

  function turnoverTableAmountMarkup(item, market, data) {
    if (!item) return '—';
    const usdLabel = turnoverAmountLabel(turnoverUsdAmount(item.turnover, market.currency, data), 'USD');
    const original = market.currency === 'USD' ? '' : turnoverAmountLabel(item.turnover, market.currency);
    return `<span class="turnover-table-primary">${escapeHTML(usdLabel)}</span>${original ? `<small class="turnover-table-original">${escapeHTML(original)}</small>` : ''}`;
  }

  function signedTurnoverPercent(value) {
    const percent = toFiniteNumber(value);
    if (percent === null) return '—';
    return `${percent > 0 ? '+' : ''}${formatNumber(percent, 1, '%')}`;
  }

  function turnoverChangeClass(value) {
    const percent = toFiniteNumber(value);
    if (percent === null || Math.abs(percent) < 0.05) return 'is-flat';
    return percent > 0 ? 'is-up' : 'is-down';
  }

  function turnoverSourceMarkup(market) {
    const primary = safeExternalUrl(market && market.sourceUrl);
    const secondary = safeExternalUrl(market && market.secondarySourceUrl);
    const links = [];
    if (primary) links.push(`<a href="${escapeHTML(primary)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHTML(market.sourceLabel || '数据来源')} ↗</a>`);
    if (secondary) links.push(`<a href="${escapeHTML(secondary)}" target="_blank" rel="noopener noreferrer nofollow">深交所 ↗</a>`);
    return links.join('<span aria-hidden="true"> · </span>');
  }

  function renderMarketTurnover(data) {
    const markets = Array.isArray(data && data.markets) ? data.markets : [];
    const grid = byId('turnover-market-grid');
    const marketAppearance = {
      cn: { emblem: '沪深', pulse: 'MARKET PULSE · 01' },
      hk: { emblem: 'HK', pulse: 'MARKET PULSE · 02' },
      nasdaq: { emblem: 'NQ', pulse: 'MARKET PULSE · 03' }
    };
    grid.innerHTML = markets.map((market, index) => {
      const observations = normalizedTurnoverObservations(market);
      const latest = observations.at(-1);
      const previous = observations.at(-2);
      const averageWindow = rollingQuarterObservations(observations);
      const average = averageWindow.length
        ? averageWindow.reduce((sum, item) => sum + item.turnover, 0) / averageWindow.length
        : null;
      const latestUsd = turnoverUsdAmount(latest && latest.turnover, market.currency, data);
      const averageUsd = turnoverUsdAmount(average, market.currency, data);
      const dayChange = latest && previous ? ((latest.turnover / previous.turnover) - 1) * 100 : null;
      const versusAverage = latest && average ? ((latest.turnover / average) - 1) * 100 : null;
      const originalLabel = market.currency === 'USD' || !latest ? '' : turnoverAmountLabel(latest.turnover, market.currency);
      const appearance = marketAppearance[market.id] || { emblem: String(index + 1).padStart(2, '0'), pulse: `MARKET PULSE · ${String(index + 1).padStart(2, '0')}` };
      return `
        <article class="turnover-market-card" data-market="${escapeHTML(market.id)}">
          <div class="turnover-card-topline">
            <div class="turnover-market-identity">
              <span class="turnover-market-emblem" aria-hidden="true">${escapeHTML(appearance.emblem)}</span>
              <div>
                <span class="turnover-pulse-label">${escapeHTML(appearance.pulse)}</span>
                <strong>${escapeHTML(market.name)}</strong>
              </div>
            </div>
            <time datetime="${escapeHTML(latest && latest.date)}">${escapeHTML(latest ? formatDate(latest.date) : '待更新')}</time>
          </div>
          <div class="turnover-latest-row">
            <div class="turnover-value-stack">
              <span class="turnover-value">${escapeHTML(turnoverAmountLabel(latestUsd, 'USD'))}</span>
              ${originalLabel ? `<span class="turnover-original-value">原币 ${escapeHTML(originalLabel)}</span>` : '<span class="turnover-original-value">原币同为美元</span>'}
            </div>
            <span class="turnover-change ${turnoverChangeClass(dayChange)}" title="较上一有效交易日">${escapeHTML(signedTurnoverPercent(dayChange))}</span>
          </div>
          <dl class="turnover-stats">
            <div><dt>季度日均（美元）</dt><dd>${escapeHTML(turnoverAmountLabel(averageUsd, 'USD'))}</dd></div>
            <div><dt>相对季度均值</dt><dd>${escapeHTML(signedTurnoverPercent(versusAverage))}</dd></div>
          </dl>
          <p class="turnover-card-definition">${escapeHTML(market.definition)}</p>
          <span class="turnover-card-source">${turnoverSourceMarkup(market)}</span>
        </article>
      `;
    }).join('') || '<div class="loading-block">暂无可用的日终成交额记录。</div>';

    const marketModels = markets.map((market) => ({
      ...market,
      observations: normalizedTurnoverObservations(market)
    }));
    const dates = Array.from(new Set(marketModels.flatMap((market) => market.observations.map((item) => item.date))))
      .sort()
      .slice(-12)
      .reverse();
    const byMarketAndDate = new Map(marketModels.flatMap((market) => market.observations.map((item) => [`${market.id}:${item.date}`, item])));
    const body = byId('turnover-history-body');
    body.innerHTML = dates.map((date) => `
      <tr>
        <td><time datetime="${escapeHTML(date)}">${escapeHTML(formatDate(date))}</time></td>
        ${marketModels.map((market) => {
          const item = byMarketAndDate.get(`${market.id}:${date}`);
          return `<td>${turnoverTableAmountMarkup(item, market, data)}</td>`;
        }).join('')}
      </tr>
    `).join('') || '<tr><td colspan="4" class="table-empty">暂无成交额历史记录。</td></tr>';

    const fetchedAt = byId('turnover-fetched-at');
    fetchedAt.dateTime = data.fetchedAt || data.updatedAt || '';
    fetchedAt.textContent = data.fetchedAt ? `抓取于 ${formatDate(data.fetchedAt)}` : `更新于 ${formatDate(data.updatedAt)}`;
    const methodology = data.methodology || {};
    const fxRates = data.fx && data.fx.rates || {};
    const fxSummary = ['CNY', 'HKD'].map((currency) => {
      const snapshot = fxRates[currency];
      return snapshot && toFiniteNumber(snapshot.rate) !== null ? `${snapshot.pair} ${formatNumber(snapshot.rate, 4)}` : '';
    }).filter(Boolean).join('，');
    byId('turnover-method-copy').textContent = [methodology.comparison, fxSummary ? `当前折算汇率：${fxSummary}。` : '', methodology.caveat, methodology.retention]
      .filter(Boolean)
      .join(' ');

    const chartApi = charts();
    if (chartApi && typeof chartApi.initTurnoverChart === 'function') {
      chartApi.initTurnoverChart(data);
    }
  }

  function populateSelect(select, values, defaultLabel) {
    const current = select.value;
    select.replaceChildren();
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = defaultLabel;
    select.append(allOption);
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
    select.value = Array.from(select.options).some((option) => option.value === current) ? current : 'all';
  }

  function textValue(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function safeTradingViewSymbol(value) {
    const symbol = textValue(value, '');
    return tradingViewSymbolPattern.test(symbol) ? symbol : '';
  }

  function safeCurrency(value, fallback) {
    const currency = textValue(value, '').toUpperCase();
    if (/^[A-Z]{3}$/.test(currency)) return currency;
    const fallbackCurrency = textValue(fallback, 'USD').toUpperCase();
    return /^[A-Z]{3}$/.test(fallbackCurrency) ? fallbackCurrency : 'USD';
  }

  function formatCurrencyAmount(value, currency) {
    const amount = toFiniteNumber(value);
    if (amount === null) return '—';
    const decimals = Number.isInteger(amount) ? 0 : 2;
    try {
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
        minimumFractionDigits: decimals,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (error) {
      return `${currency} ${formatNumber(amount, decimals)}`;
    }
  }

  function formatValuationPrice(value, currency) {
    const amount = toFiniteNumber(value);
    if (amount === null) return '—';
    try {
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (error) {
      return `${currency} ${formatNumber(amount, 2)}`;
    }
  }

  function valuationConfidence(value) {
    const key = textValue(value, 'unknown').toLowerCase();
    return confidenceLabels[key] || confidenceLabels.unknown;
  }

  function formatBuyZonePrice(value, currency, minimumFractionDigits = 0) {
    const amount = toFiniteNumber(value);
    if (amount === null) return '—';
    try {
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: safeCurrency(currency, 'USD'),
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits,
        maximumFractionDigits: 2
      }).format(amount);
    } catch (error) {
      return `${currency} ${formatNumber(amount, minimumFractionDigits)}`;
    }
  }

  function formatBuyZoneRange(zone, currency) {
    const low = toFiniteNumber(zone && zone.low);
    const high = toFiniteNumber(zone && zone.high);
    if (low === null || high === null) return '—';
    return `${formatBuyZonePrice(low, currency)}–${formatBuyZonePrice(high, currency)}`;
  }

  function marketQuoteForTicker(ticker) {
    const quotes = state.data.marketQuotes && Array.isArray(state.data.marketQuotes.quotes)
      ? state.data.marketQuotes.quotes
      : [];
    const quote = quotes.find((item) => item && item.ticker === ticker);
    const price = toFiniteNumber(quote && quote.price);
    const quoteTime = quote && typeof quote.quoteTime === 'string' ? quote.quoteTime : '';
    if (!quote || price === null || price <= 0 || Number.isNaN(Date.parse(quoteTime))) return null;
    return { ...quote, price };
  }

  function formatMarketQuoteTime(value, market) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '时间待确认';
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: market === 'cn' ? 'Asia/Shanghai' : 'America/New_York',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(parsed).replaceAll('/', '-');
    } catch (error) {
      return parsed.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function quoteChangeMeta(quote) {
    const percent = toFiniteNumber(quote && quote.changePercent);
    if (percent === null) return { text: '涨跌待确认', className: 'is-flat' };
    const prefix = percent > 0 ? '+' : '';
    return {
      text: `${prefix}${formatNumber(percent, 2, '%')}`,
      className: percent > 0 ? 'is-up' : percent < 0 ? 'is-down' : 'is-flat'
    };
  }

  function formatCompactMarketCap(value, currency) {
    const amount = toFiniteNumber(value);
    if (amount === null || amount <= 0) return '—';
    const scaled = amount / 1e8;
    const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    const symbol = currency === 'CNY' ? '¥' : '$';
    return `${currency} ${symbol}${formatNumber(scaled, decimals)}亿`;
  }

  function marketCapCurrencyValues(quote) {
    const marketCap = toFiniteNumber(quote && quote.marketCap);
    const marketCapCurrency = textValue(quote && quote.marketCapCurrency, '').toUpperCase();
    const usdCnyRate = toFiniteNumber(state.data.marketQuotes && state.data.marketQuotes.fx && state.data.marketQuotes.fx.rate);
    if (marketCap === null || marketCap <= 0 || usdCnyRate === null || usdCnyRate <= 0) return null;
    if (marketCapCurrency === 'USD') {
      return { usd: marketCap, cny: marketCap * usdCnyRate, usdCnyRate };
    }
    if (marketCapCurrency === 'CNY') {
      return { usd: marketCap / usdCnyRate, cny: marketCap, usdCnyRate };
    }
    return null;
  }

  function buyZoneMarketCapMarkup(quote) {
    const values = marketCapCurrencyValues(quote);
    if (!values) return '<span class="buy-zone-market-cap is-missing">总市值待更新</span>';
    const usd = formatCompactMarketCap(values.usd, 'USD');
    const cny = formatCompactMarketCap(values.cny, 'CNY');
    const sourceUrl = safeExternalUrl(quote && quote.marketCapSourceUrl);
    const label = `公司总市值：${usd}，${cny}；USD/CNY ${formatNumber(values.usdCnyRate, 4)}`;
    const content = `
      <span class="buy-zone-market-cap-label">总市值</span>
      <strong class="is-usd">${escapeHTML(usd)}</strong>
      <strong class="is-cny">${escapeHTML(cny)}</strong>
    `;
    return sourceUrl
      ? `<a class="buy-zone-market-cap" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow" aria-label="${escapeHTML(label)}；打开市值来源" title="${escapeHTML(label)}">${content}</a>`
      : `<span class="buy-zone-market-cap" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">${content}</span>`;
  }

  function getBuyZoneStatus(company) {
    if (company && company.researchStatus === 'pending') {
      return { label: '待建立估值区间', className: 'is-pending' };
    }
    const referencePrice = toFiniteNumber(company && company.referencePrice);
    const safety = company && company.safety ? company.safety : {};
    const reasonable = company && company.reasonable ? company.reasonable : {};
    const aggressive = company && company.aggressive ? company.aggressive : {};
    if (referencePrice === null) return { label: '等待参考价', className: 'is-unknown' };
    if (referencePrice >= Number(safety.low) && referencePrice <= Number(safety.high)) {
      return { label: '进入安全区间', className: 'is-safety' };
    }
    if (referencePrice >= Number(reasonable.low) && referencePrice <= Number(reasonable.high)) {
      return { label: '进入合理区间', className: 'is-reasonable' };
    }
    if (referencePrice >= Number(aggressive.low) && referencePrice <= Number(aggressive.high)) {
      return { label: '进入激进区间', className: 'is-aggressive' };
    }
    if (referencePrice > Number(aggressive.high)) {
      return {
        label: '高于激进区间',
        className: 'is-wait'
      };
    }
    if (referencePrice < Number(safety.low)) {
      return { label: '低于安全区间 · 先复核', className: 'is-review' };
    }
    return { label: '处于区间空档', className: 'is-between' };
  }

  function buyZoneDailyMarker(company, price) {
    const currentPrice = toFiniteNumber(price);
    if (currentPrice === null || currentPrice <= 0) return null;
    const tiers = [
      {
        key: 'safety',
        label: '高安全边际价内',
        shortLabel: '高安全边际',
        image: './assets/buy-zone-safety.png',
        range: company && company.safety
      },
      {
        key: 'reasonable',
        label: '合理主买价内',
        shortLabel: '合理主买',
        image: './assets/buy-zone-reasonable.png',
        range: company && company.reasonable
      },
      {
        key: 'aggressive',
        label: '激进试仓价内',
        shortLabel: '激进试仓',
        image: './assets/buy-zone-aggressive.png',
        range: company && company.aggressive
      }
    ];
    const matchedTier = tiers.find((tier) => {
      const upperBound = toFiniteNumber(tier.range && tier.range.high);
      return upperBound !== null && upperBound > 0 && currentPrice <= upperBound;
    });
    if (matchedTier) return matchedTier;
    const aggressiveRange = company && company.aggressive;
    const aggressiveUpper = toFiniteNumber(aggressiveRange && aggressiveRange.high);
    if (aggressiveUpper !== null && aggressiveUpper > 0 && currentPrice > aggressiveUpper) {
      return {
        key: 'wait',
        label: '高于激进区间 · 等待',
        shortLabel: '激进试仓',
        image: './assets/buy-zone-wait.png',
        range: aggressiveRange
      };
    }
    return null;
  }

  function buyZoneDailyMarkerMarkup(company, price) {
    const marker = buyZoneDailyMarker(company, price);
    if (!marker) return '';
    const upperBound = toFiniteNumber(marker.range && marker.range.high);
    const currency = safeCurrency(company && company.currency, 'USD');
    const detail = marker.key === 'wait'
      ? `当前价高于${marker.shortLabel}上限 ${formatBuyZonePrice(upperBound, currency, 2)} · 不追价`
      : `当前价不高于${marker.shortLabel}上限 ${formatBuyZonePrice(upperBound, currency, 2)}`;
    const accessibleLabel = `参考价格位置图案：${marker.label}；${detail}；仅作研究区间提示`;
    return `
      <span class="buy-zone-daily-marker is-${escapeHTML(marker.key)}" aria-label="${escapeHTML(accessibleLabel)}">
        <img src="${escapeHTML(marker.image)}" alt="" width="56" height="56" loading="lazy" decoding="async" aria-hidden="true">
        <span class="buy-zone-daily-marker-copy">
          <em>价格位置图案</em>
          <strong>${escapeHTML(marker.label)}</strong>
          <small>${escapeHTML(detail)}</small>
        </span>
      </span>
    `;
  }

  function buyZoneDistanceMetrics(company, price) {
    const referencePrice = toFiniteNumber(price);
    return [
      { key: 'safety', label: '安全区间', range: company && company.safety },
      { key: 'reasonable', label: '合理区间', range: company && company.reasonable },
      { key: 'aggressive', label: '激进区间', range: company && company.aggressive }
    ].map((metric) => {
      const lowerBound = toFiniteNumber(metric.range && metric.range.low);
      const upperBound = toFiniteNumber(metric.range && metric.range.high);
      const distanceToUpper = referencePrice !== null && upperBound !== null && upperBound > 0
        ? (referencePrice / upperBound - 1) * 100
        : null;
      const distanceToLower = referencePrice !== null && lowerBound !== null && lowerBound > 0
        ? (referencePrice / lowerBound - 1) * 100
        : null;
      return { ...metric, distanceToUpper, distanceToLower };
    });
  }

  function formatSignedBuyZonePercent(value) {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) < 0.05) return '0.0%';
    return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value), 1, '%')}`;
  }

  function formatBuyZoneDistanceRange(metric) {
    const distanceToUpper = metric && metric.distanceToUpper;
    const distanceToLower = metric && metric.distanceToLower;
    if (!Number.isFinite(distanceToUpper) || !Number.isFinite(distanceToLower)) return '待确认';
    if (distanceToUpper > 0) {
      return `高于 ${formatNumber(distanceToUpper, 1, '%')}～${formatNumber(distanceToLower, 1, '%')}`;
    }
    if (distanceToLower < 0) {
      return `低于 ${formatNumber(Math.abs(distanceToLower), 1, '%')}～${formatNumber(Math.abs(distanceToUpper), 1, '%')}`;
    }
    return `区间内 ${formatSignedBuyZonePercent(distanceToUpper)}～${formatSignedBuyZonePercent(distanceToLower)}`;
  }

  function buyZoneDistanceClass(metric) {
    const distanceToUpper = metric && metric.distanceToUpper;
    const distanceToLower = metric && metric.distanceToLower;
    if (!Number.isFinite(distanceToUpper) || !Number.isFinite(distanceToLower)) return 'is-at';
    if (distanceToUpper > 0) return 'is-above';
    if (distanceToLower < 0) return 'is-below';
    return 'is-within';
  }

  function buyZoneSortScore(company, price) {
    const aggressiveMetric = buyZoneDistanceMetrics(company, price)
      .find((metric) => metric.key === 'aggressive');
    return aggressiveMetric && Number.isFinite(aggressiveMetric.distanceToUpper)
      ? aggressiveMetric.distanceToUpper
      : null;
  }

  function marketGroup(value, currency) {
    const market = textValue(value, '').toLowerCase();
    const currencyCode = safeCurrency(currency, 'USD');
    if (market === 'hk' || market.includes('港股') || currencyCode === 'HKD') return 'hk';
    if (market === 'cn' || market.includes('a 股') || market.includes('沪') || market.includes('深') || currencyCode === 'CNY') {
      return 'cn';
    }
    return 'us';
  }

  function marketGroupLabel(value) {
    return { cn: '沪深', hk: '港股', us: '美股' }[value] || '待分类';
  }

  function normalizedExchange(value) {
    const exchange = textValue(value, '').toUpperCase();
    if (exchange === 'SSE') return 'SH';
    if (exchange === 'SZSE') return 'SZ';
    if (exchange === 'HKEX') return 'HK';
    return exchange || '—';
  }

  function watchlistRowKey(row) {
    const market = textValue(row.market, '');
    const ticker = textValue(row.ticker, '');
    return market === 'us' ? `${market}:${ticker}` : `${market}:${normalizedExchange(row.exchange)}:${ticker}`;
  }

  function stockWatchlistUniverse() {
    const snapshot = state.data.stockWatchlist;
    const hkSnapshot = state.data.hkWatchlist;
    const usSnapshot = state.data.usWatchlist;
    const rows = [];
    const seen = new Set();
    const addRow = (row) => {
      if (!row || !textValue(row.ticker, '') || !textValue(row.name, '')) return;
      const key = watchlistRowKey(row);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ ...row, order: rows.length });
    };

    (snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : []).forEach((entry) => {
      const exchange = normalizedExchange(entry.exchange);
      addRow({
        ticker: textValue(entry.ticker, ''),
        name: textValue(entry.name, ''),
        exchange,
        market: 'cn',
        typeLabel: { stock: '股票', etf: 'ETF', index: '指数' }[entry.type] || '证券',
        category: '',
        currency: safeCurrency(entry.currency, 'CNY'),
        sourceUrl: `https://www.tradingview.com/symbols/${exchange === 'SH' ? 'SSE' : 'SZSE'}-${encodeURIComponent(entry.ticker)}/`
      });
    });

    (hkSnapshot && Array.isArray(hkSnapshot.entries) ? hkSnapshot.entries : []).forEach((entry) => {
      const ticker = textValue(entry.ticker, '');
      const sourceTicker = /^\d{5}$/.test(ticker) ? String(Number(ticker)) : '';
      addRow({
        ticker,
        name: textValue(entry.name, ''),
        exchange: textValue(entry.exchange, 'HKEX'),
        market: 'hk',
        typeLabel: textValue(entry.securityType, '证券'),
        category: textValue(entry.category, ''),
        currency: safeCurrency(entry.currency, 'HKD'),
        sourceUrl: sourceTicker ? `https://www.tradingview.com/symbols/HKEX-${sourceTicker}/` : ''
      });
    });

    (usSnapshot && Array.isArray(usSnapshot.entries) ? usSnapshot.entries : []).forEach((entry) => {
      const ticker = textValue(entry.ticker, '');
      const exchange = normalizedExchange(entry.exchange);
      const tradingViewExchange = ['NASDAQ', 'NYSE', 'NYSEARCA', 'AMEX', 'OTC'].includes(exchange)
        ? exchange
        : '';
      addRow({
        ticker,
        name: textValue(entry.name, ''),
        exchange,
        market: 'us',
        typeLabel: textValue(entry.securityType, '证券'),
        category: textValue(entry.category, ''),
        currency: safeCurrency(entry.currency, 'USD'),
        sourceUrl: tradingViewExchange
          ? `https://www.tradingview.com/symbols/${tradingViewExchange}-${encodeURIComponent(ticker.replace(/^\./, ''))}/`
          : ''
      });
    });

    return rows;
  }

  function buyZoneUniverse(data) {
    const snapshot = data && data.manualBuyZones && typeof data.manualBuyZones === 'object'
      ? data.manualBuyZones
      : {};
    const researchedEntries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const researchedByKey = new Map(researchedEntries.map((entry) => [
      `${marketGroup(entry.market, entry.currency)}:${textValue(entry.ticker, '')}`,
      entry
    ]));
    const coverageSnapshot = state.data.valuationCoverage;
    const coverageEntries = coverageSnapshot && Array.isArray(coverageSnapshot.entries)
      ? coverageSnapshot.entries
      : [];
    const coverageByKey = new Map(coverageEntries.map((entry) => [
      `${textValue(entry.market, '')}:${normalizedExchange(entry.exchange)}:${textValue(entry.ticker, '')}`,
      entry
    ]));

    return stockWatchlistUniverse().map((row) => {
      const researched = researchedByKey.get(`${row.market}:${row.ticker}`);
      if (researched) {
        return {
          ...row,
          ...researched,
          directoryMarket: row.market,
          researchStatus: 'researched',
          sourceUrl: row.sourceUrl
        };
      }
      const quantitative = coverageByKey.get(
        `${row.market}:${normalizedExchange(row.exchange)}:${row.ticker}`
      );
      if (quantitative) {
        return {
          ...row,
          ...quantitative,
          directoryMarket: row.market,
          researchStatus: 'quantitative',
          sourceUrl: quantitative.sourceUrl || row.sourceUrl
        };
      }
      return {
        ...row,
        segment: row.category || row.typeLabel,
        researchStatus: 'pending',
        referencePrice: null,
        safety: null,
        reasonable: null,
        aggressive: null,
        view: '已纳入估值观察，等待完成基本面与估值研究。'
      };
    });
  }

  function updateMarketTabs(selector, dataAttribute, activeMarket, counts) {
    document.querySelectorAll(selector).forEach((button) => {
      const market = button.dataset[dataAttribute];
      const isActive = market === activeMarket;
      button.setAttribute('aria-selected', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
      const count = button.querySelector('span');
      if (count) count.textContent = String(counts[market] || 0);
    });
  }

  function renderStockWatchlistTable() {
    const body = byId('stock-watchlist-body');
    if (!body) return;
    const universe = stockWatchlistUniverse();
    const counts = { cn: 0, hk: 0, us: 0 };
    universe.forEach((row) => {
      if (Object.prototype.hasOwnProperty.call(counts, row.market)) counts[row.market] += 1;
    });
    updateMarketTabs('[data-stock-market]', 'stockMarket', state.stocks.market, counts);

    const query = state.stocks.query.trim().toLocaleLowerCase('zh-CN');
    const marketRows = universe.filter((row) => row.market === state.stocks.market);
    const rows = marketRows.filter((row) => {
      if (!query) return true;
      return [row.name, row.ticker, row.exchange, row.typeLabel, row.category]
        .some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(query));
    });
    const marketLabel = marketGroupLabel(state.stocks.market);
    const summary = byId('stock-watchlist-summary');
    if (summary) {
      summary.textContent = `${marketLabel}显示 ${rows.length} / ${marketRows.length} 个标的 · 全部市场共 ${universe.length} 个 · 已按代码录入基础资料`;
    }

    if (!rows.length) {
      const message = marketRows.length
        ? '当前搜索没有匹配标的，请换一个名称或代码。'
        : `${marketLabel}暂未录入标的。`;
      body.innerHTML = `<tr><td colspan="7" class="table-empty">${escapeHTML(message)}</td></tr>`;
      return;
    }

    body.innerHTML = rows.map((row) => {
      const sourceUrl = safeExternalUrl(row.sourceUrl);
      return `
        <tr>
          <th scope="row">
            <span class="stock-watchlist-company">
              <strong>${escapeHTML(row.name)}</strong>
              <span class="stock-watchlist-company-meta">
                <span>${escapeHTML(row.ticker)}</span>
              </span>
            </span>
          </th>
          <td><span class="stock-directory-value">${escapeHTML(marketGroupLabel(row.market))}</span></td>
          <td><span class="stock-directory-value">${escapeHTML(row.exchange)}</span></td>
          <td><span class="stock-instrument-tag">${escapeHTML(row.typeLabel)}</span></td>
          <td><span class="stock-directory-value">${escapeHTML(row.category || '—')}</span></td>
          <td><span class="stock-directory-value">${escapeHTML(row.currency)}</span></td>
          <td>${sourceUrl
            ? `<a class="stock-directory-link" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">查看资料 ↗</a>`
            : '<span class="stock-directory-value">—</span>'}</td>
        </tr>
      `;
    }).join('');
  }

  function renderStockWatchlist(data) {
    state.data.stockWatchlist = data;
    renderStockWatchlistTable();
  }

  function renderBuyZones(data) {
    const body = byId('buy-zones-body');
    const summary = byId('buy-zones-summary');
    const updatedAt = byId('buy-zones-updated-at');
    const disclosure = byId('buy-zones-disclosure');
    const snapshot = data && data.manualBuyZones && typeof data.manualBuyZones === 'object'
      ? data.manualBuyZones
      : {};
    const allCompanies = buyZoneUniverse(data);
    if (!body || !allCompanies.length) {
      throw new Error('买入区间速览缺少有效公司数据。');
    }
    const counts = { cn: 0, hk: 0, us: 0 };
    allCompanies.forEach((company) => {
      const group = marketGroup(company.market, company.currency);
      counts[group] += 1;
    });
    updateMarketTabs('[data-buy-zone-market]', 'buyZoneMarket', state.buyZones.market, counts);
    const marketCompanies = allCompanies.filter(
      (company) => marketGroup(company.market, company.currency) === state.buyZones.market
    );
    const query = state.buyZones.query.trim().toLocaleLowerCase('zh-CN');
    const companies = marketCompanies.filter((company) => {
      if (!query) return true;
      return [company.name, company.ticker, company.exchange, company.segment, company.typeLabel]
        .some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(query));
    });

    const sortDirection = state.buyZones.sortDirection === 'asc' ? 'asc' : 'desc';
    const detailTickers = new Set(getValuationCompanies(data).map((company) => company.ticker));
    const sortedCompanies = companies.map((company, index) => {
      const quote = marketQuoteForTicker(company.ticker);
      const shownPrice = quote ? quote.price : company.referencePrice;
      return {
        company,
        index,
        score: buyZoneSortScore(company, shownPrice)
      };
    }).sort((left, right) => {
      if (left.score === null && right.score === null) return left.index - right.index;
      if (left.score === null) return 1;
      if (right.score === null) return -1;
      const difference = sortDirection === 'desc'
        ? right.score - left.score
        : left.score - right.score;
      return difference || left.index - right.index;
    }).map((item) => item.company);

    const sortHeading = byId('buy-zones-status-heading');
    const sortButton = byId('buy-zones-sort-button');
    const sortIndicator = byId('buy-zones-sort-indicator');
    const directionLabel = sortDirection === 'desc' ? '从高到低' : '从低到高';
    if (sortHeading) sortHeading.setAttribute('aria-sort', sortDirection === 'desc' ? 'descending' : 'ascending');
    if (sortButton) {
      sortButton.setAttribute(
        'aria-label',
        `参考价所处区间，当前按相对激进区间上限的距离${directionLabel}排序；点击切换排序方向`
      );
      sortButton.title = `按相对激进区间上限的距离${directionLabel}排列，点击切换`;
    }
    if (sortIndicator) sortIndicator.textContent = sortDirection === 'desc' ? '高→低' : '低→高';

    body.innerHTML = sortedCompanies.length ? sortedCompanies.map((company) => {
      const ticker = textValue(company.ticker, '—');
      const name = textValue(company.name, ticker);
      const market = textValue(company.market, '待分类');
      const segment = textValue(company.segment, '待分类');
      const currency = safeCurrency(company.currency, 'USD');
      const isPending = company.researchStatus === 'pending';
      const isQuantitative = company.researchStatus === 'quantitative';
      const quote = marketQuoteForTicker(ticker);
      const status = getBuyZoneStatus({ ...company, referencePrice: quote ? quote.price : company.referencePrice });
      const shownPrice = quote ? quote.price : company.referencePrice;
      const distanceMetrics = isPending ? [] : buyZoneDistanceMetrics(company, shownPrice);
      const distanceMarkup = distanceMetrics.map((metric) => `
        <span class="buy-zone-distance is-${escapeHTML(metric.key)}-tier ${escapeHTML(buyZoneDistanceClass(metric))}">
          <em>${escapeHTML(metric.label)}</em>
          <strong>${escapeHTML(formatBuyZoneDistanceRange(metric))}</strong>
        </span>
      `).join('');
      const referencePrice = `${!quote && company.referencePriceApproximate === true ? '约 ' : ''}${formatBuyZonePrice(shownPrice, currency, 2)}`;
      const change = quoteChangeMeta(quote);
      const quoteUrl = safeExternalUrl(quote && quote.sourceUrl);
      const directoryUrl = safeExternalUrl(company.sourceUrl);
      const priceUrl = quoteUrl || directoryUrl;
      const priceMarkup = isPending
        ? (directoryUrl
          ? `<a class="buy-zone-reference is-directory" href="${escapeHTML(directoryUrl)}" target="_blank" rel="noopener noreferrer nofollow">查看资料 ↗</a>`
          : '<span class="buy-zone-reference is-directory">—</span>')
        : priceUrl
          ? `<a class="buy-zone-reference" href="${escapeHTML(priceUrl)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHTML(referencePrice)} ↗</a>`
          : `<span class="buy-zone-reference">${escapeHTML(referencePrice)}</span>`;
      const quoteMeta = isPending
        ? '<span class="buy-zone-quote-meta"><span>已纳入 · 尚未建立估值参数</span></span>'
        : isQuantitative
          ? `<span class="buy-zone-quote-meta"><span>量化参考价 · ${escapeHTML(formatDate(company.referencePriceDate))} · ${escapeHTML(confidenceLabel(company.confidence))}置信度</span></span>`
          : quote
          ? `<span class="buy-zone-quote-meta"><span class="buy-zone-quote-change ${escapeHTML(change.className)}">${escapeHTML(change.text)}</span><span>自动快照 · ${escapeHTML(formatMarketQuoteTime(quote.quoteTime, quote.market))} ${quote.market === 'cn' ? '上海' : '美东'}</span></span><span class="buy-zone-analysis-price">研究价 ${escapeHTML(formatBuyZonePrice(company.referencePrice, currency, 2))}</span>`
          : '<span class="buy-zone-quote-meta"><span>研究参考价 · 等待自动行情</span></span>';
      const symbolMarkup = !detailTickers.has(ticker)
        ? `<span class="buy-zone-symbol is-static">${escapeHTML(ticker)}</span>`
        : `
          <button
            class="buy-zone-symbol"
            type="button"
            data-valuation-ticker="${escapeHTML(ticker)}"
            aria-label="查看 ${escapeHTML(name)}（${escapeHTML(ticker)}）的区间详情"
          >${escapeHTML(ticker)}</button>
        `;
      const rangeMarkup = (tier) => isPending
        ? '<span class="buy-zone-range is-pending">待评估</span>'
        : `<span class="buy-zone-range is-${tier}">${escapeHTML(formatBuyZoneRange(company[tier], currency))}</span>`;
      const marketCapMarkup = isPending
        ? '<span class="buy-zone-market-cap is-missing">估值资料待评估</span>'
        : isQuantitative
          ? `<span class="buy-zone-market-cap is-missing">${escapeHTML(confidenceLabel(company.confidence))}置信度 · ${company.observationCount ? `${escapeHTML(company.observationCount)} 个交易日` : '特殊参考价'}</span>`
        : buyZoneMarketCapMarkup(quote);
      return `
        <tr>
          <th scope="row">
            ${symbolMarkup}
            <strong>${escapeHTML(name)}</strong>
            <span class="buy-zone-company-meta">${escapeHTML(marketGroupLabel(marketGroup(market, currency)))} · ${escapeHTML(company.exchange || segment)} · ${escapeHTML(segment)}</span>
            ${marketCapMarkup}
          </th>
          <td>${priceMarkup}${quoteMeta}</td>
          <td>${rangeMarkup('safety')}</td>
          <td>${rangeMarkup('reasonable')}</td>
          <td>${rangeMarkup('aggressive')}</td>
          <td>
            ${isPending ? '' : buyZoneDailyMarkerMarkup(company, shownPrice)}
            <span class="buy-zone-status ${escapeHTML(status.className)}">${escapeHTML(status.label)}</span>
            ${isPending ? '' : `<span class="buy-zone-distance-grid" aria-label="参考价相对三档价格区间两端的百分比区间">${distanceMarkup}</span>`}
            <span class="buy-zone-note">${escapeHTML(textValue(company.view, '等待补充研究备注。'))}</span>
          </td>
        </tr>
      `;
    }).join('') : `<tr><td colspan="6" class="table-empty">${escapeHTML(
      query
        ? '当前搜索没有匹配标的，请换一个名称或代码。'
        : `${marketGroupLabel(state.buyZones.market)}暂未录入估值标的。`
    )}</td></tr>`;

    body.querySelectorAll('[data-valuation-ticker]').forEach((button) => {
      button.addEventListener('click', () => {
        const ticker = textValue(button.dataset.valuationTicker, '');
        const valuationData = state.data.valuation;
        if (!valuationData || !getValuationCompanies(valuationData).some((company) => company.ticker === ticker)) return;
        state.valuation.ticker = ticker;
        const select = byId('valuation-company-select');
        if (select) select.value = ticker;
        try {
          renderSelectedValuation({ forceChart: true });
          byId('valuation-watch-title')?.scrollIntoView({
            block: 'start',
            behavior: prefersReducedMotion() ? 'auto' : 'smooth'
          });
        } catch (error) {
          renderSectionError('valuation', DATA_SOURCES.valuation, error);
        }
      });
    });

    if (summary) {
      const researchedCount = marketCompanies.filter((company) => company.researchStatus === 'researched').length;
      const quantitativeCount = marketCompanies.filter((company) => company.researchStatus === 'quantitative').length;
      const pendingCount = marketCompanies.length - researchedCount - quantitativeCount;
      const quoteCount = marketCompanies.filter((company) => marketQuoteForTicker(company.ticker)).length;
      const marketSnapshot = state.data.marketQuotes;
      const quoteSummary = quoteCount
        ? ` · 有行情快照 ${quoteCount} 只 · 抓取 ${formatMarketQuoteTime(marketSnapshot.fetchedAt, state.buyZones.market)}`
        : '';
      const pendingSummary = pendingCount ? ` · 待补区间 ${pendingCount} 只` : '';
      summary.textContent = `${marketGroupLabel(state.buyZones.market)}显示 ${companies.length} / ${marketCompanies.length} 只 · 全部 ${allCompanies.length} 只 · 财报研究区间 ${researchedCount} 只 · 量化区间 ${quantitativeCount} 只${pendingSummary}${quoteSummary}`;
    }
    if (updatedAt) {
      const fetchedAt = state.data.marketQuotes && state.data.marketQuotes.fetchedAt;
      const coverageUpdatedAt = state.data.valuationCoverage && state.data.valuationCoverage.updatedAt;
      const rangesUpdatedAt = [snapshot.updatedAt, coverageUpdatedAt, data.updatedAt].filter(Boolean).sort().at(-1);
      updatedAt.dateTime = fetchedAt || rangesUpdatedAt;
      updatedAt.textContent = fetchedAt
        ? `行情抓取 ${formatMarketQuoteTime(fetchedAt, 'cn')} 上海 · 区间 ${formatDate(rangesUpdatedAt)}`
        : `区间更新 ${formatDate(rangesUpdatedAt)}`;
    }
    if (disclosure) {
      const quoteNotice = textValue(
        state.data.marketQuotes && state.data.marketQuotes.source && state.data.marketQuotes.source.dataNotice,
        '自动行情可能延迟或暂时不可用。'
      );
      const researchedTotal = allCompanies.filter((company) => company.researchStatus === 'researched').length;
      const quantitativeTotal = allCompanies.filter((company) => company.researchStatus === 'quantitative').length;
      const lowConfidenceTotal = allCompanies.filter(
        (company) => company.researchStatus === 'quantitative' && company.confidence === 'low'
      ).length;
      const coverageNotice = textValue(
        state.data.valuationCoverage
          && state.data.valuationCoverage.methodology
          && state.data.valuationCoverage.methodology.notice,
        '量化区间不等同于公司内在价值。'
      );
      disclosure.innerHTML = `<strong>区间与行情边界</strong><p>股票资料目录中的 ${allCompanies.length} 个标的均已建立三档区间：${researchedTotal} 个采用财报与业务研究，${quantitativeTotal} 个采用近一年价格分布或参考价阶梯，其中 ${lowConfidenceTotal} 个因历史不足、杠杆属性或特殊证券结构标为低置信度。每日价格图案按参考价不高于安全、合理或激进区间上限分档；每个百分比区间由参考价分别对照对应价格带的上、下限计算。${escapeHTML(coverageNotice)} ${escapeHTML(textValue(snapshot.notice, '静态研究价格带不构成投资建议。'))} ${escapeHTML(quoteNotice)} 区间不会触发交易。</p>`;
    }
  }

  function normalizeResearchBands(value) {
    if (!value || typeof value !== 'object') return null;
    const normalizeRange = (range) => {
      const low = toFiniteNumber(range && range.low);
      const high = toFiniteNumber(range && range.high);
      return low !== null && high !== null && low > 0 && high >= low ? { low, high } : null;
    };
    const safety = normalizeRange(value.safety);
    const reasonable = normalizeRange(value.reasonable);
    const aggressive = normalizeRange(value.aggressive);
    if (
      !safety || !reasonable || !aggressive
      || safety.high >= reasonable.low
      || reasonable.high >= aggressive.low
    ) {
      return null;
    }
    return {
      ...value,
      safety,
      reasonable,
      aggressive,
      referencePrice: toFiniteNumber(value.referencePrice)
    };
  }

  function formatResearchRange(range, currency) {
    return `${formatValuationPrice(range.low, currency)} – ${formatValuationPrice(range.high, currency)}`;
  }

  function calculatePePriceModel(model, methodology) {
    const eps = toFiniteNumber(model && model.eps && model.eps.value);
    const bearPe = toFiniteNumber(model && model.peScenarios && model.peScenarios.bear);
    const basePe = toFiniteNumber(model && model.peScenarios && model.peScenarios.base);
    const bullPe = toFiniteNumber(model && model.peScenarios && model.peScenarios.bull);
    const safetyDiscount = toFiniteNumber(methodology && methodology.safetyDiscount);
    if (
      eps === null || eps <= 0
      || bearPe === null || basePe === null || bullPe === null
      || bearPe <= 0 || bearPe >= basePe || basePe >= bullPe
      || safetyDiscount === null || safetyDiscount <= 0 || safetyDiscount >= 1
    ) {
      return null;
    }

    const bearValue = eps * bearPe;
    const baseValue = eps * basePe;
    const bullValue = eps * bullPe;
    return {
      eps,
      bearPe,
      basePe,
      bullPe,
      safetyDiscount,
      bearValue,
      baseValue,
      bullValue,
      safetyCap: bearValue * safetyDiscount
    };
  }

  function renderValuationSources(sources) {
    const links = (Array.isArray(sources) ? sources : []).map((source) => {
      const url = safeExternalUrl(source && source.url);
      const label = textValue(source && source.label, '来源');
      if (!url) return `<span>${escapeHTML(label)}</span>`;
      return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHTML(label)} ↗</a>`;
    }).filter(Boolean);
    return links.length ? links.join('') : '<span>暂未提供来源说明。</span>';
  }

  function researchBandsFromEntry(snapshot, entry) {
    const marketQuote = marketQuoteForTicker(entry.ticker);
    return {
      asOf: snapshot.updatedAt,
      timeHorizon: textValue(snapshot.timeHorizon, '未来约 6–12 个月'),
      sourceLabel: textValue(snapshot.sourceLabel, '用户提供的《股票买入区间分析》研究对话'),
      methodology: textValue(snapshot.basis, '上一季度财报、公司指引与估值风险的人工研究快照'),
      referencePrice: marketQuote ? marketQuote.price : entry.referencePrice,
      referencePriceApproximate: marketQuote ? false : entry.referencePriceApproximate === true,
      analysisReferencePrice: entry.referencePrice,
      marketQuote,
      aggressive: entry.aggressive,
      reasonable: entry.reasonable,
      safety: entry.safety,
      thesis: entry.view,
      aboveAggressiveNote: entry.aboveAggressiveNote
    };
  }

  function getValuationCompanies(data) {
    const companies = data && Array.isArray(data.companies) ? data.companies : [];
    const snapshot = data && data.manualBuyZones && typeof data.manualBuyZones === 'object'
      ? data.manualBuyZones
      : {};
    const manualEntries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const uniqueCompanies = new Map();

    companies.forEach((company) => {
      if (!company || typeof company !== 'object') return;
      const ticker = textValue(company.ticker, '');
      if (!valuationTickerPattern.test(ticker) || uniqueCompanies.has(ticker)) return;
      uniqueCompanies.set(ticker, company);
    });

    manualEntries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const ticker = textValue(entry.ticker, '');
      if (!valuationTickerPattern.test(ticker)) return;
      const buyZones = researchBandsFromEntry(snapshot, entry);
      const entrySources = Array.isArray(entry.sources) && entry.sources.length
        ? entry.sources
        : [{
            label: textValue(snapshot.sourceLabel, '用户提供的《股票买入区间分析》研究对话'),
            type: 'analysis-origin'
          }];
      const existing = uniqueCompanies.get(ticker);
      if (existing) {
        uniqueCompanies.set(ticker, { ...existing, buyZones });
        return;
      }
      uniqueCompanies.set(ticker, {
        ticker,
        name: textValue(entry.name, ticker),
        segment: textValue(entry.segment, '待分类'),
        tradingViewSymbol: textValue(entry.tradingViewSymbol, ''),
        disclosureMonitor: 'manual',
        reviewStatus: 'demo',
        reviewReason: '该价格带已从用户提供的研究对话导入；财务输入与价格区间需在后续披露后手动复核。',
        currency: safeCurrency(entry.currency, data && data.currency),
        confidence: textValue(entry.confidence, 'not_assessed'),
        valuationModel: { kind: 'research-range' },
        assumptions: [
          textValue(entry.view, '等待下一次研究复核。'),
          '只有在核心投资逻辑未被财报、指引、融资或监管变化破坏时，价格区间才有效。'
        ],
        riskNote: textValue(entry.riskNote, snapshot.notice || '研究区间可能随基本面和估值条件变化而失效。'),
        updatedAt: snapshot.updatedAt,
        sources: entrySources,
        buyZones
      });
    });

    return Array.from(uniqueCompanies.values());
  }

  function renderTradingViewChart(company, marketDataNotice, forceRefresh = false) {
    const shell = byId('valuation-chart-shell');
    const container = byId('valuation-price-chart');
    const sourceLink = byId('valuation-source-link');
    const fallback = byId('valuation-chart-fallback');
    if (!shell || !container || !sourceLink || !fallback) return false;

    shell.setAttribute('aria-busy', 'true');
    const symbol = safeTradingViewSymbol(company && company.tradingViewSymbol);
    const ticker = textValue(company && company.ticker, '该公司');
    const companyName = textValue(company && company.name, ticker);

    if (!symbol) {
      const placeholder = document.createElement('div');
      placeholder.className = 'chart-placeholder';
      placeholder.textContent = '行情符号无效，暂时无法加载价格图。';
      container.replaceChildren(placeholder);
      sourceLink.hidden = true;
      sourceLink.removeAttribute('href');
      fallback.textContent = '行情组件已安全降级；估值观察参数仍可查看。';
      shell.setAttribute('aria-busy', 'false');
      return false;
    }

    let widget = forceRefresh ? null : container.querySelector('tv-mini-chart');
    if (!widget) {
      widget = document.createElement('tv-mini-chart');
    }
    container.replaceChildren(widget);
    widget.setAttribute('symbol', symbol);
    widget.setAttribute('theme', 'dark');
    widget.setAttribute('transparent', '');
    widget.setAttribute('aria-label', `${companyName}（${ticker}）价格走势，行情可能延迟`);
    widget.style.display = 'block';
    widget.style.width = '100%';
    widget.style.height = '100%';

    sourceLink.hidden = false;
    sourceLink.href = `https://www.tradingview.com/symbols/${symbol.replace(':', '-')}/`;
    sourceLink.textContent = `在 TradingView 查看 ${ticker} ↗`;
    fallback.textContent = textValue(
      marketDataNotice,
      '行情图由 TradingView 提供并自动更新；交易所数据可能延迟，不作为实时成交或交易依据。'
    );
    shell.setAttribute('aria-busy', 'false');
    return true;
  }

  function renderSelectedValuation(options = {}) {
    const data = state.data.valuation;
    const companies = getValuationCompanies(data);
    const company = companies.find((item) => item.ticker === state.valuation.ticker);
    if (!data || !company) {
      throw new Error('未找到所选公司的估值观察参数。');
    }

    const ticker = textValue(company.ticker, '—');
    const name = textValue(company.name, ticker);
    const segment = textValue(company.segment, '待分类');
    const currency = safeCurrency(company.currency, data.currency);
    const confidence = valuationConfidence(company.confidence);
    const riskNote = textValue(company.riskNote, '暂未提供单独风险提示。');
    const updatedAt = formatDate(company.updatedAt || data.updatedAt);
    const model = company.valuationModel && typeof company.valuationModel === 'object'
      ? company.valuationModel
      : {};
    const eps = model.eps && typeof model.eps === 'object' ? model.eps : {};
    const epsValue = toFiniteNumber(eps.value);
    const epsText = epsValue === null ? '—' : formatCurrencyAmount(epsValue, currency);
    const epsPeriod = eps.periodEnd ? formatDate(eps.periodEnd) : '待确认';
    const epsPeriodType = { TTM: 'TTM', FY: '完整财年', Q: '单季' }[eps.periodType] || '待确认期间';
    const isPeModel = model.kind === 'pe';
    const pePriceModel = isPeModel ? calculatePePriceModel(model, data.methodology) : null;
    const hasPePriceModel = Boolean(isPeModel && pePriceModel);
    const researchBands = normalizeResearchBands(company.buyZones);
    const hasResearchBands = Boolean(researchBands);
    const reviewStatus = ['demo', 'reviewed', 'needs-review'].includes(company.reviewStatus)
      ? company.reviewStatus
      : 'demo';
    const reviewMeta = {
      demo: { label: '研究模型 · 待验证', className: 'is-demo' },
      reviewed: { label: '已按最新财报复核', className: 'is-reviewed' },
      'needs-review': { label: '发现新披露 · 需复核', className: 'is-review' }
    }[reviewStatus];
    const reviewReason = textValue(
      company.reviewReason,
      reviewStatus === 'needs-review'
        ? '系统发现新的公司披露，现有 EPS 与 P/E 情景仅保留作历史研究参考。'
        : '估值输入已人工复核；情景倍数仍是研究假设，不代表收益保证。'
    );
    const latestFiling = company.latestSecFiling && typeof company.latestSecFiling === 'object'
      ? company.latestSecFiling
      : null;
    const filingUrl = safeExternalUrl(latestFiling && latestFiling.sourceUrl);
    const filingLink = filingUrl
      ? `<a class="valuation-filing-link" href="${escapeHTML(filingUrl)}" target="_blank" rel="noopener noreferrer nofollow">查看 SEC ${escapeHTML(latestFiling.form || '披露')} ↗</a>`
      : '';
    const automation = data.automation && typeof data.automation === 'object' ? data.automation : {};
    const lastDailyCheck = automation.lastDailyCheckAt ? formatDate(automation.lastDailyCheckAt) : '等待首次运行';
    const automationSummary = company.disclosureMonitor === 'manual'
      ? '披露巡检：手动复核 · 财报或重大事件后需重新评估价格带'
      : `${textValue(automation.dailySchedule, '每天自动巡检')} · ${textValue(automation.eventSchedule, '定时检查新披露')} · 最近巡检：${lastDailyCheck}`;
    const assumptions = Array.isArray(company.assumptions)
      ? company.assumptions.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : [];
    const assumptionItems = assumptions.length
      ? assumptions.map((item) => `<li>${escapeHTML(item)}</li>`).join('')
      : '<li>暂未提供关键假设明细。</li>';
    const summary = byId('valuation-summary');

    if (!summary) {
      throw new Error('找不到估值观察摘要容器。');
    }

    let valuationMarkup = '';
    if (hasResearchBands) {
      const analysisDate = researchBands.asOf ? formatDate(researchBands.asOf) : '待确认';
      const referencePrice = researchBands.referencePrice === null
        ? '未记录'
        : `${researchBands.referencePriceApproximate ? '约 ' : ''}${formatValuationPrice(researchBands.referencePrice, currency)}`;
      const sourceLabel = textValue(researchBands.sourceLabel, '人工研究记录');
      const marketQuote = researchBands.marketQuote && typeof researchBands.marketQuote === 'object'
        ? researchBands.marketQuote
        : null;
      const quoteChange = quoteChangeMeta(marketQuote);
      const referenceLabel = marketQuote ? '自动行情快照 · 可能延迟' : '分析参考价 · 非实时';
      const referenceMeta = marketQuote
        ? `${quoteChange.text} · ${formatMarketQuoteTime(marketQuote.quoteTime, marketQuote.market)} ${marketQuote.market === 'cn' ? '上海' : '美东'}`
        : `研究区间原参考价 ${formatValuationPrice(researchBands.analysisReferencePrice, currency)}`;
      valuationMarkup = `
        <div class="valuation-model-intro is-research-band">
          <div>
            <span>财报与指引研究区间</span>
            <strong>${escapeHTML(textValue(researchBands.timeHorizon, '未来约 6–12 个月'))}</strong>
          </div>
          <span class="valuation-model-chip">截至 ${escapeHTML(analysisDate)}</span>
        </div>
        <div class="valuation-scenario-grid" aria-label="${escapeHTML(ticker)} 三档研究买入区间">
          <section class="valuation-scenario is-safety">
            <span class="valuation-scenario-step">01 · Safety margin</span>
            <h4>高安全边际</h4>
            <strong class="valuation-scenario-price">${escapeHTML(formatResearchRange(researchBands.safety, currency))}</strong>
            <p>${escapeHTML(textValue(researchBands.safety.note, '基本面未破坏时，适合更明显地分批增加仓位。'))}</p>
          </section>
          <section class="valuation-scenario is-reasonable">
            <span class="valuation-scenario-step">02 · Core entry</span>
            <h4>合理主买</h4>
            <strong class="valuation-scenario-price">${escapeHTML(formatResearchRange(researchBands.reasonable, currency))}</strong>
            <p>${escapeHTML(textValue(researchBands.reasonable.note, '兼顾增长兑现与估值风险的主要分批区间。'))}</p>
          </section>
          <section class="valuation-scenario is-aggressive">
            <span class="valuation-scenario-step">03 · Starter position</span>
            <h4>激进试仓</h4>
            <strong class="valuation-scenario-price">${escapeHTML(formatResearchRange(researchBands.aggressive, currency))}</strong>
            <p>${escapeHTML(textValue(researchBands.aggressive.note, '仅适合计划仓位的一小部分，需承受较大回撤。'))}</p>
          </section>
        </div>
        <p class="valuation-wait-note"><strong>区间纪律</strong>${escapeHTML(textValue(
          researchBands.aboveAggressiveNote,
          `高于激进区间上沿 ${formatValuationPrice(researchBands.aggressive.high, currency)} 时等待，不追价。`
        ))}</p>
        <div class="valuation-detail-grid">
          <div class="valuation-detail">
            <span>${escapeHTML(referenceLabel)}</span>
            <strong>${escapeHTML(referencePrice)}</strong>
            <small class="valuation-quote-meta ${escapeHTML(marketQuote ? quoteChange.className : 'is-flat')}">${escapeHTML(referenceMeta)}</small>
          </div>
          <div class="valuation-detail">
            <span>区间日期</span>
            <strong>${escapeHTML(analysisDate)}</strong>
          </div>
          <div class="valuation-detail">
            <span>研究口径</span>
            <strong>${escapeHTML(textValue(researchBands.methodology, '最近财报、管理层指引与估值情景综合判断'))}</strong>
          </div>
          <div class="valuation-detail">
            <span>研究置信度</span>
            <strong>${escapeHTML(confidence)}</strong>
          </div>
        </div>
        <p class="valuation-basis"><strong>核心判断</strong>${escapeHTML(textValue(researchBands.thesis, '需结合后续财报与价格走势继续复核。'))}</p>
        <p class="valuation-band-origin"><strong>区间来源</strong>${escapeHTML(sourceLabel)}。价格带为人工研究结论；自动行情只用于判断当前价格落在哪一档，不会重算区间。</p>
        ${model.kind === 'pe-not-meaningful' ? `
          <div class="valuation-unavailable-panel is-compact">
            <span class="valuation-scenario-step">P/E CROSS-CHECK</span>
            <h4>P/E 暂不适用</h4>
            <p>${escapeHTML(textValue(model.notMeaningfulReason, '当前盈利不满足 P/E 估值条件；以上区间采用替代估值与前瞻情景。'))}</p>
          </div>
        ` : ''}
      `;
    } else if (hasPePriceModel) {
      const {
        bearPe,
        basePe,
        bullPe,
        safetyDiscount,
        bearValue,
        baseValue,
        bullValue,
        safetyCap
      } = pePriceModel;
      const safetyPercent = Math.round(safetyDiscount * 100);
      const safetyPrice = formatValuationPrice(safetyCap, currency);
      const bearPrice = formatValuationPrice(bearValue, currency);
      const basePrice = formatValuationPrice(baseValue, currency);
      const bullPrice = formatValuationPrice(bullValue, currency);
      valuationMarkup = `
        <div class="valuation-model-intro">
          <div>
            <span>规范化盈利输入</span>
            <strong>${escapeHTML(epsText)} / 股</strong>
          </div>
          <span class="valuation-model-chip">${escapeHTML(epsPeriodType)} P/E 情景</span>
        </div>
        <div class="valuation-scenario-grid" aria-label="${escapeHTML(ticker)} 三档估值价格">
          <section class="valuation-scenario is-safety">
            <span class="valuation-scenario-step">01 · Bear × ${escapeHTML(String(safetyPercent))}%</span>
            <h4>有安全边际</h4>
            <strong class="valuation-scenario-price">≤ ${escapeHTML(safetyPrice)}</strong>
            <p>熊市 P/E ${escapeHTML(String(bearPe))}× 对应 ${escapeHTML(bearPrice)}，再保守折价 ${escapeHTML(String(100 - safetyPercent))}%。</p>
          </section>
          <section class="valuation-scenario is-reasonable">
            <span class="valuation-scenario-step">02 · Base P/E ${escapeHTML(String(basePe))}×</span>
            <h4>合理买入</h4>
            <strong class="valuation-scenario-price">&gt; ${escapeHTML(safetyPrice)} – ≤ ${escapeHTML(basePrice)}</strong>
            <p>左端不含、右端包含：高于安全边际上限，不高于基准情景价值。</p>
          </section>
          <section class="valuation-scenario is-aggressive">
            <span class="valuation-scenario-step">03 · Bull P/E ${escapeHTML(String(bullPe))}×</span>
            <h4>激进买入</h4>
            <strong class="valuation-scenario-price">&gt; ${escapeHTML(basePrice)} – ≤ ${escapeHTML(bullPrice)}</strong>
            <p>左端不含、右端包含；需要牛市增长兑现，容错空间最小。</p>
          </section>
        </div>
        <p class="valuation-wait-note"><strong>等待线</strong> &gt; ${escapeHTML(bullPrice)} 不列入买入区；右侧实时图仅用于对照，不自动给出交易信号。</p>
        <div class="valuation-formula-card">
          <span>可复算公式</span>
          <code>${escapeHTML(epsText)} × ${escapeHTML(String(bearPe))} = ${escapeHTML(bearPrice)}；${escapeHTML(bearPrice)} × ${escapeHTML(String(safetyPercent))}% = ${escapeHTML(safetyPrice)}</code>
        </div>
        <div class="valuation-detail-grid">
          <div class="valuation-detail">
            <span>EPS 口径</span>
            <strong>${escapeHTML(textValue(eps.basis, '待确认'))}</strong>
          </div>
          <div class="valuation-detail">
            <span>熊 / 基准 / 牛 P/E</span>
            <strong>${escapeHTML(`${bearPe}× / ${basePe}× / ${bullPe}×`)}</strong>
          </div>
          <div class="valuation-detail">
            <span>财务期末</span>
            <strong>${escapeHTML(epsPeriod)}</strong>
          </div>
          <div class="valuation-detail">
            <span>研究置信度</span>
            <strong>${escapeHTML(confidence)}</strong>
          </div>
        </div>
        <p class="valuation-basis"><strong>历史 P/E 背景</strong>${escapeHTML(textValue(model.historicalPeContext, '待补充。'))}</p>
        <p class="valuation-basis"><strong>情景设定理由</strong>${escapeHTML(textValue(model.scenarioRationale, '待补充。'))}</p>
      `;
    } else {
      const unavailableTitle = isPeModel ? 'P/E 模型输入异常' : '暂不提供 P/E 买入价';
      const unavailableReason = isPeModel
        ? '当前 EPS、P/E 或安全边际输入未通过前端完整性检查，请等待数据修复。'
        : textValue(model.notMeaningfulReason, '当前盈利不满足 P/E 估值条件。');
      valuationMarkup = `
        <div class="valuation-unavailable-panel">
          <span class="valuation-scenario-step">P/E NOT MEANINGFUL</span>
          <h4>${escapeHTML(unavailableTitle)}</h4>
          <p>${escapeHTML(unavailableReason)}</p>
        </div>
        <div class="valuation-detail-grid">
          <div class="valuation-detail">
            <span>已披露 EPS 观察</span>
            <strong>${escapeHTML(epsText)} / 股</strong>
          </div>
          <div class="valuation-detail">
            <span>财务期末</span>
            <strong>${escapeHTML(epsPeriod)}</strong>
          </div>
          <div class="valuation-detail">
            <span>替代估值</span>
            <strong>${escapeHTML(textValue(model.alternativeMetric, '待建立。'))}</strong>
          </div>
          <div class="valuation-detail">
            <span>重新启用 P/E 条件</span>
            <strong>${escapeHTML(textValue(model.reentryRule, '待建立。'))}</strong>
          </div>
        </div>
      `;
    }

    const modelLabel = hasResearchBands
      ? '财报 / 指引研究区间'
      : hasPePriceModel
        ? 'P/E 三情景模型'
      : isPeModel
        ? 'P/E 模型输入异常'
        : 'P/E 暂不适用';
    const modelClassName = hasResearchBands
      ? 'is-research'
      : hasPePriceModel
        ? 'is-pe'
        : 'is-unavailable';
    const epsSupportMarkup = model.eps && typeof model.eps === 'object'
      ? `
        <p class="valuation-basis"><strong>EPS 计算</strong>${escapeHTML(textValue(eps.calculation, '待补充。'))}</p>
        <p class="valuation-basis"><strong>GAAP 对照</strong>${escapeHTML(textValue(eps.gaapComparison, '待补充。'))}</p>
      `
      : '';

    summary.innerHTML = `
      <div class="valuation-summary-head">
        <div>
          <span class="valuation-company-segment">${escapeHTML(segment)}</span>
          <h3 class="valuation-company-name">${escapeHTML(name)}</h3>
        </div>
        <div class="valuation-symbol-stack">
          <span class="valuation-symbol">${escapeHTML(ticker)}</span>
          <span class="valuation-model-kind ${modelClassName}">${escapeHTML(modelLabel)}</span>
        </div>
      </div>
      <div class="valuation-review-status ${escapeHTML(reviewMeta.className)}">
        <strong>${escapeHTML(reviewMeta.label)}</strong>
        <span>${escapeHTML(reviewReason)}</span>
        ${filingLink}
      </div>
      ${valuationMarkup}
      ${epsSupportMarkup}
      <div class="valuation-assumptions">
        <strong>关键假设</strong>
        <ul>${assumptionItems}</ul>
      </div>
      <p class="valuation-risk-note"><strong>主要风险</strong>${escapeHTML(riskNote)}</p>
      <div class="valuation-sources"><strong>资料来源</strong><div>${renderValuationSources(company.sources)}</div></div>
      <p class="valuation-meta-line">研究更新：${escapeHTML(updatedAt)} · 产业链：${escapeHTML(segment)} · 币种：${escapeHTML(currency)}</p>
      <p class="valuation-auto-meta">自动巡检：${escapeHTML(automationSummary)}</p>
    `;

    const chartTitle = byId('valuation-chart-title');
    if (chartTitle) chartTitle.textContent = `${name}（${ticker}）价格走势`;
    const chartIsActive = state.routing.active === 'supply-chain';
    const chartReady = chartIsActive
      ? renderTradingViewChart(company, data.marketDataNotice, options.forceChart === true)
      : false;
    const status = byId('valuation-status');
    if (status) {
      const chartStatus = chartReady
        ? '已请求切换行情图，第三方价格可能延迟。'
        : chartIsActive
          ? '行情图暂不可用。'
          : '行情图将在打开供应链与估值页面后加载。';
      status.textContent = `已显示 ${name}（${ticker}）的${modelLabel}。${chartStatus}`;
    }
  }

  function renderValuation(data) {
    const companies = getValuationCompanies(data);
    const select = byId('valuation-company-select');
    if (!select || !companies.length) {
      throw new Error('价格与估值观察缺少有效公司数据。');
    }

    state.data.valuation = data;
    renderBuyZones(data);
    select.replaceChildren();
    companies.forEach((company) => {
      const ticker = textValue(company.ticker, '');
      const name = textValue(company.name, ticker);
      const option = document.createElement('option');
      option.value = ticker;
      option.textContent = `${ticker} · ${name}`;
      select.append(option);
    });

    const selected = companies.find((company) => company.ticker === state.valuation.ticker) || companies[0];
    state.valuation.ticker = selected.ticker;
    select.value = selected.ticker;
    select.disabled = false;

    const disclosure = byId('valuation-disclosure');
    if (disclosure) {
      disclosure.innerHTML = `<strong>研究边界</strong><p>${escapeHTML(textValue(
        data.dataNotice,
        '研究观察区间仅用于信息展示与进一步复核，不构成任何投资建议。'
      ))}</p>`;
    }

    renderSelectedValuation();
  }

  function compareSupplyRows(left, right, key) {
    const riskKeys = ['inventoryRisk', 'receivablesRisk', 'debtRisk', 'customerConcentration', 'overallRisk'];
    if (key === 'latestQuarterGrossMargin') {
      const leftMargin = latestQuarterGrossMargin(left);
      const rightMargin = latestQuarterGrossMargin(right);
      if (leftMargin === null) return rightMargin === null ? 0 : -1;
      if (rightMargin === null) return 1;
      return leftMargin - rightMargin;
    }
    if (key === 'overallRisk') {
      return Number(left.riskScore || 0) - Number(right.riskScore || 0);
    }
    if (riskKeys.includes(key)) {
      const api = utils();
      const priority = api && typeof api.riskPriority === 'function'
        ? api.riskPriority
        : (level) => ({ unknown: 0, low: 1, medium: 2, high: 3, critical: 4 }[level] || 0);
      return priority(left[key]) - priority(right[key]);
    }
    if (key === 'updatedAt') {
      return String(left[key] || '').localeCompare(String(right[key] || ''));
    }
    return String(left[key] || '').localeCompare(String(right[key] || ''), 'zh-CN', { numeric: true });
  }

  function latestQuarterGrossMargin(company) {
    const quarter = company && company.latestQuarter;
    const grossProfit = toFiniteNumber(quarter && quarter.grossProfitUsdMillions);
    const revenue = toFiniteNumber(quarter && quarter.revenueUsdMillions);
    if (grossProfit === null || revenue === null || revenue <= 0) return null;
    return (grossProfit / revenue) * 100;
  }

  function formatUsdMillionsAsYi(value) {
    const usdMillions = toFiniteNumber(value);
    if (usdMillions === null) return '—';
    const yiUsd = usdMillions / 100;
    const absoluteValue = Math.abs(yiUsd);
    const decimals = absoluteValue >= 100 ? 0 : absoluteValue >= 10 ? 1 : absoluteValue >= 1 ? 2 : 3;
    return `${formatNumber(yiUsd, decimals)} 亿美元`;
  }

  function renderLatestQuarterGrossMargin(company) {
    const quarter = company && company.latestQuarter;
    const margin = latestQuarterGrossMargin(company);
    if (!quarter || margin === null) {
      return '<span class="financial-metric is-unavailable">—<small>待披露</small></span>';
    }

    const fiscalPeriod = textValue(quarter.fiscalPeriod, '最新季度');
    const periodEnd = textValue(quarter.periodEnd, '');
    const grossProfit = toFiniteNumber(quarter.grossProfitUsdMillions);
    const revenue = toFiniteNumber(quarter.revenueUsdMillions);
    const basis = textValue(quarter.basis, '毛利润 ÷ 营收');
    const form = textValue(quarter.form, '财报');
    const filedAt = textValue(quarter.filedAt, '');
    const sourceUrl = textValue(quarter.sourceUrl, '');
    const filingDetail = filedAt ? `；SEC ${form} 申报于 ${formatDate(filedAt)}` : `；SEC ${form}`;
    const detail = `毛利率 ${formatNumber(margin, 1, '%')}；${basis}；毛利润 ${formatUsdMillionsAsYi(grossProfit)} / 营收 ${formatUsdMillionsAsYi(revenue)}${filingDetail}`;
    const periodMarkup = periodEnd
      ? `${escapeHTML(fiscalPeriod)} · <time datetime="${escapeHTML(periodEnd)}">${escapeHTML(formatDate(periodEnd))}</time>`
      : escapeHTML(fiscalPeriod);
    const content = `<strong>${escapeHTML(formatNumber(margin, 1, '%'))}</strong><small>${periodMarkup}</small>`;

    if (!/^https:\/\//.test(sourceUrl)) {
      return `<span class="financial-metric" title="${escapeHTML(detail)}">${content}</span>`;
    }
    return `<a class="financial-metric" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(detail)}" aria-label="${escapeHTML(`${company.name} ${fiscalPeriod} 毛利率 ${formatNumber(margin, 1, '%')}，打开 SEC 财报`)}">${content}</a>`;
  }

  function updateSortHeaders() {
    document.querySelectorAll('.sort-button').forEach((button) => {
      const isActive = button.dataset.sort === state.supply.sortKey;
      button.classList.toggle('is-active', isActive);
      const th = button.closest('th');
      if (th) {
        th.removeAttribute('aria-sort');
        if (isActive) {
          th.setAttribute('aria-sort', state.supply.sortDirection === 'asc' ? 'ascending' : 'descending');
        }
      }
      const indicator = button.querySelector('.sort-indicator') || button.querySelector('span');
      if (indicator) {
        indicator.textContent = isActive ? (state.supply.sortDirection === 'asc' ? '↑' : '↓') : '↕';
        indicator.className = isActive ? 'sort-indicator' : '';
      }
    });
  }

  function renderSupplyTable() {
    const payload = state.data.supplyChain;
    if (!payload) return;

    const rows = payload.companies
      .filter((company) => state.supply.segment === 'all' || company.segment === state.supply.segment)
      .filter((company) => state.supply.risk === 'all' || company.overallRisk === state.supply.risk)
      .sort((left, right) => {
        const result = compareSupplyRows(left, right, state.supply.sortKey);
        return state.supply.sortDirection === 'asc' ? result : -result;
      });

    byId('supply-result-count').textContent = `显示 ${rows.length} / ${payload.companies.length} 家公司`;
    updateSortHeaders();

    if (rows.length === 0) {
      byId('supply-chain-body').innerHTML = '<tr><td colspan="12" class="table-empty">当前筛选条件下没有公司，请调整筛选器。</td></tr>';
      return;
    }

    byId('supply-chain-body').innerHTML = rows.map((company) => `
      <tr>
        <td><span class="ticker">${escapeHTML(company.ticker)}</span></td>
        <td><span class="company-cell"><strong>${escapeHTML(company.name)}</strong></span></td>
        <td>${escapeHTML(company.segment)}</td>
        <td><span class="${trendClass(company.revenueTrend)}">${escapeHTML(company.revenueTrend)}</span></td>
        <td><span class="${trendClass(company.grossMarginTrend)}">${escapeHTML(company.grossMarginTrend)}</span></td>
        <td>${renderLatestQuarterGrossMargin(company)}</td>
        <td>${renderRiskBadge(company.inventoryRisk)}</td>
        <td>${renderRiskBadge(company.receivablesRisk)}</td>
        <td>${renderRiskBadge(company.debtRisk)}</td>
        <td>${renderRiskBadge(company.customerConcentration)}</td>
        <td>${renderRiskBadge(company.overallRisk, `${getRiskMeta(company.overallRisk).label} · ${company.riskScore}`)}</td>
        <td><time datetime="${escapeHTML(company.updatedAt)}">${escapeHTML(formatDate(company.updatedAt))}</time></td>
      </tr>
    `).join('');
  }

  function renderSupplyChain(data) {
    state.data.supplyChain = data;
    populateSelect(
      byId('segment-filter'),
      Array.from(new Set(data.companies.map((company) => company.segment))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      '全部环节'
    );
    renderSupplyTable();

    byId('supply-chain-heatmap').innerHTML = data.segments.map((segment, index) => {
      const meta = getRiskMeta(segment.riskLevel);
      return `
        <article class="heatmap-node ${escapeHTML(meta.className)}">
          <span class="node-order">${String(index + 1).padStart(2, '0')}</span>
          <h3>${escapeHTML(segment.name)}</h3>
          <div class="node-score">${escapeHTML(segment.score)}<span>/100</span></div>
          ${renderRiskBadge(segment.riskLevel)}
          <p>${escapeHTML(segment.description)}</p>
        </article>
      `;
    }).join('');
  }

  function metricValue(indicator) {
    const numericValue = toFiniteNumber(indicator.value);
    if (numericValue === null) return '—';
    const decimals = Number.isInteger(numericValue) ? 0 : Math.abs(numericValue * 10 - Math.round(numericValue * 10)) < 0.001 ? 1 : 2;
    const unit = String(indicator.unit || '');
    const suffix = unit.includes('%') ? '%' : unit === '点' ? ' 点' : unit ? ` ${unit}` : '';
    return `${formatNumber(numericValue, decimals)}${suffix}`;
  }

  function renderMacro(data) {
    const statusMeta = getRiskMeta(data.status.riskLevel);
    const regime = byId('macro-regime');
    regime.className = `regime-banner ${statusMeta.className}`;
    byId('macro-regime-title').textContent = data.status.name;
    byId('macro-regime-summary').textContent = data.status.summary;

    byId('macro-metrics').innerHTML = data.indicators.map((indicator) => {
      const directionSymbol = indicator.direction === 'up' ? '↑' : indicator.direction === 'down' ? '↓' : '→';
      const changeValue = toFiniteNumber(indicator.change);
      const changePrefix = changeValue !== null && changeValue > 0 ? '+' : '';
      const changeText = changeValue === null ? '—' : formatNumber(changeValue, 2);
      const previousValue = toFiniteNumber(indicator.previousValue);
      const previousSuffix = String(indicator.unit || '').includes('%') ? '%' : '';
      const previousText = previousValue === null ? '—' : `${formatNumber(previousValue, 2)}${previousSuffix}`;
      return `
        <article class="macro-card">
          <div class="macro-card-topline">
            <h2>${escapeHTML(indicator.name)}</h2>
            ${renderRiskBadge(indicator.riskLevel)}
          </div>
          <div class="macro-values">
            <strong class="macro-current">${escapeHTML(metricValue(indicator))}</strong>
            <span class="macro-direction">${directionSymbol} ${changePrefix}${escapeHTML(changeText)}</span>
          </div>
          <span class="macro-previous">前值 ${escapeHTML(previousText)}</span>
          <p class="macro-impact">${escapeHTML(indicator.impact)}</p>
        </article>
      `;
    }).join('');

    byId('macro-quadrants').innerHTML = data.quadrants.map((quadrant) => {
      const className = quadrant.riskLevel === 'low' ? 'quadrant-favorable' : quadrant.riskLevel === 'critical' ? 'quadrant-danger' : 'quadrant-watch';
      const current = quadrant.isCurrent ? renderRiskBadge(quadrant.riskLevel, '当前环境') : '';
      return `
        <article class="quadrant-card ${className}">
          <span class="quadrant-axis">${escapeHTML(quadrant.name)}</span>
          <h3>${quadrant.isCurrent ? '当前所处象限' : '情景路径'} ${current}</h3>
          <p>${escapeHTML(quadrant.description)}</p>
        </article>
      `;
    }).join('');
  }

  function renderEventTimeline() {
    const payload = state.data.events;
    if (!payload) return;

    const events = payload.events
      .filter((event) => state.events.sentiment === 'all' || event.sentiment === state.events.sentiment)
      .filter((event) => state.events.entity === 'all' || event.entity === state.events.entity)
      .sort((left, right) => String(right.date).localeCompare(String(left.date)));

    byId('event-result-count').textContent = `显示 ${events.length} / ${payload.events.length} 条事件`;

    if (events.length === 0) {
      byId('event-timeline').innerHTML = '<div class="empty-state">当前筛选条件下没有事件，请调整筛选器。</div>';
      return;
    }

    byId('event-timeline').innerHTML = events.map((event) => {
      const url = safeExternalUrl(event.sourceUrl);
      const sourceLink = url
        ? `<a class="source-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" aria-label="在新标签页打开 ${escapeHTML(event.sourceName)}">查看来源 ↗</a>`
        : '';
      const delta = Number(event.riskScoreChange);
      const deltaClass = delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : '';
      const deltaText = `${delta > 0 ? '+' : ''}${delta}`;
      return `
        <article class="timeline-item sentiment-${escapeHTML(event.sentiment)}">
          <time class="timeline-date" datetime="${escapeHTML(event.date)}">${escapeHTML(formatDate(event.date))}</time>
          <div class="timeline-card">
            <div class="timeline-topline">
              <span class="timeline-entity">${escapeHTML(event.entity)}</span>
              <span class="sentiment-badge sentiment-${escapeHTML(event.sentiment)}">${escapeHTML(sentimentLabels[event.sentiment] || '待判断')}</span>
            </div>
            <h2>${escapeHTML(event.title)}</h2>
            <p>${escapeHTML(event.description)}</p>
            <div class="timeline-meta">
              <span class="type-badge">${escapeHTML(event.type)}</span>
              <span>影响：${escapeHTML(event.affectedSegments.join(' · '))}</span>
              <span class="risk-delta ${deltaClass}">风险 ${deltaText}</span>
            </div>
            <div class="timeline-footer">
              <span class="source-label">${escapeHTML(event.sourceName)}</span>
              ${sourceLink}
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderEvents(data) {
    state.data.events = data;
    const sourceChip = byId('event-source-chip');
    if (sourceChip) {
      const hasAutomatedEvents = Array.isArray(data.events) && data.events.some((event) => event && event.isAutomated === true);
      sourceChip.textContent = hasAutomatedEvents ? '演示情景 + SEC 官方披露' : '演示情景；SEC 披露发现后加入';
    }
    const dataNotice = byId('event-data-notice-text');
    if (dataNotice) {
      dataNotice.textContent = [data.dataNotice, data.automationNotice].filter(Boolean).join(' ');
    }
    populateSelect(
      byId('entity-filter'),
      Array.from(new Set(data.events.map((event) => event.entity))).sort((a, b) => a.localeCompare(b, 'en')),
      '全部主体'
    );
    renderEventTimeline();
  }

  function formatSaleUsd(value, options = {}) {
    const amount = toFiniteNumber(value);
    if (amount === null) return '—';
    if (amount === 0) return '$0';
    const absolute = Math.abs(amount);
    const sign = amount < 0 ? '−' : '';
    if (absolute >= 1e9) return `${sign}$${formatNumber(absolute / 1e9, 2)}B`;
    if (absolute >= 1e6) return `${sign}$${formatNumber(absolute / 1e6, options.compact ? 1 : 2)}M`;
    if (absolute >= 1e3) return `${sign}$${formatNumber(absolute / 1e3, options.compact ? 0 : 1)}K`;
    return `${sign}$${formatNumber(absolute, 0)}`;
  }

  function formatSaleShares(value) {
    const amount = toFiniteNumber(value);
    if (amount === null) return '—';
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(amount);
  }

  function saleStatusMeta(company) {
    if (company.coverage === 'excluded') {
      return { label: '非可比', className: 'is-excluded' };
    }
    if (Number(company.pending && company.pending.shares) > 0) {
      return { label: '待确认拟售', className: 'is-pending' };
    }
    if (Number(company.executed && company.executed.shares) > 0) {
      return { label: '已有出售', className: 'is-sold' };
    }
    return { label: '窗口内零披露', className: 'is-clear' };
  }

  function renderSaleCompanyBars(data) {
    const container = byId('sale-company-bars');
    if (!container) return;
    const active = (data.companies || [])
      .filter((company) => company.coverage === 'covered')
      .filter((company) => Number(company.executed && company.executed.valueUsd) > 0 || Number(company.pending && company.pending.valueUsd) > 0)
      .sort((a, b) => (Number(b.executed && b.executed.valueUsd) + Number(b.pending && b.pending.valueUsd))
        - (Number(a.executed && a.executed.valueUsd) + Number(a.pending && a.pending.valueUsd)));
    const maximum = Math.max(1, ...active.map((company) => Number(company.executed.valueUsd) + Number(company.pending.valueUsd)));

    container.innerHTML = active.map((company, index) => {
      const executed = Number(company.executed.valueUsd) || 0;
      const pending = Number(company.pending.valueUsd) || 0;
      const executedWidth = executed > 0 ? Math.max(2, Math.sqrt(executed / maximum) * 100) : 0;
      const pendingWidth = pending > 0 ? Math.max(2, Math.sqrt(pending / maximum) * 100) : 0;
      return `
        <div class="sale-bar-row">
          <div class="sale-bar-rank">${String(index + 1).padStart(2, '0')}</div>
          <div class="sale-bar-company">
            <strong>${escapeHTML(company.ticker)}</strong>
            <span>${escapeHTML(company.name)}</span>
          </div>
          <div class="sale-bar-track-group">
            <div class="sale-bar-track" title="已售 ${escapeHTML(formatSaleUsd(executed))}">
              <span class="is-executed" style="width:${executedWidth.toFixed(2)}%"></span>
            </div>
            <div class="sale-bar-track" title="待确认拟售 ${escapeHTML(formatSaleUsd(pending))}">
              <span class="is-pending" style="width:${pendingWidth.toFixed(2)}%"></span>
            </div>
          </div>
          <div class="sale-bar-values">
            <strong>${escapeHTML(formatSaleUsd(executed))}</strong>
            <span>${pending > 0 ? `+ ${escapeHTML(formatSaleUsd(pending))} 待确认` : '拟售已匹配'}</span>
          </div>
        </div>
      `;
    }).join('') + `<p class="sale-scale-note">条形按金额平方根缩放，便于同时辨认小额交易；精确值以右侧数字和下表为准。</p>`;
  }

  function saleCompanyMatchesFilter(company) {
    const query = state.insiderSales.query.trim().toLowerCase();
    const matchesQuery = !query || `${company.ticker} ${company.name} ${company.market}`.toLowerCase().includes(query);
    if (!matchesQuery) return false;
    if (state.insiderSales.status === 'all') return true;
    if (state.insiderSales.status === 'active') return Number(company.executed && company.executed.shares) > 0;
    if (state.insiderSales.status === 'pending') return Number(company.pending && company.pending.shares) > 0;
    if (state.insiderSales.status === 'clear') return company.coverage === 'covered'
      && Number(company.executed && company.executed.shares) === 0
      && Number(company.pending && company.pending.shares) === 0;
    return true;
  }

  function renderSaleCompanyTable() {
    const data = state.data.insiderSales;
    const body = byId('sale-company-body');
    if (!data || !body) return;
    const companies = (data.companies || []).filter(saleCompanyMatchesFilter);
    const resultCount = byId('sale-result-count');
    if (resultCount) resultCount.textContent = `显示 ${companies.length} / ${data.companies.length} 只标的`;

    if (!companies.length) {
      body.innerHTML = '<tr><td colspan="6" class="table-empty">当前筛选条件下没有标的，请调整筛选器。</td></tr>';
      return;
    }

    body.innerHTML = companies.map((company) => {
      const status = saleStatusMeta(company);
      const executedShares = company.executed ? formatSaleShares(company.executed.shares) : '—';
      const executedValue = company.executed ? formatSaleUsd(company.executed.valueUsd) : '—';
      const pendingShares = company.pending ? formatSaleShares(company.pending.shares) : '—';
      const pendingValue = company.pending ? formatSaleUsd(company.pending.valueUsd) : '—';
      return `
        <tr class="${escapeHTML(status.className)}">
          <td>
            <a class="sale-company-name" href="${escapeHTML(company.sourceUrl)}" target="_blank" rel="noopener noreferrer">
              <strong>${escapeHTML(company.ticker)}</strong>
              <span>${escapeHTML(company.name)} · ${escapeHTML(company.market)}</span>
            </a>
          </td>
          <td><span class="sale-status ${escapeHTML(status.className)}">${escapeHTML(status.label)}</span></td>
          <td class="sale-numeric"><strong>${escapeHTML(executedShares)}</strong></td>
          <td class="sale-numeric"><strong>${escapeHTML(executedValue)}</strong></td>
          <td class="sale-numeric"><strong>${escapeHTML(pendingShares)}</strong><span>${escapeHTML(pendingValue)}</span></td>
          <td><p class="sale-company-note">${escapeHTML(company.note)}</p><a class="sale-source-link" href="${escapeHTML(company.sourceUrl)}" target="_blank" rel="noopener noreferrer">打开原始披露 ↗</a></td>
        </tr>
      `;
    }).join('');
  }

  function renderSaleLedger(data) {
    const ledger = byId('sale-ledger');
    if (!ledger) return;
    ledger.innerHTML = (data.timeline || []).map((item) => {
      const kindLabel = item.kind === 'pending' ? '拟售' : item.kind === 'executed-discretionary' ? '非计划' : '已售';
      return `
        <article class="sale-ledger-item is-${escapeHTML(item.kind)}">
          <time datetime="${escapeHTML(item.date)}">${escapeHTML(formatDate(item.date))}</time>
          <div class="sale-ledger-marker" aria-hidden="true"></div>
          <div class="sale-ledger-copy">
            <div class="sale-ledger-titleline">
              <span class="sale-ledger-kind">${escapeHTML(kindLabel)}</span>
              <strong>${escapeHTML(item.ticker)} · ${escapeHTML(item.person)}</strong>
            </div>
            <p>${escapeHTML(item.label)} · ${escapeHTML(formatSaleShares(item.shares))} 股 · ${escapeHTML(formatSaleUsd(item.valueUsd))}</p>
            <small>${escapeHTML(item.detail)}</small>
          </div>
          <a href="${escapeHTML(item.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="打开 ${escapeHTML(item.ticker)} ${escapeHTML(item.date)} 原始披露">↗</a>
        </article>
      `;
    }).join('');
  }

  function renderInsiderSales(data) {
    state.data.insiderSales = data;
    const summary = data.summary || {};
    const scope = data.scope || {};
    const windowRange = data.window || {};

    byId('sale-window-label').textContent = windowRange.label || '滚动观察窗口';
    byId('sale-window-dates').textContent = `${formatDate(windowRange.start)} — ${formatDate(windowRange.end)}`;
    byId('sale-coverage-label').textContent = `${scope.comparableCoverage} / ${scope.total} 只可比覆盖 · ${scope.notice || ''}`;
    byId('sale-executed-value').textContent = formatSaleUsd(summary.executedValueUsd);
    byId('sale-executed-shares').textContent = formatSaleShares(summary.executedShares);
    byId('sale-pending-value').textContent = formatSaleUsd(summary.pendingValueUsd);
    byId('sale-pending-shares').textContent = formatSaleShares(summary.pendingShares);
    byId('sale-planned-share').textContent = formatNumber(summary.plannedExecutionSharePct, 1, '%');
    byId('sale-coverage-value').textContent = `${scope.comparableCoverage} / ${scope.total}`;
    byId('sale-concentration-orbit-value').textContent = formatNumber(summary.topCompanyConcentrationPct, 1, '%');
    byId('sale-concentration-copy').textContent = `CRWV 占样本已售金额 ${formatNumber(summary.topCompanyConcentrationPct, 1, '%')}。集中度远高于其余标的，读数应被视为单一公司事件，而不是整个 AI 供应链的普遍抛压。`;
    byId('sale-company-count').textContent = `${summary.companiesWithSales} 家`;
    byId('sale-pending-company-count').textContent = `${summary.companiesWithPendingNotices} 家`;
    byId('sale-method-executed').textContent = data.methodology.executed;
    byId('sale-method-notices').textContent = data.methodology.notices;
    byId('sale-method-pending').textContent = data.methodology.pending;
    byId('sale-method-caveat').textContent = `${data.methodology.caveat} ${data.methodology.excluded}`;
    byId('sale-source-links').innerHTML = (data.methodology.sources || []).map((source) => `
      <a href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.label)} <span aria-hidden="true">↗</span></a>
    `).join('');

    renderSaleCompanyBars(data);
    renderSaleCompanyTable();
    renderSaleLedger(data);
  }

  function renderSectionError(key, source, error) {
    const message = `${source.label}加载失败。其他模块仍可继续使用，请刷新页面重试。`;
    console.error(`[AI CapEx Monitor] ${source.label}数据加载失败`, error);
    const api = utils();

    if (key === 'risk') {
      api.renderSectionError('risk-components', message);
      byId('cycle-summary-text').textContent = message;
    } else if (key === 'hyperscalers') {
      const chartApi = charts();
      if (chartApi) {
        chartApi.initCapexChart(null);
        chartApi.initGrowthChart(null);
      }
      byId('growth-diagnostic').innerHTML = `<span class="diagnostic-icon">!</span><div><strong>增速诊断不可用</strong><p>${escapeHTML(message)}</p></div>`;
    } else if (key === 'marketTurnover') {
      api.renderSectionError('turnover-market-grid', message);
      byId('turnover-history-body').innerHTML = `<tr><td colspan="4" class="table-empty">${escapeHTML(message)}</td></tr>`;
      byId('turnover-method-copy').textContent = message;
      const chartApi = charts();
      if (chartApi && typeof chartApi.initTurnoverChart === 'function') chartApi.initTurnoverChart(null);
    } else if (key === 'supplyChain') {
      byId('supply-chain-body').innerHTML = `<tr><td colspan="12" class="table-empty">${escapeHTML(message)}</td></tr>`;
      api.renderSectionError('supply-chain-heatmap', message);
    } else if (key === 'stockWatchlist') {
      const body = byId('stock-watchlist-body');
      if (body) body.innerHTML = `<tr><td colspan="7" class="table-empty">${escapeHTML(message)}</td></tr>`;
      const summary = byId('stock-watchlist-summary');
      if (summary) summary.textContent = message;
    } else if (key === 'marketQuotes') {
      // 行情快照失败时，估值模块会自动回退到研究参考价。
    } else if (key === 'insiderSales') {
      const body = byId('sale-company-body');
      if (body) body.innerHTML = `<tr><td colspan="6" class="table-empty">${escapeHTML(message)}</td></tr>`;
      api.renderSectionError('sale-company-bars', message);
      api.renderSectionError('sale-ledger', message);
    } else if (key === 'valuation') {
      const buyZoneBody = byId('buy-zones-body');
      if (buyZoneBody) buyZoneBody.innerHTML = `<tr><td colspan="6" class="table-empty">${escapeHTML(message)}</td></tr>`;
      const buyZoneSummary = byId('buy-zones-summary');
      if (buyZoneSummary) buyZoneSummary.textContent = message;
      const select = byId('valuation-company-select');
      if (select) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '估值观察暂不可用';
        select.replaceChildren(option);
        select.disabled = true;
      }
      api.renderSectionError('valuation-summary', message);
      api.renderSectionError('valuation-price-chart', message);
      const shell = byId('valuation-chart-shell');
      if (shell) shell.setAttribute('aria-busy', 'false');
      const sourceLink = byId('valuation-source-link');
      if (sourceLink) {
        sourceLink.hidden = true;
        sourceLink.removeAttribute('href');
      }
      const fallback = byId('valuation-chart-fallback');
      if (fallback) fallback.textContent = message;
      const status = byId('valuation-status');
      if (status) status.textContent = message;
    } else if (key === 'macro') {
      api.renderSectionError('macro-metrics', message);
      byId('macro-regime-summary').textContent = message;
    } else if (key === 'events') {
      api.renderSectionError('event-timeline', message);
      const dataNotice = byId('event-data-notice-text');
      if (dataNotice) dataNotice.textContent = message;
    }
  }

  function updateSharedDates() {
    const dates = Object.values(state.data)
      .map((item) => item && item.updatedAt)
      .filter(Boolean)
      .sort();
    const latest = dates.at(-1);
    if (!latest) return;
    ['header-updated-at', 'footer-updated-at'].forEach((id) => {
      const element = byId(id);
      element.dateTime = latest;
      element.textContent = formatDate(latest);
    });
  }

  function bindInteractions() {
    byId('segment-filter').addEventListener('change', (event) => {
      state.supply.segment = event.target.value;
      renderSupplyTable();
    });
    byId('risk-filter').addEventListener('change', (event) => {
      state.supply.risk = event.target.value;
      renderSupplyTable();
    });
    const stockSearch = byId('stock-watchlist-search');
    if (stockSearch) {
      stockSearch.addEventListener('input', (event) => {
        state.stocks.query = event.target.value;
        renderStockWatchlistTable();
      });
    }
    const stockMarketButtons = Array.from(document.querySelectorAll('[data-stock-market]'));
    stockMarketButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        state.stocks.market = button.dataset.stockMarket;
        renderStockWatchlistTable();
      });
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? stockMarketButtons.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + stockMarketButtons.length) % stockMarketButtons.length;
        stockMarketButtons[nextIndex].click();
        stockMarketButtons[nextIndex].focus();
      });
    });
    const valuationSelect = byId('valuation-company-select');
    if (valuationSelect) {
      valuationSelect.addEventListener('change', (event) => {
        state.valuation.ticker = event.target.value;
        try {
          renderSelectedValuation();
        } catch (error) {
          renderSectionError('valuation', DATA_SOURCES.valuation, error);
        }
      });
    }
    document.querySelectorAll('.sort-button').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.sort;
        if (state.supply.sortKey === key) {
          state.supply.sortDirection = state.supply.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          state.supply.sortKey = key;
          state.supply.sortDirection = ['latestQuarterGrossMargin', 'overallRisk', 'inventoryRisk', 'receivablesRisk', 'debtRisk', 'customerConcentration', 'updatedAt'].includes(key) ? 'desc' : 'asc';
        }
        renderSupplyTable();
      });
    });
    const buyZoneSortButton = byId('buy-zones-sort-button');
    if (buyZoneSortButton) {
      buyZoneSortButton.addEventListener('click', () => {
        state.buyZones.sortDirection = state.buyZones.sortDirection === 'desc' ? 'asc' : 'desc';
        try {
          renderBuyZones(state.data.valuation);
        } catch (error) {
          renderSectionError('valuation', DATA_SOURCES.valuation, error);
        }
      });
    }
    const buyZoneSearch = byId('buy-zones-search');
    if (buyZoneSearch) {
      buyZoneSearch.addEventListener('input', (event) => {
        state.buyZones.query = event.target.value;
        try {
          renderBuyZones(state.data.valuation);
        } catch (error) {
          renderSectionError('valuation', DATA_SOURCES.valuation, error);
        }
      });
    }
    const buyZoneMarketButtons = Array.from(document.querySelectorAll('[data-buy-zone-market]'));
    buyZoneMarketButtons.forEach((button, index) => {
      button.addEventListener('click', () => {
        state.buyZones.market = button.dataset.buyZoneMarket;
        try {
          renderBuyZones(state.data.valuation);
        } catch (error) {
          renderSectionError('valuation', DATA_SOURCES.valuation, error);
        }
      });
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buyZoneMarketButtons.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + buyZoneMarketButtons.length) % buyZoneMarketButtons.length;
        buyZoneMarketButtons[nextIndex].click();
        buyZoneMarketButtons[nextIndex].focus();
      });
    });
    const saleSearch = byId('sale-company-search');
    if (saleSearch) {
      saleSearch.addEventListener('input', (event) => {
        state.insiderSales.query = event.target.value;
        renderSaleCompanyTable();
      });
    }
    const saleStatusButtons = Array.from(document.querySelectorAll('[data-sale-status]'));
    saleStatusButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.insiderSales.status = button.dataset.saleStatus;
        saleStatusButtons.forEach((candidate) => {
          candidate.setAttribute('aria-pressed', String(candidate === button));
        });
        renderSaleCompanyTable();
      });
    });
    byId('sentiment-filter').addEventListener('change', (event) => {
      state.events.sentiment = event.target.value;
      renderEventTimeline();
    });
    byId('entity-filter').addEventListener('change', (event) => {
      state.events.entity = event.target.value;
      renderEventTimeline();
    });
  }

  async function initialize() {
    bindRouting();
    const api = utils();
    const scoreApi = scoring();
    if (!api || !scoreApi) {
      const notice = byId('global-notice');
      notice.hidden = false;
      notice.textContent = '核心脚本未能加载，请检查网络或静态资源路径后刷新页面。';
      console.error('[AI CapEx Monitor] 缺少 CapExUtils 或 CapExScoring。');
      return;
    }

    bindInteractions();
    const entries = Object.entries(DATA_SOURCES);
    const outcomes = await Promise.allSettled(
      entries.map(([, source]) => api.loadJSON(source.path, source.label))
    );

    let failureCount = 0;
    outcomes.forEach((outcome, index) => {
      const [key, source] = entries[index];
      if (outcome.status === 'fulfilled') {
        state.data[key] = outcome.value;
      } else {
        failureCount += 1;
        renderSectionError(key, source, outcome.reason);
      }
    });

    const renderers = {
      risk: renderOverview,
      hyperscalers: renderHyperscalers,
      marketTurnover: renderMarketTurnover,
      supplyChain: renderSupplyChain,
      stockWatchlist: renderStockWatchlist,
      hkWatchlist: () => {},
      usWatchlist: () => {},
      marketQuotes: () => {},
      valuationCoverage: () => {},
      valuation: renderValuation,
      insiderSales: renderInsiderSales,
      macro: renderMacro,
      events: renderEvents
    };

    entries.forEach(([key, source]) => {
      if (!Object.prototype.hasOwnProperty.call(state.data, key)) return;
      try {
        renderers[key](state.data[key]);
      } catch (error) {
        failureCount += 1;
        renderSectionError(key, source, error);
      }
    });
    updateSharedDates();
    refreshRouteMedia(state.routing.active, { refreshValuation: false });

    if (failureCount > 0) {
      const notice = byId('global-notice');
      notice.hidden = false;
      notice.textContent = `${failureCount} 个数据模块未能加载；其余内容仍可正常查看。`;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
}());
