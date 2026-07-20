'use strict';

(function (global) {
  const CAPEX_CONTAINER_ID = 'capex-chart';
  const CAPEX_CONTROLS_ID = 'capex-series-controls';
  const GROWTH_CONTAINER_ID = 'growth-chart';
  const MIN_QUARTERS = 8;
  const RESIZE_DEBOUNCE_MS = 160;

  const COLORS = Object.freeze({
    accent: '#69d7df',
    accentStrong: '#9ce8ed',
    green: '#5bd39a',
    yellow: '#f2c75c',
    orange: '#f59b55',
    red: '#f26f76',
    purple: '#a991f7',
    surface: '#101923',
    border: '#344558',
    grid: '#263342',
    text: '#f2f6f8',
    textSecondary: '#a8b5c2',
    textMuted: '#738292'
  });

  const FONT_FAMILY = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  const MONO_FONT_FAMILY = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
  const CAPEX_COLORS = [COLORS.accent, COLORS.yellow, COLORS.red, COLORS.green, COLORS.purple];

  let capexChart = null;
  let growthChart = null;
  let resizeTimer = null;

  function getContainer(id) {
    if (!global.document || typeof global.document.getElementById !== 'function') {
      return null;
    }

    return global.document.getElementById(id);
  }

  function safeLabel(value, fallback) {
    if (typeof value !== 'string') {
      return fallback;
    }

    const label = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return label || fallback;
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function getUnit(data, key, fallback) {
    if (!data || !data.units || typeof data.units !== 'object') {
      return fallback;
    }

    return safeLabel(data.units[key], fallback);
  }

  function getQuarters(data) {
    if (!data || !Array.isArray(data.quarters) || data.quarters.length < MIN_QUARTERS) {
      return null;
    }

    const quarters = data.quarters.map(function (quarter, index) {
      return safeLabel(quarter, '季度 ' + String(index + 1));
    });

    return quarters.every(Boolean) ? quarters : null;
  }

  function showPlaceholder(container, message) {
    if (!container || !global.document) {
      return;
    }

    container.textContent = '';
    container.setAttribute('aria-busy', 'false');

    const placeholder = global.document.createElement('div');
    placeholder.className = 'chart-placeholder';
    placeholder.textContent = message;
    container.appendChild(placeholder);
  }

  function hasECharts() {
    return Boolean(global.echarts && typeof global.echarts.init === 'function');
  }

  function safelyDispose(chart) {
    if (!chart || typeof chart.dispose !== 'function') {
      return;
    }

    try {
      if (typeof chart.isDisposed !== 'function' || !chart.isDisposed()) {
        chart.dispose();
      }
    } catch (error) {
      // Disposal is best-effort so a stale instance never blocks a fresh render.
    }
  }

  function disposeContainerChart(container, trackedChart) {
    safelyDispose(trackedChart);

    if (!container || !hasECharts() || typeof global.echarts.getInstanceByDom !== 'function') {
      return;
    }

    try {
      const attachedChart = global.echarts.getInstanceByDom(container);
      if (attachedChart && attachedChart !== trackedChart) {
        safelyDispose(attachedChart);
      }
    } catch (error) {
      // An unavailable or already-detached instance is safe to ignore.
    }
  }

  function resetCapexChart(container) {
    disposeContainerChart(container, capexChart);
    capexChart = null;
  }

  function resetGrowthChart(container) {
    disposeContainerChart(container, growthChart);
    growthChart = null;
  }

  function formatDecimal(value) {
    const number = toFiniteNumber(value);
    return number === null ? '—' : number.toFixed(1);
  }

  function formatAxisNumber(value) {
    const number = toFiniteNumber(value);
    if (number === null) {
      return '';
    }

    return Math.abs(number) >= 10 ? number.toFixed(0) : number.toFixed(1);
  }

  function getAxisValue(parameter) {
    if (!parameter) {
      return null;
    }

    if (Array.isArray(parameter.value)) {
      return parameter.value[parameter.value.length - 1];
    }

    return parameter.value;
  }

  function commonTooltip(formatter) {
    return {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      backgroundColor: COLORS.surface,
      borderColor: COLORS.border,
      borderWidth: 1,
      padding: [10, 12],
      textStyle: {
        color: COLORS.text,
        fontFamily: FONT_FAMILY,
        fontSize: 12,
        lineHeight: 20
      },
      axisPointer: {
        type: 'line',
        snap: true,
        lineStyle: {
          color: COLORS.accent,
          type: 'dashed',
          width: 1
        }
      },
      formatter: formatter
    };
  }

  function commonLegend() {
    return {
      type: 'scroll',
      top: 6,
      left: 'center',
      selectedMode: 'multiple',
      itemWidth: 18,
      itemHeight: 8,
      itemGap: 20,
      icon: 'roundRect',
      pageIconColor: COLORS.accent,
      pageIconInactiveColor: COLORS.textMuted,
      pageTextStyle: {
        color: COLORS.textMuted,
        fontFamily: MONO_FONT_FAMILY,
        fontSize: 10
      },
      textStyle: {
        color: COLORS.textSecondary,
        fontFamily: FONT_FAMILY,
        fontSize: 11
      }
    };
  }

  function commonCategoryAxis(quarters) {
    return {
      type: 'category',
      boundaryGap: false,
      data: quarters,
      axisLine: {
        lineStyle: {
          color: COLORS.border
        }
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: COLORS.textMuted,
        fontFamily: MONO_FONT_FAMILY,
        fontSize: 10,
        interval: 0,
        hideOverlap: true,
        margin: 13
      }
    };
  }

  function commonValueAxis(name) {
    return {
      type: 'value',
      name: name,
      nameLocation: 'end',
      nameGap: 16,
      nameTextStyle: {
        color: COLORS.textMuted,
        fontFamily: FONT_FAMILY,
        fontSize: 10,
        align: 'right'
      },
      axisLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: COLORS.textMuted,
        fontFamily: MONO_FONT_FAMILY,
        fontSize: 10,
        formatter: formatAxisNumber
      },
      splitLine: {
        lineStyle: {
          color: COLORS.grid,
          type: 'dashed',
          width: 1
        }
      }
    };
  }

  function commonSeriesStyle(color) {
    return {
      type: 'line',
      smooth: false,
      showSymbol: false,
      symbol: 'circle',
      symbolSize: 7,
      connectNulls: false,
      lineStyle: {
        color: color,
        width: 2
      },
      itemStyle: {
        color: color,
        borderColor: COLORS.surface,
        borderWidth: 2
      },
      emphasis: {
        focus: 'series',
        lineStyle: {
          width: 3
        },
        itemStyle: {
          borderColor: COLORS.text,
          borderWidth: 2
        }
      }
    };
  }

  function responsiveMedia() {
    return [
      {
        query: {
          maxWidth: 720
        },
        option: {
          legend: {
            top: 2,
            left: 4,
            right: 4,
            itemWidth: 14,
            itemHeight: 7,
            itemGap: 12,
            textStyle: {
              fontSize: 10
            }
          },
          grid: {
            top: 62,
            right: 12,
            bottom: 64,
            left: 46,
            containLabel: false
          },
          xAxis: {
            axisLabel: {
              interval: 0,
              rotate: 42,
              fontSize: 9,
              margin: 12,
              hideOverlap: false
            }
          },
          yAxis: {
            name: '',
            axisLabel: {
              fontSize: 9
            }
          }
        }
      },
      {
        query: {
          maxWidth: 420
        },
        option: {
          legend: {
            itemWidth: 12,
            itemGap: 9,
            textStyle: {
              fontSize: 9
            }
          },
          grid: {
            top: 58,
            right: 8,
            bottom: 66,
            left: 42
          },
          xAxis: {
            axisLabel: {
              rotate: 50,
              fontSize: 8
            }
          }
        }
      }
    ];
  }

  function buildCapexModel(data, quarters) {
    if (!Array.isArray(data.companies)) {
      return null;
    }

    const companies = data.companies.reduce(function (result, company, index) {
      if (!company || !Array.isArray(company.capex) || company.capex.length < quarters.length) {
        return result;
      }

      const values = company.capex.slice(0, quarters.length).map(toFiniteNumber);
      const validPointCount = values.filter(function (value) {
        return value !== null;
      }).length;

      if (validPointCount < MIN_QUARTERS) {
        return result;
      }

      result.push({
        name: safeLabel(company.name, '公司 ' + String(index + 1)),
        values: values
      });
      return result;
    }, []);

    return companies.length ? companies : null;
  }

  function buildCapexOption(data, quarters, companies) {
    const unit = getUnit(data, 'capex', '亿美元');
    const series = companies.map(function (company, index) {
      return Object.assign(commonSeriesStyle(CAPEX_COLORS[index % CAPEX_COLORS.length]), {
        name: company.name,
        data: company.values
      });
    });

    return {
      baseOption: {
        backgroundColor: 'transparent',
        color: CAPEX_COLORS,
        animationDuration: 420,
        animationEasing: 'cubicOut',
        textStyle: {
          color: COLORS.text,
          fontFamily: FONT_FAMILY
        },
        aria: {
          enabled: true,
          decal: {
            show: false
          }
        },
        tooltip: commonTooltip(function (parameters) {
          const items = Array.isArray(parameters) ? parameters : [parameters];
          const quarter = items.length ? safeLabel(items[0].axisValueLabel || items[0].name, '季度') : '季度';
          const lines = ['季度：' + quarter];

          items.forEach(function (item) {
            lines.push('● ' + safeLabel(item.seriesName, '系列') + '：' + formatDecimal(getAxisValue(item)) + ' ' + unit);
          });

          return lines.join('\n');
        }),
        legend: commonLegend(),
        grid: {
          top: 62,
          right: 24,
          bottom: 40,
          left: 62,
          containLabel: true
        },
        xAxis: commonCategoryAxis(quarters),
        yAxis: Object.assign(commonValueAxis(unit), {
          min: 0,
          scale: false
        }),
        series: series
      },
      media: responsiveMedia()
    };
  }

  function buildGrowthModel(data, quarters) {
    if (!Array.isArray(data.totalCapexGrowth) || !Array.isArray(data.cloudRevenueGrowth)) {
      return null;
    }

    if (data.totalCapexGrowth.length < quarters.length || data.cloudRevenueGrowth.length < quarters.length) {
      return null;
    }

    const capexGrowth = data.totalCapexGrowth.slice(0, quarters.length).map(toFiniteNumber);
    const revenueGrowth = data.cloudRevenueGrowth.slice(0, quarters.length).map(toFiniteNumber);
    const validCapexPoints = capexGrowth.filter(function (value) {
      return value !== null;
    }).length;
    const validRevenuePoints = revenueGrowth.filter(function (value) {
      return value !== null;
    }).length;

    if (validCapexPoints < MIN_QUARTERS || validRevenuePoints < MIN_QUARTERS) {
      return null;
    }

    return {
      capexGrowth: capexGrowth,
      revenueGrowth: revenueGrowth
    };
  }

  function getGrowthBounds(model) {
    const values = model.capexGrowth.concat(model.revenueGrowth).filter(function (value) {
      return value !== null;
    });
    const observedMin = Math.min.apply(null, values);
    const observedMax = Math.max.apply(null, values);
    const spread = Math.max(observedMax - observedMin, Math.abs(observedMax) * 0.2, 10);
    const padding = Math.max(spread * 0.12, 2);
    const axisMin = Math.min(0, Math.floor((observedMin - padding) / 5) * 5);
    let axisMax = Math.max(0, Math.ceil((observedMax + padding) / 5) * 5);

    if (axisMax <= axisMin) {
      axisMax = axisMin + 10;
    }

    return {
      min: axisMin,
      max: axisMax
    };
  }

  function buildGrowthOption(data, quarters, model) {
    const unit = getUnit(data, 'growth', '%');
    const bounds = getGrowthBounds(model);
    const capexSeries = Object.assign(commonSeriesStyle(COLORS.accent), {
      name: 'CapEx 同比增速',
      data: model.capexGrowth,
      markLine: {
        silent: true,
        symbol: ['none', 'none'],
        label: {
          show: true,
          position: 'insideEndTop',
          formatter: '0% 基准',
          color: COLORS.textMuted,
          fontFamily: MONO_FONT_FAMILY,
          fontSize: 9
        },
        lineStyle: {
          color: COLORS.textMuted,
          type: 'solid',
          width: 1,
          opacity: 0.8
        },
        data: [
          {
            yAxis: 0
          }
        ]
      }
    });
    const revenueSeries = Object.assign(commonSeriesStyle(COLORS.orange), {
      name: '云业务收入同比增速',
      data: model.revenueGrowth
    });

    return {
      baseOption: {
        backgroundColor: 'transparent',
        color: [COLORS.accent, COLORS.orange],
        animationDuration: 420,
        animationEasing: 'cubicOut',
        textStyle: {
          color: COLORS.text,
          fontFamily: FONT_FAMILY
        },
        aria: {
          enabled: true,
          decal: {
            show: false
          }
        },
        tooltip: commonTooltip(function (parameters) {
          const items = Array.isArray(parameters) ? parameters : [parameters];
          const quarter = items.length ? safeLabel(items[0].axisValueLabel || items[0].name, '季度') : '季度';
          const lines = ['季度：' + quarter];

          items.forEach(function (item) {
            lines.push('● ' + safeLabel(item.seriesName, '系列') + '：' + formatDecimal(getAxisValue(item)) + unit);
          });

          if (items.length >= 2) {
            const firstValue = toFiniteNumber(getAxisValue(items[0]));
            const secondValue = toFiniteNumber(getAxisValue(items[1]));
            if (firstValue !== null && secondValue !== null) {
              lines.push('投入－收入增速差：' + (firstValue - secondValue).toFixed(1) + ' 个百分点');
            }
          }

          return lines.join('\n');
        }),
        legend: commonLegend(),
        grid: {
          top: 62,
          right: 24,
          bottom: 40,
          left: 62,
          containLabel: true
        },
        xAxis: commonCategoryAxis(quarters),
        yAxis: Object.assign(commonValueAxis('同比增速（' + unit + '）'), {
          min: bounds.min,
          max: bounds.max,
          splitNumber: 5,
          axisLabel: Object.assign({}, commonValueAxis('').axisLabel, {
            formatter: function (value) {
              return formatAxisNumber(value) + unit;
            }
          })
        }),
        series: [capexSeries, revenueSeries]
      },
      media: responsiveMedia()
    };
  }

  function createChart(container, option) {
    container.textContent = '';
    container.setAttribute('aria-busy', 'false');

    const chart = global.echarts.init(container, null, {
      renderer: 'canvas',
      useDirtyRect: false
    });
    chart.setOption(option, {
      notMerge: true,
      lazyUpdate: false
    });
    return chart;
  }

  function initCapexChart(data) {
    const container = getContainer(CAPEX_CONTAINER_ID);
    if (!container) {
      return null;
    }

    resetCapexChart(container);

    if (!hasECharts()) {
      showPlaceholder(container, '图表组件加载失败，请检查网络连接后刷新页面。');
      return null;
    }

    const quarters = getQuarters(data);
    const companies = quarters ? buildCapexModel(data, quarters) : null;
    if (!quarters || !companies) {
      showPlaceholder(container, '资本开支数据暂不可用（至少需要 8 个季度的有效数据）。');
      return null;
    }

    try {
      capexChart = createChart(container, buildCapexOption(data, quarters, companies));
      if (typeof capexChart.on === 'function') {
        capexChart.on('legendselectchanged', function (event) {
          syncSeriesControls(event && event.selected);
        });
      }
      return capexChart;
    } catch (error) {
      resetCapexChart(container);
      showPlaceholder(container, '资本开支图表暂时无法绘制，请稍后刷新重试。');
      return null;
    }
  }

  function syncSeriesControls(selected) {
    if (!selected || typeof selected !== 'object') {
      return;
    }

    const controls = getContainer(CAPEX_CONTROLS_ID);
    if (!controls || typeof controls.querySelectorAll !== 'function') {
      return;
    }

    controls.querySelectorAll('[data-series]').forEach(function (button) {
      const seriesName = button.dataset.series;
      if (Object.prototype.hasOwnProperty.call(selected, seriesName)) {
        button.setAttribute('aria-pressed', String(Boolean(selected[seriesName])));
      }
    });
  }

  function setCapexSeriesVisible(seriesName, visible) {
    if (!capexChart || typeof capexChart.dispatchAction !== 'function' || typeof seriesName !== 'string') {
      return false;
    }

    try {
      capexChart.dispatchAction({
        type: visible ? 'legendSelect' : 'legendUnSelect',
        name: seriesName
      });
      syncSeriesControls({ [seriesName]: Boolean(visible) });
      return true;
    } catch (error) {
      return false;
    }
  }

  function initGrowthChart(data) {
    const container = getContainer(GROWTH_CONTAINER_ID);
    if (!container) {
      return null;
    }

    resetGrowthChart(container);

    if (!hasECharts()) {
      showPlaceholder(container, '图表组件加载失败，请检查网络连接后刷新页面。');
      return null;
    }

    const quarters = getQuarters(data);
    const model = quarters ? buildGrowthModel(data, quarters) : null;
    if (!quarters || !model) {
      showPlaceholder(container, '增速数据暂不可用（至少需要 8 个季度的有效数据）。');
      return null;
    }

    try {
      growthChart = createChart(container, buildGrowthOption(data, quarters, model));
      return growthChart;
    } catch (error) {
      resetGrowthChart(container);
      showPlaceholder(container, '增速对比图暂时无法绘制，请稍后刷新重试。');
      return null;
    }
  }

  function resizeChart(chart) {
    if (!chart || typeof chart.resize !== 'function') {
      return;
    }

    try {
      if (typeof chart.isDisposed !== 'function' || !chart.isDisposed()) {
        chart.resize();
      }
    } catch (error) {
      // A chart removed from the DOM should not break the rest of the dashboard.
    }
  }

  function resizeAll() {
    resizeChart(capexChart);
    resizeChart(growthChart);
  }

  function disposeAll() {
    resetCapexChart(getContainer(CAPEX_CONTAINER_ID));
    resetGrowthChart(getContainer(GROWTH_CONTAINER_ID));

    if (resizeTimer !== null) {
      global.clearTimeout(resizeTimer);
      resizeTimer = null;
    }
  }

  function handleWindowResize() {
    if (resizeTimer !== null) {
      global.clearTimeout(resizeTimer);
    }

    resizeTimer = global.setTimeout(function () {
      resizeTimer = null;
      resizeAll();
    }, RESIZE_DEBOUNCE_MS);
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('resize', handleWindowResize, { passive: true });
  }

  global.CapExCharts = {
    initCapexChart: initCapexChart,
    initGrowthChart: initGrowthChart,
    setCapexSeriesVisible: setCapexSeriesVisible,
    resizeAll: resizeAll,
    disposeAll: disposeAll
  };
}(window));
