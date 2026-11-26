# ZhongFlow 变更记录（CHANGELOG）

> 条目按时间倒序排列（新在上）。
> 2026-11-23 之前的内容整理自原 PROJECT_HANDOFF.md 的历史小节，原文原样保留；
> 2026-11-23 起项目进入 Git 管理，条目与提交记录一一对应（提交号随条目标注）。
> 当前架构、接口约定与部署说明见 [README.md](README.md)。

## 2026-11-25

### 死代码清理（`35e65ea`）
- 删除 `utils/mockData.js`（605 行）与全部 `USE_MOCK` 分支：`USE_MOCK` 恒为 `false`，mock 路径永远不会执行；
- `api.js` 移除死接口 `getOverviewStats` / `refreshStations`；`getReservoirList` / `getRiverList` / `getSoilList` 转为模块内部函数（`getStations` / `getStationGroups` 仍在使用）；
- `util.js` 删除 `formatTime` / `getDistance` / `debounce` / `throttle` / `getSoilMoistureStatus` / `getWaterLevelStatus`（后者已被 `utils/stationStatus.js` 的双口径词表取代，测试以否定断言继续守护）；
- `geoLayer` / `layerRadar` / `geoDatum` / `navigation` / `rainImpact` 收紧导出面（仅内部使用的常量不再导出），彻底删除无任何引用的 `tileCount` / `radarGridNote`；
- 净删除约 811 行，复扫确认无残留死导出；测试 51/51 通过。

### Canvas 迁移到 type="2d"（`1a7a687`）
- 详情页 4 张图（河道水文过程 / 水库水文过程 / 单指标趋势 / 土壤分层）与雨量柱状图全部从 `wx.createCanvasContext` 旧 API 迁移到 `<canvas type="2d">` + 标准 2d 上下文（属性赋值配色、标准 `setLineDash`、无 `ctx.draw()`）；
- 新增 `utils/canvas2d.js`：经 SelectorQuery 取 canvas 节点（带 5×80ms 有限重试，兜底 `wx:if` 内画布晚于 setData 渲染）+ 按 `pixelRatio` 缩放（否则高清屏图表发糊）；
- 顺手修正：水库过程图「无流量列不画」守卫原在取画布之后，已提前到取画布之前（判负时零绘制调用）；
- 新增 `tests/canvas2d-migration.test.js` 锁定迁移结果；`reservoir-process` / `soil-trend-views` 测试改造为异步桩 + 属性记录式 Proxy。

### 其他
- 删除项目根目录 `.ekko-tmp/` 临时目录（37MB、约 800 个历史脚本，已确认无保留价值，`9bd9c00`）；
- `PROJECT_HANDOFF.md`（196KB）拆分为 `README.md`（当前状态）+ 本文件（变更历史）。

## 2026-11-23

### 全盘代码评审（`0b3792e` 基线提交）
- 通读全部核心代码并跑通测试套件（49 项），项目自此进入 Git 管理；
- 评审结论：双坐标系处理、数据诚实口径、短临串行限流等设计良好；主要问题为两处 bug、失败可见性缺失、云函数无鉴权、旧 Canvas API。

### 两处 bug 修复 + 失败可见性改造（`a7ab9ec`）
- `detail.js`：删除重复定义的 `onPullDownRefresh`（后者覆盖前者，丢失 `loadFailed` 复位逻辑）；
- `rainfall.js`：雨量柱渐变对旧版 CanvasContext 误用 `fillStyle` 属性赋值不生效，改回 `setFillStyle`；
- `api.js`：列表/历史接口支持 `throwOnError` 严格模式（默认行为不变）；新增 `getStationGroups()` 聚合接口，返回 `{reservoirs, rivers, soils, failed, failedTypes, error}` 保留失败信号；
- 首页 / 列表 / 地图：区分「请求失败」与「暂无数据」，失败时渲染横幅 + 点击重试；
- 详情页：趋势数据加载失败给出可读提示，不再静默空白；
- 新增 `tests/failure-visibility.test.js`；更新 `data-integrity` 断言。

### 云函数共享密钥 + 站点列表短缓存（`b3e39b8`）
- 三个云函数入口增加 `API_TOKEN` 共享密钥校验（环境变量未配置时 fail-open 并打 `[auth]` 警告）；
- 前端 `httpGet` 统一携带 token；`check-deployed.js` 同步；
- `getStations`：成功结果缓存 2 分钟；部分类别失败标记 `degraded/failedTypes`；全部类别失败返回 502（前端进入失败态）或 30 分钟内回落过期成功结果。

### 废弃 API 迁移（`ec220c0`）
- 首页 / 详情 / 天气页三处 `wx.getSystemInfoSync()` 换成 `wx.getWindowInfo()`；同步更新测试 mock。

## 全量 UI 重设计基线（2026-08-14）

### 青黛 v4 · 静水（2026-09-22）

- 改造前完整备份：`<本地备份目录>`（90 个文件，`app.json` 与源版本一致）。
- 方向由用户确认：**深化青黛浅色高级感**——保留青色品牌，升级为玻璃拟态 + 分层光影 + 精细字阶 + 渐进入场动效。
- **纯视觉改造**：改动仅 7 个 `.wxss`、6 个 `.wxml`，以及 `app.json` 中两处遗留 TabBar 配色（`#999999`→`#8aa5b4`、`#1677ff`→`#0e4d64`）；全部 `.js`、云函数、数据字段、地图配置与 Canvas 绘制逻辑零改动（已用备份逐文件比对确认「改动其它: 无」）。
- 动效基础设施（`app.wxss`）：关键帧 `qd-fade-up / qd-pop / qd-fade-in / qd-slide-left / qd-slide-up-panel / qd-shimmer / qd-breathe / qd-aurora / qd-float / qd-sheen / qd-bar-grow`；工具类 `.anim-up / .anim-pop / .anim-fade / .anim-left` + `.d1~\.d8` 延迟分级 + `.stagger` 容器错峰；缓动 token `--qd-ease-out`（平滑减速）、`--qd-ease-spring`（回弹按压）。
- 光影 token：`--qd-e1/e2/e3`（接触层 + 中层 + 环境层）、`--qd-e-brand`、`--qd-hairline-top`（顶部 1rpx 内高光）。卡片统一为「微渐变底 + 三层阴影 + 顶部内高光」，取代原先的扁平白块。
- 玻璃拟态：`.glass` / `.glass-dark`；首页天气条、地图浮层、TabBar、详情头部图标均使用 `backdrop-filter: blur() saturate()`。
- TabBar 重做：悬浮玻璃胶囊（左右 24rpx、圆角 34rpx）+ `.tab-pill` 滑动药丸；位移由模板 `transform: translateX({{selected * 100}}%)` 数据驱动、CSS `transform` 过渡完成，因此无需改动 `custom-tab-bar/index.js`。
- 分段控件滑块：列表页 `.tab-bar.active-{type}`、地图页 `.filter-bar.active-{type}` 通过容器状态类平移滑块，同样是纯 CSS 方案。
- 骨架屏：新增 `.sk` 扫光骨架；首页天气加载态、气象页 `weatherStatus === 'loading'`、详情页加载态改为骨架屏，替换原空白区与旧 spinner。
- 新增门禁脚本：`node scripts/check-ui.js`（样式一致性审计：括号平衡、本地绝对路径、模板类名是否有定义、动态状态类选择器是否齐备、各页视觉契约与关键帧 token 是否落地）；`node scripts/run-tests.js`（一次跑完 `tests/` 全部用例）。
- 顺带修复两项既有缺陷：① `pages/index/index.wxss` 中未被 WXML 使用、且指向本机临时目录的 `.hero-waves` 死代码已移除；② 地图标题卡原先「渐变底板与 `.ic-map-w` 同元素」导致图标被 `background` 简写覆盖而不显示，改为底板 + 图标分层结构。
- 布局对齐：四个 Tab 页底部留白统一为 `calc(156rpx + env(safe-area-inset-bottom))`；地图页浮层（图例 / 定位 / 区域选择 / 站点面板）整体上移 128rpx，站点面板不再被悬浮 TabBar 遮挡。
- 验证结果：21 个既有测试全部通过且未修改任何测试文件；`scripts/check-ui.js` 审计通过；6 个 `.wxml` 的标签闭合与插值配对检查通过。


- 后续修订（同日）：首页「数据概览」由「大数字 + 右侧灰色长句」改为标准 KPI 结构——数值行 `126` + 单位「个」，含义行「中方县全域纳入监测站点」紧贴数值下方，消除「数字不知何意」的歧义；保留测试所需的「中方县全域纳入监测站点」原文与 `zhongfangStationCount` 字段，未触碰 JS。

### A 批次（语义去重 / 冗余清理 / 可读性与触控，2026-09-22）

针对「界面不恰当、不准确、易误解、冗余」的全面审查结论，先执行了纯前端可落地的 A 批次（未改任何业务逻辑）：

- **语义去重**：首页 Hero 去掉与导航栏标题重复的小标「ZHONGFANG · 水利监测」；概览卡去掉与指标标签重复的标题「中方县全域监测数据」（「数据概览」+「126 个」+「中方县全域纳入监测站点」三层已足够）；详情页「站点信息」删除与页头完全重复的「所在位置」行。
- **消除「假可点」**：删除 `.card:active`（详情/气象页所有静态卡片）、`.realtime-item:active`、`.hourly-item:active`、`.township-item:active`；加载占位条继承的按压态用 `.weather-loading:active{transform:none}` 抵消。现仅保留真正可点元素的按压反馈。
- **死按钮**：乡镇短临行原先只弹「乡镇降雨详情开发中」，已去掉 `bindtap`/`data-code` 与 `onTownshipTap` 空壳方法（该行改为纯信息展示，功能未实现前不再暗示可点）。
- **命名口径**：TabBar 与页面标题的「气象云图」改为「天气」/「天气与降水」（页面主体是分钟降水/逐小时/逐日/乡镇短临，云图仅其一且为示意），首页天气条入口文案同步为「天气详情」。
- **可读性**：全站 47 处 ≤21rpx 字号提升到 ≥22rpx（次级标签、图例、更新时间等），仅保留 3 处有理由的小字：`.data-unit`、`.soil-layer-depth text`（单位）、`.location-arrow`（装饰箭头）。
- **触控热区**：所有可点元素命中区提升到 ≥88rpx（44pt）。小图标按钮用透明 `::after` 外扩（面板关闭 25pt→44pt、搜索清除 26pt→44pt、7/15/30 切换 31pt→44pt、播放 32pt→44pt 等）；被裁剪容器内的元素改为撑开外层内边距（地图筛选栏解除 `overflow:hidden` 并外扩到 48pt，土壤指标 chip 与云图时间轴节点把滚动容器内边距撑开后外扩到 44pt）；搜索框直接加高到 44pt。
- **审计门禁增强**：`scripts/check-ui.js` 新增第 7 项（页面级 WXSS 不得有未被模板使用的死样式；app.wxss 通用原子类豁免）与第 8 项（有 `:active` 按压态的元素必须可点，picker 内胶囊与 `.weather-loading` 为例外），并已用「注入故障→确认能报→还原」自测通过。
- **验证**：21 个既有测试全部通过；`check-ui.js` 全绿；6 个 `.wxml` 标签闭合与插值配对通过；页面级死样式 0 个；残留 ≤21rpx 字号 3 处（均为单位/装饰）。

### B 批次（图表配色统一 / 图例对齐 / 状态提示，2026-09-22）

起因：Canvas 绘图与图例长期用两套配色，存在「图例颜色与图上实际颜色不一致」「图例描述了图上不存在的编码」等误导。本批次只改绘图配色与提示文案，未改动任何取数/阈值/业务逻辑。

- **图例与图形对齐（河道水文过程图）**：此前图例「水位」是青色 `#0e9bb8` 而实际曲线是旧亮蓝 `#1677ff`；「警戒水位」图例 `#d95f5f` 而实际 `#ff4d4f`。现已统一——水位曲线 → `#0e9bb8`、流量曲线 → `#0b4f8a`、警戒线 → `#d95f5f`，图例同步。
- **修复趋势图「曲线颜色与所选指标无关」的隐性问题**：`detail.js drawChart()` 原先按 `station.type` 硬编码颜色（壤土层一律绿色），导致选择「10cm 含水量」等指标时曲线颜色与该指标 chip 颜色不符；40cm 含水量与相对含水率更是直接落到默认蓝色。现改为**取当前所选指标自身的 color**，并新增 `hexToRgba()` 由该色派生渐变，chip 与曲线永远一致。
- **土壤指标配色统一**：`utils/soilTrend.js` 五个指标色由 antd 色板迁移到青黛色板，并与详情页「土壤剖面」分层条严格对应——10cm `#1f8fc4`、20cm `#12a5ac`、40cm `#7a63c9`（与 `.fill-10/20/40` 相同）、平均含水量 `#5f9e3a`、相对含水率 `#d49a2a`。
- **分钟降水图例改为如实描述**：原图例用三色标注「小雨/中雨/大雨」，但 `drawRainChart()` 实际用单一纵向渐变画所有柱体，三色编码在图上并不存在。现改为一条与柱体**同渐变**的色块 + 「柱高为逐分钟降水量（纵轴单位 mm）」，并删除失效的三色规则。
- **云图去 antd 蓝紫阶梯**：云团四档 `#d9f0ff/#7ec8ff/#388bff/#7c4dff` → 青黛青色阶梯 `#e6f5fb/#9fd8ef/#35a3c4/#0b4f8a`；底色、云团名称、风向箭头一并统一。Canvas 与图例（`.legend-dot.*`）严格同值。
- **「未来3天预报」标题如实显示**：云函数两个分支都未截断 `daily`，实际可能返回 5~7 天。改为 `未来{{weather.daily.length}}天预报`，并在 `daily` 为空时整卡不渲染（避免「未来0天预报」）。
- **短临预报失败不再静默消失**：原先 `nowcastStatus` 无人使用，短临接口失败时整张乡镇卡片直接消失，用户无法分辨「无数据」与「接口失败」。现新增失败态卡片：说明当前展示的是上次结果还是确无数据，并提供「重试」（复用 `onRefresh`，按钮同样满足 44pt 命中区）。
- **刷新提示与真实结果一致**：气象页 `onRefresh` 原先只要天气成功就提示「刷新成功」；现区分三种结果—— 全部成功 / 天气成功但短临失败（「天气已更新，乡镇短临预报暂不可用」）/ 天气失败。
- **验证**：21 个既有测试全部通过（未改动任何测试）；`scripts/check-ui.js` 全绿；`node --check` 语法检查通过；`detail.js`、`rainfall.js`、`utils/soilTrend.js` 中 antd 系旧色 **0 残留**。
- **仍未处理（C 批次）**：`utils/mapMarker.js` 的标记配色仍为 `#1677ff/#d48806/#d4380d`，因 `tests/map-marker.test.js` 将这三个色值写进了断言，改色需同步改测试。

### C 批次（状态语义 / 数据口径 / 地图配色 / 死代码，2026-09-22）

起因：B 批次统一了 Canvas 配色后，继续处理「云函数与前端在语义上会误导用户」的问题。本批次会改云函数与测试，但仍不改任何取数来源与业务规则。

**一、状态语义：供水不足不再表述为洪水「预警」**
- 事实核对：`status === 'warning'` 在云函数里**只有一处赋值**——水库水位低于死水位（`DDZ`），即供水不足，与洪水无关。
- 处理：`STATUS_TEXT.warning` 由「预警」改为「水位偏低」。同步云函数、`utils/stationStatus.js`、`utils/mapMarker.js`；首页禁止预警措辞的约束依然成立。
- 新增前端唯一来源 `utils/stationStatus.js`：`detail.js` 改为引用它；`list.js`、`map.js` 里同名 `getStatusText` **经核验无任何调用点**（列表/地图文案实际取自云函数 `statusText`），作为死代码删除。

**二、水库「正常水位」、河道「保证水位」不再等于警戒水位**
- 原实现：`normalLevel = warningLevel || XXZ`、`guaranteedLevel = BZSWZ || warningLevel`。上游缺字段时会把警戒水位回填给正常水位/保证水位，详情页于是把「正常水位」显示成「警戒水位」。
- 改为：上游未提供 `XXZ` / `BZSWZ` 时对应字段为 `null`，详情页已有 `wx:if` 守卫会隐藏该行，**宁可不显示也不显示错值**。

**三、墒情站「无数据」不再被判为「干旱」**
- 原实现：各层含水量全为空时 `moisture` 回退为 `0`，进而命中 `< 20 → drought`，列表与地图把**无数据的站点显示为红色「干旱」**，属误报（也与其自身「无数据字段返回 null」的注释矛盾）。
- 改为：全部为空时 `moisture = null`、`status = 'unknown'`、文案「暂无数据」；新增中性灰蓝配色 `.item-status.unknown`。前端 `index.js` / `list.wxml` 原本就把空值渲染为 `--`，因此数值展示不受影响。
- 阈值 `60/40/20` 提为具名常量 `SOIL_MOISTURE_THRESHOLDS`，并注明其为**现行固定阈值**（上游未提供逐站点墒情等级阈值；上游另有 FDCP/XDSD 字段，若需按土壤类型分级应由上游阈值驱动，不在前端经验推断）。

**四、地图标注配色并入青黛色板（§24 收尾）**
- `utils/mapMarker.js` 原用 antd 色（`#1677ff`/`#08979c`/`#389e0d`/`#d48806`/`#d4380d`）→ 改为青黛色板：水库 `#0b4f8a`、河道 `#0e9bb8`、墒情 `#5f9e3a`、通用 `#5e7f90`；告警红 `#d95f5f` **与图表警戒线同色**。
- 该文件此前被 `tests/map-marker.test.js` 的色值断言锁住，故同步更新断言（并补上 unknown、超警戒、旧色残留三项断言）。

**五、死代码清理**
- `utils/api.js`：删除 `getWarningList`（30 行，全仓无调用点；其 mock 分支引用的 `mockData.warningData` 在 `mockData.js` 中**根本不存在**，即返回 undefined）。导出表同步移除。
- `pages/rainfall/rainfall.js`：天气图标映射原有**两份完全相同的定义**（页面级方法与 `processWeatherDisplay` 内闭包），删除两份、提为模块级唯一 `WEATHER_ICON_MAP` + `getWeatherIcon`。

**六、顺带修正（由状态词汇表扩展带出）**
- 地图 `.panel-status` 与详情 `.soil-overview-status`、`.realtime-compare` 此前**没有任何状态配色变体**：超警戒、干旱与正常显示同一个颜色（土壤状态徽章恒为绿色）。现按 `list.wxss` 的口径补齐 warning/dry（琥珀）、danger/drought（告警红）、wet（青）、unknown（中性）。

**验证**
- 测试 **22/22 通过**（原 21 个 + 新增 `tests/station-status.test.js`）。该新测试**直接 require 云函数**并调用真实 `formatReservoirItem/formatRiverItem/formatSoilItem`，覆盖：正常水位≠警戒水位、保证水位≠警戒水位、无数据≠干旱、阈值边界、状态词汇表一致性、死代码不回流。为此云函数新增 5 个 `exports`（仅供测试，不改变 handler 运行时行为）。
- `scripts/check-ui.js` 全绿；8 个改动 JS 全部通过 `node --check`。
- 改动范围核验（对比 pre-batchC 备份）：9 改 2 增 0 删，**未改动任何 .wxml**，云函数改动仅限 `getStations`，`handler` 与地址纠错机制（`ADDRESS_CORRECTIONS`）保持原样。
- **需重新部署的云函数：只有 `getStations`**（本批次唯一被改动的云函数）。`getWeather`、`getStationHistory` 源码未变，无需重新部署；页面与 `utils/` 改动只需在微信开发者工具中重新上传/预览，不涉及云函数。

**遗留（未处理）**
- ~~`cloudfunctions/_archive/legacy-aggregate-function.js`~~ **已于 2026-09-22 按要求删除**（它保留旧的「预警」映射，存在被复制回流风险）；`cloudfunctions/README.md` 与本文档的引用已同步更新，备份中仍可找回。
- 详情页 `.station-status`（顶部胶囊）为状态无关的半透明白底样式，未按状态着色（深色页头上可读性尚可），如需区分可另行处理。

### D 批次（去掉「实时 / 数据更新中」类无据表述，2026-09-22）

清单一共 5 处界面文案断言了「实时 / 正在更新」，但数据实际来自按周期更新的监测接口，无法支撑这类时间承诺。按要求全部去掉，**只动文案，不引入新的时间承诺**。

| 位置 | 原文案 | 现文案 |
| --- | --- | --- |
| 首页 头部副标题 | 查看区域内站点**实时**更新情况 | 查看区域内站点更新情况 |
| 首页 概览卡胶囊 | **数据更新中** | *（元素移除）* |
| 首页 地图入口描述 | 站点分布 · 行政区边界 · **实时**数据 | 站点分布 · 行政区边界 · 监测数据 |
| 地图页 副标题 | {{区域}} · 点位**实时**分布 | {{区域}} · 点位分布 |
| 详情页 卡片标题 | **实时**数据 | 监测数据 |

- **首页「数据更新中」胶囊改为移除**，而不是换个说法：它是一个**静态断言**（无论数据是否加载完、是否过期，永远显示「更新中」），且卡片底部已有真实字段「最近数据更新时间 `{{latestUpdateTime}}`」，属于重复且不实的信息。移除后页面级 `.live-chip` 规则一并删除以避免死样式；app.wxss 的 `.live-dot` 与 `@keyframes qd-breathe` 作为设计系统工具保留（`scripts/check-ui.js` 的关键帧门禁也要求其存在），注释改为「设计系统状态指示器」。
- 保留未动的 JS 文案：`index.js` 的 `latestUpdateTime: '正在获取数据'` 是**加载占位**而非承诺，且 `tests/home-neutral-workbench.test.js` 锁定 `latestUpdateTime` 字段必须存在。
- 代码注释中的「实时」不属于界面文案，未改（`cloudfunctions/getWeather/index.js` 的功能说明、`utils/locationOptions.js` 中明确声明「不等同于设备实时定位」的说明）。
- **云图卡片（§5）按你的要求保持不动**——你正在自行编辑，`pages/rainfall/*` 的云图命名与「是否标注非实况」尚未决定。

**验证**：22/22 测试通过；`scripts/check-ui.js` 全绿；`verify-final` 模板标签与插值配对通过；界面文案扫描已无「实时 / 数据更新中」残留。

**部署提示**：本批次只动前端，重新上传/预览小程序即可，云函数无需再动（云函数侧只有 `getStations` 需要部署，见 C 批次）。

### 地图页乡镇选择回归修复（2026-09-22）

现象：地图页无法选择乡镇。

排查结论：`pages/map/map.js` 的乡镇逻辑（`onTownshipChange` / `resolveTownshipLocation` / `buildTownshipPolygons`）与改版前逐字节一致，`utils/locationOptions.js`、`utils/townshipBoundaries.js` 也未改动，因此问题只可能出在地图页的标记与样式层。与首页、天气页（两者乡镇选择正常）对比后，发现地图页的 `<picker>` 有三处**全项目独有**的写法，逐一加固：

1. **`bottom` 依赖 `env()`（最关键）**：地图页是全项目**唯一**把 `calc(Nrpx + env(safe-area-inset-bottom))` 放进**定位属性**的地方（其它页面都只用在 `padding` 上，失败了也看不出来）。一旦该声明被判定非法而整条丢弃，绝对定位元素会退回静态位置——正好落在 100vh 的地图下方，于是按钮「在代码里、却点不到」。
   → 四处浮动元素（图例 / 区域按钮 / 定位按钮 / 站点面板）全部改为**先给纯 rpx 降级值，再给带 env() 的版本**：
   `bottom:588rpx; bottom:calc(588rpx + env(safe-area-inset-bottom));`
   声明非法时前者生效，合法时后者覆盖，两种环境都正确。

2. **动画写在 `<picker>` 宿主上**：首页 `<picker class="location">`、天气页 `<picker class="location-row">` 的宿主都**没有**动画类；只有地图页写成了 `<picker class="region-btn anim-left d3">`。`animation-fill-mode:both` 会让宿主长期保留一个 transform，对自定义组件宿主属于未知行为。
   → 宿主改为纯定位容器；入场动效移到**内部普通 view**，并且改用**只动透明度**的 `anim-fade`（不动 transform）。

3. **`::after` 命中区写在 `<picker>` 宿主上**：首页是把样式与 `::after` 放在内部 view 上（已验证可用），地图页却放在宿主上。
   → 命中区改由内部 view 自己的 `min-height:88rpx`（≈44pt）保证，不再需要伪元素；视觉样式与 `:active` 反馈一并移到内部 view，与首页结构完全对齐。

4. **顺带修掉一个 v4 引入的真实回归**：`.map-data-summary` 在 v4 里丢掉了 `max-width:235rpx`，图例说明文字（约 24 字 × 22rpx ≈ 530rpx）会把图例撑到横跨大半屏，压在左下角的区域按钮上。已恢复上限，并把区域按钮 `z-index` 提到 110（高于图例的 100），确保它始终在图例之上。

