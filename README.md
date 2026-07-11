# AI CapEx Cycle Monitor

> AI 数据中心资本开支周期雷达

一个面向产业研究与教育用途的纯静态数据看板，用于观察 AI 数据中心建设周期、云巨头资本开支、商业化兑现、供应链与信用风险，以及宏观融资环境。项目使用 HTML5、CSS3、原生 JavaScript、JSON 和 Apache ECharts，不需要服务器、数据库、私密 API Key 或构建步骤，可直接部署到 GitHub Pages。

## 1. 项目简介 / About

AI CapEx Cycle Monitor 将分散的产业信号整理为统一的风险研究框架。首页以 0–100 的综合风险分数为入口，并通过分项评分、趋势图、风险表、产业链热力图、宏观卡片和事件时间线解释当前周期状态。

- 绿色：正常扩张
- 黄色：需要关注
- 橙色：风险上升
- 红色：熊市或信用风险确认
- 灰色：数据缺失或尚未判断

风险状态始终同时显示文字标签，不只依赖颜色。第一版数据均为演示数据，不代表实时市场或公司财务信息。

## 2. 当前功能 / Features

- 周期总览：综合风险分数、周期阶段、CapEx 动量与信用压力
- 风险评分拆解：五项风险贡献、权重、等级与解释
- 云巨头 CapEx 趋势：Microsoft、Amazon、Alphabet、Meta 与 Oracle 的季度演示数据
- CapEx 增速与云收入增速对比：自动判断两者差值并生成提示
- 供应链风险：排序、产业链环节筛选、风险等级筛选与移动端横向滚动
- 产业链风险热力图：覆盖云巨头、GPU、网络、高速连接、光模块、电力与液冷、Neocloud 等环节
- 宏观环境：关键融资指标及利率/增长四象限说明
- 重大事件时间线：支持情绪与公司筛选，并可跳转到已提供的外部来源
- 响应式深色界面、键盘可访问控件、图表 Tooltip 与可读的加载错误提示
- GitHub Pages 官方 Actions 自动部署，无后端依赖

## 3. 项目截图 / Screenshot

> 截图占位 / Screenshot placeholder：首版部署后可在这里补充桌面端和移动端页面截图。

## 4. 本地运行 / Local Development

浏览器通常会限制通过 `file://` 直接读取 JSON，因此不要直接双击 `index.html`。请在仓库根目录启动一个本地静态服务器：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000
```

如果本机已有 Node.js，也可以临时使用：

```bash
npx serve .
```

项目本身不依赖 Node.js。ECharts 通过公共 CDN 加载，首次访问时需要网络连接。

## 5. GitHub Pages 部署 / Deployment

仓库内的 `.github/workflows/deploy-pages.yml` 使用 GitHub 官方 Pages Actions。它会在推送到 `main` 分支时自动发布，也支持从 Actions 页面手动运行。

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

页面内资源均使用相对路径，因此兼容 GitHub Pages 项目站点。仓库入口占位：`https://github.com/YOUR_GITHUB_USERNAME/ai-capex-cycle-monitor`。

## 6. JSON 数据文件 / Data Files

| 文件 | 用途 |
| --- | --- |
| `data/risk-score.json` | 更新时间、周期阶段、综合判断、手动分数与五项风险分数 |
| `data/hyperscalers.json` | 云巨头季度 CapEx、合计 CapEx 增速与云收入增速 |
| `data/supply-chain.json` | 供应链公司、经营趋势、资产负债风险与综合等级 |
| `data/macro.json` | 宏观指标、变化方向、风险等级与周期影响 |
| `data/events.json` | 重大事件、情绪、影响环节、风险分数变化与来源 |

第一版 JSON 均包含 `"isDemoData": true`。替换为真实数据时，应保留一致字段，并为每个指标维护 `updatedAt` 和来源信息。不要将需要保密的 API Key 或凭证写入 JSON、JavaScript 或 Git 历史。

## 7. 风险评分公式 / Scoring Method

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

## 8. 后续路线 / Roadmap

- 接入经过校验的 SEC、FRED 与公司财报公开数据
- 增加数据来源、口径变更和修订历史
- 补充自由现金流、订单能见度、融资期限与信用利差指标
- 增加可下载快照、历史周期对比与无障碍图表摘要
- 建立数据校验和前端回归测试，持续检查 GitHub Pages 部署

## 9. 数据免责声明 / Disclaimer

本项目仅用于信息展示、产业研究与教育用途，不构成任何投资建议。页面中的演示数据可能不准确、不完整或已经过时。

The dashboard is provided for informational, research, and educational purposes only. It is not investment advice. Demo data may be inaccurate, incomplete, or outdated.

## 10. License

本项目采用 [MIT License](./LICENSE)。Copyright © 2026 AI CapEx Cycle Monitor Contributors.
