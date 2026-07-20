import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from './lib/refresh-utils.mjs';

const routes = [
  { id: 'overview', titleId: 'overview-title' },
  { id: 'hyperscalers', titleId: 'hyperscalers-title' },
  { id: 'supply-chain', titleId: 'supply-chain-title' },
  { id: 'macro', titleId: 'macro-title' },
  { id: 'events', titleId: 'events-title' },
  { id: 'methodology', titleId: 'methodology-title' }
];

const [html, app, styles, charts] = await Promise.all([
  readFile(path.join(ROOT_DIR, 'index.html'), 'utf8'),
  readFile(path.join(ROOT_DIR, 'js', 'app.js'), 'utf8'),
  readFile(path.join(ROOT_DIR, 'css', 'styles.css'), 'utf8'),
  readFile(path.join(ROOT_DIR, 'js', 'charts.js'), 'utf8')
]);
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : '';
}

const nav = html.match(/<nav\b[^>]*class="section-nav"[^>]*>[\s\S]*?<\/nav>/);
assert(nav, '缺少 section-nav 页面导航');
const routeLinks = nav
  ? Array.from(nav[0].matchAll(/<a\b[^>]*>/g), (match) => match[0])
  : [];
assert(routeLinks.length === routes.length, `页面导航必须恰好包含 ${routes.length} 个路由链接`);

routes.forEach((route, index) => {
  const link = routeLinks.find((tag) => attribute(tag, 'data-route') === route.id);
  assert(link, `导航缺少 ${route.id} 路由`);
  if (link) {
    assert(attribute(link, 'href') === `#/${route.id}`, `${route.id} 必须使用 #/${route.id} 链接`);
    assert(attribute(link, 'aria-controls') === route.id, `${route.id} 导航缺少正确 aria-controls`);
    assert(attribute(routeLinks[index] || '', 'data-route') === route.id, `${route.id} 导航顺序错误`);
  }

  const section = html.match(new RegExp(`<section\\b[^>]*\\bid="${route.id}"[^>]*>`));
  assert(section, `缺少 ${route.id} 路由 section`);
  if (section) {
    assert(attribute(section[0], 'data-route') === route.id, `${route.id} section 缺少 data-route`);
    assert(attribute(section[0], 'class').split(/\s+/).includes('route-view'), `${route.id} section 缺少 route-view class`);
    assert(attribute(section[0], 'aria-labelledby') === route.titleId, `${route.id} section 的 aria-labelledby 错误`);
  }

  assert(new RegExp(`<h1\\b[^>]*\\bid="${route.titleId}"[^>]*tabindex="-1"`).test(html), `${route.id} 顶层标题必须是可聚焦 h1`);
  assert(app.includes(`titleId: '${route.titleId}'`), `app.js 路由表缺少 ${route.titleId}`);

  const viewStart = html.indexOf(`<section id="${route.id}"`);
  const nextViewStart = index + 1 < routes.length
    ? html.indexOf(`<section id="${routes[index + 1].id}"`)
    : html.indexOf('</main>', viewStart);
  const viewMarkup = html.slice(viewStart, nextViewStart);
  const headingLevels = Array.from(viewMarkup.matchAll(/<h([1-6])\b/g), (match) => Number(match[1]));
  for (let headingIndex = 1; headingIndex < headingLevels.length; headingIndex += 1) {
    assert(
      headingLevels[headingIndex] <= headingLevels[headingIndex - 1] + 1,
      `${route.id} 存在 h${headingLevels[headingIndex - 1]} → h${headingLevels[headingIndex]} 标题跳级`
    );
  }
});