**验证**：22/22 测试通过；`scripts/check-ui.js` 全绿；`verify-final` 模板标签与插值配对通过。
**待确认**：若仍未恢复，需区分是「按钮可见但无响应」还是「按钮位置不对/不可见」，前者指向宿主结构与事件，后者指向 `env()`/`bottom`；也可在开发者工具模拟器与真机各试一次（两者 `env()` 行为不同）。

### 「站点详情打不开」根因修复（2026-09-22）

现象：点击站点进入详情页，只看到「加载中…」，随后页面自己弹回。分两层原因，均已修复。

**第一层：请求失败被缓存成「空列表」，5 分钟内不会自愈**

`utils/api.js` 的三个列表请求都是这个写法：

```js
return stationCache.get('reservoir', async () => {
  try { ...; return res.data?.list || []; }
  catch (e) { console.error(...); return []; }   // ← 失败被当成「成功返回空列表」
}, { forceRefresh });
```

`stationCache` 只在 Promise **成功**时写缓存，所以这个「失败后的空数组」会被当作有效数据存满整个 `STATION_CACHE_TTL`（`utils/config.js` 里是 5 分钟）。后果：上游/端点抖一次（例如 `getStations` 重新部署的窗口期），站点列表会空掉、详情页找不到站点，**并且在 TTL 到期前不会自动恢复**。

修复：把 `try/catch` 从缓存内部移出，改为 `stationCache.get(...).catch(...)`。失败时 Promise 拒绝 → 不写缓存；调用方仍然拿到 `[]`，**对外行为完全不变**。

**第二层：失败态不可见，且会静默弹回**

`pages/detail/detail.js` 原实现：

```js
if (!station) {
  util.showToast('站点不存在');
  setTimeout(() => wx.navigateBack(), 1500);   // ← 没有 hideLoading()，且静默返回
  return;
}
```

`util.showLoading` 是 `mask: true` 的全屏遮罩，而这条分支**漏了 `hideLoading()`**（即审计中的 §25，一直未修）。配合模板结构 `<view class="page" wx:if="{{station}}"> … <view class="loading" wx:else>`，只要数据没加载出来，页面就永远停在「正在加载站点数据…」，1.5 秒后自己弹回——表现就是「详情打不开」。

修复：
- 补上 `hideLoading()`；
- 不再静默返回，也不再断言「站点不存在」（`getStationDetail` 无法区分「站点不存在」与「接口失败」，断言本身就是误导），改为**可见的失败态卡片 + 「重新加载」按钮**（`loadFailed` 标志 + `.load-error` 样式，按钮 ≥88rpx 命中区）；
- 新增 `retryLoad()`，并且**强制回源**（`forceRefresh: true`），否则重试会拿到同一份缓存；
- 补上缺失的 `onPullDownRefresh()`：`detail.json` 开了 `enablePullDownRefresh` 却没有实现处理函数，下拉后转圈不会停。

**第三层防御：详情页未命中时强制回源一次**

`api.getStationDetail` 在列表里找不到站点时，若非强制刷新，会**再强制回源查一次**，这样即使缓存里恰好是一份空/过期结果，详情页也能立即自愈。

**部署提示（重要）**：本项目的「云函数」是**阿里云函数计算（FC）的 HTTP 触发器**，地址硬编码在 `utils/config.js`：
`ALIYUN_FUNCTION_STATIONS_URL = <云函数触发器地址，见 utils/config.js>`。
FC 的公网访问地址带随机后缀，**一旦重新部署导致地址变化，就必须同步更新 `config.js`**，否则所有站点请求都会失败（这正是上面被修成「可见失败」的那种失败）。本批次只改前端。

**验证**：测试 **24/24 通过**（新增 2 个回归测试：`tests/detail-load-state.test.js`、`tests/station-list-cache.test.js`）。其中缓存测试做了反向自检——把修复回滚后该测试按预期失败，恢复后通过，确认它真的能抓住这个缺陷。另用 Node 桩环境跑了详情页 5 条路径（正常 / 取不到 / 抛错 / 重试 / 下拉）共 12 项断言全通过。`scripts/check-ui.js` 全绿。

### 详情页「监测数据」按同类成对重排（2026-09-22）

**用户反馈**：「入库流量和出库流量应该放在同一行才符合逻辑，水位可以和库存水量放一行」。

**原则**：指标按**语义同类**成对，而不是按数量两两塞满栅格。

| 站点 | 主指标带（并排） | 次级栅格（并排） |
|---|---|---|
| 水库 | 当前水位 ｜ 当前库容 | 入库流量 ｜ 出库流量 |
| 河道 | 水位 ｜ 流量 | 水温 ｜ 水质 |
| 墒情 | 平均土壤含水量（单格） | 饱和含水率 ｜ 相对含水率；地温（落单铺满） |

- 水库的「水位 + 库容」同属**蓄水存量**；「入库 + 出库」同属**进出流量**——原先按顺序两两塞进 2 列栅格，正好把「入库」和「出库」拆到了两行。
- 河道的「水位 + 流量」正是本站「河道水文过程」图上并排画着的两条曲线，同类且同源；「水温 + 水质」同属水质环境。
- 不做配对的部分：墒情站的「地温」与含水率不同类，保持整行铺满，不强行凑对。

**实现**
- `detail.wxml`：`.metric-hero` 由「整宽单指标」升级为**主指标带**，内部改为 `.metric-hero-cell` 指标格；水库的库容格、河道的流量格由此移出栅格并入带内；两格之间用显式 `.metric-hero-divider` 细分隔线（单格时不渲染，**不用 `:only-child` 等伪类**，避免真机失效）。
- 带子触发条件相应放宽：水库 `currentLevelText !== '--' || showVolume`、河道 `waterLevelText !== '--' || showFlow`，保证「只有库容没水位」时数据不丢。
- `detail.wxss`：`.metric-hero{display:flex;align-items:stretch;overflow:hidden}`（**不用 gap**）、`.metric-hero-cell{flex:1 1 0;min-width:0;padding:26rpx 22rpx}`、带内数值降一档 `52rpx`（两格并排时 62rpx 会挤压，仍高于栅格 42rpx）；原 `.realtime-compare`（占总库容）改名为 `.metric-hero-note` 并删除旧规则。
- `tests/detail-monitoring-layout.test.js`：新增 6 条**同类并排**结构断言（水位/库容必须在带内、入库/出库必须在栅格、库容与流量不得重复出现在栅格、水温/水质成对）。

**验证**
- 渲染面校验：23 个站点（16 个真实 mock + 7 个边界）逐站打印布局，**0 处失配、0 个空洞**；「只有库容没水位」「只有水质没水位」「空态」均正确。
- 反向自检 8/8：把库容塞回栅格、把流量塞回栅格、在带子里重新用 `gap` —— 三种故障都被拦住；还原后字节一致。
- 预览量测（真实 WXSS + 真实数据）：水库主指标带两格 `159 / 159`（含 1 条分隔线），栅格两格 `157 / 157`；单格带 `319` 铺满；空栅格高度 `0` 不占位。
- 25/25 测试通过；`scripts/check-ui.js` 全绿。

### 真机指标块竖排（flex gap 失效）修复（2026-09-22）

**现象**：用户上传后反馈「还是这个样」——详情页「监测数据」里的指标块仍是一个一行竖着排。

**诊断**（对用户手机截图做像素级测量，非同猜测）：

```text
卡片左右边缘      x ≈ 8 / 349
主指标块边框      x ≈ 24..333      → 整行铺满，说明新样式已生效
第 1、2 指标块    x ≈ 24..172（宽 50%），文字中心 x ≈ 100，圆角出现在 x≈24 / x≈172
第 3 指标块       x ≈ 24..333（宽 100%），文字中心 x ≈ 178
三个块水平起点相同且各自独占一行   → 容器没有按 flex 行排列
```

结论：`width:calc(50% - 7rpx)` 生效、`.realtime-item:last-child:nth-child(odd){width:100%}` 也生效，
唯独 `.realtime-grid{display:flex;flex-wrap:wrap;gap:14rpx}` **整条失效** → 容器退化为块级，
50% 宽的块只能一个一个竖着排。该规则里唯一真机不支持的声明就是 `gap`：
**真机基础库不支持 flex 的 `gap`，且会让整条规则失效**（不是仅忽略间距）。这同样解释了用户最初的「布局不合理」。

**修复**

| 位置 | 改法 |
|---|---|
| `.realtime-grid` | 去掉 `gap`，改 `justify-content:space-between`（子项 `calc(50% - 7rpx)` 恰好留 14rpx 缝）+ `overflow:hidden` |
| `.realtime-item` | 加 `margin-bottom:14rpx` 做行间距；加 `float:left` 兜底（flex 生效时 float 对 flex item 无效；若 flex 也失效则退化为两列浮动，而非竖排） |
| `.skeleton-grid` / `.skeleton-tile` | 骨架屏与真实栅格同构，同步去 `gap` |
| `.river-chart-legend` / `.river-legend-item`、`.visual-legend` / `.visual-legend-item`、`.rain-legend` | 同一缺陷的其余 4 处，改由子项 `margin` 提供间距 |
| `scripts/check-ui.js` | 新增第 9 道闸门：WXSS 中禁止 `gap` |

**验证**
- 反向自检：注入 `gap` → 审计按预期报错（`pages/detail/detail.wxss:41`）；还原后审计通过、文件字节一致
- 用真实 WXSS + 真实数值生成两份 HTML 预览，在浏览器里量测块宽：
  - 正常路径 `157 / 157 / 321`（两列 + 落单项铺满，缝 7px = 14rpx）
  - **强制 `display:block`（模拟 flex 完全失效）**同样是 `157 / 157 / 321` 两列 → 兜底有效
- 25/25 测试通过；`scripts/check-ui.js` 全绿

**未改**：`calc()` 内含 `rpx` —— 本次测量同时证明它在本机生效（块宽确为 50%），故全仓其余 `calc` 用法无需改动。

### 详情页「监测数据」板块分区重构（2026-09-22）

现象：用户反馈「站点详情内的监测数据板块布局不合理」。实测结论如下。

**问题一：栅格空洞**
```css
.realtime-item{width:calc(50% - 7rpx)}   /* 两列 */
.realtime-item:only-child{width:100%}   /* 只有 1 项时才铺满 */
```
只有「恰好 1 项」有兜底，**3 项就会在右下留一个空洞**。按真实数据核对：6 个墒情站**全部**留空洞（指标区 1~3 项），水库/河道当前各 4 项侥幸不缺，但真实上游少一个字段就会立刻露洞。

**问题二：一个 flex 容器里混装三种东西**
墒情站的 `.realtime-grid` 里同时塞了 `.soil-overview`（全宽）、`.soil-profile`（全宽）、`.soil-section-title`（无宽度 → 被当成 flex item，缩成一小截）、以及 5 个 50% 指标块。分区标题因此表现为「意外的小标签」而不是分区标题。

**问题三：语义错位**
`默认监测层`（10cm）和 `土壤类型`（红壤）是**站点固有属性**，没有时间维度，却被放进「监测数据」栅格与实时值并列，容易被读成实时数据。同类属性（总库容/正常水位/警戒水位）本来都在「站点信息」里。

**问题四：层级缺失**
`当前水位`（带「距警戒 x m」）与`入库流量`同为 50% 等宽等大字号，没有主次。同时 `超警戒` 时 `diff` 为负，直接渲染会出现「**超警戒 -2.35m**」。

**改法**
1. **主指标全宽**：新增 `.metric-hero`（三类站点统一形态：左侧标签 + 右上状态胶囊 + 大号数值）。水库/河道是水位，墒情是含水量；`--` 时整块不渲染，不再出现大号 `--`。
2. **次级指标进栅格**：水库（库容/入库/出库）、河道（流量/水温/水质）、墒情（饱和/相对/地温）最多各 3 项。
3. **栅格只放指标块**：`.soil-profile`／分区标题／说明全部移到栅格之外，栅格内只剩 `.realtime-item`；并补上**落单项铺满整行**（`.realtime-grid .realtime-item:last-child:nth-child(odd){width:100%}`），1~4 项都不再留洞。
4. **语义归位**：`土壤类型`／`默认监测层` 移入「站点信息」卡片。
5. **层级与文案**：`metric-hero-value` 62rpx 作为唯一主数值；警戒差值改取绝对值并区分 `near`/`over` 配色（超警戒转告警红）；库容占比说明由「占比 78.4%」改为「**占总库容 78.4%**」，消除指代不明。
6. **空态**：`display.hasMonitoringData` 精确等于「模板至少渲染出一个元素」，全字段缺失时显示「该站点暂未上报监测数据」，避免只剩标题的空卡片；该等价关系由测试锁定。
7. **样式类更名**：`.soil-overview*` 系列整体并入通用的 `.metric-hero*`（下方 Batch C 记录里提到的 `.soil-overview-status` 即为本次更名前的旧类名），`.realtime-compare` 的旱情状态色变体因失去引用而删除。

**验证**：测试 **25/25 通过**（新增 `tests/detail-monitoring-layout.test.js`：空态等价关系、栅格纯净性、静态属性归属、落单项铺满规则、警戒差值绝对值）。该测试做了反向自检——把区块混回栅格 / 让空态判定失真 / 把静态属性放回监测数据 / 删掉铺满规则，四种破坏全部被捕获。另用真实 mock 数据跑了 45 项渲染面断言（5 类站点 + 边界场景），并用真实 WXSS + 真实数值生成 HTML 预览目视核对。`scripts/check-ui.js` 全绿。

### 天气页「气象图层」（雷达回波 / 风向风速）重构（2026-09-22）

把原来那张**合成示意**的「气象云图与风场」卡片整个替换为真实数据的「气象图层」卡片：
雷达回波用 RainViewer 真实瓦片，风向风速用 Open-Meteo 真实网格 + canvas 粒子平流，
底图改为按**真实乡镇边界离线烘焙**的区域底图（`assets/basemap/zhongfang.png`，1024×1024，约 182KB）。

#### 免费数据源的实测边界（决定了整个方案形态）

| 结论 | 证据 |
|---|---|
| 雷达只有「过去约 2 小时、每 10 分钟一帧」共 12 帧，`radar.nowcast` 恒为空数组，无未来帧 | `weather-maps.json` 实测并多次复测 |
| 雷达瓦片在 **z≥8 恒定返回空图**（恒为 1370 字节），z≤7 才有回波（约 1.2km/像素） | 逐层级下载比对瓦片体积 |
| 瓦片 URL 的 `color` / `options` 段**不生效**，配色固定（浅金 → 橄榄 → 青 → 深蓝） | 同一瓦片换 color=0/1/2/4/6/9 与 options=1_1/1_0，返回**字节完全相同** |
| 风场一次 GET 可取回整片网格（99 点约 40KB），返回坐标会被吸附到模式网格 | Open-Meteo 多点批量实测 |

因此视窗取 **200km**（县域约占画布宽 1/3，雷达仅被放大 1.3 倍 ≈ 原始分辨率），
时间轴只做「过去 → 现在」，**不做预报演进**（免费源没有未来帧）。

#### 新增 / 变更

- 新增 `utils/geoLayer.js`：视窗、等距圆柱投影（带 cos 修正、严格仿射）、瓦片换算、距离换算。页面与烘焙脚本共用同一套投影，这是配准的前提。
- 新增 `utils/layerRadar.js`：帧列表、瓦片 URL、瓦片规划、LRU 缓存、播放索引（纯计算，可被 Node 直测）。
- 新增 `utils/layerWind.js`：网格取点 / 拼 URL / 解析 / 双线性插值 / 粒子推进与拖尾。**风向＝来向**，屏幕 y 向下故 u=-s·sinθ、v=+s·cosθ。
- 新增 `scripts/bake-basemap.js`：纯 Node（自带 PNG 编码器 + 扫描线光栅化 + 盒式模糊）生成烘焙底图，无需任何图像库。
- 新增 `assets/basemap/zhongfang.png`：青黛浅色矢量底图 + 0.5° 经纬网 + 县境光晕 + 12 乡镇填色与边界。
- 改造 `pages/rainfall/*`：替换云图卡片为「气象图层」；canvas `type="2d"`；图层切换、时间轴（`scroll-into-view` 跟随当前帧）、距离环、县名标注、画布内状态提示、失败重试。
- 删除 `utils/weatherVisual.js` 与 `tests/weather-visual.test.js`（合成云图实现彻底移除）。

#### 踩到的坑（可复用）

- **Node 的 Buffer 写浮点会按 `&255` 环绕，不是裁剪**。烘焙底图第一版把噪声幅度调大后出现"假彩色斑块"，根因是 `buf[i] = 249 + n*22 = 266` 被环绕成 10（而回读检查显示"越界 0 个"）。改用 `Float32Array` 累积、编码前统一裁剪取整后正常（278873 个越界分量被正确裁剪）。
- 真机并发：瓦片下载限 4 并发、LRU 缓存 60 条、只预取当前帧 ±1 帧。
- 真机兼容照旧：新样式不使用 flex `gap`、不使用除 `::after/::before` 之外的伪类（已加测试锁定）。
- 画布宽度按真实内边距推算（页面 24rpx + 卡片 28rpx + 外壳 8rpx = 120rpx），不能沿用降水图的 `windowWidth-104`，否则地图右侧会留空。

#### 验证

- **配准**：把真实雷达瓦片、烘焙底图、真实乡镇边界、真实站点坐标放在同一投影下渲染，边界**完全重合**（`.ekko-tmp/preview/layer-preview.html`）。
- **视觉**：`.ekko-tmp/preview/layer-visual.html`（真机 375px 尺寸，真实瓦片 + 真实风场 + 真实时间轴）。
- 测试 **28/28 通过**（新增 geo-layer / layer-radar / layer-wind / weather-layer 四组），样式审计 9 道闸门全绿。

#### 上线注意

- 需在小程序后台「开发设置 → 服务器域名」添加：
  - **request 合法域名**：`https://api.rainviewer.com`、`https://api.open-meteo.com`
  - **downloadFile 合法域名**：`https://tilecache.rainviewer.com`
- **不需要重新部署任何云函数**（本次为纯前端 + 本地资源改动）。
- 若要「未来帧」与县域级清晰度，须换彩云「雷达图 / 预报雷达图」（企业套餐），只需替换 `utils/layerRadar.js` 的取帧与取图实现。

#### 全屏查看与缩放（2026-09-22 追加）

卡片态画布只有 315px 宽，全景看偏小。补上「全屏 + 双指缩放 + 单指平移」：

- **全屏**：同一张 canvas 节点，靠 `.weather-layer.fullscreen` 提升为固定面板（`position:fixed`），
  只重设画布像素尺寸与投影，不复制第二份绘制代码。
  `z-index:900` **低于悬浮 tabBar 的 999**，底部让出 `140rpx + env(safe-area-inset-bottom)`（先给纯 rpx 兜底），
  这样导航仍然可用，也避免自定义 tabBar 隐藏不掉的问题。
- **缩放/平移**：`geoLayer.zoomView(view, factor, ax, ay)`（以双指中点为锚点，锚点下的地块保持不动）、
  `panView`、`clampView`（把视窗钳制在烘焙底图范围内，否则会露白）。上下限 `MIN_SPAN_KM=28`、`MAX_SPAN_KM=260`。
  画布用 `catchtouchstart/move/end` 绑定，**防止拖动时整页跟着滚**。
- **风场不变形的关键**：采样从「按画布归一化坐标」改为**按经纬度**（`layerWind.sampleFieldAt`），
  粒子推进改为注入采样器 `advanceParticles(particles, sampler, …)`。
  否则缩放平移时风场会跟着视窗一起被拉伸。
- **越放大越细腻**：视窗跨度跨档（1.4 倍一档）或网格相对视窗偏粗（>2.2 倍）时才重新请求，
  取样范围比视窗大 30%（小幅平移不重复请求），并用 420ms 防抖。
  实测放大 2.6 倍后网格自动加密到约 11km 一格，流线明显变密。
- **如实提示**：免费雷达只有 z≤7（约 1.2km/像素），放大到一定倍率会提示
  「雷达原始分辨率约 1.2km，再放大只是插值放大（换彩云企业版可解决）」；
  风场在视野小于 22km 时提示「风场网格约 10km，再放大只是插值放大」。

**顺带修掉一个公式错误**：`clampView` 在「视窗比允许范围还大」时的纬度居中分支符号写反，
会让中心偏掉半个跨度——由新增的单测抓到。

验证：`tests/geo-layer.test.js`（缩放锚点不动、跨度按比例、上下限、平移像素对应、钳制不越界）
与 `tests/weather-layer.test.js`（全屏入口、catch 手势、钳制、按经纬度采样、按需加密、z-index 与安全区）
全部通过；视觉验收 `.ekko-tmp/preview/layer-fullscreen.html`。

#### 单指缩放与「进入全屏即取景县域」（2026-09-22 追加）

真机反馈：卡片只有一个 315px 宽的画布，「这样看有点小了」。

排查出两个真问题：

1. **全屏本身几乎没放大**。全屏画布 351px 宽，只比卡片宽 11%，视野仍是 200km。
   用户点「全屏」看到的是「几乎没变化」——因为放大原本只挂在双指手势上，
   而**开发者工具无法模拟画布上的双指捏合**，连验证都没法验证。
2. **卡片↔全屏会把地图拉长**。视窗只在首次创建时按画布比例算过一次，
   之后全屏复用同一视窗，但画布宽高比变了 → 两轴「每公里像素」不等，底图与站点被纵向拉伸约 15%。

修法：

- 新增 **`－ / ＋ / 县域`** 按钮条（`onLayerZoom` + `data-dir`），单指即可缩放，
  开发者工具里也能直接验证；旁边实时显示「视野约 XX km」。双指捏合与单指拖动保留不变。
- **进入全屏自动取景县域**（`geoLayer.viewForCounty`，约 92km 视窗）：
  县域占画布宽 34% → 79%，画面放大约 2.2 倍，点一下就能看细节。
- 新增 **`geoLayer.applyAspect`**：画布宽高比变化时保留中心与纵向跨度、按新比例重算东西跨度，
  两轴像素比严格相等（实测差 9e-15），不再拉伸。
- 风场网格随视窗加密（200km 时约 28km 一格 → 92km 时约 13km 一格），放大后流线更密。
- 雷达「放大后偏柔化」提示只在全屏出现，常态卡片不再打扰。

验证：`geo-layer.test.js` 增 2 条（比例切换不拉伸、县域取景完整且占宽 >60%），
`weather-layer.test.js` 增 1 条（按钮齐备 + 进入全屏必须自动取景）。
反向自检：把 `applyAspect` 改成直通 → 拉伸用例失败；去掉全屏自动取景 → 集成用例失败（2/2 捕获后还原）。
视觉验收 `.ekko-tmp/preview/layer-zoom-preview.html`（34% → 79% 对比）。

#### 缩放改为纯手势（2026-09-22 追加）

按用户要求撤销 `－ / ＋ / 县域` 按钮，缩放只保留手势：

- 卡片态与全屏态**本来就都能双指缩放**（`onLayerTouchStart/Move/End` 没有任何全屏判断）。
  现在用测试锁死这一点：逐个方法体断言不得出现 `layerFullscreen`，
  防止以后有人再加「仅全屏可缩放」的分支。
- `县域` 按钮改为 **`重定位`**（`onLayerRecenter` + `geoLayer.recenterView`）：
  把视野拉回县域正中；若当前比「能看全县域」还近，则退回到能看全县域那一档
  （按一下一定看得到县域）；本来就看得更远时只回中、不改缩放倍数。
- 卡片态补一行「双指缩放 · 单指拖动平移」——没有按钮之后，不提示就没人知道可以捏合。

⚠️ 取舍：微信开发者工具**无法模拟画布上的双指捏合**，去掉按钮后捏合只能真机验证。
若后续需要开发工具可测，可加双击放大（属于手势，不新增按钮）。

反向自检 3/3：给 `onLayerTouchStart` 加全屏判断 → 失败；重定位不走共享几何 → 失败；
`recenterView` 不真正居中 → 失败。

### 小程序包体积超限修复（2026-09-22）

真机调试报 `Error: 系统错误，错误码：80051, source size 10248KB exceed max limit 2MB`。

**原因**：开发过程产生的临时目录 `.ekko-tmp`（预览 HTML / 验收截图 / 探针脚本 / PNG 调试转储）
留在项目根下，被一并打进小程序包——该目录 265 个文件 / **13,075 KB**，而应用本体只有 785 KB。

**修法**：在 `project.config.json` 的 `packOptions.ignore` 中排除开发期目录：

```json
"packOptions": {
  "ignore": [
    { "type": "folder", "value": ".ekko-tmp" },
    { "type": "folder", "value": "tests" },
    { "type": "folder", "value": "scripts" },
    { "type": "suffix", "value": ".md" },
    { "type": "prefix", "value": ".ekko-tmp" }
  ],
  "include": []
}
```

（`prefix` 是兜底：不同版本对「点号开头目录」的匹配行为不一致。）

