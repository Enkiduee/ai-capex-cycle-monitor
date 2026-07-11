(function initCapExScoring(global) {
  'use strict';

  const EXPECTED_COMPONENT_COUNT = 5;
  const EXPECTED_COMPONENT_IDS = Object.freeze([
    'capexMomentum',
    'aiRevenueRealization',
    'supplyChainRisk',
    'neocloudCreditRisk',
    'macroRisk'
  ]);

  const SCORE_BANDS = Object.freeze([
    Object.freeze({ min: 0, max: 24, level: 'normal', riskLevel: 'low', label: '正常扩张' }),
    Object.freeze({ min: 25, max: 49, level: 'watch', riskLevel: 'medium', label: '扩张偏热' }),
    Object.freeze({ min: 50, max: 69, level: 'elevated', riskLevel: 'high', label: '增长减速' }),
    Object.freeze({ min: 70, max: 84, level: 'critical', riskLevel: 'critical', label: '高风险' }),
    Object.freeze({ min: 85, max: 100, level: 'bear', riskLevel: 'critical', label: '熊市确认' })
  ]);

  const UNKNOWN_SCORE_BAND = Object.freeze({
    min: null,
    max: null,
    level: 'unknown',
    riskLevel: 'unknown',
    label: '待判断'
  });

  function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
      return null;
    }

    const numericValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function roundTo(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function calculateWeightedScore(components) {
    if (!Array.isArray(components)) {
      throw new TypeError('风险分项必须是数组。');
    }

    if (components.length !== EXPECTED_COMPONENT_COUNT) {
      throw new RangeError(`风险评分需要恰好 ${EXPECTED_COMPONENT_COUNT} 个分项，当前收到 ${components.length} 个。`);
    }

    const seenIds = new Set();
    const validatedComponents = components.map((component, index) => {
      if (!component || typeof component !== 'object' || Array.isArray(component)) {
        throw new TypeError(`第 ${index + 1} 个风险分项不是有效对象。`);
      }

      const id = typeof component.id === 'string' ? component.id.trim() : '';
      const score = toFiniteNumber(component.score);
      const weight = toFiniteNumber(component.weight);

      if (!id) {
        throw new TypeError(`第 ${index + 1} 个风险分项缺少 id。`);
      }

      if (seenIds.has(id)) {
        throw new RangeError(`风险分项 id 重复：${id}。`);
      }
      seenIds.add(id);

      if (score === null || score < 0 || score > 100) {
        throw new RangeError(`风险分项“${id}”的 score 必须是 0–100 之间的有限数值。`);
      }

      if (weight === null || weight <= 0 || weight > 1) {
        throw new RangeError(`风险分项“${id}”的 weight 必须是大于 0 且不超过 1 的有限数值。`);
      }

      return {
        id,
        name: typeof component.name === 'string' ? component.name : id,
        score,
        weight
      };
    });

    const totalWeight = validatedComponents.reduce((total, component) => total + component.weight, 0);

    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      throw new RangeError('风险分项权重总和必须大于 0。');
    }

    const weightedSum = validatedComponents.reduce(
      (total, component) => total + component.score * component.weight,
      0
    );
    const rawScore = weightedSum / totalWeight;
    const roundedScore = Math.round(rawScore);
    const contributions = validatedComponents.map((component) => {
      const normalizedWeight = component.weight / totalWeight;
      return {
        ...component,
        normalizedWeight: roundTo(normalizedWeight, 6),
        weightedValue: roundTo(component.score * component.weight, 4),
        contribution: roundTo(component.score * normalizedWeight, 4)
      };
    });

    return {
      raw: roundTo(rawScore, 4),
      score: roundedScore,
      weight: roundTo(totalWeight, 6),
      weightedSum: roundTo(weightedSum, 4),
      normalized: Math.abs(totalWeight - 1) > 0.000001,
      contributions
    };
  }

  function scoreToRisk(score) {
    const numericScore = toFiniteNumber(score);
    const isValidScore = numericScore !== null && numericScore >= 0 && numericScore <= 100;
    const band = isValidScore
      ? SCORE_BANDS.find((candidate) => numericScore >= candidate.min && numericScore < candidate.max + 1)
      : UNKNOWN_SCORE_BAND;
    const resolvedBand = band || UNKNOWN_SCORE_BAND;
    const riskMeta = global.CapExUtils?.getRiskMeta(resolvedBand.level);

    return {
      score: isValidScore ? numericScore : null,
      min: resolvedBand.min,
      max: resolvedBand.max,
      key: resolvedBand.level,
      level: resolvedBand.level,
      riskLevel: resolvedBand.riskLevel,
      label: resolvedBand.label,
      className: riskMeta?.className || `risk-${resolvedBand.level}`,
      barClass: riskMeta?.barClass || `bar-${resolvedBand.level}`,
      priority: riskMeta?.priority || 0
    };
  }

  function compareManualScore(manual, calculated) {
    const manualScore = toFiniteNumber(manual);
    const calculatedScore = toFiniteNumber(
      calculated && typeof calculated === 'object' ? calculated.score : calculated
    );

    if (manualScore === null || calculatedScore === null) {
      const result = {
        available: false,
        consistent: null,
        manual: manualScore,
        calculated: calculatedScore,
        manualScore,
        calculatedScore,
        difference: null
      };

      global.console?.info(
        '[AI CapEx Cycle Monitor] manualScore 或分项计算结果缺失，已跳过一致性比较。'
      );
      return result;
    }

    const difference = roundTo(manualScore - calculatedScore, 4);
    const consistent = Math.abs(difference) < 0.5;
    const result = {
      available: true,
      consistent,
      manual: manualScore,
      calculated: calculatedScore,
      manualScore,
      calculatedScore,
      difference
    };

    if (consistent) {
      global.console?.info(
        `[AI CapEx Cycle Monitor] manualScore 与五项加权结果一致：${manualScore} / ${calculatedScore}。`
      );
    } else {
      global.console?.warn(
        `[AI CapEx Cycle Monitor] manualScore（${manualScore}）与五项加权结果（${calculatedScore}）不一致，差值为 ${difference}。页面将采用分项计算结果。`
      );
    }

    return result;
  }

  function buildGrowthDiagnosis(level, details) {
    const definitions = {
      critical: {
        riskLevel: 'critical',
        title: '高风险：投入与收入连续脱节',
        message: 'CapEx 增速已连续两个季度高于云收入增速超过 30 个百分点，需要重点关注资本效率与订单持续性。',
        className: 'diagnostic-critical',
        icon: '!'
      },
      elevated: {
        riskLevel: 'high',
        title: '风险上升：投入增速明显领先',
        message: '最新季度 CapEx 增速高于云收入增速超过 20 个百分点，投资兑现节奏需要关注。',
        className: 'diagnostic-high',
        icon: '△'
      },
      low: {
        riskLevel: 'low',
        title: '投入与收入差距可控',
        message: '最新季度 CapEx 与云收入增速差未触发预警阈值，当前投入兑现关系仍属可控。',
        className: 'diagnostic-low',
        icon: '✓'
      },
      unknown: {
        riskLevel: 'unknown',
        title: '增速诊断数据不足',
        message: details.reason || '缺少可比的 CapEx 或云收入增速数据，暂时无法判断。',
        className: 'diagnostic-unknown',
        icon: '—'
      }
    };
    const definition = definitions[level] || definitions.unknown;

    return {
      level: definitions[level] ? level : 'unknown',
      riskLevel: definition.riskLevel,
      title: definition.title,
      label: definition.title,
      message: definition.message,
      description: definition.message,
      text: definition.message,
      className: definition.className,
      icon: definition.icon,
      gap: details.gap ?? null,
      latestGap: details.gap ?? null,
      previousGap: details.previousGap ?? null,
      latestCapexGrowth: details.latestCapexGrowth ?? null,
      latestRevenueGrowth: details.latestRevenueGrowth ?? null,
      latestIndex: details.latestIndex ?? null,
      observations: details.observations || [],
      thresholds: Object.freeze({ elevated: 20, criticalConsecutive: 30 })
    };
  }

  function diagnoseGrowthGap(capexGrowth, revenueGrowth) {
    if (!Array.isArray(capexGrowth) || !Array.isArray(revenueGrowth)) {
      return buildGrowthDiagnosis('unknown', {
        reason: 'CapEx 与云收入增速必须按季度提供为数组。'
      });
    }

    if (capexGrowth.length === 0 || revenueGrowth.length === 0) {
      return buildGrowthDiagnosis('unknown', {
        reason: 'CapEx 或云收入增速序列为空，暂时无法判断。'
      });
    }

    if (capexGrowth.length !== revenueGrowth.length) {
      return buildGrowthDiagnosis('unknown', {
        reason: 'CapEx 与云收入增速序列长度不一致，无法确认季度对应关系。'
      });
    }

    const observations = capexGrowth.map((capexValue, index) => {
      const capex = toFiniteNumber(capexValue);
      const revenue = toFiniteNumber(revenueGrowth[index]);
      return {
        index,
        capex,
        revenue,
        gap: capex === null || revenue === null ? null : roundTo(capex - revenue, 4)
      };
    });
    const latestIndex = observations.length - 1;
    const latest = observations[latestIndex];
    const previous = latestIndex > 0 ? observations[latestIndex - 1] : null;

    if (latest.gap === null) {
      return buildGrowthDiagnosis('unknown', {
        reason: '最新季度缺少 CapEx 或云收入增速，暂时无法判断。',
        latestIndex,
        latestCapexGrowth: latest.capex,
        latestRevenueGrowth: latest.revenue,
        previousGap: previous?.gap ?? null,
        observations
      });
    }

    const details = {
      gap: latest.gap,
      previousGap: previous?.gap ?? null,
      latestCapexGrowth: latest.capex,
      latestRevenueGrowth: latest.revenue,
      latestIndex,
      observations
    };

    if (latest.gap > 30 && previous?.gap !== null && previous?.gap > 30) {
      return buildGrowthDiagnosis('critical', details);
    }

    if (latest.gap > 20) {
      return buildGrowthDiagnosis('elevated', details);
    }

    return buildGrowthDiagnosis('low', details);
  }

  global.CapExScoring = Object.freeze({
    calculateWeightedScore,
    scoreToRisk,
    compareManualScore,
    diagnoseGrowthGap,
    EXPECTED_COMPONENT_IDS,
    SCORE_BANDS
  });
})(window);