assert(html.includes('class="brand" href="#/overview"'), '品牌入口必须返回 #/overview');
assert(html.includes('id="main-content" class="dashboard-shell" tabindex="-1"'), 'main 必须可由跳过链接聚焦');
assert(html.includes('document.documentElement.dataset.initialRoute'), 'head 中必须预先标记首屏路由，避免长页面闪烁');
assert(!/<a\b[^>]*href="#(?:overview|hyperscalers|supply-chain|macro|events|methodology)"/.test(html), '不能保留旧式页面路由 hash');
assert(app.includes("window.addEventListener('hashchange'"), 'app.js 必须处理浏览器前进/后退');
assert(app.includes("link.setAttribute('aria-current', 'page')"), 'app.js 必须同步 aria-current');
assert(app.includes('chartApi.resizeAll()'), '进入图表视图后必须触发 ECharts resize');
assert(app.includes('renderSelectedValuation({ forceChart: true })'), '进入供应链视图后必须刷新 TradingView');
assert(app.includes('calculatePePriceModel'), '估值页面必须从 EPS 与 P/E 计算价格带');
assert(app.includes('normalizeResearchBands'), '估值页面必须校验人工财报/指引研究区间');
assert(app.includes('data-valuation-ticker'), '买入区间总表必须可以跳转到单家公司详情');
assert(app.includes('P/E NOT MEANINGFUL'), '估值页面必须为 P/E 不适用公司提供安全降级');
assert(app.includes('&gt; ${escapeHTML(bullPrice)} 不列入买入区'), '估值页面必须显示互斥的牛市价值以上等待线');
assert(app.includes('formatValuationPrice'), '估值页面必须保留价格阈值的两位小数精度');
assert(html.includes('研究区间 + P/E 情景'), '估值工具栏必须说明人工研究与 P/E 两类口径');
assert(html.includes('id="buy-zones-body"'), '供应链视图必须包含买入区间速览表');
assert(html.includes('data-sort="latestQuarterGrossMargin"'), '供应链风险表必须包含可排序的最新季度毛利率');
assert(app.includes('latestQuarterGrossMargin'), '前端必须从最新季度毛利润与营收计算毛利率');
assert(app.includes('renderLatestQuarterGrossMargin(company)'), '供应链风险表必须渲染最新季度毛利率与财报链接');
assert(styles.includes('.financial-metric'), 'CSS 缺少最新季度毛利率样式');
assert(html.includes('id="buy-zones-sort-button"'), '买入区间速览必须提供高低方向排序按钮');
assert(app.includes('renderBuyZones(data)'), '估值页面必须从统一数据源渲染买入区间速览');
assert(app.includes('buyZoneDistanceMetrics'), '买入区间速览必须计算相对三档价格区间两端的百分比距离');
assert(app.includes('buyZoneDailyMarkerMarkup(company, quote && quote.price)'), '每只股票必须按自动行情显示每日价格图案');
assert(app.includes("image: './assets/buy-zone-safety.png'") && app.includes("image: './assets/buy-zone-reasonable.png'") && app.includes("image: './assets/buy-zone-aggressive.png'") && app.includes("image: './assets/buy-zone-wait.png'"), '四档每日价格图案资产缺失');
assert(html.includes('class="buy-zone-marker-legend"') && html.includes('高于激进 · 等待'), '买入区间表必须提供四种图案图例');
assert(styles.includes('.buy-zone-daily-marker.is-safety') && styles.includes('.buy-zone-daily-marker.is-reasonable') && styles.includes('.buy-zone-daily-marker.is-aggressive') && styles.includes('.buy-zone-daily-marker.is-wait'), '四档每日价格图案必须使用不同颜色');
assert(app.includes('distanceToUpper') && app.includes('distanceToLower'), '买入区间速览必须同时对照价格区间上下限');
assert(app.includes('formatBuyZoneDistanceRange'), '买入区间速览必须把两个端点结果显示为比例区间');
assert(app.includes("state.buyZones.sortDirection === 'desc' ? 'asc' : 'desc'"), '买入区间速览必须支持从高到低与从低到高切换');
assert(app.includes("sortHeading.setAttribute('aria-sort'"), '买入区间排序必须同步无障碍排序状态');
assert(app.includes("marketQuotes: { path: './data/market-quotes.json'"), '前端必须加载独立的自动行情快照');
assert(app.includes('marketQuoteForTicker'), '买入区间表必须用自动行情快照对照价格带');
assert(app.includes('marketCapCurrencyValues'), '买入区间表必须把公司市值换算为 USD 与 CNY');
assert(app.includes('buyZoneMarketCapMarkup(quote)'), '每只重点股票下方必须显示双币种总市值');
assert(app.includes('const scaled = amount / 1e8'), '市值必须统一换算为“亿”');
assert(app.includes('formatNumber(scaled, decimals)}亿`'), '市值必须统一显示“亿”单位');
const forbiddenMarketCapUnits = ['百', '千', '万'].map((prefix) => `suffix: '${prefix}亿'`);
assert(forbiddenMarketCapUnits.every((unit) => !app.includes(unit)), '市值不能继续显示复合“亿”单位');
assert(app.includes('scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2'), '换算后达到三位数的市值必须显示为整数亿');
assert(!app.includes("suffix: 'B'") && !app.includes("suffix: 'T'"), '市值不能继续显示 B/T 单位');
assert(!/(?:十|百|千|万)亿|(?:十|百|千)万/.test(`${html}\n${app}\n${charts}`), '页面数值不能显示复合中文数量级');
assert(html.includes('单位：亿美元') && charts.includes("getUnit(data, 'capex', '亿美元')"), '云巨头 CapEx 图表必须统一显示亿美元');
assert(app.includes('referencePrice: quote ? quote.price : company.referencePrice'), '自动行情缺失时必须回退到研究参考价');
assert(html.includes('自动行情 + 静态区间'), '买入区间表必须明确区分自动行情与静态研究区间');
assert(styles.includes('.buy-zone-quote-meta'), 'CSS 缺少自动行情时间与涨跌样式');
assert(styles.includes('.buy-zone-market-cap strong.is-usd'), 'CSS 缺少 USD 市值样式');
assert(styles.includes('.buy-zone-market-cap strong.is-cny'), 'CSS 缺少 CNY 市值样式');
assert(styles.includes('.buy-zone-range.is-safety'), 'CSS 缺少买入区间安全档样式');
assert(styles.includes('.buy-zone-distance-grid'), 'CSS 缺少三档上限百分比对照样式');
assert(app.includes('is-${escapeHTML(metric.key)}-tier'), '三档上限百分比必须带有独立颜色类别');
assert(styles.includes('.buy-zone-distance.is-safety-tier'), 'CSS 缺少安全上限薄荷色样式');
assert(styles.includes('.buy-zone-distance.is-reasonable-tier'), 'CSS 缺少合理上限紫色样式');
assert(styles.includes('.buy-zone-distance.is-aggressive-tier'), 'CSS 缺少激进上限樱花色样式');
assert(html.includes('分别对照价格带的上、下限'), '页面必须解释比例区间的上下限计算口径');
assert(html.includes('安全边际再对熊市价值折价 20%'), '方法页必须解释安全边际公式');
assert(styles.includes('.route-view[hidden]'), 'CSS 必须可靠隐藏非当前视图');
assert(styles.includes(':root[data-initial-route] .route-view'), 'CSS 必须在主脚本执行前隐藏非当前视图');
assert(styles.includes('.section-nav a[aria-current="page"]'), 'CSS 必须显示当前导航状态');
assert(styles.includes('outline-offset: -3px'), '横向导航必须避免裁切键盘焦点环');
assert(styles.includes('@keyframes route-enter'), 'CSS 缺少轻量路由切换动画');
assert(styles.includes('.valuation-scenario.is-safety'), 'CSS 缺少安全边际价格卡样式');
assert(styles.includes('.valuation-model-kind.is-research'), 'CSS 缺少人工研究区间状态样式');
assert(styles.includes('.valuation-unavailable-panel'), 'CSS 缺少 P/E 不适用状态样式');
assert(styles.includes('.buy-zones-table'), 'CSS 缺少重点标的买入区间表样式');

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`validated ${routes.length} GitHub Pages hash routes and navigation invariants`);
}