结果：进入小程序包的文件由 369 个 / 13,900 KB 降到 **64 个 / 832 KB**（上限 2048 KB，余量充足）。
已核对包内清单包含全部 `pages/`、`utils/`、`assets/`、`custom-tab-bar/`、`cloudfunctions/`；
并核对应用代码**没有任何**对 `tests/`、`scripts/`、`.ekko-tmp/` 的引用，排除不会影响运行时。
另外删除了 4 MB 的 `.ekko-tmp/basemap-raw.bin`（PNG 编码器调试转储，可由 `scripts/bake-basemap.js` 重新生成）。

**约束**：后续所有开发期产物（预览、截图、探针脚本、转储）一律放进 `.ekko-tmp/`；
不要再往项目根或 `pages/`、`assets/` 里丢调试文件，否则会重新顶到 2MB 上限。

### 天气页新增「未来降雨影响」与逐小时雨量柱（2026-09-22）

背景：天气页信息不少，但**一个 mm 汇总都没有**——只有「降雨概率 %」「每乡镇 3.2mm」这类碎片；
水利真正要的是「全县未来会下多少毫米」。概率是给生活天气用的，毫米才是给水利用的。

新增（纯前端，**不改云函数、不加新接口、无需重新部署**）：

1. **`utils/rainImpact.js`（纯计算，Node 可测，同 geoLayer / layerRadar 的做法）**
   - 未来 6h / 12h / 24h 累计 = 逐小时 `rain` 前 N 小时求和（脏数据过滤：NaN / 负数 / 缺 time 不计入）；
   - 雨量等级按 **GB/T 28592-2012**：12h 与 24h 各一套表，
     **只有覆盖时长正好等于 12 / 24 小时才给等级**；覆盖不足时标签改成实际小时数且不给等级——不套错表；
   - 最强小时（mm/h + 时段）、未来 2 小时雨中心（乡镇短临累计最大者，全为 0 时不指任何乡镇）；
   - 小时雨强的 light / moderate / heavy / storm 是**强度参考档**（≤2.5 / ≤8 / ≤16 / >16 mm/h）：
     国标没有 1 小时等级表，所以只用来说明柱高与配色，不对外称「等级」。
2. **天气页「未来降雨影响」卡片**：三档 mm（显式分隔竖线）+ 等级 chip（按档配色）+ 最强小时/雨中心一行 + 一句结论；
   拿不到逐小时预报时**整卡不渲染**（不显示 0mm 冒充「无雨」）；无雨时给出「未来24小时无明显降雨」。
3. **逐小时卡片雨量柱**：柱高按小时雨强归一化（16mm/h 满格、有雨至少 12%，否则微量看不出），
   配色与雷达图例同一套色阶（#a8dff2 / #35a3c4 / #0b4f8a / #6a4bb8）；柱体在轨道内绝对定位，不撑高卡片。

口径与边界（重要）：
- 三档都是**未来**累计。**过去实况降雨拿不到**（彩云 realtime 不提供历史降水），
  所以「土壤是否已饱和 / 水库是否已有来水」这类回顾性判断仍缺数据源，需要另接历史降水接口（和风有，需改云函数）；
- 雨中心来自乡镇短临，是**未来 2 小时**口径，界面文案与测试都写明，不含糊成「累计」；
- 结论文案只做事实描述，不使用「关注 / 预警 / 风险 / 态势」，与首页口径一致（测试里锁死）。

验证：新增 `tests/rain-impact.test.js`（12/24 小时表边界、脏数据过滤、覆盖不足降档、
最强小时、雨中心、空态、文案禁用词、柱高与配色、WXML 与接线锁），全量 **29/29 通过**，9 道样式闸门全绿。
反向自检 3/3：覆盖不足也套等级表 → 失败；短临加载后不重算 → 失败；微量降雨柱高为 0 → 失败（均已还原）。
视觉验收 `.ekko-tmp/preview/rain-impact.html`（真实 Open-Meteo 逐小时降水 + 一次典型降雨过程），
浏览器实测：轨道 32px、柱 100% 时正好 32px 且不出轨道、chip 右对齐到卡片边缘。

### 和风凭据落地 + 修掉一个「照原样部署必然全灭」的缺陷（2026-09-25）

**背景**：用户在控制台建好凭据，给出四条值 —— 凭据ID `KMGTQX87JA`、开发者ID `Q951EA1D04`、项目ID `4EE276V2CQ`、
API Host `km3aatd4f8.re.qweatherapi.com`。用本地已生成的 Ed25519 私钥就近装配后**真打接口**验证。

#### 一、凭据本身没问题（三条实测）

| 探测 | 结果 |
| --- | --- |
| `GET /v7/minutely/5m?location=110.115186,27.509196` + `Authorization: Bearer <JWT>` | **HTTP 200**，`code:"200"`，`summary:"未来两小时无降水"`，24 档 |
| `GET /weather/v1/current/27.509196/110.115186` + 同 | **HTTP 200**，嵌套结构（气温 25.6 / 湿度 0.74 / 风速 2.17 m/s / 风级 2 / 能见度 26800 m） |
| 同上但不带 `Authorization` | **HTTP 401** `Authentication failed, check your KEY/Token or Host` |

第三条是关键：**401 说明和风确实在验签**，所以第一条的 200 不是「接口不校验」的假通过 —— 公私钥配对成功。

本地签出的 JWT：`header {"alg":"EdDSA","kid":"KMGTQX87JA"}` + `payload {"iss":"Q951EA1D04","sub":"4EE276V2CQ","iat":now-30,"exp":iat+930}` ✓ 与官方规格一致。

#### 二、★ 发现的缺陷：和风新 API Host **无条件返回 gzip**

端到端跑真 handler 时，两类接口全部失败：

```
[nowcast] 中方镇 取数失败 :: JSON 解析失败        （12 个乡镇全灭）
常规天气 → HTTP 502（v1 与 v7 两代都失败）
```

**根因**：`httpsGetJson` 原来是

```js
let data = '';
res.on('data', (chunk) => data += chunk);   // ← 把压缩字节当字符串拼
resolve(JSON.parse(data));
```

而和风新 Host **即使请求里没写 `Accept-Encoding` 也照样 gzip**（实测两个接口的响应头都是
`content-encoding: gzip`，响应体以 `1f 8b` 开头）。压缩字节被当字符串拼，`JSON.parse` 必然失败。
**也就是说：这个缺陷与凭据对错无关，照原样部署上去，和风分支（短临 + 常规天气）会 100% 取不到数。**

顺带还有第二个隐患：`data += chunk` 逐块转字符串，**分块边界切在多字节汉字中间会产生乱码**。

**修法**（`cloudfunctions/getWeather/index.js`）：新增统一解码

```js
function decodeHttpBuffer(buffer, contentEncoding)   // gzip / deflate / br，且按 1f 8b 魔数兜底识别
function decodeHttpBody(buffer, contentEncoding)     // → UTF-8 文本
```

三处 HTTP 读取全部改为「**先收集 Buffer → 统一解码 → 再 JSON.parse**」：

| 位置 | 用途 |
| --- | --- |
| `httpsGetJson` | 和风短临 + 和风常规天气 + RainViewer 元数据 |
| `httpsGetCaiyun` 签名分支 | 彩云（同类风险一并消除） |
| `httpsGetBuffer` | 雷达回波瓦片（PNG，按 content-encoding 解码后再交给 PNG 解码器） |

`zlib` 是 Node 内置，阿里云 FC 运行时无需额外依赖。

#### 三、顺带修掉一个会写假结论的死代码

真数据一跑就露出来：**无雨乡镇返回 `peakMinute: 0`**，即「最可能第 0 分钟最强」。
成因是 `peakMinute: ok ? (peakMinute === null ? peakFrame.minute : peakMinute) : null` ——
无强度峰值时退回 `frames[0].minute`（= 0）。而 `willRain` 为真时 `findPeakMinute` 必然有值，
**这个兜底在所有展示路径上都是死代码**，唯一作用就是给「真无雨」的乡镇写一个编出来的时刻。
改为 `peakMinute: ok ? peakMinute : null`（前端本来也只在该乡镇 `willRain` 为真时才显示「N分」）。
已在 `tests/nowcast-integrity.test.js` 的「有数据但无降雨」用例里补上断言。

#### 四、验证

| 验证 | 结果 |
| --- | --- |
| 新增 `tests/qweather-http-encoding.test.js`（13 项） | 全部通过 |
| 真实夹具 `tests/fixtures/qweather-v1.json`（55.8 KB） | 2026-09-25 从真和风 Host 抓的 current/hourly/daily/minutely 原文 |
| 反向自检 `.ekko-tmp/selftest-http-gzip.js` | **6/6 全部抓住**，还原后逐字节一致（`168ee4ac9007`） |
| 全量测试 | **38/38 通过** |
| `check-ui` | 绿 |
| 端到端（真 handler + 真凭据，16 次真实请求） | 短临 `success=true ok=12/12 source=qweather`；常规天气 HTTP 200 |

端到端真数据（2026-09-25 23:47）：

```
[nowcast-q] 口径自检 中方镇：24 档合计 0.00mm，强度峰值 0.00mm/h，上游 summary「未来两小时无降水」
[qweather] 形态自检 v1：实况湿度 → 74%，风级 → 2级；首个逐小时 → 00:00，雨量 → 0mm；首日 → 9/25，概率 → 0
current = {温度26, 体感27, 湿度74, 风向西北偏西, 风级2, 7.8km/h, 晴, 气压1011, 能见度26.8km, 紫外线0}
```

**单位口径已用真数据逐项核对通过**：v1 湿度 0-1 →×100 得 74%；风速 m/s →×3.6 得 7.8km/h（与上游 `scale:2` 自洽）；
能见度米 →26.8km；`16:00Z` → 北京时间 `00:00`；`2026-09-24T16:00Z` → `9/25`（跨日正确）。

#### 五、还差什么

1. **把 5 个环境变量填进云函数并重新部署**（值见 `<本地密钥目录>/env-values.txt`，
   该文件在项目之外，不会被打包）。环境变量改动必须重新部署才生效。
2. **前端也要重新上传**（短临按需获取那一版）。
3. 部署后探活：`?mode=nowcast&provider=qweather` 看 `source:"qweather"` 与 `okCount:12`；
   常规天气看 `current` 是否有 `windSpeedKmh`（本轮之前线上缺这两个字段）。
4. 日志核对 `[qweather] 形态自检 v1` 与 `[nowcast-q] 口径自检` 两行 —— 它们是「换算有没有差 12 倍」的自证。

### 环境变量交付 + 线上「字符串经纬度」缺陷（2026-09-26）

用户问「能不能直接帮我填入环境变量」。结论：**不能代填**（阿里云函数计算的环境变量只能在控制台/凭据化的 CLI 里改）：本机没有 `s`（Serverless Devs）、`aliyun`、`tcb` 任一 CLI，没有 `~/.serverless-devs`、`~/.aliyun` 登录态，仓库里也没有 `s.yaml` / `serverless.yml`；浏览器工具打开 `fcnext.console.aliyun.com` 直接跳登录页，而登录需要用户本人扫码/账密，不应代持。

于是交付了两样「让手工这一步不出错」的东西：

| 交付物 | 位置 | 作用 |
| --- | --- | --- |
| `env-paste.txt` | `<本地密钥目录>`（项目外） | 5 行 `KEY=value`，全选复制即可粘进控制台「键值对」模式 |
| `env-paste.json` | 同上 | 同一份内容的单行 JSON，对应控制台的 JSON 编辑模式 |
| `scripts/check-deployed.js` | 仓库 | 一条命令自查线上三个函数是否真的生效 |

生成的 `env-paste.txt` 做过两道自检：私钥 B64 与既有 `env-values.txt` 完全一致、B64 解回后与 `ed25519-private.pem` 逐字节一致（防止换行符被污染）。

#### 一、★ 线上基线实测：天气两条链路现在都是坏的

`node scripts/check-deployed.js` 跑出来的真实线上状态：

| 探测 | 结果 |
| --- | --- |
| 常规天气 `?latitude=…&longitude=…`（不传 provider） | HTTP 200，`pressure:null`、`visibility:13`、`windSpeed:13`、无 `windSpeedKmh` ⇒ **旧代码** |
| 常规天气 `?…&provider=qweather` | **HTTP 500** `{"error":"longitude.toFixed is not a function"}` |
| 短临 `?mode=nowcast&provider=qweather` | HTTP 200 但 `source:"caiyun"`、`okCount:0/12`、`degraded:true` ⇒ **旧代码 + 彩云全灭** |
| 站点列表 | HTTP 200，106 个水库站点，11.6s |

#### 二、★ 顺带挖出一个真实缺陷：`longitude.toFixed is not a function`

线上带 `provider=qweather` 时 500，根因是 FC 的 `queryParameters` **所有值都是字符串**，而旧代码直接对字符串调 `.toFixed(...)`。

- 本仓库的新代码全程用 `Number(latitude).toFixed(2)` / `Number(longitude).toFixed(4)` 包裹（见 `fetchQWeatherWeather`、`coordKey`），本来就不会踩这个坑；
- 但既然线上真实炸过，就锁成回归测试：`tests/qweather-http-encoding.test.js` 新增 2 条 ——
  ① `handler：经纬度以字符串传入（真实 FC 事件形态）也必须取到数，不得崩`（用打桩 https + 真实夹具，断言 200 / `source=qweather` / `windSpeedKmh` / 逐小时 24 条 / 逐日 7 条 / 请求 URL 为 `/weather/v1/current/27.51/110.12`）；
  ② `源码：经纬度取整必须先 Number() 包一层（不得出现裸的 .toFixed）`。
- **反向自检**（`.ekko-tmp/selftest-string-params.js`）：把 `Number(latitude)` 改回裸的 `latitude.toFixed` → **4 条用例变红**，其中 handler 用例复现的正是线上那句 `latitude.toFixed is not a function`（502）；还原后 `index.js` 逐字节一致（`dcfdd22317ce`），基线复跑通过。

#### 三、端到端证明「粘进控制台就能用」

`.ekko-tmp/e2e-qw-strings.js` 先把 `env-paste.txt` 的内容按云函数方式注入 `process.env`，再用**字符串** query 参数调真 handler：

- `qweatherJwtConfigured = true`；Host 规范化 = `km3aatd4f8.re.qweatherapi.com`
- 常规天气 HTTP 200 / 374ms / `source=qweather`：气温 25 / 湿度 77 / 晴 / 风级 2 / `windSpeedKmh=7.1` / 13 个字段 / 逐小时 24 条 / 逐日 7 条
- 短临 HTTP 200 / 2464ms / `success=true` / `okCount=12/12`
- 日志 `[qweather] 形态自检 v1：…` + `[nowcast-q] 口径自检 中方镇：24 档合计 0.00mm…`

#### 四、文档同步

`cloudfunctions/README.md` 的「天气函数环境变量」小节此前**只写了彩云变量**（`CAIYUN_APP_KEY`/`CAIYUN_APP_SECRET`，`QWEATHER_KEY` 标为「可选」），在当前只用和风的状态下会直接误导配置——已整节重写：和风 5 个必需变量、JWT 就地签名与自动续签、私钥必须放项目外、`NOWCAST_PROVIDER` 可选、彩云降为显式退路，并写明**两个必踩的坑**（改环境变量必须重新部署；和风无条件 gzip）。「发布前检查」清单里「手工调用函数公网 URL」也升级为 `node.exe scripts/check-deployed.js`。

#### 五、验证

| 项目 | 结果 |
| --- | --- |
| `tests/qweather-http-encoding.test.js` | **15/15**（原 13 + 新增 2） |
| 反向自检（裸 `.toFixed`） | 4 条变红、还原逐字节一致 |
| 全量测试 | **38/38** |
| `check-ui` | 绿（8 样式文件 / 84 全局类） |
| 端到端（env-paste.txt 注入 + 字符串经纬度） | 常规天气 200、短临 12/12 |


### 部署核对：新版代码已上线，但私钥变量被粘贴毁掉（2026-09-26）

用户填完环境变量后要求核对部署。`node scripts/check-deployed.js` 的结论：

| 探测 | 结果 |
| --- | --- |
| 常规天气 `&provider=qweather` | HTTP 502，`source:"qweather"`，失败原因「和风私钥无法解析…`error:1E08010C:DECODER routines::unsupported`」 |
| 短临 `?mode=nowcast&provider=qweather` | HTTP 200，**`source:"qweather"`**、`note:数据来源：和风天气分钟级降水 API（1km，5 分钟一档）`、ok 0/12 |
| 站点列表 | HTTP 200，106 个水库站点，2.9s |

**好消息**：短临已经走和风分支、`note` 是新版才有的文案 ⇒ **云函数新版代码已上线、环境变量 5 个也都写进去了**（否则报的会是「未配置和风天气凭据」）。

**卡点**：私钥文本读不出 PEM。实测该 OpenSSL 报错对应至少 6 种「粘贴毁掉私钥」的形态（下表），旧实现一个都修不了，用户只能反复重部署试。

#### 一、把粘贴失误做成可自动修复

`qweatherPrivateKeyPem()` 原来只做两件事（要么 base64 解、要么把字面量 `\n` 换回真换行），其余形态一律直接抛错。现在改成：

新增 `normalizePemText(raw)`：剥掉 `KEY=` 前缀（正则收紧为 `^[A-Z][A-Z0-9_]{2,}=`，避免误伤大小写混合的 base64）、剥掉成对引号、字面量 `\n`/`\r` 换回真换行、从 `-----BEGIN` 处切片、**换行全丢时按 64 字符重新折行**；
新增 `qweatherPemCandidates()`：按可靠程度给出候选（`_B64` 先按 base64 解一份 → `_B64` 原文一份 → `QWEATHER_PRIVATE_KEY` 一份），去重；
`qweatherPrivateKeyPem()` 改为**逐个候选尝试 `crypto.createPrivateKey`，返回第一个能解析的**；
`createQWeatherJwt` 报错补上 `describePemCandidates()` 的形状描述（只写长度 / 是否 PEM 开头 / 前 15 字符，控制字符脱敏，**不回显私钥内容**）。

复现过的形态与处理：

| 粘贴失误 | 旧实现 | 现在 |
| --- | --- | --- |
| 换行写成字面量 `\n` | ✓ | ✓ |
| 换行全丢、压成一行 | ✗ 报错 | **✓ 自动重新折行** |
| PEM 原文错填进 `*_B64` | ✗ 报错 | **✓ 原文兜底候选** |
| 值里连着 `QWEATHER_...=` 前缀 | ✗ 报错 | **✓ 剥前缀** |
| 值被成对引号包住 | ✗ 报错 | **✓ 剥引号** |
| 值被截断 | ✗ 报错 | ✗ 无法还原，**但报错会说明形状** |

#### 二、`scripts/check-deployed.js` 修掉一处误判

原判定用「`current` 是否含 `windSpeedKmh`」推断代码新旧，**请求失败时 `current` 为空会被误判成「线上仍是旧代码」**。改为：

- 代码新旧：看响应里有没有新版特征（顶层 `source`、短临 `note` 为和风分钟级降水、或新版私钥报错文案）；
- 凭据可用：常规天气取到数且字段为新版；
- 命中私钥解析失败时，额外打印 4 步改法，并提示「把『读到的是——候选N』原样发出来即可定位」。

#### 三、验证

| 项目 | 结果 |
| --- | --- |
| `tests/qweather-jwt.test.js` | **18/18**（原 13 + 新增 5：压成一行 / 错填 `_B64` / 带 `KEY=` 前缀 / 被引号包住 / 真坏了必须如实报错且带形状描述） |
| 反向自检 `.ekko-tmp/selftest-pem-robust.js` | **3/3 全部抓住**（A 跳过文本修复 → 3 条变红；B 去掉形状自诊断 → 1 条变红；C 去掉原文兜底候选 → 1 条变红），还原后 `index.js` 逐字节一致（`fc9e4ecb478f`） |
| 全量测试 | **38/38** |
| `check-ui` | 绿 |
| 端到端（`env-paste.txt` 注入 + 字符串经纬度） | 常规天气 200、短临 12/12 |

`cloudfunctions/getWeather/index.js` → **61860 字节**（CRLF=0）。


### 私钥被截短 3 个字符：精确诊断 + 自动补全（2026-09-26）

上一轮自查脚本带的「读到的是——」自诊断直接给出了线索，用户重新部署后拿到：

```
读到的是——候选1：117 字符，是 PEM 开头；候选2：157 字符，不是 PEM（前 15 字符「LS0tLS1CRUdJTiB」）
```

**本地用 `b64.slice(0, -3)` 复现，报错与线上一字不差**：

| 量 | 正确值 | 线上实际 | 差 |
| --- | --- | --- | --- |
| `QWEATHER_PRIVATE_KEY_B64` | 完整单行 base64 | 少 3 个字符 | 丢的是末尾 base64 结束符 |
| 解出来的 PEM | 完整（含标准结束行） | 结束标记残缺 | 少结尾 1 个 `-` |
| 补回结束符后 | — | 逐字节等于原始 PEM | ✓ |

也就是说：从长文本里复制私钥时，**尾部 3 个字符没被选中**。这类「复制不完整」是粘贴私钥最常见的翻车方式，而 DER 只要少一个字节 OpenSSL 就只回一句 `DECODER routines::unsupported`，用户根本看不出差在哪。

#### 一、代码加固：只补「能证明正文完整」的截断

新增 `repairTruncatedPem(pemText)`：当文本以 `-----BEGIN <label>-----` 开头、但**找不到完整的结束标记**时，取出正文、校验它是合法 base64 且长度是 4 的倍数、且能原样重新编码，然后补回标准结束行。

**安全性论证（这是敢自动补的关键）**：PKCS8 的 DER 长度是严格的 —— 正文哪怕少一个字节 `createPrivateKey` 都会失败。所以「补完之后能解析」等价于「正文本身是完整的」。测试里用 `crypto.verify` 证明补出来的确实是**同一把密钥**（签出的 token 公钥能验过），不是猜出来的另一把。

`qweatherPemCandidates()` 现在每个候选都附带「末尾补全版」；`qweatherPrivateKeyPem()` 只接受 **`asymmetricKeyType === 'ed25519'`** 的候选；`describePemCandidates()` 改为逐个候选报「长度 / 是否 PEM / **可解析性**（可用 / 类型是 rsa，不是 ed25519 / 解析失败）」。

#### 二、用户侧两条修法

1. **3 秒手改（不用改代码）**：在 `QWEATHER_PRIVATE_KEY_B64` 的值末尾补回缺失的 base64 结束符（以 `=` 结尾），保存后重新部署。
2. **重新部署这一版代码**：之后这类「末尾被截断」会被自动补全，不必再手工核对长度。

#### 三、验证

| 项目 | 结果 |
| --- | --- |
| 本地复现 | 报错与线上一字不差（`候选1：117 字符，是 PEM 开头；候选2：157 字符…`） |
| 端到端（用被截短 3 字符的值 + 真凭据 + 字符串经纬度） | 候选2 判定「可用」；**常规天气 HTTP 200**（气温 25℃ / 湿度 80% / 晴 / windSpeedKmh 8.1）；**短临 12/12** |
| `tests/qweather-jwt.test.js` | **20/20**（新增：线上真实形态必须自动补全且公钥能验过；只有「正文完整、结束标记残缺」才补，正文也残缺时必须放弃猜测） |
| 反向自检 `.ekko-tmp/selftest-pem-robust.js` | **4/4 全部抓住**（A 跳过文本修复 / B 去掉形状自诊断 / C 去掉原文兜底候选 / D 去掉末尾截断补全），还原后逐字节一致（`75a615fb8639`） |
| 全量测试 | **38/38** |

`cloudfunctions/getWeather/index.js` → **63717 字节**。

**遗留**：`REPORT` 提到的两个待办 —— 部署后核对 `[nowcast-q] 口径自检` 的单位（界面「累计降水」与日志相差 12 倍即错）、以及界面「未来降雨影响 / 逐小时雨量柱」在真机上的观感。


### 交接补记：风场升级 / 地形起伏 / 周边区划 / 两处联动 / 若干删减（2026-09-30）

这一轮跨度很长，前面几节没来得及记，补在这里（都已落地并跑过全量测试）。

**1. 风场图层升级（取代雷达成为气象图层的主角）**

- 取数从「实况单帧」改成 **未来逐小时**（`layerWind.buildHourlyUrl` / `parseHourly` / `hourlyPlan`，
  Open-Meteo ICON 11km，一次请求拿整片网格；按北京时区）。
- **风速填色 + 粒子**：色阶按**当前帧**自适应（`scaleForField`），但有 **最小跨度 4 m/s** ——
  防止微风被画成大风；图例数值来自色阶本身，不写死。
- 时间轴：卡片里那套控件**按模式分流**（雷达模式走雷达帧、风场模式走小时帧）；
  风场模式下**隐藏雷达胶囊条**，时刻文案写成「现在 15:00 · 未来 N 小时可播放」。
- 切帧 `setWindFrame()` **只换场、不重建粒子** ⇒ 动画连续不跳。
- 踩过的坑（已修 + 已加断言）：改名漏改（`field` → `this.windField` 后仍有两处裸引用 ⇒ 真机显示"风场数据暂不可用"）。

