'use strict';

(function () {
  const DATA_SOURCES = {
    risk: { path: './data/risk-score.json', label: '风险评分' },
    hyperscalers: { path: './data/hyperscalers.json', label: '云巨头 CapEx' },
    supplyChain: { path: './data/supply-chain.json', label: '供应链风险' },
    valuation: { path: './data/valuation-bands.json', label: '价格与估值观察' },
    macro: { path: './data/macro.json', label: '宏观环境' },
    events: { path: './data/events.json', label: '重大事件' }
  };
  const DEFAULT_ROUTE = 'overview';
  const BASE_TITLE = 'AI CapEx Cycle Monitor';
  const ROUTES = Object.freeze({
    overview: { label: '周期总览', titleId: 'overview-title' },
    hyperscalers: { label: '云巨头 CapEx', titleId: 'hyperscalers-title' },
    'supply-chain': { label: '供应链风险与估值', titleId: 'supply-chain-title' },
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
  const tradingViewSymbolPattern = /^(?:NASDAQ|NYSE):[A-Z][A-Z0-9.-]{0,9}$/;
  const confidenceLabels = Object.freeze({
    high: '高',
    medium: '中',
    low: '低',
    not_assessed: '待评估',
    unknown: '待评估'
  });

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
        if (route === 'hyperscalers') {
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

  function normalizeValuationRange(range) {
    if (!range || typeof range !== 'object') return null;
    const low = toFiniteNumber(range.low);
    const high = toFiniteNumber(range.high);
    if (low === null || high === null || low <= 0 || high < low) return null;
    return { low, high };
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

  function formatValuationRange(range, currency) {
    const normalized = normalizeValuationRange(range);
    if (!normalized) {
      return { isValid: false, text: '待建立' };
    }
    return {
      isValid: true,
      text: `${formatCurrencyAmount(normalized.low, currency)} – ${formatCurrencyAmount(normalized.high, currency)}`
    };
  }

  function valuationConfidence(value) {
    const key = textValue(value, 'unknown').toLowerCase();
    return confidenceLabels[key] || confidenceLabels.unknown;
  }

  function getValuationCompanies(data) {
    const companies = data && Array.isArray(data.companies) ? data.companies : [];
    const uniqueCompanies = new Map();

    companies.forEach((company) => {
      if (!company || typeof company !== 'object') return;
      const ticker = textValue(company.ticker, '');
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || uniqueCompanies.has(ticker)) return;
      uniqueCompanies.set(ticker, company);
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
    const observationRange = formatValuationRange(company.observationRange, currency);
    const fairValueRange = formatValuationRange(company.fairValueRange, currency);
    const confidence = valuationConfidence(company.confidence);
    const valuationBasis = textValue(company.valuationBasis, '暂未提供估值框架说明。');
    const riskNote = textValue(company.riskNote, '暂未提供单独风险提示。');
    const source = textValue(company.source, '演示研究参数');
    const updatedAt = formatDate(company.updatedAt || data.updatedAt);
    const reviewStatus = ['demo', 'reviewed', 'needs-review'].includes(company.reviewStatus)
      ? company.reviewStatus
      : 'demo';
    const reviewMeta = {
      demo: { label: '演示区间 · 待验证', className: 'is-demo' },
      reviewed: { label: '已完成估值复核', className: 'is-reviewed' },
      'needs-review': { label: '发现新披露 · 需复核', className: 'is-review' }
    }[reviewStatus];
    const reviewReason = textValue(
      company.reviewReason,
      reviewStatus === 'needs-review'
        ? '系统发现新的公司披露，当前区间仅保留作历史研究参考。'
        : '当前为演示研究区间；自动巡检不会机械生成公允价值或买卖建议。'
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
    const automationSummary = `${textValue(automation.dailySchedule, '每天自动巡检')} · 最近巡检：${lastDailyCheck}`;
    const assumptions = Array.isArray(company.assumptions)
      ? company.assumptions.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : [];
    const assumptionItems = assumptions.length
      ? assumptions.map((item) => `<li>${escapeHTML(item)}</li>`).join('')
      : '<li>暂未提供关键假设明细。</li>';
    const observationContext = observationRange.isValid
      ? reviewStatus === 'needs-review'
        ? '新披露后尚未重估；当前区间仅作历史研究参考。'
        : '演示研究参数；仅用于触发进一步复核，不是买入建议。'
      : '缺少有效上下限，暂不展示区间。';
    const summary = byId('valuation-summary');

    if (!summary) {
      throw new Error('找不到估值观察摘要容器。');
    }

    summary.innerHTML = `
      <div class="valuation-summary-head">
        <div>
          <span class="valuation-company-segment">${escapeHTML(segment)}</span>
          <h3 class="valuation-company-name">${escapeHTML(name)}</h3>
        </div>
        <span class="valuation-symbol">${escapeHTML(ticker)}</span>
      </div>
      <div class="valuation-range-panel">
        <span class="valuation-range-label">研究观察区间</span>
        <strong class="valuation-range-value">${escapeHTML(observationRange.text)}</strong>
        <span class="valuation-range-context">${escapeHTML(observationContext)}</span>
      </div>
      <div class="valuation-review-status ${escapeHTML(reviewMeta.className)}">
        <strong>${escapeHTML(reviewMeta.label)}</strong>
        <span>${escapeHTML(reviewReason)}</span>
        ${filingLink}
      </div>
      <div class="valuation-detail-grid">
        <div class="valuation-detail">
          <span>演示公允价值区间</span>
          <strong>${escapeHTML(fairValueRange.text)}</strong>
        </div>
        <div class="valuation-detail">
          <span>研究置信度</span>
          <strong>${escapeHTML(confidence)}</strong>
        </div>
        <div class="valuation-detail">
          <span>产业链环节</span>
          <strong>${escapeHTML(segment)}</strong>
        </div>
        <div class="valuation-detail">
          <span>计价币种</span>
          <strong>${escapeHTML(currency)}</strong>
        </div>
      </div>
      <p class="valuation-basis"><strong>估值框架</strong>${escapeHTML(valuationBasis)}</p>
      <div class="valuation-assumptions">
        <strong>关键假设</strong>
        <ul>${assumptionItems}</ul>
      </div>
      <p class="valuation-risk-note"><strong>主要风险</strong>${escapeHTML(riskNote)}</p>
      <p class="valuation-meta-line">数据更新：${escapeHTML(updatedAt)} · 来源：${escapeHTML(source)}</p>
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
      status.textContent = `已显示 ${name}（${ticker}）的估值观察参数。${chartStatus}`;
    }
  }

  function renderValuation(data) {
    const companies = getValuationCompanies(data);
    const select = byId('valuation-company-select');
    if (!select || !companies.length) {
      throw new Error('价格与估值观察缺少有效公司数据。');
    }

    state.data.valuation = data;
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
      byId('supply-chain-body').innerHTML = '<tr><td colspan="11" class="table-empty">当前筛选条件下没有公司，请调整筛选器。</td></tr>';
      return;
    }

    byId('supply-chain-body').innerHTML = rows.map((company) => `
      <tr>
        <td><span class="ticker">${escapeHTML(company.ticker)}</span></td>
        <td><span class="company-cell"><strong>${escapeHTML(company.name)}</strong></span></td>
        <td>${escapeHTML(company.segment)}</td>
        <td><span class="${trendClass(company.revenueTrend)}">${escapeHTML(company.revenueTrend)}</span></td>
        <td><span class="${trendClass(company.grossMarginTrend)}">${escapeHTML(company.grossMarginTrend)}</span></td>
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
    } else if (key === 'supplyChain') {
      byId('supply-chain-body').innerHTML = `<tr><td colspan="11" class="table-empty">${escapeHTML(message)}</td></tr>`;
      api.renderSectionError('supply-chain-heatmap', message);
    } else if (key === 'valuation') {
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
          state.supply.sortDirection = ['overallRisk', 'inventoryRisk', 'receivablesRisk', 'debtRisk', 'customerConcentration', 'updatedAt'].includes(key) ? 'desc' : 'asc';
        }
        renderSupplyTable();
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
      supplyChain: renderSupplyChain,
      valuation: renderValuation,
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
