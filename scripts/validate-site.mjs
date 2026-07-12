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

const [html, app, styles] = await Promise.all([
  readFile(path.join(ROOT_DIR, 'index.html'), 'utf8'),
  readFile(path.join(ROOT_DIR, 'js', 'app.js'), 'utf8'),
  readFile(path.join(ROOT_DIR, 'css', 'styles.css'), 'utf8')
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
assert(styles.includes('.route-view[hidden]'), 'CSS 必须可靠隐藏非当前视图');
assert(styles.includes(':root[data-initial-route] .route-view'), 'CSS 必须在主脚本执行前隐藏非当前视图');
assert(styles.includes('.section-nav a[aria-current="page"]'), 'CSS 必须显示当前导航状态');
assert(styles.includes('outline-offset: -3px'), '横向导航必须避免裁切键盘焦点环');
assert(styles.includes('@keyframes route-enter'), 'CSS 缺少轻量路由切换动画');

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`validated ${routes.length} GitHub Pages hash routes and navigation invariants`);
}