**2. 地形起伏（晕渲）**

- 数据：**AWS Open Data Terrain Tiles**（Terrarium 编码，免 key），z9 取 25 张；
  实测高程 33~2488 m。算法：西北 315°/45° 标准晕渲；异常高程剔除 + 邻域填补 + 双次平滑。
- 烘焙：`scripts/bake-hillshade.js` → `assets/basemap/hillshade.png`（**384×384、74.5 KB**，
  与底图**同 BAKE_BOUNDS 对齐**）。取瓦片带重试（曾出现 20/25 失败，脚本会拒绝写文件，不会写坏资产）。
- 绘制：底图层叠一次（alpha 0.32）；**风场模式在"填色之上、粒子之下"再叠一次（alpha 0.24）** ——
  否则不是被填色盖住、就是压住流线。叠加层必须用**与底图相同的 rect 算法**（有断言）。
- 口径：只作视觉参考（约 782m/像素），**不要拿它读高程**。

**3. 周边区划（显示中方县与邻县的相对位置）**

- 数据：阿里云 DataV 公开 GeoJSON（市级 `431200_full` 含怀化市 12 个区县）。
  坐标系判定用**最近距离评分**：不换算 900m ↔ 换算后 602m、最佳平行位移 594m ⇒ **判定为 GCJ-02**，
  绘制时用 `geoDatum.gcjToWgs` 拉回 WGS-84（**只换算一次并缓存**；每帧重算是白烧 CPU）。
- 层次：底图 → 填色 → 粒子 → **周边区划** → 本县乡镇边界 → 本县乡镇名 → 提示；中方县本身跳过（有自己的数据）。
- **乡镇级自动隐藏邻县**（`REGION_HIDE_SPAN_KM = 40`）：那个尺度下两套数据沿县界有几百米错位。
- 守卫收紧：天气页原来「不得出现 geoDatum」改为「**不得做正向换算，但允许把外来 GCJ-02 拉回 WGS-84**」。

**4. 两处联动（用户要求）**

- **顶部实况 ↔ 气象图层共用一个「当前乡镇」**：图层选乡镇 ⇒ `syncWeatherLocation` 切顶部实况；
  顶部选乡镇 ⇒ 复用 `onLayerScope` 让图层取景过去；「全县」＝县城中心；同乡镇**去重不重复请求**（联动不会来回打）。
- **气象图层卡不再有自己的乡镇选择器**（改成只读标签 `{{layerScope}}`）—— 选择权合并到顶部。
- 短临列表的**选中高亮**先加后撤（用户：「短临不需要高亮了」）⇒ 断言改成「**不得有**」，防止以后又被好心加回来。

**5. 删减**

- **气象图层不再有全屏**（用户要求）：入口、状态 `layerFullscreen`、`onLayerFullscreen()`、
  工具条 `.layer-fs-*`、容器类名与样式全部移除；测试改成「不得再有」并**同时断言未误删卡片本体**
  （`layer-swap`/`id="layerCanvas"`）。
- 遗留待定：`resetLayerView()`（重置视野）原本只挂在全屏工具条上，现在没有入口 ⇒ **可能是死代码**，
  用户尚未表态（留 / 删都行）。
- **地图监测页的雷达不恢复**（2026-09-30 用户明确：先删、后决定「不恢复」）。
  天气页卡片里的雷达**保留**（那才是"保留雷达回波"所指）。

**当前包体积**：63 文件 / **879.3 KB（42.9%）**；最大的 6 个：`townshipBoundaries.js` 183.7 /
`basemap/zhongfang.png` 177.3 / `regionBoundaries.js` 84.4 / `basemap/hillshade.png` 74.5 /
`rainfall.js` 55.8 / `detail.js` 31.4 KB。
压缩手法记录：乡镇边界 **只改格式**（紧凑 JSON + 坐标 5 位小数，几何逐点保留；**不能抽稀** ——
实测 60m 间距在细长"半岛"状村界上就有 91m 偏差）；邻县抽稀到 1200m。

### 雷达退场，改用降水分布场（2026-09-29 深夜）

用户决定：**不要雷达回波了**（天气页卡片、地图监测页都算），**只留降水分布场**；并要求提高分辨率、
把官方拼图放大到县域。后两项先做了事实核查：

**分辨率提不上去（有据）**：Open-Meteo 上中国区可用的模式与分辨率实测 —— ECMWF 25km、ICON 13km、
GFS 13km、**中国气象局 CMA GRAPES 13km**、GEM 15km ⇒ **最细 13km，这是免费模式数据的硬上限**。
一个乡镇只压到 1~2 个格点，所以"乡镇级精确落区"用模式数据做不到；能做的只有渲染改平滑（观感）+
如实标注。已把这条写进 `utils/precipField.js` 的注释与界面文案。

**官方拼图放大到县域做不到（有据）**：公开拼图是 **975×980 的展示版 PNG**，覆盖华中/湖南一大片；
我按三种候选范围把县域裁出来（`nmc-crop-calib.html`），**县域在图上只占 64~88 像素**，
乡镇边界缩成一小团 ⇒ 要把乡镇边界看清需要 1km 甚至更细的原始拼图数据，那是不公开的产品。
结论：免费公开资源做不到，只有付费源或自建 metradar 数据链（需确认气象数据再分发许可）。

**湖南省水文上游**：全站 404（连首页），产品清单无法自行推断 ⇒ 已建议用户直接问对方
"有没有雨量站/雷达接口"（若对方有，远优于自建）。

**本轮改动**

| 文件 | 改动 |
|---|---|
| `utils/precipField.js` | **新增**：16×16 采样点、Open-Meteo 请求 URL（一次带 256 坐标、按北京时间、默认中国气象局模式+回退 best_match）、解析、北京时间帧规划、分级配色、**双线性插值出 RGBA 位图**。纯逻辑、可测 |
| `pages/radar-map/*` | 整页从"雷达回波"改成**降水分布场**：底图仍是腾讯 map；场地用**离屏 1×1 canvas**（背后 256×256）渲染 → `canvasToTempFilePath` → `addGroundOverlay`（bounds 换算成 GCJ-02）；逐小时帧（现在/+1h…）含播放；乡镇取景；如实文案（"模式预报 · 约 13km/格 · 非实测"、"没有颜色＝这一格预报没有降水"、"看不出哪个村"）。导航标题改为「降水分布场」 |
| `pages/map/map.js/.wxml/.wxss` | **移除雷达图层**（开关、方法、data 字段、样式全部删掉） |
| `tests/precip-field.test.js` | **新增 17 条**（数据数学、北京时间、无色不上色、离屏画布必须 1px 且移出屏幕、bounds 必须换算、整场一张图不叠加、取不到必须报错、文案守则、地图页不得再有雷达） |
| `tests/radar-map-view.test.js` | 删除（页面语义已变，由 `precip-field.test.js` 取代） |
| `tests/map-radar-offset.test.js` | 删除"地图页雷达接线"整段（页面已无雷达），保留数据/坐标层断言 |

**验证**：`run-tests.js` **48/48**；`check-ui.js` 绿（新页面在审计清单内）；包 876.6 KB（42.8%）。

**仍待做（下一步）**：天气页卡片里的「雷达回波」模式还在（它与风场共用一张 canvas，删除要动
`layerView/layerProjector` 那条链），确认降水场页面真机可用后再删；届时 `utils/layerRadar.js`
与其测试可一并删除。

### ⚠️ 修正：「乡镇雷达地图」必须是独立页面，不能做同页浮层（2026-09-29 晚）

上一节把它做成了天气页上的全屏浮层 —— **真机上一眼就是错的**：屏幕上出现一大片与回波无关的蓝色块。

**定位过程（先排除数据，再排除底层）**

1. 解码当时的 z7 瓦片：**99.2% 全透明**，非透明的只有 551 个像素且是灰褐色（RGB 130,123,105）
   ⇒ 那片蓝**根本不是回波**，问题在渲染侧。
2. 看 `assets/basemap/zhongfang.png`：中方县是**只描边、不填色**的
   ⇒ 也不是烘焙底图直接铺上去的。
3. 结论：**微信里 `<map>` 与 `<canvas>` 都是原生组件，同一页面混用时层级不受 z-index 控制**，
   卡片里那张自绘 canvas 会盖在新加的 `position:fixed` 浮层之上（地图页一直没这个问题，
   因为那一页只有 map 一个原生组件）。

**修法**：把该视图挪成**独立页面** `pages/radar-map/radar-map`（页面上只有 `<map>` 一个原生组件），
天气页雷达模式的入口改成 `wx.navigateTo`。并把这个教训写成测试的**第一条断言**：
`pages/radar-map/radar-map.wxml` 里**不得出现 `<canvas>`**（也不得混入 video/live-player/web-view）。

**其余保持**：坐标换算（bounds 由 `planMapOverlays` 换算、取景角点用 `geoDatum.toMapPoint`、
页面不许二次换算）、`0_1` 不插值、`updateGroundOverlay` 换帧不叠加、取不到必须报错、
「空白≠取不到」+「不含未来预报」+ 分辨率来自 `radarGridNote()`。

**验证**：`run-tests.js` **48/48**（`radar-map-view.test.js` 14 条含真跑页面方法）；
`check-ui.js` 绿（新页面已加入审计清单）；反向自检 **13/13**（含"本页混入 canvas 必须被抓"）。
包 878.2 KB（42.9%）。

**教训（写进这一节，避免以后再犯）**：小程序里凡是要放地图/视频/画布这类原生组件的地方，
**一个页面只放一个原生组件**；需要叠层就换页面，不要指望 z-index。

### 天气页新增「乡镇雷达地图」：详细底图 + 图片图层回波（2026-09-29）

用户诉求：气象图层的底图要像「地图监测」那样详细（村名、路网），视野收到乡镇级，
好判断「哪个乡镇在下雨」。第 3 步（买彩云）因预算跳过。

**为什么这一轮是"加法"而不是直接替换卡片**：卡片里的图层视图是约 600 行 canvas + 手势代码，
与 `layerView` / `layerProjector` / `catchtouch*` 深度耦合，而且**本机没有真机可验证**。
直接把卡片换掉等于一次性改掉旗舰页核心却无法验收。所以本轮**新增一个全屏视图**，
复用已经测过的 `addGroundOverlay` 管道；旧卡片一行不动，真机确认后再决定是否替换本体、
以及把风场从粒子改成静态风矢（A 方案）。

**新视图内容**

| 项 | 实现 |
|---|---|
| 底图 | 原生 `<map>`（腾讯 = GCJ-02，放大出村名/路网/水系，与地图监测页同一套） |
| 回波 | `addGroundOverlay`，瓦片走 `planMapOverlays`（z7 上限、**bounds 已换算**）、渲染用 `0_1` **不插值**（放大后是清晰的 1km 格子，不是糊成一片） |
| 乡镇取景 | `includePoints` 传入**换算后的两个角**（不猜微信 `scale` 的含义），选中乡镇即收到该乡镇包围盒 |
| 帧播放 | 上一帧/播放/下一帧；换帧用 `updateGroundOverlay`（**不重复叠加**），关闭即摘图层并停表 |
| 诚实文案 | 回波时间（北京时间）+ 帧龄（"约 N 分钟前"）+「空白处表示该时刻这片区域没有回波」+「不含未来预报」+ 分辨率说明（来自 `radarGridNote()`，读 `SOURCE_KM_PER_PX`）；取不到时必须报错，不得显示成「没有回波」 |
| 入口 | 卡片视野条上的「地图查看」（仅雷达模式显示） |

**测试**：`tests/radar-map-view.test.js` **16 条**（含真跑页面方法：`openRadarMap` 后中心是换算值、
`focusRadarMap` 的角点已换算、`showRadarMapFrame` 用 `tile.bounds` 且第二帧只更新不新增、
下载失败必须抛错）；反向自检 **16/16**；`run-tests.js` **48/48**；`check-ui.js` 绿。

**顺带修了一处守卫**：`map-datum-correction.test.js` 里原断言是"天气页不得出现 geoDatum"，
现在天气页合法地需要它（全屏地图视图）。守卫改为**"坐标换算只允许出现在全屏地图视图那一段"**
（自绘 canvas 路径仍不许有任何换算调用）—— 比原来更精确，而不是放宽。

**真机上需要重点确认两件事**（本机无法验证）：
① 全屏 `<map>` 与上层浮层（标题/乡镇选择/底部控制条）的层级与手势是否正常（同层渲染）；
② `includePoints` 的 padding 是否真的把上下浮层的位置留出来了。

**下一步（等真机确认）**：① 把卡片本体的雷达模式也换成这个地图（那时可删掉 canvas 的手势/投影代码）；
② 风场改成静态风矢图（`canvasToTempFilePath` → `addGroundOverlay`，每 5 分钟刷新）；
③ 第 2 步：中央气象台公开雷达拼图（每 6 分钟一帧）做成"官方拼图·仅供对照"页签。

### 地图页坐标校正：站点 / 分界线 / 地图中心 从 WGS-84 换算到 GCJ-02（2026-09-29）

起因：做路线 A（把雷达回波叠到微信 <map>）时就怀疑——既然雷达瓦片需要换算，
那**同一页的站点 marker 和乡镇分界线**是不是也整体偏了 594m？本轮先验证、后修改。

**验证方法与结果（可复现）**：在高德影像（GCJ-02，与微信地图同一坐标系）上，
对每座水库同时标注「原始坐标直接当 GCJ-02 用」（红）与「按 WGS-84→GCJ-02 换算后」（蓝）：

| 站点 | 红（原始） | 蓝（换算后） |
|---|---|---|
| 铜湾 | 岸边沙地 | **压在坝体上** |
| 三角滩 | 上游居民区 | 河道/水面 |
| 五龙溪 | 山林 | 水库水面 |
| 乌溪 | 山林 | 溪流上 |
| 老马田水库 | 树林 | 库尾水面 |
| 楠木洞水库 | 林地 | 水塘 |
| 批修 | 林地 | **两片水面之间的坝上** |
| 四卧垅水库 | 山林 | 库面/坝 |

**8/8 换算后落在坝体或水面上，8/8 原始坐标落在山林/村里** ⇒ 站点数据确实是 WGS-84，
交给 GCJ-02 底图前必须换算。（对比图：`.ekko-tmp/preview/station-datum-check.html`）

**改动**

| 文件 | 内容 |
|---|---|
| `utils/geoDatum.js` | 新增 `toMapPoint` / `toMapPoints`（批量）。**空值判无效返回 NaN** —— 因为 `Number(null) === 0`，不显式判空会把「缺经纬度」的点悄悄画到赤道 (0,0) |
| `pages/map/map.js` | 四处消费点统一换算：① `updateMarkers` 的 marker 坐标；② `buildTownshipPolygons` 的分界线（**按乡镇名缓存换算结果**，上万个点不能每次重算）；③ 地图中心（初始值 / onLoad / onShow / 乡镇切换 / 定位，共 5 处）；④ `onMarkerTap` 的 `translateMarker` 终点（必须与 marker 显示位置同一套换算，否则点击动画会把图标挪走 594m） |
| `tests/map-datum-correction.test.js` | **新增 11 条**：换算方向/量级/境外/空值、批量保序、**真跑页面方法**断言 marker 位移约 594m、markerMap 保留原始数据、点击动画与 marker 一致、分界线换算、中心换算、全局 location 保持 WGS-84、**天气页不得引入换算**、雷达图层两条路不能互相顶掉 |

**反向边界（同样写进了测试，防止以后"顺手统一"改坏）**

- 天气页那张**自绘 canvas** 用的是与雷达/风场同源的 **WGS-84 烘焙底图** ⇒ 那边**绝对不能**换算，
  否则反而错 594m。测试断言 `pages/rainfall/rainfall.js` 里不得出现 geoDatum。
- `app.globalData.location` 保持 WGS-84（它是全应用共享的），换算只发生在**页面消费点**，
  否则地图页换算一次、其它页再换算一次会变成 1188m。

**验证**：`run-tests.js` **47/47**；`check-ui.js` 绿；反向自检 **11/11**
（marker 忘换算 / 分界线忘换算 / 中心忘换算 / 方向写反 / toMapPoint 退化成恒等 / 点击动画用原始坐标 /
缺字段算成 (0,0) / 换算结果写回全局 / 天气页被顺手换算 / markerMap 被污染 / 边界点顺序被打乱），
还原后逐字节一致。包 865.5 KB（42.3%）。**只改前端，云函数未动。**

### 气象图层：视野收到乡镇级 + 「最精准分辨率」的实测答案（2026-09-28）

起因：用户反馈「雷达回波和风场图视野太大（约 200km），无法观测每个乡镇的大致情况」，
并直接问「这样的雷达回波图能做到最精准的分辨率是多少」。

**分辨率：实测结论（不是查来的说法）**

- **RainViewer 免费档最细就是 z7 = 1.079 km/像素**（≈1.08，在中方县纬度）。
  验证方式很关键：**特意挑了有强回波的雨区**去请求 z8~z13，返回的全是同一张
  **1370 字节空瓦片** ⇒ 是层级上限，不是「那里没雨」。写进 `layerRadar.RADAR.SOURCE_KM_PER_PX = 1.08`（界面文案唯一出处）。
- 数据本身的物理上限也在 1 km 量级：国内业务雷达拼图产品（中央气象台、彩云）都是 1 km 网格。
  **付费买不到"更细"，只能买到**：① 服务端直接给 z10~z14 瓦片（把同一份 1 km 数据放大平滑，信息量不变）；
  ② 未来 2 小时外推帧（彩云「预报雷达图」）——后者才是花钱的理由。
- **真正的问题不是分辨率，是视野**：1 km 的格子在 375px 屏上 ——
  200km 视野 = **1.9px**（看不出落区）、20km = 19px、10km = 37.5px。
  12 个乡镇东西向 8.4~22.9km，收到乡镇级后 1 格有 15~37px，**这才叫"看得出每个乡镇"**。

**本轮落地（纯前端，云函数未动）**

| 文件 | 改动 |
|---|---|
| `utils/layerRadar.js` | `RADAR.SOURCE_KM_PER_PX = 1.08`、`SMOOTH_OPTIONS/SHARP_OPTIONS('1_1'/'0_1')`、`optionsForUpscale()`（≥3 倍改用**不插值**，让 1km 格子保持清晰）、`radarGridText()`（"回波 1 km/格 · 当前 1 格 ≈ N px"）；`tileUrl/planFrameTiles/planMapOverlays` 增加 options 透传（默认值不变，旧调用零影响） |
| `pages/rainfall/rainfall.js` | 视野条新增**乡镇选择器**（`onLayerScope`，用真实乡镇 `bounds` + `fitView` + `clampView`）；`currentUpscale()`/`radarTileOptions()` 统一插值策略；`updateLayerGridText()` 如实标注；**乡镇名标注** `drawTownshipLabels()`（视野 ≤60km 时按真实中心画 12 个乡镇名，同一阈值下县名让位） |
| `pages/rainfall/rainfall.wxml/.wxss` | 选择器 UI（`.layer-scope`）、网格文案行（`.layer-gridtext`） |
| `tests/layer-township-focus.test.js` | **新增 16 条**：12 个乡镇逐个取景都在乡镇级、乡镇级下 1km 格子 ≥12px、取景夹在底图内、插值开关、默认值不变、两条规划路径一致、分辨率文案不许比源更细、极端值不产生 NaN、选择器接线、不篡改短临索引、乡镇名阈值与县名互斥、样式无 gap/伪类 |

**验证**：`run-tests.js` **46/46**；`check-ui.js` 绿；反向自检 **17/17**（含：取景不夹紧 / 拿全县范围充数 /
放大仍用平滑 / 默认值被改 / 只带一处插值策略 / 虚报分辨率 / 文案写死像素 / 插值提示常驻 / 名称阈值不一致 /
不画在真实中心 / 加 :active / 加 gap / 篡改短临索引 / 去掉 bindchange / 不刷新文案 / 删掉提示阈值），还原后逐字节一致。

**做题过程中发现并修掉的三处（都是助手自己的问题）**

1. `String.replace` 只替换第一处 —— 上一版用了 `all:true` 却仍只替换一处，导致**两处瓦片规划只有一处带插值策略**；是测试（"两条路必须同一个策略"）抓出来的。
2. 插值提示阈值原本定得太低，**乡镇级视野会常驻**"更细是插值"（噪音）；改为独立常量 `INTERP_NOTE_PX = 60`。
3. 对比图里我手写的"约 18px"与真实 47px 不符 —— **说明文字一律改由真实数值算出**。

**⚠️ 仍待用户定的一件事（已在对话里问过，未答）**：天气页那张图层卡是**同一张卡靠 tab 切换雷达/风场**，
要换成"像地图监测页那样带村名路网的详细底图"，唯一可行做法是改用原生 `<map>`（腾讯底图）。
但原生地图上画不了流动粒子 ⇒ 风场只能改成**每 5 分钟刷新的静态风矢图**，或**把两张卡拆开**（风场卡保留 canvas 粒子）。
已给出两套方案与代价，等用户选。**在用户选定前不要动这张卡的地图底盘。**

**旁证（对比图里看得最清楚的一点）**：视野收到乡镇级后，**烘焙底图被放大成一片淡蓝**，
没有村名、没有路网 —— 这正是用户要换详细底图的根因；
同时这一刻（2026-09-28 14:00 北京时）**全县境内几乎没有回波**（过去 2 小时回波最多的一帧，
整张 z7 瓦片 65536 个像素里只有 **89 个**有内容），所以效果图里那大片淡蓝是底图填色，不是雨。

### 地图页叠加雷达回波（路线 A）：图片图层 + WGS-84 → GCJ-02 校正（2026-09-28）

起因：用户问「想要地图监测这样底图上的雷达回波和风向图，应该接入什么服务」。
调研结论（均已核对官方文档，不是凭印象）：

- **微信 `<map>` 没有现成气象图层开关**。能叠东西的只有三条：
  `MapContext.addGroundOverlay`（基础库 2.14.0+，自定义图片图层、图片随地图缩放，`src` 支持
  **网络图片/临时路径/代码包路径**，`bounds` 用西南·东北角经纬度）、
  `MapContext.addVisualLayer`（2.20.1+，`layerId` + `interval`≥15s，走**腾讯位置服务「数据图层」**，
  官方只支持**热力图 / 蜂窝热力图 / 网格热力图 / 弧线图** —— 是给自己数据做可视化的，不是气象图层）、
  `MapContext.addCustomLayer`（个性化**样式**图层，与气象无关）。
- **和风天气没有雷达回波产品**（API 目录只有 GeoAPI / 天气预报 / 分钟预报 / 预警 / 天气指数 / 空气质量 /
  时光机 / 台风 / 海洋 / 太阳辐射 / 天文 / 控制台 API），所以「用现有和风凭据拿雷达图」这条路不存在。
- **RainViewer 现状实测（2026-09-28）**：`past` **13 帧**（跨 2 小时、10 分钟一帧）、`nowcast` **恒为空**
  （免费档无未来帧）；`z≥8` 依旧恒返回 **1370 B 空瓦片**（2026-09-22 的结论今天仍然成立）；
  县域在 `z7` 只需 **1 张**瓦片（1.085 km/像素）。
  想要「未来外推帧」只能上彩云「雷达图 / 预报雷达图」（企业套餐）。
- **风场**沿用 Open-Meteo（免费、无授权问题）；商业地砖（Windy）要谈商用授权。

**关键不是"接哪个服务"，是坐标系**：微信底图是腾讯的 **GCJ-02**，而 RainViewer 瓦片与乡镇边界/站点数据是
**WGS-84**。实测（375px 真宽量测 + 标准换算）：中方县中心偏 **东 482 m / 北 −347 m（直线 596 m，东南向 126°）**；
县域内 6 个取样点都在 591~594 m ⇒ **在县域尺度上它近似是一个常数平移**，
整块平移的残差 **≤21 m**（≈ 回波一个像素的 2%，可忽略）。

落地内容（本轮新文件/改动）：

| 文件 | 改动 |
|---|---|
| `utils/geoDatum.js` | **新增**：`wgsToGcj` / `gcjToWgs`（迭代反解）/ `wgsBoundsToGcj` / `offsetMeters`；境外坐标原样返回 |
| `utils/layerRadar.js` | 新增 `planMapOverlays`（z7 上限、按县域规划、**bounds 已换算成 GCJ-02**）、`overlayId`（数字且稳定）、`timeCst`（显式 UTC+8）、`frameAgeMinutes`、`RADAR.LEGEND`（与气象页 `.legend-dot.lv-*` 同步） |
| `pages/map/map.js` | 图例卡顶部新增雷达开关（**默认关**）；开：`wx.downloadFile` → `addGroundOverlay`；关：`removeGroundOverlay`；回到页面时帧超 5 分钟静默换新；三态文案（加载中 / 失败原因 / 已就绪＋回波时间＋帧龄＋分辨率提示）；无 `addGroundOverlay` 的旧基础库如实说明 |
| `pages/map/map.wxml` | 雷达开关 + 回波时间/帧龄 + 四档图例 + 「空白处表示该时刻这片区域没有回波」+「不含未来预报」 |
| `pages/map/map.wxss` | 上述样式（无 flex `gap`、无真机不可靠伪类） |
| `tests/map-radar-offset.test.js` | **新增 24 条**：换算方向/量级/境外/往返、县域残差、bounds 必须换算、id 数字且稳定、z7 上限、北京时间实现级（禁止用设备本地时间冒充）、图例两处同步、页面只消费校正后 bounds、能力检测、真下载、失败原因可自诊、文案守则、三态、默认关闭、开关可点 |

