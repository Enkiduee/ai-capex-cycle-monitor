'use strict';

(function () {
  const DATA_SOURCES = {
    risk: { path: './data/risk-score.json', label: '风险评分' },
    hyperscalers: { path: './data/hyperscalers.json', label: '云巨头 CapEx' },
    supplyChain: { path: './data/supply-chain.json', label: '供应链风险' },
    macro: { path: './data/macro.json', label: '宏观环境' },
    events: { path: './data/events.json', label: '重大事件' }
  };

  const state = {
    data: {},
    supply: {
      segment: 'all',
      risk: 'all',
      sortKey: 'overallRisk',
      sortDirection: 'desc'
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

  function byId(id) {
    return document.getElementById(id);
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
          <h4>${escapeHTML(segment.name)}</h4>
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
            <h3>${escapeHTML(indicator.name)}</h3>
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
          <h4>${quadrant.isCurrent ? '当前所处象限' : '情景路径'} ${current}</h4>
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
            <h3>${escapeHTML(event.title)}</h3>
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
    } else if (key === 'macro') {
      api.renderSectionError('macro-metrics', message);
      byId('macro-regime-summary').textContent = message;
    } else if (key === 'events') {
      api.renderSectionError('event-timeline', message);
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
