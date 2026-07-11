(function initCapExUtils(global) {
  'use strict';

  const RISK_DEFINITIONS = Object.freeze({
    low: Object.freeze({
      key: 'low',
      canonical: 'low',
      label: '低风险',
      englishLabel: 'Low',
      className: 'risk-low',
      barClass: 'bar-low',
      diagnosticClass: 'diagnostic-low',
      color: 'green',
      priority: 1
    }),
    medium: Object.freeze({
      key: 'medium',
      canonical: 'medium',
      label: '中风险',
      englishLabel: 'Medium',
      className: 'risk-medium',
      barClass: 'bar-medium',
      diagnosticClass: 'diagnostic-medium',
      color: 'yellow',
      priority: 2
    }),
    high: Object.freeze({
      key: 'high',
      canonical: 'high',
      label: '高风险',
      englishLabel: 'High',
      className: 'risk-high',
      barClass: 'bar-high',
      diagnosticClass: 'diagnostic-high',
      color: 'orange',
      priority: 3
    }),
    critical: Object.freeze({
      key: 'critical',
      canonical: 'critical',
      label: '严重风险',
      englishLabel: 'Critical',
      className: 'risk-critical',
      barClass: 'bar-critical',
      diagnosticClass: 'diagnostic-critical',
      color: 'red',
      priority: 4
    }),
    unknown: Object.freeze({
      key: 'unknown',
      canonical: 'unknown',
      label: '待判断',
      englishLabel: 'Unknown',
      className: 'risk-unknown',
      barClass: 'bar-unknown',
      diagnosticClass: 'diagnostic-unknown',
      color: 'gray',
      priority: 0
    }),
    normal: Object.freeze({
      key: 'normal',
      canonical: 'low',
      label: '正常扩张',
      englishLabel: 'Normal expansion',
      className: 'risk-normal',
      barClass: 'bar-normal',
      diagnosticClass: 'diagnostic-low',
      color: 'green',
      priority: 1
    }),
    watch: Object.freeze({
      key: 'watch',
      canonical: 'medium',
      label: '扩张偏热',
      englishLabel: 'Watch',
      className: 'risk-watch',
      barClass: 'bar-watch',
      diagnosticClass: 'diagnostic-medium',
      color: 'yellow',
      priority: 2
    }),
    elevated: Object.freeze({
      key: 'elevated',
      canonical: 'high',
      label: '增长减速',
      englishLabel: 'Elevated',
      className: 'risk-elevated',
      barClass: 'bar-elevated',
      diagnosticClass: 'diagnostic-high',
      color: 'orange',
      priority: 3
    }),
    bear: Object.freeze({
      key: 'bear',
      canonical: 'critical',
      label: '熊市确认',
      englishLabel: 'Bear market confirmed',
      className: 'risk-bear',
      barClass: 'bar-bear',
      diagnosticClass: 'diagnostic-critical',
      color: 'red',
      priority: 5
    })
  });

  const RISK_ALIASES = Object.freeze({
    green: 'normal',
    yellow: 'watch',
    orange: 'elevated',
    red: 'critical',
    gray: 'unknown',
    grey: 'unknown'
  });

  const TREND_DEFINITIONS = Object.freeze({
    up: Object.freeze({ key: 'up', label: '上升', symbol: '↑', className: 'trend-up' }),
    down: Object.freeze({ key: 'down', label: '下降', symbol: '↓', className: 'trend-down' }),
    flat: Object.freeze({ key: 'flat', label: '持平', symbol: '→', className: 'trend-flat' }),
    improving: Object.freeze({ key: 'improving', label: '改善', symbol: '↗', className: 'trend-up' }),
    worsening: Object.freeze({ key: 'worsening', label: '恶化', symbol: '↘', className: 'trend-down' }),
    unknown: Object.freeze({ key: 'unknown', label: '待判断', symbol: '—', className: 'trend-flat' })
  });

  const TREND_ALIASES = Object.freeze({
    increase: 'up',
    increasing: 'up',
    rising: 'up',
    higher: 'up',
    decrease: 'down',
    decreasing: 'down',
    falling: 'down',
    lower: 'down',
    stable: 'flat',
    unchanged: 'flat',
    sideways: 'flat',
    same: 'flat',
    improve: 'improving',
    improved: 'improving',
    worsen: 'worsening',
    worsened: 'worsening'
  });

  function normalizeToken(value) {
    if (value && typeof value === 'object') {
      return normalizeToken(value.level || value.key || value.riskLevel);
    }

    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
      return null;
    }

    const numericValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function createLoadError(message, resource, label, cause, status) {
    const error = new Error(message);
    error.name = 'DataLoadError';
    error.resource = resource;
    error.resourceLabel = label;

    if (cause) {
      error.cause = cause;
    }

    if (Number.isFinite(status)) {
      error.status = status;
    }

    return error;
  }

  async function loadJSON(path, label) {
    const resource = typeof path === 'string' ? path.trim() : '';
    const resourceLabel = typeof label === 'string' && label.trim() ? label.trim() : '数据资源';

    if (!resource) {
      throw createLoadError('无法加载数据：资源路径为空。', resource, resourceLabel);
    }

    if (typeof global.fetch !== 'function') {
      throw createLoadError(
        `加载“${resourceLabel}”（${resource}）失败：当前环境不支持 Fetch API。`,
        resource,
        resourceLabel
      );
    }

    let response;

    try {
      response = await global.fetch(resource, {
        headers: { Accept: 'application/json' }
      });
    } catch (cause) {
      throw createLoadError(
        `加载“${resourceLabel}”（${resource}）失败：网络请求错误。`,
        resource,
        resourceLabel,
        cause
      );
    }

    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : '';
      throw createLoadError(
        `加载“${resourceLabel}”（${resource}）失败：HTTP ${response.status}${statusText}。`,
        resource,
        resourceLabel,
        null,
        response.status
      );
    }

    try {
      return await response.json();
    } catch (cause) {
      throw createLoadError(
        `加载“${resourceLabel}”（${resource}）失败：JSON 格式无效。`,
        resource,
        resourceLabel,
        cause,
        response.status
      );
    }
  }

  function formatDate(value) {
    if (value === null || value === undefined || value === '') {
      return '—';
    }

    let date;

    if (value instanceof Date) {
      date = new Date(value.getTime());
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      const [year, month, day] = value.trim().split('-').map(Number);
      date = new Date(year, month - 1, day);

      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        return '—';
      }
    } else {
      date = new Date(value);
    }

    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}年${month}月${day}日`;
  }

  function formatNumber(value, decimals, suffix) {
    const numericValue = toFiniteNumber(value);

    if (numericValue === null) {
      return '—';
    }

    const defaultDecimals = Number.isInteger(numericValue) ? 0 : 2;
    const fractionDigits = Number.isInteger(decimals)
      ? Math.min(Math.max(decimals, 0), 8)
      : defaultDecimals;
    const normalizedValue = Object.is(numericValue, -0) ? 0 : numericValue;
    const formatted = new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(normalizedValue);
    const formattedSuffix = suffix === null || suffix === undefined ? '' : String(suffix);

    return `${formatted}${formattedSuffix}`;
  }

  function escapeHTML(value) {
    return String(value === null || value === undefined ? '' : value).replace(
      /[&<>"']/g,
      (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]
    );
  }

  function getRiskMeta(level) {
    const token = normalizeToken(level);
    const resolvedToken = RISK_ALIASES[token] || token;
    return RISK_DEFINITIONS[resolvedToken] || RISK_DEFINITIONS.unknown;
  }

  function riskPriority(level) {
    return getRiskMeta(level).priority;
  }

  function getTrendMeta(direction) {
    const token = normalizeToken(direction);
    const resolvedToken = TREND_ALIASES[token] || token;
    return TREND_DEFINITIONS[resolvedToken] || TREND_DEFINITIONS.unknown;
  }

  function resolveContainer(containerOrId) {
    const documentRef = global.document;

    if (!documentRef) {
      return null;
    }

    if (containerOrId && containerOrId.nodeType === 1) {
      return containerOrId;
    }

    if (typeof containerOrId !== 'string' || !containerOrId.trim()) {
      return null;
    }

    const reference = containerOrId.trim();
    const id = reference.startsWith('#') ? reference.slice(1) : reference;
    const byId = documentRef.getElementById(id);

    if (byId) {
      return byId;
    }

    try {
      return documentRef.querySelector(reference);
    } catch (error) {
      return null;
    }
  }

  function appendErrorCopy(parent, detail) {
    const documentRef = global.document;
    const copy = documentRef.createElement('div');
    const title = documentRef.createElement('strong');
    const description = documentRef.createElement('p');

    title.textContent = '该分区暂时无法显示';
    description.textContent = detail;
    copy.append(title, description);
    parent.append(copy);
  }

  function renderSectionError(containerOrId, message) {
    const container = resolveContainer(containerOrId);
    const isError = message instanceof Error;
    const detail = isError
      ? message.message
      : String(message || '数据加载失败，请稍后刷新页面重试。');

    if (isError && global.console && typeof global.console.error === 'function') {
      global.console.error('[AI CapEx Cycle Monitor] 分区数据加载失败：', message);
    }

    if (!container || !global.document) {
      if (global.console && typeof global.console.error === 'function') {
        global.console.error('[AI CapEx Cycle Monitor] 找不到用于显示错误信息的容器。');
      }
      return null;
    }

    if (container.tagName === 'TBODY') {
      const row = global.document.createElement('tr');
      const cell = global.document.createElement('td');
      const columnCount = container.closest('table')?.querySelectorAll('thead th').length || 1;

      cell.colSpan = columnCount;
      cell.className = 'table-empty';
      cell.setAttribute('role', 'alert');
      appendErrorCopy(cell, detail);
      row.append(cell);
      container.replaceChildren(row);
      return cell;
    }

    const errorState = global.document.createElement('div');
    errorState.className = 'loading-block section-error';
    errorState.setAttribute('role', 'alert');
    appendErrorCopy(errorState, detail);
    container.replaceChildren(errorState);
    return errorState;
  }

  global.CapExUtils = Object.freeze({
    loadJSON,
    formatDate,
    formatNumber,
    escapeHTML,
    getRiskMeta,
    getTrendMeta,
    renderSectionError,
    riskPriority
  });
})(window);