**验证**：`run-tests.js` **45/45**；`check-ui.js` 绿；反向自检 **18/18**（含：bounds 不换算 / 方向写反 /
用 z8 空瓦片 / id 变字符串 / id 跟帧变化 / 用设备本地时间冒充北京时 / 境外也偏移 / 页面用 sourceBounds /
删能力检测 / 不下载直接交网络地址 / 删「空白＝无回波」/ 失败不显示原因 / 开关不可点 / 默认开启 /
引入 flex gap / 引入 :nth-child / 气象页调色板漂移 / 帧丢北京时标签），还原后逐字节一致。

**对比图**：`.ekko-tmp/preview/map-radar-offset.html`（底图高德影像＝与微信地图同为 GCJ-02；回波、分界线、站点都是真数据）。
关键实证：z15 下同一组站点在校正前/后相差 **140 px**（理论 140.8），
**校正后「铜湾」站落在河道的水工建筑物（坝/桥）处，未校正时整组站点被推到西北侧的田地里**。

**上真机的前提**：在微信后台把 `api.rainviewer.com`（request 合法域名）与
`tilecache.rainviewer.com`（downloadFile 合法域名）加入白名单 —— 否则开关一打就报「合法域名」那一条失败文案。
**本轮只改前端，云函数无改动 ⇒ 重新上传小程序即可。**

**已知残余（不打算在路线 A 里解决）**：

- 免费档上限 z7（1.085 km/像素）：放大到乡镇级只会更糊，不会更清楚 ⇒ 这个图层真正有用的视窗是县域级。
- 把整张 2.8° 瓦片当**矩形**贴：GCJ-02 变换在瓦片内部仍有形变，实测残差 ≤40 m（≈0.04 个回波像素）。
- 想要「回波往哪走」（未来外推）或乡镇级清晰度，必须换付费源，不是代码能解决的。

### 天气页头部与卡片之间的「裂缝」：面板写死 400rpx，跟不住头部内容（2026-09-27）

起因：用户反馈「气象图层和头部天气之间存在间隔，感觉不协调」。

**实测**（375px 真宽、状态栏 20px，用真实样式渲染后读 `getBoundingClientRect`）：

- `.header` 实际高 **273px**（546rpx，随状态栏高度与内容变化），而 `.header-bg` 写死 `height:400rpx` = **200px**；
- 玻璃条（体感/湿度/风向）底在 **249px** ⇒ **49px 露在面板外**，下半截压在浅色页底上（看截图就是「28°／78%」被切成两半）；
- 面板底(200) 到「气象图层」卡顶(261) = **61px 空白**（卡片间距才 11px）；
- 状态栏 47px 的机型更糟：头部 300px vs 面板 200px ⇒ 空白 **88px**、玻璃条露出 **76px**。

**根因**：`.header-bg` 用了固定高度，而头部内容是流式的（状态栏高度、实时天气块有无、玻璃条有无）。
同类页面对照：`pages/detail/detail.wxss:9` 的 `.header-bg` 是 `top:0;bottom:0;left:0`（跟头部盒子走）——
天气页是**全仓唯一**写死高度的例外，所以这是遗漏，不是设计。

**改法（一行）**：`.header-bg{...top:0;right:0;bottom:0;left:0;...}`，去掉 `height:400rpx`。

**改后实测**（同一 harness，状态栏 20px 与 47px 各跑一遍，结论完全一致）：

| 量 | 改前 | 改后 |
|---|---|---|
| 面板底 → 卡 1 顶 | 61px 空白 | **-12px（卡片上叠面板）** |
| 玻璃条底 → 卡 1 顶 | 12px（但下半截露在面板外） | **12px，玻璃条整条在面板内** |
| 面板底 vs 头部盒底 | 差 73px | **完全一致** |
| 卡 1 底 → 卡 2 顶 | 11px | 11px（未动） |

修完「头部 → 首卡」的 12px 与卡片间距 11px 同一节奏，也与详情页「头部 → 首卡」的 12px 一致。

**新增 `tests/header-panel-fill.test.js`（7 条）**：`.header-bg` 必须锚定头部盒子（top/bottom/left 同时为 0）且
**不得声明固定高度**（这条正是根因，原来没有任何测试拦着）；保留 `border-radius:0 0 36rpx 36rpx` 圆角底边；
`.header` 保持 `overflow:hidden`（把极光/圆环裁在头部内）；`.content` 保持 `margin-top:-24rpx` 上叠；
头部留白 − 上叠量 ≈ 卡片间距（间距节奏）；各页做法一致（这条能一次抓住「某一页偷偷写死高度」）。

**验证**：`scripts/run-tests.js` **44/44**；`scripts/check-ui.js` 绿；
反向自检 **6/6**（A 天气页退回 400rpx / B 既 `bottom:0` 又加回高度 / C 详情页改成写死高度 /
D 删 `overflow:hidden` / E 上叠归零 / F 头部留白改大），还原后逐字节一致；375px「改前 / 改后」视觉核对。

**需重新上传**：前端（`pages/rainfall/rainfall.wxss`）。云函数无改动。

### 逐小时雨量柱：补上满格口径 + 无雨不画空槽 + 「没取到」独立成第三态（2026-09-27）

起因：用户问「逐小时预报中天气图标和气温中间是什么标识」——该位置是**雨量柱 + 该小时雨量 mm** 两个元素
（`pages/rainfall/rainfall.wxml` 逐小时卡），但页面上既没有图例、也没写满格口径，所以看不出柱子在说什么；
同时「无雨」与「没取到」都用 `--` 表示，同一张卡上两种含义长得一样。用户选定方案 A+B。

1. **A 图例**：`utils/rainImpact.js` 新增 `barLegendText()`（满格口径的**唯一出处**，读 `BAR_FULL_MM`），
   `rainfall.js` 在 `onLoad` 写入 `data.hourBarLegend`，模板挂在卡片标题行右侧。
   文案：`柱高＝该小时雨量 · 满格 16mm`。改常量只需改 `BAR_FULL_MM` 一处，界面不重复写数字。
2. **B1 空槽**：无雨 / 未取到时不画那个浅蓝空盒子，走内联 `style="{{item.rainQuiet ? 'background:transparent' : ''}}"`；
   **轨道元素仍保留占位高度** —— 否则六列的「气温」会错行（`.hourly-list` 是 inline-flex 等高、内容顶对齐，
   抽掉轨道会让该列内容整体上移）。不用伪类（真机对 `:empty` 一类不可靠）。
3. **B2 三态**：云函数 `normalizeQWeatherHourly` 不再把「上游没给」静默成 0：
   `rain` 保留 `null`、新增 `rainKnown`（与逐日 `hasRainProb` 同一套约定）；前端映射补 `rainQuiet` / `rainKnown`；
   模板三态 —— `wx:if="{{item.rain > 0}}"` → `X.Xmm`、`wx:elif="{{item.rainKnown}}"` → `--`（确实 0mm）、
   `wx:else` → `未知`（`.hour-rain.unknown-rain` 单独配色）。
4. **★ 顺带的诚实降档（超出 A+B 的一处，已在汇报中标明）**：`buildRainImpact` 现在记录每个窗口里
   「没取到」的小时数 `unknown`；只要 > 0 —— 累计只是**已知部分** —— 就 **不给雨量等级**、
   **不下「未来24小时无明显降雨」结论**（`empty` 强制为 false）、最强小时改称「已知最强」，
   并给独立结论行「未来N小时里有 M 小时雨量未取到，累计仅含已取到的部分」。
   理由：B2 已经把「不知道」这个信号引进数据流，若累计仍把它当 0，就成了同一张卡一边承认不知道、一边照旧下结论。
5. 云函数形态自检日志补 `rainKnown`（部署自查：日志里能看到新字段是否上线）。

**真实数据核对**：`tests/fixtures/qweather-v1.json`（和风 v1 真实响应）里 `hourly.hours[].precipitation.amount`
是**对象** `{value, unit}`；云函数 `numOf()` 会拆 `{value}`，所以取值本身没错
（那份 fixture 恰好 24 小时全为 0mm，且 `precipitation` 对象 24/24 都存在 ⇒ 今天 `rainKnown` 恒为 true，
「未知」态在实际数据里暂时看不到，属安全网）。

**降级相容（可先后部署）**：只上传前端不重新部署云函数 → 旧云函数没有 `rainKnown`，前端按「已知」兜底，
仍显示 `--`；只部署云函数不上传前端 → 旧前端拿到 `rain: null` 走 `wx:else>--`，同样正常。两种顺序都不会出现空白或错值。

**验证**：`scripts/run-tests.js` **43/43**（新增 `tests/hourly-rain-states.test.js` 15 条）；`scripts/check-ui.js` 绿；
反向自检 **12/12** 全抓（A 云函数退回静默 0 / B `--` 退回无条件兜底 / C 删「未知」态 / D 图例写死 16mm /
E 两态同色 / F 空槽改回伪类 / G `rainKnown` 不透传 / H 静默条件写错 / I `empty` 判断退回 /
J 等级不挡 unknown / K 不记 unknown 数 / L 删独立结论行），还原后逐字节一致；
375px 真宽「改前 / 改后」视觉核对（图例一行不换行、无雨列空盒子消失、六列气温仍在同一水平线、最后一列显示「未知」）。

**需重新上传**：前端（`pages/rainfall/*`、`utils/rainImpact.js`）；**需重新部署**：`cloudfunctions/getWeather`
（该函数原本没有 VERSION 常量，是否上线看日志里的 `rainKnown → `）。

### 控制水位称谓：水库统一叫「汛限水位」，河道保持「警戒水位」（2026-09-26）

**起因**：上一轮修完库容口径后，同一个页面上出现了「控制水位的**高程**叫『警戒水位』、相应**库容**叫『汛限水位库容』」的并列。用户决定：水库一律用「汛限水位」。

**为什么不能全局替换**：水库的上游字段 `FSLTDZ` 是防汛（防洪限制）水位，河道的 `HLZ` 才是警戒水位。**河道用「警戒水位」是对的**——只能按站点类型分流。

**改动（四层，每层只有一个真来源）**

| 层 | 位置 | 水库 | 河道 |
| --- | --- | --- | --- |
| 云函数状态文案 | `getStations` 新增 `RESERVOIR_STATUS_TEXT = Object.assign({}, STATUS_TEXT, { danger: '超汛限' })` | 超汛限 | 超警戒（`STATUS_TEXT` 不动） |
| 前端状态文案 | `utils/stationStatus.js` → `getStationStatusText(status, type)` | 超汛限 | 超警戒（不传 type 时保持河道口径） |
| 地图气泡 | `utils/mapMarker.js` 删掉自己那份 `label`，改为调用共用函数 | 超汛限 | 超警戒 |
| 详情页文案 | 主指标带徽标 + 站点信息标签 | 距汛限 / 超汛限 / 汛限水位 | 距警戒 / 超警戒 / 警戒水位 |

顺带把 `utils/mapMarker.js` 里**第三份**状态文案删掉：同一句「超警戒」此前在云函数、前端词汇表、地图配置三处各写一遍，现在统一由 `utils/stationStatus.js` 提供，地图只保留配色。再顺带把云函数里两处过时注释改准（`FSLTDZ` 是汛限水位、`FSLTDW` 是汛限水位相应库容）。

**测试口径变更（出于本意，非放宽）**：`tests/station-status.test.js` 与 `tests/map-marker.test.js` 里原本断言水库 `danger` 的文案是「超警戒」，现按新口径改为「超汛限」，并各自补上「河道仍是超警戒」的对照断言。

**口径（新增）**

> 同一个物理概念，在不同水文对象上可能各有各的名字（水库＝汛限水位，河道＝警戒水位）；**不得为了一致就给其中一类套上另一类的术语**，也不得在三个地方各写一份相同的文案。

**验证**

| 项目 | 结果 |
| --- | --- |
| 全量测试 | **42/42**（新增 `tests/level-ref-wording.test.js`，13 条） |
| `check-ui` | 绿 |
| 反向自检 `.ekko-tmp/selftest-level-ref-wording.js` | **8/8 全抓**：A 水库状态文案退回共用表 / B 前端忽略类型 / C 地图气泡写死「超警戒」 / D 详情页徽标退回「距警戒」 / E 详情页状态文案不传类型 / F 站点信息标签退回「警戒水位」 / G 水库过程卡混入「警戒水位」图例 / H 列表把状态文字写死。还原后逐字节一致，基线复跑通过 |
| 串味守卫 | 测试按卡片边界切片断言：**水库水文过程卡内不得出现「警戒」、河道卡内不得出现「汛限」**；列表/地图的状态文字只能来自云函数 `statusText`，不得写死；页面不得改用 `utils/util.js` 里那个返回「超警戒」且已无人调用的旧函数 |
| 视觉核对 | 预览 6 个面板（水库距汛限×2 + 水库超汛限 + 老马田水库 + 河道距警戒 + 河道超警戒），肉眼看无换行/截断；字体宽度未变（警戒↔汛限同为 2 字） |
| 版本号 | `getStations` 的 `VERSION` → `2026-09-26-v8`（云函数本轮又改了，用户需要一个能区分最新版的标记） |
| 包体积 | 60 文件 / 839.8 KB（41.0%） |

### 水库站的入库/出库：一处必须修的口径错值 + 水库水文过程图（2026-09-26）

用户问：*「水库站还有入库出库流量信息，要不要也趋势里体现，说说你的意见」* → 采纳推荐的分步方案 **① 先修硬伤 → ③ 补净差值数字 → ② 做水文过程图**。

#### 一、结论

- **该不该放进趋势**：该——但**不该塞进现有那张单线「水位趋势」图**，而是让水库站改走河道站那套「水文过程图」（水位左轴 + 入库/出库右轴）；且只对真有可用序列的站升级（**106 座里只有 2 座**）。
- **顺带挖出一处必须修的错值**：界面上库容的**量纲差 100 倍**，并且「总库容」这个名字与字段口径不符。这一条与加不加趋势无关——地图页、列表页、详情页都在显示它。

#### 二、实测的数据实情（2026-09-26 全量扫描 106 座水库）

上游水库历史接口 `/wxhn/data/rthyinfo/rsvr/proc/one.json` **同时返回四条序列**：`rz`(水位) / `w`(蓄量) / `inq`(入库) / `otq`(出库)，而云函数此前**只 map 了 RZ**，另外三个字段直接丢掉——所以「水库没有趋势」不是数据没有，是没取。

| 序列 | 近 7 天覆盖率 |
| --- | --- |
| 水位 `rz` | 106/106 |
| 蓄量 `w` | 8/106 |
| 入库 `inq` | **5/106** |
| 出库 `otq` | **5/106** |

那 5 座的真实质量差别极大：

| 站点 | 7 天点数 | 判断 |
| --- | --- | --- |
| 铜湾 613K0912 | 169（逐时） | 四条序列齐全，**唯一有实用价值** |
| 三角滩 613K0920 | 9 | 可用 |
| 五龙溪 613K0907 | 8 | 入库恒 0.341、出库恒 0.92，7 天一动不动 → 抄录值，不是观测 |
| 柏坡洞 613K0919 | 168 条水位 / 仅 7 条流量 | 流量与蓄量矛盾 → 不可信 |
| 白沙 613K0901 | 7 | 净入为正而蓄量在降 → 不可信 |

#### 三、★ 必须修的错值：蓄量量纲差 100 倍，且「总库容」名实不符

**(1) 量纲 100 倍。** 用同一接口自带的入库/出库做水量平衡核算——若 `inq/otq` 是 m³/s（水文要素代码 Q 的规定单位，也是界面标注的单位），则 `Σ(入库−出库)×Δt ÷ Δ蓄量` 就是蓄量的量纲：

| 站点 | Σ(净入×Δt) | Δ蓄量 | 反推 1 单位 = |
| --- | --- | --- | --- |
| 铜湾（逐时，最准） | 4,577,472 m³ | 4.42 | **1,035,627 m³** |
| 五龙溪 | −300,154 m³ | −0.36 | 833,760 m³ |
| 三角滩 | 1,296,000 m³ | 1.95 | 664,615 m³ |

三个独立站点都落在 **10⁶ m³** 量级，与界面标的「万m³」(10⁴) 差两个数量级。点越密反推越准（铜湾最接近 10⁶）；稀疏站的「净入」只是一个瞬时快照、而记录间隔 12–24 小时，反推必然偏小——这解释了另外两站为何偏低，并不构成对 10⁶ 的反证。

另一条不依赖流量的独立佐证：五龙溪出库 0.92 m³/s，7 天要放掉 55.6 万 m³，而蓄量只掉 0.36 个单位——0.36 只能是 36 万 m³ 量级，否则这座库 16 小时就被放干，但它的水位一周只降 0.9 m。

**修法**：`cloudfunctions/getStations/index.js` 新增命名常量 `RESERVOIR_VOLUME_SCALE = 100` 与 `toWanCubicMeters()`，在云函数一次性换算，**详情/列表/地图四个显示位置同时修正**（标签「万m³」不动，改的是数字）。上游日后改口径只需改这一个常量。注释里写明了上面三个站的反推结果，便于与数据源复核。

**(2) 「总库容」名实不符。** 铜湾 `FSLTDW − W = 120 − 112.55 = 7.45`，水位差 `FSLTDZ − RZ = 0.64 m`，而该站 169 个逐时点算出的真实水面面积 `A = Δ蓄量/Δ水位 = 11.63 km²`；`7.45 / 0.64 = 11.64`——**与 A 吻合到三位有效数字**，说明 `FSLTDW` 就是「汛限（防洪限制）水位相应库容」。若按「总库容」解释，等于说 0.64 m 水位差只剩 6% 蓄量空间，物理上不可能。

⇒ 界面两处改为 **「汛限水位库容」**（站点信息）与 **「占汛限水位库容 X%」**（主指标带）。

⚠️ **一处遗留已定**：同一个字段对应的水位 `FSLTDZ` 此前在界面上叫「**警戒水位**」，而水库不用这个说法 ⇒ 已按用户决定统一改为「**汛限水位**」（见下一小节）。另外三角滩（水位差 0.11 m 却差 19% 蓄量）对上述推论不吻合，用户表示没有别的途径核对，**暂按现状保留、未做改动**。

**(3) 换算带来的排版问题。** 数值放大 100 倍后，「11255.00 万m³」会把单位挤到下一行（真机上是明显破损）→ 新增 `formatVolume()` 按数量级取小数位（≥1000 不带小数 / ≥100 一位 / 其余两位）。

#### 四、③ 净入库/净出库：只作为数字，不给结论

在「入库/出库」两格下面补一行，只陈述两个数之差：`净入库 33.33 m³/s` / `净出库 0.58 m³/s` / 相等时「入库与出库持平」；且**只有两个数都有时**才出现（老马田那类 101 座水库不出现这一行）。

**不给「库容在涨/在退」这类方向性结论**：上游的净入本身恒为蓄量变化率的整数倍（同义反复），而白沙那类自相矛盾的站会直接得出相反的结论。

#### 五、② 水库水文过程图

- 云函数 `getReservoirHistory` 补取 `waterLevel / volume / inflow / outflow`（`value` 继续保留水位，供单线降级路径使用）。
- 新增 `utils/reservoirProcess.js`：`buildReservoirProcess(records)` → `{ hasFlow, reason, records }`，三条同时成立才画：
  ① ≥3 条记录同时有入库与出库；② 入库与出库不能都是恒定值；③ 若有蓄量，`Σ(入库−出库)×Δt` 必须与蓄量变化同号（无蓄量的站跳过，不因此判负）。
- 抽稀：`MAX_CHART_POINTS = 48`，等间隔抽样且**首尾必留**（铜湾 7 天 169 点、30 天 700+ 点，逐点铺在 250px 宽的过程图上每点不到 2px）。
- 绘制：新增 `drawReservoirProcessChart()`（水位左轴 m + 入库/出库右轴 m³/s，三条线、双侧刻度各一套、图例在卡片内、流量轴底部不出现负刻度），结构与河道过程图同源；**`drawChart` 的单线路径逐字节未动**，106 座里 101 座走原路径、界面零变化（标题仍是「水位趋势」）。
- **不画「净入/净出」第三条线**：净入就是水位曲线的斜率，属于重复指标（与上一轮收敛掉的「平均含水量 vs 分层」是同一类问题）。
- **入库与出库共用右侧一套刻度**：两者同为 m³/s，不各占一轴（测试断言两条线传的是同一个 `flowRange`）。
- 图例类名由 `river-legend-*` 中性化为 `process-legend-*`，河道与水库共用一套样式。
- 两个云函数都加了版本号（`2026-09-26-v7` / `2026-09-26-v1`），部署后可直接从接口响应确认新代码是否上线。

#### 六、验证

| 项目 | 结果 |
| --- | --- |
| 全量测试 | **41/41**（新增 `tests/reservoir-process.test.js`、`tests/reservoir-volume-unit.test.js`） |
| `check-ui` | 绿 |
| 反向自检 `.ekko-tmp/selftest-reservoir-process.js` | **12/12 全抓**：A 去掉 ×100 换算 / B 不取入库出库序列 / C 去掉「与蓄量同号」校验 / D 去掉「恒定值不是过程」判定 / E 不抽稀 / F 去掉过程图路由 / G 出库自占一轴 / H 标签改回「总库容」 / I 去掉净差值行 / J 图例无条件显示 / K 退回「一律两位小数」 / L 去掉流量轴非负约束。还原后逐字节一致，基线复跑通过 |
| 真实数据夹具 | `tests/fixtures/reservoir-process.json`（5 座站的线上真实序列，含铜湾 169 点），判定与抽稀都在真实数据上断言 |
| 视觉核对 | `.ekko-tmp/gen-reservoir-preview.js` 用**页面里真正跑的绘制代码**（桩 canvas → SVG）出图，肉眼核对三条线/双轴/图例/刻度非负/小流量刻度小数位；同一页核对监测数据卡的单位口径与净差值行排版。核对中发现并修掉了「11255.00 万m³ 把单位挤到下一行」与「流量轴出现 −179」两个真机必现的破损 |
| 包体积 | 60 文件 / 839.2 KB（41.0%）；夹具位于 `tests/` 内，不计入包 |

#### 七、口径（新增）

> **同一件事的合成量与分解量不各占一条曲线**：净入就是水位曲线的斜率，只作数字、不作曲线。**异量纲才允许双轴，同量纲必须共用一套刻度**：入库与出库同为 m³/s，共用右轴，不做三轴。**抄录值不是过程**：一组序列若恒定不变，不能当作观测过程画出来。**界面上标的单位必须与上游给的量自洽**：用量纲反推 + 物理矛盾交叉验证，发现不符时宁可先不显示，也不显示错值。

### 含水量趋势从 5 个指标收敛为「整体 / 分层」两个视角（2026-09-26）

用户反馈：*「我的意思是你觉得含水量趋势需要这么多种类的数据吗，平均的10cm的20cm和40cm的，是否有点冗余」*

#### 一、判断：有两处冗余，其中一处比用户指出的更彻底

| 选项 | 判断 |
| --- | --- |
| 平均含水量 | **与分层冗余**：平均含水量本身就是 10/20/40cm 的合成值，两者是同一件事的「合成 / 分解」 |
| 10cm / 20cm / 40cm 各占一个 chip | **互相冗余且不可比**：三个 chip 排不进一行（末尾那个被裁掉），看一层要点一次、还得凭记忆来回对比 |
| 相对含水率 | **更彻底的冗余**：相对含水率 = 含水量 ÷ 该站土壤自身的一个常数（田间持水量，按《土壤墒情监测规范》口径），所以它的曲线与含水量**完全同形、只是纵轴刻度不同**。作为一条独立的趋势线，看的还是同一件事 |

⇒ 五个选项里真正独立的趋势只有两个**视角**：整体（平均含水量）与分层（10/20/40cm）。

#### 二、改法

