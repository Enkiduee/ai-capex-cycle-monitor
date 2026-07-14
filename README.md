> 🌐 在线展示：[https://enkiduee.github.io/ai-capex-cycle-monitor/](https://enkiduee.github.io/ai-capex-cycle-monitor/)

<p align="center">
  <img src="./assets/readme-anime-banner.png" alt="AI 数据中心资本开支周期监控原创二次元横幅" width="100%">
</p>

<h1 align="center">✦ AI CapEx Cycle Monitor ✦</h1>

<p align="center">
  <em>AI 数据中心资本开支周期雷达 · 在数据星海里捕捉周期信号 ( •̀ ω •́ )✧</em>
</p>

<p align="center">
  <a href="https://enkiduee.github.io/ai-capex-cycle-monitor/"><img alt="GitHub Pages" src="https://img.shields.io/badge/GitHub_Pages-打开看板-69d7df?style=for-the-badge&amp;logo=github"></a>
  <img alt="Vanilla JavaScript" src="https://img.shields.io/badge/Vanilla_JS-ES2022-f2c75c?style=for-the-badge&amp;logo=javascript&amp;logoColor=111827">
  <img alt="No server" src="https://img.shields.io/badge/Server-Not_Required-5bd39a?style=for-the-badge">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-a991f7?style=for-the-badge"></a>
</p>

<p align="center">⋆｡°✩ Static Dashboard · GitHub Pages · ECharts · TradingView ✩°｡⋆</p>

一个面向产业研究与教育用途的纯静态数据看板，用于观察 AI 数据中心建设周期、云巨头资本开支、商业化兑现、供应链与信用风险，以及宏观融资环境。项目使用 HTML5、CSS3、原生 JavaScript、JSON 和 Apache ECharts，不需要服务器、数据库、私密 API Key 或构建步骤，可直接部署到 GitHub Pages。

## 1. 🌌 项目简介 / About

AI CapEx Cycle Monitor 将分散的产业信号整理为统一的风险研究框架。首页以 0–100 的综合风险分数为入口，并通过分项评分、趋势图、风险表、公司估值观察卡、产业链热力图、宏观卡片和事件时间线解释当前周期状态。

- 绿色：正常扩张
- 黄色：需要关注
- 橙色：风险上升
- 红色：熊市或信用风险确认
- 灰色：数据缺失或尚未判断

风险状态始终同时显示文字标签，不只依赖颜色。宏观、CapEx、风险评分等首版数据仍以演示框架为主；详细估值卡采用截至 `2026-07-12` 可得财报输入与可复算 P/E 情景，重点标的表另展示截至 `2026-07-14` 的人工研究区间，并分别标注口径与边界。

## 2. ✨ 当前功能 / Features

- 周期总览：综合风险分数、周期阶段、CapEx 动量与信用压力
- 六视图导航：总览、云巨头、供应链与估值、宏观、事件、方法通过 GitHub Pages Hash 路由独立切换，支持刷新、分享与浏览器前进/后退
- 风险评分拆解：五项风险贡献、权重、等级与解释
- 云巨头 CapEx 趋势：Microsoft、Amazon、Alphabet、Meta 与 Oracle 的季度演示数据
- CapEx 增速与云收入增速对比：自动判断两者差值并生成提示
- 供应链风险：排序、产业链环节筛选、风险等级筛选与移动端横向滚动
- 12 只重点股票买入区间速览：集中展示 AAOI、SKHY、LITE、兴森科技、深南电路、通富微电、AXTI、ASTS、Intel、Nebius、CoreWeave 与 Corning 的“安全边际、合理主买、激进试仓”研究区间；逐项计算行情相对三档价格带上下限的百分比区间，并支持按相对激进上限的距离从高到低或从低到高排序；点击代码可进入对应详情和行情图
- 重点标的自动行情：A 股与美股在各自盘中每 30 分钟抓取一次，并在收盘后补抓一次；页面用行情快照判断当前落在哪一档，抓取失败时回退到研究参考价
- 供应链公司估值观察：以规范化摊薄 EPS × 熊 / 基准 / 牛市 P/E 计算“安全边际、合理买入、激进买入”三档研究价格，并嵌入 TradingView Mini Chart
- P/E 适用性护栏：亏损或一次性非经营收益主导的公司不会硬算买入价，而会说明原因、替代估值口径与重新启用条件
- 自动数据巡检：每天 09:23（上海时间）记录 SEC 巡检状态，计划每 4 小时检查一次财报与重大事项申报
- SEC 事件提醒：发现新的 10-K、10-Q、20-F、8-K 或 6-K 后，以中性事件加入时间线，并把对应估值区间标记为“需复核”
- 产业链风险热力图：覆盖云巨头、GPU、网络、高速连接、光模块、电力与液冷、Neocloud 等环节
- 宏观环境：关键融资指标及利率/增长四象限说明
- 重大事件时间线：支持情绪与公司筛选，并可跳转到已提供的外部来源
- 响应式深色界面、键盘可访问控件、图表 Tooltip 与可读的加载错误提示
- GitHub Pages 官方 Actions 自动部署，无后端依赖

## 3. 🖼️ 项目截图 / Screenshot

> 截图占位 / Screenshot placeholder：首版部署后可在这里补充桌面端和移动端页面截图。

## 4. 🛠️ 本地运行 / Local Development

浏览器通常会限制通过 `file://` 直接读取 JSON，因此不要直接双击 `index.html`。请在仓库根目录启动一个本地静态服务器：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000
```

也可以直接打开某个视图，例如：

```text
http://localhost:8000/#/supply-chain
```

如果本机已有 Node.js，也可以临时使用：

```bash
npx serve .
```

网站运行本身不依赖 Node.js，也不需要 API Key。仓库维护脚本使用 GitHub Actions 自带的 Node.js。重点标的行情快照和 TradingView Mini Chart 都依赖第三方网络资源，可能存在延迟，也可能因网络、地区限制或第三方服务状态而暂时不可用。

## 5. 🚀 GitHub Pages 部署 / Deployment

仓库内的 `.github/workflows/deploy-pages.yml` 使用 GitHub 官方 Pages Actions。它会在推送到 `main` 分支时自动发布，也支持从 Actions 页面手动运行。自动数据工作流在机器人提交成功后会由独立的部署任务校验并发布当时最新的 `main`，既补足机器人推送无法再次触发普通 `push` 工作流的问题，也避免并发任务把站点回退到旧提交。

首次部署前，在 GitHub 仓库中设置：

```text
Repository
→ Settings
→ Pages
→ Source
→ GitHub Actions
```

随后将代码推送到 `main`，在仓库的 **Actions** 页面等待 `Deploy static site to Pages` 工作流完成。站点将发布到类似下面的项目子路径：

```text
https://YOUR_GITHUB_USERNAME.github.io/ai-capex-cycle-monitor/
```

页面内资源均使用相对路径，因此兼容 GitHub Pages 项目站点。

顶部导航使用 `#/页面` 形式的 Hash 路由，不需要服务器端重写规则，因此直接刷新或分享子视图不会出现 GitHub Pages 404：

- [总览](https://enkiduee.github.io/ai-capex-cycle-monitor/#/overview)
- [云巨头 CapEx](https://enkiduee.github.io/ai-capex-cycle-monitor/#/hyperscalers)
- [供应链与估值](https://enkiduee.github.io/ai-capex-cycle-monitor/#/supply-chain)
- [宏观环境](https://enkiduee.github.io/ai-capex-cycle-monitor/#/macro)
- [重大事件](https://enkiduee.github.io/ai-capex-cycle-monitor/#/events)
- [方法说明](https://enkiduee.github.io/ai-capex-cycle-monitor/#/methodology)

## 6. 💾 JSON 数据文件 / Data Files

| 文件 | 用途 |
| --- | --- |
| `data/risk-score.json` | 更新时间、周期阶段、综合判断、手动分数与五项风险分数 |
| `data/hyperscalers.json` | 云巨头季度 CapEx、合计 CapEx 增速与云收入增速 |
| `data/supply-chain.json` | 供应链公司、经营趋势、资产负债风险与综合等级 |
| `data/market-quotes.json` | 12 只重点标的最近一次自动行情快照、涨跌幅、行情时间、抓取时间与分市场刷新状态 |
| `data/valuation-bands.json` | 12 只重点股票的人工研究区间，以及供应链公司的 EPS 口径、熊 / 基准 / 牛市 P/E、适用性判断、假设与来源 |
| `data/sec-filings-state.json` | SEC accession number 去重状态；避免同一披露被重复加入事件流 |
| `data/macro.json` | 宏观指标、变化方向、风险等级与周期影响 |
| `data/events.json` | 重大事件、情绪、影响环节、风险分数变化与来源 |

风险、CapEx、宏观等首版 JSON 仍包含 `"isDemoData": true`；估值文件已使用 `"isDemoData": false`，但其中 P/E 倍数依然是带主观判断的研究情景。更新任何数据时都应维护 `updatedAt` 和来源信息。不要将需要保密的 API Key 或凭证写入 JSON、JavaScript 或 Git 历史。

### 🎯 编辑估值观察数据

`data/valuation-bands.json` 的 `manualBuyZones.entries` 维护重点标的人工研究区间；每项包含 `aggressive`、`reasonable`、`safety` 三个互不重叠的价格范围、分析参考价、币种、市场和简短判断。前端会把这些标的合并到详情选择器。`companies` 数组则按股票代码维护可复算的详细估值卡。编辑时请保留现有对象结构，重点字段包括：

- `ticker`、`name`、`segment`：公司与产业链标识
- `tradingViewSymbol`：TradingView 使用的 `交易所:代码`，例如 `NASDAQ:NVDA`
- `currency`：价格带采用的货币
- `valuationModel.kind`：使用 `pe` 或 `pe-not-meaningful`，后者不会生成买入价格
- `valuationModel.eps`：记录 EPS 数值、`accountingBasis`、`periodType`、四季覆盖证据、财务期末、计算过程和 GAAP 对照
- `valuationModel.peScenarios`：仅用于 `pe` 模型，且必须满足 `0 < bear < base < bull`
- `valuationModel.historicalPeContext`、`valuationModel.scenarioRationale`：记录历史牛熊估值背景与情景倍数为什么这样设定
- `valuationModel.notMeaningfulReason`、`valuationModel.alternativeMetric`、`valuationModel.reentryRule`：解释 P/E 为什么失效、改看什么以及何时重启
- `assumptions`、`riskNote`、`confidence`、`updatedAt`：记录关键假设、失效风险、研究置信度与更新时间
- `sources`：提供官方财报和历史估值资料的 HTTPS 链接
- `reviewStatus`：可使用 `demo`、`needs-review` 或 `reviewed`；标为 `reviewed` 时必须同时填写 `reviewedAt`、`reviewedBy` 与 HTTPS `reviewEvidenceUrl`

修改 JSON 并刷新页面即可看到新内容，无需构建或后端服务。重点标的行情由独立工作流写入 `data/market-quotes.json`，不会改写 `data/valuation-bands.json` 中的静态研究区间；TradingView Mini Chart 仍由组件独立请求。两种行情都无需 API Key，但可能延迟，显示可用性也取决于第三方网络。

三档价格的统一公式为：

```text
熊 / 基准 / 牛市情景价值 = 同口径规范化摊薄 EPS × 对应情景 P/E
安全边际上限 = 熊市情景价值 × 80%
合理买入区 = 高于安全边际上限、且不高于基准价值
激进买入区 = 高于基准价值、且不高于牛市价值
高于牛市价值 = 等待，不列入买入区
```

P/E 只在规范化 EPS 为正、核心经营盈利可复核、数据覆盖至少连续四季，并能找到同一 GAAP / non-GAAP 口径的历史 P/E 时启用。优先使用 TTM；遇到公司更改披露口径时可退回最近完整财年。MRVL、AAOI、CRWV 与 NBIS 当前分别因为出售收益、持续亏损、口径错配或一次性投资重估主导利润而明确显示“P/E 不适用”，页面不会为了给出一个数字而制造错误精度。

这些价格带不是目标价、收益保证、个性化建议或任何形式的买卖推荐。人工研究区间必须记录分析日期、参考价和来源；P/E 区间必须注明财务期末、EPS 口径、历史估值背景和主要假设。自动行情快照和右侧 TradingView 图表只用于研究对照，仓库不会使用行情自动执行交易判断。

### 🤖 自动更新机制

仓库提供两套免费的无服务器自动化：`.github/workflows/refresh-data.yml` 负责 SEC 披露巡检，`.github/workflows/refresh-market-data.yml` 负责重点标的行情快照。

行情工作流：

- A 股交易日按 `Asia/Shanghai` 时区在 09:30–11:30、13:00–15:00 盘中每 30 分钟抓取，并在 15:17 收盘后补抓
- 美股交易日按 `America/New_York` 时区在 09:30–16:00 核心盘中每 30 分钟抓取，并在 16:17 收盘后补抓；时区配置会自动适配美国夏令时
- 节假日或接口只返回上一交易日数据时不会覆盖快照；任一标的抓取失败时整批不写入，避免页面出现半套新旧数据
- 只有价格、前收盘价或行情时间确实变化时才提交；机器人提交成功后会校验并重新部署 GitHub Pages
- GitHub Actions 定时任务可能排队延迟且没有准时 SLA，页面展示的是第三方行情快照，不是交易所实时成交数据

SEC 工作流：

- 每天 `09:23`（Asia/Shanghai）记录一次 SEC 巡检状态
- 计划每 4 小时轮询一次 SEC EDGAR，另有每日巡检；GitHub 定时任务可能延迟且没有准时 SLA
- 支持 Actions 页面手动选择 `full`、`daily`、`events` 或 `bootstrap`
- 支持 `refresh-data`、`financial-report` 与 `major-event` 三种 `repository_dispatch`
- 只有业务数据或巡检状态确实变化时才提交；事件扫描没有新披露时不会制造空提交
- 自动提交完成后由独立任务校验并部署当时最新的 `main`；部署失败可单独重跑，不需要服务器或个人访问令牌

SEC 检测使用官方 `data.sec.gov/submissions/CIK##########.json`，监测 10-K、10-Q、10-KT、10-QT、20-F、40-F、8-K、6-K 及部分财报延期申报。首次运行只建立 accession number 基线，不会把旧披露全部误报成新事件。发现新披露时，系统只执行两件事：

1. 将官方披露作为 `neutral`、风险变化 `0` 的事件加入时间线；
2. 将对应公司的 EPS 与 P/E 情景标记为“发现新披露，需人工复核”。

自动化不会仅凭申报表类型编造利好/利空、风险分数或公允价值，也不会自动改写宏观、CapEx、供应链或估值区间。行情工作流只保存第三方延迟快照；EPS 与 P/E 情景只有在财报或重大事件后的明确估值复核中才人工更新。

SEC 要求自动客户端声明“项目/组织名 + 可联系邮箱”的 User-Agent。工作流不会把联系邮箱写入公开代码；上线前必须在仓库中进入 `Settings → Secrets and variables → Actions → Secrets → New repository secret`，新增：

```text
Name: SEC_USER_AGENT
Value: AI CapEx Cycle Monitor your-contact@example.com
```

它不是 API Key，但使用 repository secret 可以避免把联系邮箱直接公开在源码中。缺少该配置时，SEC 巡检会安全失败并且不会写入任何数据。

本地校验自动化脚本：

```bash
node scripts/validate-data.mjs
node scripts/validate-site.mjs
node scripts/test-sec-monitor.mjs
node scripts/test-market-quotes.mjs
node scripts/refresh-market-quotes.mjs --market all --force --dry-run
node scripts/check-sec-filings.mjs --mode events --dry-run
```

## 7. 📐 风险评分公式 / Scoring Method

前端优先使用五个分项计算综合风险分数：

```text
综合风险分数 =
  巨头 CapEx 动量分数 × 25%
  + AI 收入兑现分数 × 20%
  + 供应链订单与库存分数 × 20%
  + Neocloud 信用风险分数 × 20%
  + 宏观与利率环境分数 × 15%
```

分数越高代表风险越高：

| 分数 | 风险等级 |
| --- | --- |
| 0–24 | 正常扩张 |
| 25–49 | 扩张偏热 |
| 50–69 | 增长减速 |
| 70–84 | 高风险 |
| 85–100 | 熊市确认 |

如果数据同时提供手动综合分数与分项分数，页面采用分项加权结果，并在浏览器控制台提示二者是否一致。评分同时包含客观数据与主观判断，应结合原始财报、监管文件和宏观数据复核。

## 8. 🧭 后续路线 / Roadmap

- 自动提取 SEC XBRL 基本面字段，并在不自动生成交易建议的前提下辅助人工估值复核
- 增加数据来源、口径变更和修订历史
- 补充自由现金流、订单能见度、融资期限与信用利差指标
- 增加可下载快照、历史周期对比与无障碍图表摘要
- 建立数据校验和前端回归测试，持续检查 GitHub Pages 部署

## 9. ⚠️ 数据免责声明 / Disclaimer

本项目仅用于信息展示、产业研究与教育用途，不构成任何投资建议。页面数据可能不准确、不完整或已经过时。估值观察卡中的“安全边际、合理买入、激进买入”来自人工财报/指引研究或特定 EPS 与 P/E 假设，不是目标价、收益保证或针对任何人的投资建议；自动行情快照与 TradingView Mini Chart 都可能延迟，且可用性依赖第三方网络服务。SEC 自动提醒只证明申报已出现，不代表对内容、重要性或市场影响的判断。

The dashboard is provided for informational, research, and educational purposes only. It is not investment advice. Demo data may be inaccurate, incomplete, or outdated.

## 10. 📜 License

本项目采用 [MIT License](./LICENSE)。Copyright © 2026 AI CapEx Cycle Monitor Contributors.