| 项目 | 改前 | 改后 |
| --- | --- | --- |
| chip 数 | 5 个（末尾被裁，需横向滚动才能看到） | **2 个**：「平均含水量」「分层含水量」 |
| 分层怎么看 | 三层各占一个 chip，点一次看一层 | **三条线同图**：10/20/40cm 画在同一张曲线图上，共用一套纵轴（同为 %，同轴才可比）；图例在画布顶部，颜色与「分层含水量」进度条一致 |
| 相对含水率 | 一个常规趋势 chip | 不再是常规趋势项；**仅当上游只回传相对含水率时兜底提供**（否则趋势卡会空转） |
| 绘制路径 | 只有单指标 `drawChart` | 新增 `drawSoilLayersChart()`；`drawChart` 顶部按 `activeSoilTrend === 'layers'` 路由，**单指标绘制路径逐字节未动**，不引入新的绘制范式（结构沿用河道过程图里已验证的「逐层画线 + 关键点」写法） |
| 缺层处理 | — | 只画真的有数据的层，图例同步只列对应颜色，不会出现「图例里有、曲线上没有」的层 |
| 数据点多时 | 单线 ≤15 点全画 | 三线 ≤12 点全画，超过则每层只留首尾关键点，避免三色圆点糊成一片 |

**收益**：chip 从 5 个变 2 个（一行绰绰有余，因此上一轮为挤下 5 个 chip 而加的 `short` 深度简称字段已删除）；更重要的是，三条分层曲线同图后**可以直接对比「哪一层在变干」**，比原来点三次、凭记忆比较有用得多。

#### 三、口径（新增）

> **同一个趋势只保留一个视角。合成值与分解值不要做成两条可切换的曲线（要么合并成一组多线图，要么只留其中一条）；由线性换算得到的量（相对含水率 = 含水量 ÷ 站点常数）形状必然相同，只保留其「当前值」，不单列趋势。**

#### 四、验证

| 项目 | 结果 |
| --- | --- |
| 全量测试 | **39/39**（新增 `tests/soil-trend-views.test.js`） |
| `check-ui` | 绿 |
| 反向自检 `.ekko-tmp/selftest-soil-views.js` | **6/6 全抓**（A 三层恢复成三个独立项 / B 相对含水率恢复成常规项 / C 去掉 `layers` 路由分支 / D 图例不标深度 / E 改成双纵轴 / F chip 退回简称字段），还原后逐字节一致（`soilTrend.js` `ef65a4dd861a`、`detail.js` `f7c2e23fc6ea`、`detail.wxml` `56337dab1e52`） |
| 绘制验证（不靠肉眼猜 canvas） | `.ekko-tmp/render-layers-svg.js` 把**页面里真正跑的 `drawSoilLayersChart`** 跑在桩 canvas 上、记录每一次绘制调用并翻译成 SVG → `.ekko-tmp/preview/soil-trend-layers.html`（7 天 / 30 天两张），核对三条曲线、图例、单套刻度、点的疏密 |
| 行为断言 | 三种颜色各画一条线；图例只列有数据的层；纵轴刻度恰好 5 个（等于自证没有双轴）；7 点 → 42 次 `arc`（3 层 × 7 点 × 2 圆）；只有一层时只画 2 次 `arc`；无分层数据时 0 次绘制调用 |
| 包体积 | 59 文件 / 826.6 KB（40.4%） |

### 站点详情「监测数据」瘦身：只留会变的数（2026-09-26）

用户反馈：*「你看土壤墒情的详情是否过于复杂，能否选取一些对用户有重要意义的数据展示，水库站及河道站也是如此」*。

#### 一、先量化，再动手

用 `.ekko-tmp/gen-detail-preview2.js` 把三类的「监测数据」卡按真实条件渲染成 HTML（数值取自页面自己的 `processStationDisplay`，样式用真实 `detail.wxss` 做 rpx→px），得到「卡内数据点」计数：

| 类型 | 改前 | 改后 |
| --- | --- | --- |
| 水库站 | 4 | 4 |
| 河道站 | 4 | 4 |
| 土壤墒情站（数据齐全） | **7 个数据点 + 2 个分区标题 + 1 行说明** | **6 个数据点 + 1 个分区标题** |

⇒ 结论：**过载的只有墒情站**（接近另两类的两倍），且有三处「同一件事要读两遍」：

1. 10/20/40cm 分层含水量：进度条（当前值）与趋势 chip（曲线）各一份；
2. 相对含水率：埋在下面小格里，又在趋势 chip 里；
3. 「平均土壤含水量」与「分层含水量」是同一件事的聚合与分解，却被两个分区标题隔开。

#### 二、土壤墒情站（实质瘦身）

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| 主指标带 | 平均土壤含水量（单格） | **平均土壤含水量 ｜ 相对含水率** 同类成对（现在有多湿 + 旱情程度），相对含水率的解释改为带内小字「反映当前旱情程度」 |
| 分区标题 | 「土壤剖面 · 分层含水量」+「墒情与旱情指标」 | 仅「**分层含水量**」 |
| 说明行 | 「相对含水率反映当前旱情程度」独立一行 | 并入主指标带小字 |
| 次级栅格 | 饱和含水率 ｜ 相对含水率 ｜ 地温 | **仅地温**（整行） |
| 站点信息 | 编号 / 经纬度 / 土壤类型 / 默认监测层 | 增加「**饱和含水率**」——它是土壤物理属性、不随时间变，归属性区 |
| 趋势说明 | 「当前曲线：平均含水量（单位：%）」 | 「**单位：%**」（chip 已高亮，不再重复曲线名） |
| 趋势 chip | 5 个挤一行，第 5 个「相对含水率」被裁掉 | 分层三项改用深度简称（10cm / 20cm / 40cm，与进度条标签一致），**5 个 chip 一行完整显示** |

#### 三、水库站 / 河道站：同类检查后判定「已达标」，未删减

- 水库：当前水位（+距警戒）｜ 当前库容（+占总库容 %） → 入库流量 ｜ 出库流量；
- 河道：水位（+距警戒）｜ 流量 → 水温 ｜ 水质。

两类的「监测数据」卡都只有 4 个数据点，且每一个都是**会变的实时值**；不随时间变的属性（总库容、正常水位、警戒水位、保证水位）本来就在「站点信息」卡里。**没有可删的项**，故保持不动，避免为了「有改动」而删掉有用的基准值。

（可选、本次未做：① 河道过程图把流量线画细一档，弱化它与水位线的视觉同级；② 「站点编号 / 经纬度」对普通用户价值低，可移入折叠区；③ 水库「入库−出库」净流量一句话结论。）

#### 四、真机兜底

墒情站瘦身后，「地温」成为栅格里唯一的落单项。原先靠 `.realtime-item:only-child` / `:last-child:nth-child(odd)` 撑满整行——**伪类选择器在部分基础库会被整条丢弃**，故新增显式规则并写进测试：

```css
/* 真机对伪类选择器支持不可靠，墒情站的「地温」不靠伪类兜底 */
.realtime-item-wide{float:none;width:100%}
```

#### 五、验证

| 项目 | 结果 |
| --- | --- |
| 全量测试 | **38/38** |
| `check-ui` | 绿 |
| 反向自检 `.ekko-tmp/selftest-detail-slim.js` | **5/5**（① 饱和含水率放回监测卡 ② `hasMonitoringData` 退回旧判据 ③ 趋势说明改回「当前曲线：」 ④ 恢复 `.section-hint` ⑤ 恢复「墒情与旱情指标」标题 —— 逐一变红），还原后逐字节一致（wxml `d9ceb4fc5424` / js `55ba6c3fb727` / wxss `63c9273d7273`），基线复跑通过 |
| 预览 | `.ekko-tmp/preview/detail-before.html`（36 112 字节）与 `detail-after.html`（34 715 字节），浏览器截图逐块核对 |
| 包体积 | 59 文件 / 820.3 KB（40.1 %） |

**判据隔离样本**：`tests/detail-monitoring-layout.test.js` 新增 X6「只有饱和含水率的墒情站」——`hasMonitoringData` 若退回用 `showDroughtIndicators` 判定，该样本会立刻不一致（其余样本抓不到这个回归）。

#### 六、详情页口径（新增）

> **「监测数据」卡只放会变的数；不随时间变的属性一律归「站点信息」。同一组数据不在两处各显示一遍。**

### 文案收口：面向用户的文字不再出现「上游 / 接口」，并去掉重复的数据来源（2026-09-26）

用户反馈：*「乡镇短临预报下面的说明不太恰当，用户不需要了解什么请求的」*。根因是把**实现理由**写进了界面（12 次请求、上游额度），以及多处失败原因把「上游 / 接口」这类实现用语直接端给了用户。

#### 一、逐条改动

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| 短临卡片（未展开） | 12 个乡镇需要 12 次独立请求，为避免无谓消耗上游额度，只在展开时获取。未获取前，这里不给任何降雨结论。 | **展开后查看 12 个乡镇未来 2 小时的降雨趋势** |
| 失败原因行 | 失败原因：上游接口限流（和风天气频率超限） | **失败原因：数据源访问频率超限（和风天气）** |
| 失败原因（超时） | 上游接口超时或连接中断 | 数据源响应超时（和风天气） |
| 失败原因（无权限） | 上游接口无权限（该接口可能不在当前套餐内） | 数据源无权限访问（和风天气） |
| 回落提示（stale） | 上游接口限流中，以下为上次成功结果 | 数据源访问频率超限，以下为上次成功结果 |
| 响应 message | 和风天气接口限流（429）／和风天气接口取数失败／彩云天气接口限流（429） | 和风天气访问频率超限／和风天气取数失败／彩云天气访问频率超限 |
| `describeError` | 上游接口限流（彩云天气配额或频率超限），请稍后重试 | 数据源访问频率超限，请稍后重试 |
| `describeError` | 接口返回格式无法解析 | 返回格式无法解析 |
| 短临失败态 | 短临预报接口未返回有效数据，可点击重试 | 短临预报未返回有效数据，可点击重试 |
| 内部错误（天气页 / 首页） | 天气接口未返回有效数据 | 天气数据未返回有效内容 |
| **列表脚注** | 数据来源：和风天气分钟级降水 API（1km，5 分钟一档） | **删除**（数据来源只保留页脚一处） |
| 页脚 | 数据来源：和风天气｜乡镇短临：和风天气 | 同源时自动折叠 → **数据来源：和风天气** |

`summarizeFailReason(list, label)` 的标签改为可选后缀：无标签时「数据源访问频率超限」，有标签时「数据源访问频率超限（和风天气）」，不再出现「（数据源）」这类自指括号。

云函数的 `note` 字段（数据来源署名）**保留在载荷里**（API 元数据、测试与 mock 仍引用），只是不再渲染到卡片里。

#### 二、把它变成硬约束

新增/改写三处断言，锁死「面向用户的文案不得出现实现用语」：

- `tests/weather-honesty.test.js`：对 429 / 超时 / 403 / 401 / 其他 五类输入逐一 `assert.doesNotMatch(out, /上游|接口/)`；
- `tests/weather-fetch-diagnostic.test.js`：对 `describeError` 的三类 429 输入 `assert.ok(!/上游|接口/.test(out))`；
- `tests/nowcast-lazy.test.js`：短临卡片区块 `assert.doesNotMatch(/上游|接口/)` ＋ `assert.ok(索引 < 0, '卡片内不再重复「数据来源」')`。

原先绑定旧文案的断言按**同样的意图**等价更新（`/限流/` → `/超限/`、`/和风天气接口限流（429）/` → `/和风天气访问频率超限/`、`/和风天气接口取数失败/` → `/和风天气取数失败/`），不放松强度；四张测试文件的「卡片区块」边界由 `nowcast-note` 改为 `provider-info`。

#### 三、验证

| 项目 | 结果 |
| --- | --- |
| 全量测试 | **38/38** |
| `check-ui` | 绿（`.nowcast-note` 样式随之删除，无死样式） |
| 反向自检 `.ekko-tmp/selftest-user-copy.js` | **3/3**（429 文案改回「上游接口限流」→ 天气诚实性变红；`describeError` 改回 → 诊断测试变红；把脚注加回来 → 按需获取测试变红），还原后逐字节一致（fc `fa68dae5227b` / api `0319b20e4342` / wxml `d1672b0a5342`） |
| 反向自检 `.ekko-tmp/selftest-nowcast-lazy.js` | **16/16** |
| 四态预览 + 截图核对 | 卡片内无「数据来源」脚注；失败原因写作「数据源访问频率超限（和风天气）」；全篇无「上游 / 接口」 |


### 乡镇短临改为「按需获取」（2026-09-23）

**动机**：短临要打 12 个乡镇 = 12 次上游请求，而它是天气页里唯一的大头。原来页面一打开就取（`loadAllData` 用 `Promise.all([loadWeather(), loadNowcast()])`），哪怕用户根本没往下看。和风按 QPM 限流，这 12 次既是额度消耗的主要来源，也是最容易被限流打死的链路。

#### 一、改成了什么

| 时机 | 改前 | 改后 |
| --- | --- | --- |
| 打开天气页 | 天气 + 12 个乡镇短临（16 次） | **只取天气（4 次）**，短临一次都不打 |
| 下拉刷新 / 点「刷新」 | 同上，连带短临 | 天气必刷；短临**只在已展开过时**才跟着刷 |
| 展开短临卡片 | ——（没有这个概念） | 取 12 个乡镇；5 分钟内重复展开不再请求 |
| 收起短临卡片 | —— | **不取数、不丢数据**（收起只是隐藏） |
| 短临失败卡片上的「重试」 | `onRefresh`（连天气一起刷） | `onNowcastRefresh`（只重取短临） |
| 切换乡镇 | 连同短临一起重取 | 短临是**全县 12 个乡镇**，与所选乡镇无关；5 分钟内不重取 |

新增状态与方法：`nowcastStatus` 多了一个 `idle`（尚未取数）、`nowcastExpanded`、`nowcastFresh()`、`onToggleNowcast()`、`onNowcastRefresh()`、`NOWCAST_FRESH_MS = 5 分钟`、`this.nowcastLoadedAt`。

#### 二、口径：新增的「尚未取数」不能和别的状态混

这是本轮最需要注意的地方。短临现在有四个状态，界面必须各自可辨：

| 状态 | 界面 | 绝不能是 |
| --- | --- | --- |
| `idle` 尚未展开 | 「尚未获取」＋「点上方「展开」获取」＋「展开后查看 12 个乡镇未来 2 小时的降雨趋势」（**面向用户的收益，不写请求次数 / 上游额度**） | 「无降雨」「暂无降雨」「数据缺失」「取数失败」，**以及一切实现细节（请求次数 / 上游额度 / 接口）** |
| `loading` 正在取 | 「正在获取 12 个乡镇的短临数据…」＋骨架圈 | 空白、旧的加载文案 |
| `success` 取到了 | 完整性提示 + 失败原因行（若有）+ 12 个乡镇列表 + 来源说明 | —— |
| `error` 失败了 | 失败卡片 + **具体原因** + 重试 | 「无降雨」 |

同理，`onRefresh` 的成功提示里，**「没展开过」不算「暂不可用」**（`nowcastIdle`）：以前 `weatherOk && !nowcastOk` 会掉进「天气已更新，乡镇短临预报暂不可用」，现在「没展开」直接算刷新成功，只有真的失败才提示不可用。

另外：`data.nowcastStatus` 初值是 `idle` 而不是 `loading`——**没在加载就不能显示成加载中**，这跟「取不到就说取不到」是同一条纪律。

#### 三、验证

- **文案口径（2026-09-26 修订）**：未展开说明原先写成「12 个乡镇需要 12 次独立请求，为避免无谓消耗上游额度，只在展开时获取。未获取前，这里不给任何降雨结论。」——这是**把实现理由写进了界面**，用户不需要知道请求次数与上游额度。改为面向用户的收益陈述「展开后查看 12 个乡镇未来 2 小时的降雨趋势」。测试把「应说明为什么按需获取」换成「应告诉用户展开能得到什么」，并**新增 `assert.doesNotMatch(idle, /请求|额度|上游|接口|12 次/)`**，把「未展开文案不得暴露实现细节」变成硬约束；反向自检补场景 P（把旧文案写回界面）→ 该条确实变红。
- **新增 `tests/nowcast-lazy.test.js`（19 项）**：包括用桩页面对象做的行为测试——`loadAllData` 在未展开时 `loadNowcast` 调用数必须为 0、已展开且过期时必须为 1；展开取 1 次、收起 0 次且不丢数据；5 分钟内复用、超过 5 分钟重取、失败后必须允许重试；`loadNowcast` 第一步就是置 `loading` 并记录取数时刻；模板三态互斥、未展开区块不含任何降雨结论、列表不再依赖 `success`；既有口径（完整性行 / 失败原因行 / 缺失说明 / 标题时间 / 来源标注）在改动后仍然在；样式无 `gap`、无多余伪类、触控高度 ≥88rpx；新增文案无「关注 / 预警 / 风险 / 态势」；云函数仍是 12 个乡镇一次全取（按需只发生在前端）。
- **反向自检 16/16**（`.ekko-tmp/selftest-nowcast-lazy.js`）：逐个回滚——改回 `Promise.all` 打开就取 / 把 `idle` 写成 `loading` / 收起也重取 / 去掉 5 分钟新鲜度 / 不记录取数时刻 / 未展开暗示「暂无降雨」/ 未展开说成「数据缺失」/ 未展开区块不绑状态 / 重试改回刷新整页 / 去掉「正在获取」/ 未展开提示成「不可用」/ 触控高度不足 / 用 `gap` / 标题行变假可点 / 失败时渲染空列表——**15 个全部被抓住**，且还原后三个文件逐字节一致。
- **全量 37/37 通过**，`check-ui` 绿（9 道门禁全过）；改动文件全部纯 LF。
- **四态视觉核对**：`.ekko-tmp/preview/nowcast-lazy.html` → 截图确认。顺带发现并修掉一处真实问题：**「展开/收起」胶囊原先在未取数态贴着标题、在取到数据态却跑到最右，位置会跳**——原因是标题里的时间元素带 `wx:if`，没有它就没有 `margin-left:auto` 撑开。改为时间占位常驻（未取数时为空，不伪造时间），胶囊在四个状态里位置一致。
- 包体积 **59 个文件 / 820.1 KB（40.0%）**，新增测试文件被 `packOptions.ignore` 排除。

#### 四、额度对照（和风第一档 0–50,000 次/月 = ¥0，超出 0.0007 元/次）

| 场景 | 使用强度 | 次/月 | 占免费额度 | 费用 |
| --- | --- | --- | --- | --- |
| 只看天气（不展开短临） | 每天 8 小时 | 11,520 | 23% | ¥0 |
| 只看天气（不展开短临） | 全天常开 | 34,560 | 69% | ¥0 |
| 天气 + 短临一直展开 | 每天 8 小时 | 46,080 | 92% | ¥0 |
| 天气 + 短临一直展开 | 全天常开 | 138,240 | 276% | ¥61.77 |

**改动前**：打开页面就取 12 个乡镇 → 全天常开 **138,240 次/月 ≈ ¥61.77/月**。
**改动后**：默认路径（不展开）全天常开 **34,560 次/月 = ¥0**。也就是说，**把最贵的场景从「必然付费」变成了「免费」**；只有用户主动把短临一直开着（还要一直停在天气页）才会回到付费区。

每个窗口的 16 次里 4 次是常规天气（实况 + 逐小时 + 逐日 + 分钟级），这部分云函数侧有 5 分钟坐标缓存，多个用户/多个实例各自缓存，实际更低。

#### 五、给后续接手者的提醒

1. **别把短临挪回 `loadAllData` 的无条件调用**——一挪额度就回去了。`tests/nowcast-lazy.test.js` 的第一个行为测试就是为了拦住这件事。
2. 短临是**全县 12 个乡镇**，跟页面上选的乡镇无关；不要因为「换了乡镇」就强制重取。
3. 如果以后想让首屏也有个「有没有雨」的概览，别去提前打 12 个乡镇——分钟级降水（单点 1 次请求）已经覆盖了这个需求。

### 天气数据源统一为和风（单一数据源）（2026-09-23）

**用户要求**：「只想用一种服务，不想彩云和和风混用」。已落地为**全程只用和风**，并且顺带修掉了两个会让界面显示错值的真问题。

#### 一、混用点一共三处，全部收口

| 链路 | 改前 | 改后 |
| --- | --- | --- |
| 常规天气（实况 / 逐小时 / 未来几天） | 由 `utils/config.js` 的 `WEATHER_PROVIDER: 'caiyun'` 决定 | `'qweather'` |
| 乡镇短临 + 分钟级降水 | 前端 `getNowcast` **不传** provider，云函数走 `auto`＝和风失败回落彩云 | 前端**显式传同一个 provider**，云函数据此只上和风 |
| 和风失败时的回落 | 有彩云兜底 | **无兜底**：失败就如实报失败（这正是「不混用」的代价，也是用户要的） |

单一开关：`utils/config.js` 的 `WEATHER_PROVIDER`。前端 `getWeather` 与 `getNowcast` 都传它，云函数 `resolveNowcastProviders('qweather')` 只返回 `['qweather']`。
彩云的代码**全部保留**（`getCaiyunWeather` / `buildNowcastFromCaiyun` / `fetchCaiyunMinutely`），只有显式传 `provider=caiyun` 或设 `NOWCAST_PROVIDER=caiyun` 才会走到——留作退路，但不再是默认，也不会被自动回落命中。

#### 二、★ 切源前发现的真问题：和风已经把常规天气迁到新结构

核对官方文档（`/docs/api/weather/weather-current/` 等）发现：常规天气不再是 `/v7/weather/now|24h|7d` 的扁平字段，而是

- 实况 `GET /weather/v1/current/{纬度}/{经度}`
- 逐小时 `GET /weather/v1/hourly/{纬度}/{经度}`
- 逐日 `GET /weather/v1/daily/{纬度}/{经度}`

返回的是嵌套对象（`temperature.value` / `hours[]` / `days[]` / `precipitation.probability`）。
**旧实现在这个结构上会全部取到 undefined**：气温、天气现象、逐小时、未来几天全空——切源当天就会「打不开」。
而**分钟级降水仍留在 `/v7/minutely/5m`**（官方文档原文），所以同一个 API Host 上两代路径并存。

处理：**两代都归一化**。先试 v1，不通退回 v7，成功的那一代记在内存里，后续请求不再反复探测。两代形态都进 `normalizeQWeatherCurrent/Hourly/Daily`。

#### 三、两代的单位约定不同（差 100 倍 / 3.6 倍的坑）

| 字段 | v1（新） | v7（旧） | 处理 |
| --- | --- | --- | --- |
| `humidity` | `[0,1]` 小数（0.69） | 百分比整数（96） | 按代判断是否 ×100 |
| `precipitation.probability` / `pop` | `[0,1]` 小数（0.64） | 百分比整数（60） | 同上 |
| 风速 | `wind.speed` 是 **m/s** | `windSpeed` 是 km/h | v1 ×3.6 换 km/h |
| 能见度 | `visibility` 是**米** | `vis` 是**公里** | 统一成公里（v7 别再除一次变成 0） |
| 风级 | `wind.scale` | `windScale` | 优先用上游风级，缺失才按 GB/T 28591-2012 自己算 |
| 路径经纬度顺序 | 路径参数，**纬度在前** | query，**经度在前** | 分别写对（最难发现的一类错） |

#### 四、★ 修掉的口径错误：把降水量当成降雨概率

旧实现（和风分支）写的是 `rainProb: parseInt(item.precip || 0)`——界面上「未来 N 天」那一列的概率条与「64%」实际是**降水量的毫米数**。本项目口径是「宁可不显示，也不显示错值」，已改为：

- 概率只来自真正的概率字段（v1 `daytime.precipitation.probability`、v7 `pop`）；
- 上游没给就是 `null` + `hasRainProb: false`，模板渲染成灰色的「--」（与逐小时「--」同一套灰），**绝不外推、绝不用毫米数冒充**；
- 降水量保留在 `rain` 字段（mm），语义与概率分开。

同时把 `current.uvIndex` 从写死的 `0` 改成上游真实值（v1 `uvIndex`），避免一个「看着像数据」的假 0。

#### 五、时区：`Z` 要 +8，显式偏移不要动

v1 官方示例给的是 `2024-05-31T03:00Z`（UTC），逐日的 `forecastStartTime` 常是 `22:00Z`——**+8 之后已经跨日**。`qweatherClock()`：

- 以 `Z` 结尾 → +8 小时**并用真实 Date 处理跨日**（`22:00Z` → 次日 `06:00`，日期滚到下一天）；
- 带显式偏移（`+08:00`）→ 上游给的已是当地时间，直接用墙钟，**不再加 8 小时**（否则整体错 8 小时）；
- 只有日期（旧 v7 的 `fxDate`）→ 只出日期，时刻留空，不凭空造 `00:00`。

**待线上核对**：v1 的 `astro`（日出日落）示例值与「Z=UTC」的解释并不自洽（`04:22Z` 若按 UTC 换算是 12:22，明显不对）。所以部署后**必须看一次** `[qweather] 形态自检` 日志（见下），确认时区解释与该账号真实返回一致。

#### 六、切源之后补上的配额保护

和风分支原来**没有**缓存/退避：切源后每次刷新都会真打 3 个天气接口 + 1 次分钟级。已把彩云那套策略原样接到和风分支：

- 成功结果按坐标缓存 `WEATHER_CACHE_TTL`（5 分钟），命中返回 `cached: true`；
- 429 时退避 `UPSTREAM_BACKOFF_MS`（90 秒），期间回落到 `WEATHER_STALE_MAX`（40 分钟）内的上次成功结果并标 `stale` + `staleMinutes`；
- 超 40 分钟不回落到旧预报；失败一律带 `source: 'qweather'` 与可读原因（含 `retryAfterSec`）。

#### 七、★ 部署后必看的一条日志（口径自检）

首个真实响应会打一次：

```
[qweather] 形态自检 v1：实况湿度 → 69%，风级 → 3级；首个逐小时 → 11:00，雨量 → 0.09mm；首日 → 8/11，概率 → 64（null 表示上游确实没给概率）
```

用途：① 确认走的是 v1 还是 v7；② 确认湿度不是被多乘/少乘 100 倍；③ 确认逐小时时刻不是整体错 8 小时；④ 确认概率列的值是不是百分比（`null` 表示上游确实没给）。
若「首个逐小时」的时刻与当前北京时间明显不符，就是时区解释需要调整，把这条日志贴回来即可定位。

#### 八、验证

- **新增 `tests/single-weather-source.test.js`（27 项）**：单一数据源（前端开关、短临不回落、云函数源列表不含彩云）、v1/v7 双形态归一化、结构不符必须抛错、路径经纬度顺序、四类单位坑、三条时区规则、概率口径（`hasRainProb`）、模板条件渲染、和风分支的缓存/退避/失败原因、形态自检日志、分钟级同源。
- **反向自检 45/45**（11 个回滚场景）：数据源改回彩云 / 短临不传 provider / 和风失败又回落彩云 / v1 湿度不 ×100 / v7 湿度按 v1 处理 / 拿降水量冒充概率 / 时区不处理跨日 / 显式偏移也 +8 / 概率无条件渲染 / 和风分支不写缓存 / v7 能见度再除一次——**全部被抓住**。其中「和风分支不写缓存」一开始没被抓住，暴露出我写的一条**空断言（`||` 组合后永远为真）**，已改成直接要求真的写缓存。
- **端到端假网络验证（`.ekko-tmp/smoke-single-source.js`）**：把 `https.get` 打桩，统计每个请求落到的域名。结果——短临 12 个请求、常规天气 4 个请求，**100% 落在自有和风 Host，打到彩云的请求数 = 0**；所有和风请求都带 `Authorization`，URL 上不带 `key=`（JWT 模式）；返回结构逐项正确（气温 32 / 湿度 69% / 西南风 / 3 级 17.1km/h / 逐小时 11:00 / 逐日跨日 8/11 / 概率 64% / 分钟级 5 分钟一档 24 点 00:00→01:55）。
- **全量 36/36 通过**，`check-ui` 绿，本轮改动文件全部纯 LF。
- **两条旧断言按同等意图更新**（实现被重写，断言绑在旧文本上）：`weather-honesty.test.js` 里「和风分支也应带 `available: false`」改为兼容单行/多行写法；`weather-value-sanity.test.js` 里「和风分支风级应保持不变」改为覆盖两代的风级来源（v1 `wind.scale` / v7 `windScale`，缺失才自己算）。**均是等强度替换，没有放松。**

#### 九、气象图层那两个源不属于「天气服务」

「只用一种服务」目前指**天气数据**。天气页的「气象图层」是另一条数据平面，用的是：

- **雷达回波**：RainViewer（`api.rainviewer.com` / `tilecache.rainviewer.com`）
- **风场**：Open-Meteo（`api.open-meteo.com`）

**和风的开发者文档目录里没有雷达 / 卫星瓦片类 API**（`/docs/api/` 下只有 GeoAPI、天气预报、分钟预报、预警、天气指数、空气质量、时光机、热带气旋、海洋、太阳辐射、天文、控制台 API；官网的「天气地图」是展示页面而不是可调用接口）。所以这两个源**没有和风替代品**，无法并入单一数据源。若确实要去掉，只能整块砍掉气象图层，或另找付费瓦片服务——**未决，等用户决定**。

### 乡镇短临 / 分钟级降水接入和风天气（2026-09-23）

**为什么换源**：彩云免费档的分钟级降水取不到——`/weather` 响应里没有 `minutely`，直连 `/minutely` 的 12 个
乡镇在线上实测 **12/12 全部 429**。选型结论（真请求实测 + 官方定价页实读）：

| 方案 | 粒度 | 空间 | 时效 | 费用 |
| --- | --- | --- | --- | --- |
| **和风天气分钟级降水**（本次采用） | **5 分钟** | **1 km** | 2 小时 | **0–5 万次/月 = CNY 0**，超出 0.0007 元/次 |
| 彩云（原用） | 1 分钟 | 2 km | 2 小时 | 免费档限流严重；付费贵 |
| Open-Meteo `minutely_15` | 15 分钟 | 模式格点 | 2 小时 | 0 元，**但境内是逐小时插值**（官方文档原文 + `models=icon_d2` 实测 400） |
| 自建雷达外推 | 10 分钟 | 1.1 km | 30–60 分钟 | 0 元，但只有回波档、给不了毫米数 |

**实现（`cloudfunctions/getWeather/index.js`）**

- **多源编排**：`resolveNowcastProviders()` 决定优先级——显式 `?provider=` > 环境变量 `NOWCAST_PROVIDER` >
  `auto`（配了和风密钥则和风优先、失败回落彩云）。`getNowcast()` 逐个尝试，第一个有乡镇取到的就算数；
  **全部源都失败时把每个源的失败原因合并上送**（`和风天气：…｜彩云天气：…`）。
- **串行 + 间隔**（关键）：`buildNowcastFromQWeather()` 用 `for` 循环逐乡镇取数，每轮 `await sleep(NOWCAST_QPM_GAP_MS = 150)`，
  **绝不并发**——和风按「每分钟请求数」限流，12 个并发就是彩云那样全军覆没。一轮约 1.8 秒。
- **口径归一**：和风 `minutely[24]` 每档是该 5 分钟的**降水量（mm）**，`qweatherSlotIntensity()` ×12 换算成
  全项目统一的 **mm/h 强度**，再 `expandSlotsToMinutes()` 展开成 120 个 1 分钟点，
  于是 `findStartMinute` / `downsampleToFrames` / `rainImpact` 全部沿用，**2 小时累计严格等于 24 档之和**。
  归一化后的对象与彩云同形状（`toInternalMinutely`），下游只维护一套逻辑。
- **概率不编**：和风不提供降雨概率 → `probability: null`、`hasProbability: false`、`peakProb: null`、
  帧里的 `prob` 也是 `null`（旧实现用强度反推过一个「概率」，那是没有出处的数字）。
- **时间轴修正**（顺带修掉的真错误）：`buildMinuteBlock(minutely, stepMinutes)` 按真实间隔标轴。
  旧实现把 1 分钟序列按 10 分钟标，一张「未来 2 小时」的图画出来标到 **11:50**，等于谎报时段。
- **常规天气接口的分钟级兜底**：`fillMinuteFromQWeather()` —— 彩云 `/weather` 不给 `minutely` 时用和风补上，
  补不到就保持「暂不可用」并带上原因（未配密钥 / 限流 / 超时 / 无权限），绝不换一句「无降水」。
- **鉴权兼容**：`qweatherUrl()` + `qweatherAuthHeaders()` 同时支持旧版 `?key=` 与新版
  **JWT（`Authorization: Bearer`，配 `QWEATHER_TOKEN` + `QWEATHER_HOST`）**；`getQWeather` 也改走同一套。
- **口径自检日志**：每轮的第一个乡镇打一条
  `[nowcast-q] 口径自检 中方镇：24 档合计 X.XXmm，强度峰值 Y.YYmm/h，上游 summary「…」`。
  和风「每档 mm」的单位是从官方示例（`18:55` 起雨、`summary = 95分钟后雨就停了`，数据在 90 分钟后归零）
  反推的，**首个真实响应必须靠这条日志自证**：若与界面数字相差 12 倍，就是单位理解错了。

**前端（`pages/rainfall/rainfall.js|wxml|wxss`）**

- 分钟级卡片：图例改为「柱高为 **5 分钟档/逐分钟** 降水强度（纵轴单位 **mm/h**）｜数据来源：和风天气」——
  旧图例写「逐分钟降水量（mm）」既不真（彩云给的是强度）也不分源。**纵轴刻度同步改 mm/h 并把左边距
  40 → 54**（换成 mm/h 后「10mm/h」宽 39.6px，40 会把顶格裁掉——预览截图实测发现）。
- 分钟级卡片取不到时新增 `.minute-empty-reason` 行，把上游原因显示出来。
- 短临卡片的「降雨概率」列改为 `wx:if="{{item.hasProb}}"`：和风不给概率时该列消失（变成 2 列，布局实测正常）。
- 页脚数据来源分行：`数据来源：彩云天气｜乡镇短临：和风天气`（实况与短临来源不同，必须说清哪一段是谁给的）。

**部署配置（必须做，否则和风分支按 `auto` 会回落彩云）**

1. 和风控制台确认已开通「**分钟预报**」。
2. 云函数 `getWeather` 环境变量任选一种（详见下方「和风凭据」）：
   - **API KEY 凭据（最省事）**：`QWEATHER_HOST=<你的 API Host>` + `QWEATHER_KEY=<凭据里的 key>`
   - **JWT 凭据（更安全，推荐）**：`QWEATHER_HOST` + `QWEATHER_KID`（凭据ID）+
     `QWEATHER_ISSUER`（开发者ID，Q 开头 10 位）+ `QWEATHER_PROJECT`（项目ID）+
     `QWEATHER_PRIVATE_KEY`（Ed25519 私钥 PEM 全文，换行可写成字面量）或 `QWEATHER_PRIVATE_KEY_B64`
   - 旧版账号：`QWEATHER_KEY=<你的 key>`（公共地址 `devapi.qweather.com` 从 2026 年起逐步停服）
3. 重新部署 `getWeather`（本次同时带上了风速风级修复、分钟级诚实性、失败原因透传）。
4. 无需改小程序域名白名单——和风请求全部在云函数内发起。
5. 可选：`NOWCAST_PROVIDER=caiyun|qweather|auto` 强制数据源。


**和风凭据：公钥/私钥是怎么回事，以及由此更正的一处配置错误**

- 和风新版用 **Ed25519 非对称签名**：**私钥自己保管、用来签名；公钥上传到控制台、由和风用来验签**。
  控制台要你上传公钥，是因为它不需要（也不应该）拿到你的私钥——它只用公钥验证「这个 JWT 确实是你签的」。
  公钥可以公开，泄漏公钥没有风险；**私钥泄漏等于身份被冒用**。每个项目最多 20 个凭据。
- 生成方式（官方给的两条路）：`openssl genpkey -algorithm ED25519 -out ed25519-private.pem` +
  `openssl pkey -pubout -in ed25519-private.pem > ed25519-public.pem`；或浏览器控制台用 WebCrypto 生成。
  控制台粘贴**公钥 PEM 全文**；上传时和风会去掉首尾空白与换行后算 SHA256，控制台之后不再显示公钥，
  只能靠 SHA256 比对确认。
- JWT 规格（官方原文）：header `{alg:"EdDSA", kid:"凭据ID"}`；payload `{iss:开发者ID, sub:项目ID, iat:当前-30秒, exp}`；
  **三段必须 Base64URL（不是 Base64）**；**有效期最长 24 小时**；除上述字段外不得夹带其它信息（明文传输）。
- ⚠️ **上一版交接里让配 `QWEATHER_TOKEN=<签名后的 JWT>` 是不现实的**——JWT 最长 24 小时就过期，
  等于天天人工换 token。现已改为**云函数用私钥就地签名**（`createQWeatherJwt`/`qweatherJwt`，
  TTL 15 分钟、留 60 秒余量、内存缓存复用），一次配置长期有效。
- **端点没变，只换了 Host 与鉴权**：分钟级降水仍是 `GET /v7/minutely/5m?location=经度,纬度`
  （实测文档原文示例为 `'https://your-api-host/v7/minutely/5m?location=116.41%2C39.92'` +
  `Authorization: Bearer your_token'`）。注意和风新版的**天气类**接口已迁到
  `/weather/v1/current/{latitude}/{longitude}` 这种路径参数风格，但分钟级降水不在其中。
- 若不想管密钥对：在控制台把凭据类型选成 **API KEY**（`X-QW-Api-Key` 头或 `key=` 参数），
  代码里两种都已支持；`qweatherAuthHeaders()` 有 Authorization 时不会再挂 `key`，
  避免命中官方警告的「同时使用多种身份认证方式」。
- 新增测试 `tests/qweather-jwt.test.js`（**12 项**）：用本地生成的真 Ed25519 密钥对签名，
  **再用公钥验签**（不是「看起来像 JWT」，而是数学上成立）；并锁死 Base64URL、iat 前移 30 秒、
  iss/sub 不得写反、有效期 ≤ 24 小时、私钥字面量换行可还原、JWT 优先且不再挂 key、token 缓存复用。
  反向自检 **17/17**（退回普通 Base64 / 去掉 iat 前移 / 写反 iss 与 sub / 不还原换行，四类都被抓住）。
  端到端：配本地密钥对跑真实 handler → 走和风分支（自有 Host + Bearer 头）、12 个乡镇串行 1.8 秒、
  失败原因如实上屏（`getaddrinfo ENOTFOUND ...`）、`totalRain` 为 null 而非 0。


**JWT 落地操作清单（照抄即可，2026-09-23 与官方文档逐条对齐）**

官方原文出处：`/docs/configuration/project-and-key/`、`/docs/configuration/api-host/`、`/docs/configuration/authentication/`。

1. **生成 Ed25519 密钥对**（官方首选 Openssl，但注明「Windows 需提前安装 OpenSSL」）。
   本项目改用 Node 生成（免装 OpenSSL），输出在**小程序项目之外**的 `<本地密钥目录>`：
   `ed25519-private.pem`（保密）/ `ed25519-public.pem`（要上传）/ `env-values.txt`（可直接复制的环境变量值）。
2. **上传公钥**：控制台 → **项目管理** → 点进项目 → 凭据区域右侧「**添加凭据**」→ 输名称 →
   身份认证方式选「**JSON Web Token**」→ 公钥文本框粘**全部内容**（含 BEGIN/END 两行）→ 保存。
   成功后页面显示 **创建日期 / ID / SHA256**；**控制台此后不再显示公钥**，只能用 SHA256 与本地比对。
   官方示例公钥形如 `-----BEGIN PUBLIC KEY----- MCowBQYDK2VwAyEA… -----END PUBLIC KEY-----`（与本项目生成的一致）。
3. **抄下三个值**：`kid` = 凭据ID（项目管理里看）；`iss` = 开发者ID（**控制台-设置**，Q 开头 10 位）；
   `sub` = 项目ID（项目管理里看）；`QWEATHER_HOST` = **控制台-设置**里的 API Host（形如 `h2a9cf3mhs.xy.qweatherapi.com`）。
4. **配置云函数环境变量**（`QWEATHER_KID` / `QWEATHER_ISSUER` / `QWEATHER_PROJECT` / `QWEATHER_PRIVATE_KEY_B64` / `QWEATHER_HOST`）后重新部署。
5. **自查两个坑**：① 私钥用 `QWEATHER_PRIVATE_KEY_B64`（单行 base64）比 PEM 全文更不容易被换行搞坏；
   ② **API Host 不要带 `https://`** —— 代码已做规范化（`qweatherHost()` 去协议头、去尾斜杠、去空白，缺省回落公共地址），有测试锁定。

**官方文档里两处此前的说法需要更正**：
- 上一轮交接写的「控制台开通『分钟预报』」**在新版按量计费模型下找不到对应步骤**：文档「开始使用」只要求
  注册帐号 → 建项目和凭据 → 身份认证 → 取 API Host，计费是「按量计费 + 阶梯价，不用不付费」。
  首次调用若返回 403/404 再去找工单，不要预设需要「开通」。
- 官方明确：**从 2027-02-01 起逐步限制 API KEY 的每日请求量**，且 **SDK v5.x 及以上仅支持 JWT**。
  所以选 JWT 是对的方向（API KEY 只是过渡）。另有「保留字段」警告：JWT 里**不要**带 `typ`/`aud`/`nbf`
  （部分库会默认加 `typ:JWT`）——本项目手写签名，天然不带这三个字段，已在测试里锁死 payload 只允许 `iss/sub/iat/exp`。
  401 时可用控制台「JWT验证」工具自查（只能验自己帐号的 token），或用 `jwt.qweather.com` 在浏览器里生成对照。
**验证**：新增 `tests/qweather-minutely.test.js`（**26 项**，含单位守恒、概率不编、时间轴、串行限速、
密钥/URL 组装、前端接线、文案口径）；全量 **34/34 通过**；`check-ui` 绿；反向自检 **13/13**
（回滚单位换算 / 去掉串行间隔 / 概率改用强度反推 / 时间轴退回 10 分钟错轴，四类回退都被抓住，且每次恢复后逐字节一致）。
本地跑真实 handler：`provider=qweather` 在未配密钥时如实返回
`success=false` + `failedReason=未配置和风天气密钥（QWEATHER_KEY / QWEATHER_TOKEN）`；
`auto` 在无密钥时回落彩云且 `note` 正确标注来源。预览图 `.ekko-tmp/preview/qweather-nowcast.html`。


### 天气诚实性修复：分钟级兜底 + 短临失败原因透传（2026-09-23）

**起因（线上实测）**：彩云免费档的 `/weather` 响应里**没有 `minutely` 对象**（`minute.precipitation` 为 `[]`，
`summary` 正好命中源码兜底串「未来2小时无降水」），直连 `/minutely` 的 12 个乡镇也**全部失败**
（部署前的旧版本返回的是「12 乡镇、概率全 0、强度全 0」——旧代码把「没取到」当成了「无降雨」）。
于是页面上出现了一句没有任何数据支撑的「无降水」，属于典型的假阴性。

**修复①：取不到就说取不到**

- 云函数新增 `buildMinuteBlock(minutely)`：只有真的拿到 `precipitation_2h` 序列才 `available: true`；
  否则 `summary: '分钟级数据暂不可用'`，`precipitation: []`。**「无降水」不再是任何分支的兜底文案。**
- 和风分支同样补 `available: false`。
- 前端 `processWeatherDisplay` 归一化三态：缺 `minute` 字段 / `available` 为假 / `available` 为真但序列为空，
  一律 `available: false` + 「分钟级数据暂不可用」；`drawRainChart` 容忍 `minute` 缺失。
- 模板：`rain-summary`、图表、图例都改为 `wx:if="{{weather.minute.available}}"`；否则显示 `.minute-empty` 占位
  （「本次没有取到分钟级降水数据，无法判断未来 2 小时有没有雨」）。页面默认值不再预置「未来2小时无降水，天气晴好」。

**修复②：失败原因必须能上屏**

- 云函数：`summarizeTownship` 每个乡镇带 `error`（上游原始原因 / 「返回数据里没有分钟级降水字段」）；
  `aggregateNowcast` 汇总 `failedReason`（人话版）+ `failedReasons`（去重原始原因，最多 3 条）；
  `buildNowcastFromCaiyun` 对每个失败乡镇写 `console.error('[nowcast] <乡镇> 取数失败 :: <原因>')`。
- `summarizeFailReason` 可分辨：**上游接口限流 / 超时或连接中断 / 无权限（接口不在套餐内）/ 其他**。
- 前端：`loadNowcast` 失败时把云函数的 `failedReason` 带给界面（不再只说「短临预报数据获取失败」）；
  部分失败时新增 `failedReasonText` 行（放在 `integrityText` 之前，避免影响既有断言）。

**验证**：新增 `tests/weather-honesty.test.js`（18 项，用 `global.Page` 桩直接调用页面方法做行为断言，不只是源码匹配）；
全量 **33/33 通过**；`check-ui` 绿；反向自检 **3/3**（回滚兜底串 / 回滚前端默认值 / 移除 `failedReason` 都能被抓住）。

### 分钟级降水替代数据源调研（2026-09-23）

**结论：和风天气「分钟级降水」是当前性价比最高的方案——免费额度内现金成本为 0，且粒度/分辨率都不比彩云差。**

| 方案 | 粒度 | 空间分辨率 | 时效 | 费用 | 备注 |
| --- | --- | --- | --- | --- | --- |
| **和风 分钟级降水**（`GET /v7/minutely/5m`） | **5 分钟** | **1 km** | 2 小时 | **0–50,000 次/月 = CNY 0**，超出 0.0007 元/次 | 中国境内；返回 24 条 `precip`(mm) + 中文 `summary` |
| 彩云（现用） | 1 分钟 | 2 km | 2 小时 | 免费档限流严重（实测 12/12 失败）；付费贵 | 已完成但不可用 |
| Open-Meteo `minutely_15` | 15 分钟 | 模式格点 | 2 小时 | 0 元（非商用，1 万次/日） | **境内是逐小时插值，没有额外信息** |
| 自建雷达外推（RainViewer 免费帧） | 10 分钟 | 1.1 km | 30–60 分钟 | 0 元 | 真实回波，但只能给「回波档」，给不了毫米数 |

**关键证据**

- 和风定价页（浏览器实读表格）：「天气和基础服务」含**天气预报 / 分钟预报 / 预警 / 天气指数 / 空气质量 /
  时光机 / GeoAPI / 天文 / 控制台API」，阶梯价 **0–50000 次/月 = CNY 0**，之后 0.0007 元/次。
- 和风文档：「分钟级降水 API（临近预报）支持中国 **1 公里**精度的未来 2 小时**每 5 分钟**降雨预报数据」；
  返回 `summary`（如「95分钟后雨就停了」）+ `minutely[]`（`fxTime` / `precip` / `type`，24 条）。
- Open-Meteo 文档原文：`ICON-D2 and Météo-France AROME model for Central Europe. If 15-minutely data is
  requested for other regions data is interpolated from 1-hourly to 15-minutely.`；实测 `models=icon_d2`
  对中方县直接 HTTP 400 ⇒ **中方县的 `minutely_15` 是插值出来的，不含新信息**。
- RainViewer 免费档只有过去帧（`weather-maps.json` 的 `radar.nowcast` 为空数组），免费没有预报帧。

**配额测算（12 个乡镇）**：每次打开天气页 = 12 次请求；免费 5 万次/月 ⇒ 不缓存也够约 4,166 次打开/月；
再加 5 分钟服务端缓存（和风本身就是 5 分钟更新）后，月请求通常在 1 万上下，**稳在免费额度内**。超了也就 1 万次 7 元。

**已知坑（实施前必须处理）**

1. **鉴权换代**：和风新账号走 JWT（`Authorization: Bearer <token>` + 自有 API Host），文档示例已无 `?key=`；
   云函数里现存的 `QWEATHER_KEY` 属哪一代需确认。若为新号，需实现 Ed25519 JWT 签名（Node `crypto` 可做）。
2. **QPM 限速**：和风有「每分钟请求数」限制（429 即超限）。12 个乡镇**必须串行 + 间隔**发送，
   不能像彩云那样 `Promise.all` 并发 12 个（那正是现在 12/12 全挂的原因）。并加指数退避（和风文档明确建议）。
3. **没有降雨概率**：和风不返回概率 ⇒ 短临的「降雨概率」列要么去掉，要么换成强度档（口径：只显示有的）。
4. **注明来源**：和风要求注明来源，页面「数据来源」需改为和风天气。
5. **控制台开通**：需在和风控制台确认「分钟预报」已启用。

**若不做数据源切换**：可选零成本增强——用 RainViewer 免费过去帧**自建回波外推**（相邻帧互相关求位移矢量，
外推 10/20/30/60 分钟），得到逐乡镇「未来有无回波 / 落区 / 强度档」。项目已有 PNG 解码 + 乡镇掩膜 + 回波统计
（`lib/radarTruth.js`）与基线脚本（`scripts/radar-baseline.js`），只需再加外推算法。它给不了毫米数，但提供
**观测基础**的 0–60 分钟信息，与和风的 1–2 小时模式预报互补。


### 天气数据准确性交叉核对（2026-09-22）

用**独立数据源**核对页面上的彩云数据：Open-Meteo 多模式（ECMWF / GFS / ICON / 最佳匹配）+
RainViewer 雷达回波，与线上云函数的彩云输出逐项对比（同点位 27.5092,110.1152，同时刻）。

**结论：湿度、风向量级、当前有无降水三项一致；气温系统偏高约 2~3℃；另发现 1 个确定的显示错误（已修）。**

| 项目 | 彩云（页面显示） | 独立模式 | 判断 |
| --- | --- | --- | --- |
| 湿度 | 96% | 94 / 93 / 96 / 96 % | 一致 |
| 体感 | 22℃ | 21 / 20.5 / 22.4 / 21.6 ℃ | 一致 |
| 风速 | 反推 1.48 m/s | 2.11 / 1.40 / 0.95 / 1.58 m/s | 同量级，一致 |
| 气温 | 21℃ | 19.2 / 18.6 / 19.5 / 19.2 ℃ | **彩云偏高 1.8~2.4℃** |
| 现象 | 多云 | 阴 / 阴 / 雾 / 阴（云量 98~100%） | 边界情况，可议 |
| 当前有无降水 | 未来 2 小时无降水 | 雷达最新帧全县回波像素 0 | **双源一致** |

**已修的确定错误：风速风级（`windSpeed`）**

- 界面标注「N级」（`{{weather.current.windSpeed}}级`），但彩云分支算的是
  `Math.round(realtime.wind.speed * 3.6 / 1.6)`——既不是 km/h 也不是 m/s；
  同字段的和风分支用的是 `now.windScale`（本来就是风级），**两条链路语义不一致**。
- 实测：彩云原始值 ≈5.3（km/h）→ 反推 1.48 m/s，与独立模式 0.95~2.11 m/s 吻合，
  说明彩云单位是 km/h；**正确风级是 1 级，页面却显示「12级」（台风级）**。
- 修复：新增 `beaufortFromKmh()`（GB/T 28591-2012 级距），`windSpeed` 输出真实风级，
  另保留 `windSpeedKmh` / `windSpeedMs` 便于核对。新增 `tests/weather-value-sanity.test.js`（6 项）。

**彩云与独立模式的分歧（无法判定谁对，缺雨量站）**

- 未来 3 天：彩云 9/23「中雨 60%」、9/24「晴/中雨 33/22℃」；独立模式 9/23 基本无雨（0~0.7mm，6~49%）、
  9/24 29.3~30.7 / 19.3~19.9℃。彩云偏湿、偏高。
- 逐小时：方向一致（上午 06~11 时有雨），量级分歧大（彩云 09:00 0.99mm，最佳匹配 9.9mm）。
- 日最高/最低：彩云系统性高 2~3℃。实况来自观测融合、模式是格点值，山区夜间有差异属正常，
  但**系统性偏差值得记一笔**，等有地面实测才能定论。

**发现但尚未改的口径问题（待确认）**

1. 逐小时那一列显示彩云天空现象图标（如 🌧️「中雨」），而雨量 0.99mm/h 按强度参考档渲染成浅色柱——
   图标与柱高打架。建议有雨时图标也按 mm/h 分档。
2. 今天（9/22）那一行：标签「小雨」而降水概率显示 0%，是彩云自身的矛盾；且当天的日概率意义有限。
3. `pressure` 恒为 `null`（彩云免费档 realtime 无 `pres`，`Math.round(undefined)` → NaN → JSON 变 null），
   Open-Meteo 有 1017~1018hPa 可补，但属跨源混用，需先定口径。

**部署提醒**：`getWeather` 重新部署后，一次带上三件事——短临诚实语义、上游配额保护（缓存/退避/回落）、风速风级修复。


### 天气取数失败根因定位 + 上游配额保护（2026-09-22）

**现象**：天气页与首页天气条显示「暂未获取到天气数据」，点击刷新无效。

**根因（已复现，非代码 bug）**：彩云天气接口返回 **HTTP 429 Rate limit exceeded**。
云函数把它包成 500 后返回 `{"success":false,"message":"天气数据获取失败","error":"HTTPS 429: …"}`；
前端 `api.getWeather` 只取 `res.data.data`，拿不到就返回 null，页面于是只剩一句「暂未获取到天气数据」。

复现证据（curl 直连线上云函数 zf-getweather-…）：

| 入参 | 结果 |
| --- | --- |
| 县中心坐标（命中已有结果） | 200，数据完整 |
| 中方镇 / 蒿吉坪 / 坐标全 0 / 缺 provider | 500，`Rate limit exceeded` |

即：**换一个坐标就是一次新的彩云调用，立刻被限流**。天气页打开一次 = 1 次 `/weather` +
**12 次乡镇短临 minutely**（`fetchCaiyunMinutely` 每乡镇一次），是配额消耗的主要来源。

**修复**

1. 云函数 `getWeather`（**需重新部署**）：
   - `weatherCache`：成功结果按坐标缓存 `WEATHER_CACHE_TTL = 5 分钟`（彩云自身粒度约 5 分钟）；
   - `upstreamBlockUntil` + `UPSTREAM_BACKOFF_MS = 90 秒`：限流时退避，不重复打上游；
   - 回落：退避期间若手上有 `WEATHER_STALE_MAX = 40 分钟` 内的成功结果，就回落并标记 `stale: true` +
     `staleMinutes`，由界面上的更新时间体现新旧（**不伪造时间**）；超过 40 分钟不回落——
     逐小时预报会错位，按本项目口径「宁可不显示，也不显示错值」；
   - 限流如实返回 **429**（含 `message` 与 `retryAfterSec`），不再一律包成 500。
2. 前端可辨性：
   - `utils/api.js → describeError(err)`：把失败翻译成人话——域名未配置 / 上游限流 / 超时 /
     接口报错（带状态码）/ 返回格式异常；
   - `httpGet` 非 200 时带上云函数的 `message`/`error`，否则只剩状态码看不出原因；
   - 天气页、首页天气条、乡镇短临三处失败提示都带上原因；图层的失败文案补上「合法域名配置」。
3. 顺带修掉一个 patch 引入的转义破坏：`describeError` 里 `/HTTP错误:\s*(\d+)/` 被写成
   `/HTTP错误:s*(d+)/`（**patch 脚本的模板字面量会吃掉反斜杠**）。
   已全项目扫描 78 个文件，同类破坏仅此 2 处，均已修正；新测试加断言锁死。

**测试**：新增 `tests/weather-fetch-diagnostic.test.js`（12 项：原因翻译、页面是否上屏、
失败不得暗示无雨、云函数配额保护与回落期限、域名清单）。全量 **31/31 通过**，`check-ui` 通过，
反向自检 1/1（回滚后测试失败、恢复后逐字节一致）。

**需要你做的两件事**

1. **重新部署 `getWeather` 云函数**（本轮加固才生效）；
2. 核对 **request 合法域名**：`zf-getstation-skkqwvcjke`、`zf-getsnhistory-nnvbkviycj`、
   三个云函数触发器地址（见 utils/config.js）、`api.rainviewer.com`、`api.open-meteo.com`；
   **downloadFile 合法域名**：`tilecache.rainviewer.com`。项目里 `urlCheck: true`（正在校验域名），
   开发工具本地测试可临时勾选「不校验合法域名」，但**真机预览/正式版必须配置白名单**。

**同轮并行进展（雷达事后对照，进行中）**：`lib/radarTruth.js`（自研 PNG 解码 + Web Mercator +
面内掩膜；全县恰好 1 张 z=7 瓦片；真实数据验证：面内像素 1246 vs 理论 1247）、
`lib/radarTownships.js`（12 乡镇掩膜抽稀到 466 点，最大面积偏差 3.56%）、
云函数 `mode=radar-verify`、`scripts/radar-baseline.js`（外推能力上界参照）、
`utils/nowcastLedger.js`（短临存档 + 雷达事后对照，纯计算）。**尚未接前端，未接完。**

### 乡镇短临预报可信性加固（2026-09-22）

**起因**：用户问「怎么保障我可以获得准确的短临预报」。结论：预报准确率是数据源的物理能力，无法承诺；
能保障的是「新鲜 / 可辨 / 可量」——本次先把「可辨」（失败绝不冒充无雨）做扎实。

**修复的 4 个「不可信」问题**（均在 `cloudfunctions/getWeather/index.js`）：

| # | 问题 | 后果 | 修复 |
| --- | --- | --- | --- |
| 1 | 12 个乡镇取数失败时各帧 intensity 全为 0，返回体仍 `success:true`、`source:'caiyun'` | 彩云故障时界面显示「全县未来2小时无明显降水」——**假阴性**，值班人员看到的是「没事」 | `success: okCount > 0`；每个乡镇带 `ok`；失败乡镇的 `totalRain / peakProb / peakMinute / willRain` 一律 `null`、`frames: []`；新增 `okCount / failedCount / townshipCount / degraded` |
| 2 | `nowcastCache` 无条件写入 | 失败批次在窗口内被反复复用 | `shouldCacheNowcast(okCount, total)`：正常乡镇过半（>50%）才写缓存 |
| 3 | 「X分钟后开始降雨」由 `probability[floor(minute/30)]` 决定 | 概率只有 30 分钟一档 → 起始时刻实际只能落到 0/30/60…；而 `precipitation_2h` 本身是 1 分钟分辨率的强度序列 | 新增 `findStartMinute` 用 1 分钟强度跨 `NOWCAST_RAIN_THRESHOLD = 0.1 mm/h` 判定；`findPeakMinute` 同理取最强分钟 |
| 4 | `issueTime: formatDate(t0)`（6 分钟窗口对齐时刻） | 界面读作「发布时间」，最多乐观 6 分钟 | `issueTime` 改为实际取数完成时刻，窗口对齐时刻另存 `windowTime` |

（另：和风 fallback 只取 now/24h/7d，**不覆盖短临** → 彩云是单一来源、零兜底，这正是问题 1 的成因。）

**前端三态**（`pages/rainfall/rainfall.{js,wxml,wxss}`）：
- 新增第 3 态「数据缺失」：`dataMissing` 分支 + 灰色徽标；数值块整体不渲染，改为虚线框「本次未取到该乡镇的短临数据，未计入任何统计」
- **失败乡镇不再输出 0.0mm**（`totalRainText: okTown ? … : ''`）
- 卡片顶部完整性提示：`12 个乡镇数据正常`（青）／`12 个乡镇中 3 个取数失败，缺失乡镇已标注为数据缺失`（琥珀）
- 标题时间改为「更新于 HH:mm」（同日；跨天补月日）
- `success === false` 或空列表 → 抛错进错误态，**绝不降级展示成「全县无降雨」**
- 下拉刷新区分「部分乡镇数据缺失」
- `utils/rainImpact.js`：雨中心排除 `ok === false` 的乡镇（`totalRain` 为 null 不被当作 0mm 或候选雨中心）

**验证**：
- 测试 **30/30**（新增 `tests/nowcast-integrity.test.js`，18 项）
- `check-ui.js` 9 闸门通过
- 反向自检 **4/4** 被抓到：把 `success` 写死 true、起始时刻退回 30 分钟档、前端无条件写 0.0mm、删除「数据缺失」态；还原后字节一致
- 浏览器数值测量（375px）：panel③ 12 项中 3 项缺失、**失败项带数值块的数量 = 0**；三色徽标可区分（缺失 `rgb(125,139,150)`／暂无降雨 `rgb(84,142,37)`／有雨 `rgb(14,106,128)`）；完整性提示 正常 `rgb(244,250,253)` → 降级 `rgb(255,248,232)`；面板②起始时刻为 7/12/18/25/33/40/47/55/65/80 分钟（旧实现只会是 0/30/60…）；四张面板均无横向溢出
- 视觉验收图：`.ekko-tmp/preview/nowcast-states.png`

⚠️ **本次必须重新部署 `getWeather` 云函数**（与气象图层那几轮「只重传前端」不同）。

**仍未解决（准确性本身）**：短临的「准不准」需要实测对账（预测 vs 实况的误差闭环）与雷达回波 / 双源对照；
彩云 realtime 不提供历史降水，因此需要另接一个历史降水源或自行按日累积日志。详见下方「待办」。

### 青黛质感升级（2026-08-16，v3）

- 改造前完整备份：`<本地备份目录>`（87 个文件，app.json SHA-256 `AFCC094B55CFA4BFE33180115E8D5D7277BF6B0019D3FEEAFCF4830010DA2AF0`）。
- 按用户确认方向实施：**线性线条图标 + 青黛色系**。纯视觉改造，不触碰任何 JS、云函数、数据字段、地图与 Canvas 逻辑。
- 青黛设计系统 v3 token：品牌深青黛 `#0e4d64`、过渡蓝 `#0b4f8a`（渐变中段）、强调青 `#0e9bb8`、墨青文本 `#123a4a`、雾白青背景 `#f4f8fc`、青黛调阴影 `rgba(14,77,100,…)`；数值一律 `font-variant-numeric:tabular-nums` 等宽对齐。
- 图标体系：`assets/icons.wxss`（由 `scripts/gen-icons.js` 生成，11 个线性 SVG 图标 × 白/青黛/强调/灰 4 色变体，base64 内联，零网络依赖）。自定义 TabBar 与全部页面 emoji（🏠🗺️📋🌤️💧🌊🌱🔍📭📍⌖）已替换为线性图标；仅 `rainfall.js` 内天气语义 emoji 保留（数据驱动，属天气符号惯例）。
- 全局：`app.json` 导航栏由亮蓝 `#1677ff` 改为雾白青 `#f4f8fc` + 深色文字；`app.wxss` 重写为青黛 token 体系。
- 质感细节：首页 hero 新增水波纹 SVG 纹理与呼吸点动画、地图门户双层水形装饰、卡片按压态（scale+阴影）、列表行按压反馈、毛玻璃 TabBar、土壤分层条渐变填充。
- 测试基线同步：`tests/home-neutral-workbench.test.js` 中主色断言由 `#1677ff` 更新为 `#0e4d64`、渐变断言更新为 `linear-gradient(150deg,#0e4d64 0%,#0b4f8a`；`tests/ui-redesign.test.js` 及全部 21 项测试通过。
- 生成脚本保留在 `scripts/`：`gen-icons.js`（图标集）、`gen-waves.js`（水波纹），改动图标后重新运行即可。

### 2026-08-14 中性工作台重设计基线

- 当前版本已在重设计前完整备份：
  - 可恢复目录：`<本地备份目录>`
  - 压缩归档：`<本地备份目录>.zip`
  - 备份共86个文件，`app.json` 与源版本 SHA-256 一致：`AFCC094B55CFA4BFE33180115E8D5D7277BF6B0019D3FEEAFCF4830010DA2AF0`。
- 已检索 GitHub 微信小程序 UI/UX Skill：`Billzhouheart/wechat-miniprogram-designUI`、`go-goll/wechat-miniprogram-ui-ux`、`bc1pjerry/build-wechat-miniprogram`。未引入其代码；仅采纳微信小程序可读性、触控尺寸、信息层级和统一设计 token 原则。
- 在不改动页面 JS、云函数、数据字段、定位策略、地图配置、Canvas 逻辑及既有交互的前提下，重构五个页面的 WXSS：`index`、`map`、`list`、`detail`、`rainfall`。
- 统一设计系统：雾白蓝背景 `#f4f8fc`、深水蓝主品牌色 `#0b4f8a`、亮蓝交互色 `#1677ff`、28rpx 圆角卡片、浅蓝边框与低对比水系阴影；水库/河道/墒情绿蓝仅作为数据类型辅助色。
- 首页保留中性数据入口而不恢复预警结论；地图仍保持无设备定位、无指南针、禁旋转及乡镇边界；详情页保持真实水位/流量/墒情趋势；气象页仍明确“短临降水预报云图演变示意”的数据语义。
- 新增 `tests/ui-redesign.test.js` 约束五页面统一视觉 token 以及各页关键功能容器保留。



- 已核验原始网站实际接口：`POST 上游河道过程接口（地址见云函数代码）`；请求体字段必须为小写 `stcd`、`stm`、`etm`。花桥站 `61310900` 在 `2026-08-12 15:55` 至 `2026-08-13 15:55` 范围内实际返回30条记录，包含 `TM`、水位 `Z`、流量 `Q`、警戒水位 `GRZ`。
- `cloudfunctions/getStationHistory/index.js` 已增加 `type=river` 分支，代理真实 `river/process` 接口并向前端标准化输出 `waterLevel`、`flow`、`warningLevel`、`timestamp`；没有把河道站错误转发给水库过程接口。
- `utils/api.js` 已移除“河道历史数据暂无真实接口”的固定空数组逻辑，改为请求历史云函数的 `type=river`。
- 河道详情页已由“暂未接入”空态改为“河道水文过程”：以双纵轴绘制水位（左轴，蓝）、流量（右轴，黑）和警戒水位参考线（左轴，红色虚线），支持7/15/30天范围；无上游记录时才显示对应时间范围暂无记录。
- 新增 `tests/river-history.test.js` 与 `tests/river-history.integration.js`。本地云函数对真实花桥站已验证返回30条过程数据，样例为 `waterLevel: 2.01`、`flow: 1.25`、`warningLevel: 5.63`。
- 河道过程图会根据本次真实时序记录动态决定是否存在流量：仅当至少一条记录返回 `Q` 时，才显示流量图例、右侧流量轴和黑色流量曲线；否则明确提示“未返回流量数据”，只展示水位及警戒水位参考线。
- 为避免高频过程记录的圆点遮挡曲线，河道图最多在12条记录时展示全部标点；超过12条时仅保留首尾点与局部极值点，曲线始终完整绘制。



- 已检查线上77个站点的名称与地址文本，发现并定位1条上游地址异常：河道站 `613H0938`（龙溪）在线返回“怀化市中方县接龙镇��溪村部”，而直接核验上游 `STLC` 原始 UTF-8 响应为“怀化市中方县接龙镇龙溪村部”。
- `getStations` 云函数现按经核验站号维护最小化地址纠错映射，输出前修正该站为“怀化市中方县接龙镇龙溪村部”；不对其他乱码字符做猜测性批量替换，避免误改未核验地名。新增 `tests/station-address.test.js` 覆盖该纠错和正常地址不受影响的情形。
- **该修复需要重新部署 `cloudfunctions/getStations/index.js` 后才会反映到线上站点列表、地图、首页和详情页。**

- 卡片边框、阴影、标题与正文色阶同步气象页，地图入口改为与主蓝色一致的渐变，河道/土壤仅保留为数据类型的辅助色而非首页主色。

- 首页改为中性的“数据入口”界面，仅展示真实可追溯的查看区域、天气摘要、总站点数量、最近一条数据更新时间、地图入口和最多3条最近更新数据。站点状态颜色也不在首页显示。
- 首页的唯一核心操作为“查看地图”，具体点位数据、状态、边界和进一步核查均在地图监测及站点详情中完成；天气云图仍可由顶部天气摘要进入。
- 视觉语言改为中性水青色工作台：大留白、低干扰层级、简短天气条和单一地图门户，避免红黄风险色与“预警”暗示。
- 新增 `tests/home-neutral-workbench.test.js`，禁止首页重新引入预警、风险、重点关注和相关数量字段，同时校验中性数据概览、地图入口和3条最新数据仍然存在。



- 已核验重新部署的线上 `getWeather`：返回12个乡镇，中方镇采样点为 `109.956492,27.384400`，蒿吉坪瑶族乡代码为 `431221214`，不再返回旧代码 `431221200`。
- 首页和气象云图页不再展示默认“28℃、多云”等演示值：新增 `loading / success / error` 数据状态。天气请求失败时显示“暂未获取到天气数据”及刷新入口，避免默认内容被误判为实时业务数据。
- 气象云图页的全局 Loading 仅由 `loadAllData()` 管理；`loadWeather()`、`loadNowcast()` 仅返回加载结果并分别更新状态，避免重复显示/隐藏造成闪烁或提前消失。
- 河道详情新增“暂未接入该河道站历史监测数据”空态；站点无经纬度时详情页明确显示“暂未获取站点坐标”，不拼接空坐标。
- 前端 `utils/config.js` 已清除 `CAIYUN_TOKEN` 占位项；天气 Token、App Key、App Secret 只能在云函数环境变量中保存。
- 地图加入 `MAX_MAP_MARKERS = 200` 防护：按筛选结果先过滤无效坐标，最多绘制200个 Marker；当超出上限时显示实际展示和未显示数量。当前73个站点不受影响；未来扩展到大量雨量站、视频站、泵站时，应以“按地图视野请求 + 点聚合”替换该临时上限策略。
- 新增 `tests/reliability-and-scale.test.js`，覆盖天气状态、Loading 职责、错误重试、河道历史空态、坐标空态、前端密钥清理和 Marker 上限约束。



- `cloudfunctions/getWeather/index.js`：乡镇短临预报采样点已统一为 `utils/townshipBoundaries.js` 的12个聚合边界面内中心；乡镇代码依据国家统计局2024目录同步修正（蒿吉坪瑶族乡为 `431221214`）。**需重新部署 `getWeather` 云函数后才会在线生效。**
- `cloudfunctions/getStations/index.js`：上游缺少经纬度时统一返回 `null`，不再伪造中方县中心坐标；地图页通过 `hasValidCoordinates` 仅渲染经纬度合法的站点，防止无坐标站点集中叠落县中心。**需重新部署 `getStations` 云函数后才会在线生效。**
- `pages/index/index.js`：水库、河道预警文案会根据真实水位/警戒水位字段降级生成，不再出现 `NaN m`；“最新数据”已从全量水库、河道、土壤站统一按更新时间排序后显示前5条，避免先截取每类返回前几条而遗漏真正最新记录。
- 全县默认查看中心已统一使用天地图县级边界计算中心：`27.509196, 110.115186`，同步到 `app.js`、`utils/config.js`、首页、地图页、气象云图页。
- 新增 `tests/data-integrity-and-home.test.js`，覆盖乡镇天气采样点、代码、伪坐标禁用、地图过滤、预警文案和全量排序约束。



- 原始数据：`E:\ZhongFlow-geodata\village-boundaries-hunan.zip`，来自 `thedavidweng/china-village-boundaries` 的 `v2026.06` 湖南村界包；下载文件 SHA-256：`E6E77F92BEA483DB608ACBA241E0D484EEBED460348BBEEFB50E9D889C010D99`。
- 原始数据声明为 WGS84（EPSG:4326），湖南数据表中筛出中方县（`431221`）134条村级面记录；其中13个历史乡镇名称含黄岩乡。按 `adyliu/china_area` 的国家统计局2024区划目录核验后，当前项目仅采用12个现行乡镇的132条村级面，排除黄岩乡。
- 按乡镇代码/名称融合村级边界、简化为 4,223 个地图顶点，生成 `utils/townshipBoundaries.js`（约333KB）。该文件保留乡镇代码、面内显示中心、范围和边界点；原始700MB级文件不纳入小程序包。
- 天地图 WFS 县级边界：`https://gisserver.tianditu.gov.cn/TDTService/wfs` 的 `TDTService:BOUA`，查询 `NAME='中方县'` 返回 `PAC=431221`、EPSG:4326 多边形；12个乡镇聚合边界面积约1463.67平方公里，对应县级边界约1519.37平方公里（约96.33%），说明村界源存在约3.67%的未覆盖/历史差异，不能标注为官方行政界线。
- `utils/locationOptions.js` 已由生成的边界中心替换人工估算坐标；全县查看中心使用天地图县级边界几何中心。该机制仍仅表示“手动查看区域”，不申请也不调用设备定位。
- `pages/map/map.js` / `map.wxml` 使用原生 `<map polygons>` 绘制12条乡镇分界线；选择乡镇时将对应面高亮。地图仍保持 `show-location="{{false}}"`，不得恢复 `wx.getLocation`、`wx.chooseLocation` 或原生实时定位。
- 数据来源与限制：村界仓库明确说明原始出处、数据年份和版权授权不完全确定；本项目仅将结果用于地图浏览与站点分区辅助，**不作为行政区划确认、测绘成果、执法或法律依据**。取得中方县自然资源部门/天地图中方县节点授权边界后应替换该资源。



```text
ZhongFlow/
├─ app.js                         # 全局状态：位置、天气、站点缓存
├─ app.json                       # 页面、窗口、4 项自定义 TabBar、定位权限
├─ app.wxss                       # 全局样式
├─ project.config.json            # 小程序工程配置/AppID
├─ project.private.config.json    # 本机微信开发者工具配置
├─ custom-tab-bar/                # 自定义底部导航（表情符号图标）
├─ pages/
│  ├─ index/                      # 首页：概览、预警、最新数据、天气入口
│  ├─ map/                        # 地图：类型化水利点位图标、筛选、站点面板
│  ├─ list/                       # 分类列表与站点搜索
│  ├─ detail/                     # 站点详情与 Canvas 趋势图
│  └─ rainfall/                   # 天气、分钟级降水、乡镇短临预报
├─ utils/
│  ├─ config.js                   # API 地址、行政区划、天气服务商、Mock 开关与缓存 TTL
│  ├─ api.js                      # 所有前端接口封装、站点缓存、数据聚合与容错
│  ├─ mapMarker.js                 # 地图站点类型、状态与标记视觉配置
│  ├─ soilDisplay.js               # 土壤分层墒情与旱情指标的自适应展示模型
│  ├─ soilHistory.js               # 土壤多指标时序字段标准化
│  ├─ soilTrend.js                 # 土壤趋势可选指标与颜色配置
│  ├─ weatherVisual.js             # 短临降水帧与风场可视化数据模型
│  ├─ stationCache.js              # 通用 TTL 内存缓存与并发请求合并
│  ├─ mockData.js                  # 本地演示数据
│  └─ util.js                     # 日期、状态、Toast、Loading 等公共方法
└─ cloudfunctions/
   ├─ getStations/index.js        # 站点列表/详情阿里云函数
   ├─ getStationHistory/index.js  # 水库/土壤历史阿里云函数
   ├─ getWeather/index.js         # 天气与乡镇短临预报阿里云函数
   └─ README.md                    # 正式云函数职责、部署与发布前检查
```
