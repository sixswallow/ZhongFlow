# ZhongFlow（中方县水利监测）

> 原生微信小程序：面向中方县水利监测场景，提供水库 / 河道 / 土壤墒情站点的概览、列表、地图与详情，以及定位天气、分钟级降水、逐小时/逐日预报和 12 乡镇短临降水摘要。
>
> 功能与修复的历史沿革见 [CHANGELOG.md](CHANGELOG.md)。本文描述当前状态，最后更新：2026-11-25。

## 1. 技术与工程

| 项目项 | 当前情况 |
| --- | --- |
| 前端 | 原生微信小程序（JavaScript、WXML、WXSS、JSON），无 npm 构建 |
| 基础库 | `project.config.json` 为 2.30.0；`project.private.config.json` 本地设置为 3.17.0 |
| 后端 | 前端通过 HTTPS 调用 3 个阿里云函数公网地址；`cloudfunctions/` 保存 Node.js 函数源码（仅用内置 `http` / `https` / `crypto`） |
| 图表 | 详情页 4 张图与雨量柱状图全部为 `<canvas type="2d">`，统一经 `utils/canvas2d.js` 取上下文（SelectorQuery 取节点 + 按 `pixelRatio` 缩放） |
| 测试 | `tests/` 下 51 个测试文件（源码级断言 + 行为级回归），`node scripts/run-tests.js` 一键运行 |
| 版本管理 | Git（`main` 分支；2026-11-23 起有完整提交历史） |
| AppID | `wx1d9796dcca21c7e8` |

常用命令：

```bash
node scripts/run-tests.js       # 全量回归测试（应保持全绿）
node scripts/check-deployed.js  # 核对线上三个云函数的可用性与返回结构
```

### 推荐打开方式

使用微信开发者工具导入项目根目录，再确认项目 AppID、合法域名、位置权限和阿里云函数部署配置均与线上环境一致。

## 2. 页面与用户路径

### 底部导航

1. **首页**：`pages/index/index`
2. **地图监测**：`pages/map/map`
3. **站点列表**：`pages/list/list`
4. **气象云图**：`pages/rainfall/rainfall`

站点详情 `pages/detail/detail` 不属于底部导航页面，通过 `wx.navigateTo` 打开。

### 主要交互

| 页面 | 主要逻辑 |
| --- | --- |
| 首页 | 经 `getStationGroups()` 并发加载三类站点（失败时有横幅 + 重试，与「暂无数据」区分）、天气、最新站点；可选位置、跳转地图/列表/降水/详情 |
| 地图 | 调取全部站点，按水库/河道/墒情筛选，点击 Marker 进入站点信息面板和详情；坐标经 WGS-84 → GCJ-02 校正 |
| 列表 | 预先并发读取三类站点，本地按名称与地址模糊筛选，点击进入详情 |
| 详情 | 按 `id` 查找站点；水库站按数据可用性画水位趋势或水位+入/出库双轴过程图，河道站画水位+流量双轴过程线（含警戒水位参考线），土壤站提供「整体 / 分层（10/20/40cm）」两个趋势视角；全部图表为 Canvas 2d |
| 气象云图 | 读取常规天气和乡镇短临预报；将 12 乡镇、21 帧短临降水数据绘制为可播放云图演变，并叠加当前风向/风速；同时保留分钟降水（雨量柱状图）、逐小时与逐日预报 |

## 3. 前端接口与数据流

### API 配置：`utils/config.js`

```js
ALIYUN_FUNCTION_STATIONS_URL: '（云函数触发器地址，部署后填入）'
ALIYUN_FUNCTION_HISTORY_URL:  '（同上）'
ALIYUN_FUNCTION_WEATHER_URL:  '（同上）'
ADCD: '431221'
API_TOKEN: '（与三个云函数环境变量 API_TOKEN 同值，改值必须两端同步）'
WEATHER_PROVIDER: 'qweather'         // 单一数据源：常规天气与短临都走和风
```

> 前端不保存任何天气密钥；和风凭据只部署在云函数环境变量中。

### `utils/api.js` 关键约定

- `httpGet()` 兼容普通 JSON、字符串 JSON、以及阿里云常见 `{ statusCode, headers, body }` 包装；所有请求统一携带 `token` 参数（云函数侧校验）。
- **失败可见性**：默认失败返回 `[]` / `null`（兼容既有调用）；传 `{ throwOnError: true }` 时向上抛错。页面侧用 `getStationGroups()` 取回 `{reservoirs, rivers, soils, failed, failedTypes, error}`，据此区分「请求失败」与「真的没有数据」并渲染失败态。
- `getStations(type, keyword, { forceRefresh })` 在 API 层按站点类型和关键词使用 5 分钟内存 TTL 缓存（`utils/stationCache.js`）；同一键的并发请求会合并为一次网络请求。下拉刷新传 `forceRefresh: true` 强制回源。
- `getStationDetail(id)` 复用三类站点 TTL 缓存聚合查询后按 ID 查找，缓存未命中时强制回源再找一次；不调用后端单站详情接口。
- 历史时序统一入口 `getStationHistory(stationId, type, days, options)`，按类型路由到水库 / 河道 / 土壤三个实现；`throwOnError` 同样透传。

### 站点对象核心字段

| 类型 | 核心字段 |
| --- | --- |
| `reservoir` | `id`、`name`、`currentLevel`、`currentVolume`、`inflow`、`outflow`、`warningLevel`、`deadLevel`、`capacity`、`latitude`、`longitude`、`status` |
| `river` | `id`、`name`、`waterLevel`、`flow`、`warningLevel`、`guaranteedLevel`、`waterQuality`、`temperature`、坐标、`status` |
| `soil` | `id`、`name`、`moisture`（展示/统计主值）、`averageMoisture`、`moisture10`、`moisture20`、`moisture40`、`saturatedMoisture`（饱和含水率）、`relativeMoisture`（相对含水率）、`temperature`、`depth`、`soilType`、坐标、`status` |

状态枚举：`normal`、`warning`、`danger`、`dry`、`drought`、`wet`。

## 4. 云函数与上游依赖

三个云函数入口都做 `API_TOKEN` 共享密钥校验：不匹配返回 403；**环境变量未配置时放行并打 `[auth]` 警告**（fail-open，避免部署顺序弄挂线上）。改密钥时必须两端同步：`utils/config.js` 改一次 + 三个云函数环境变量改一次并重新部署。

### `getStations`

- 向上游水文数据服务请求水库、河道、土壤数据（服务地址见云函数配置）；行政区划默认 `431221`；
- `Promise.allSettled()`：单一种类失败不拖垮整体；部分失败如实标记 `degraded` / `failedTypes`；全部失败返回 502（前端据此进入失败态），30 分钟内有成功结果则回落过期数据；
- 成功结果缓存 2 分钟，上游抖动不会立即打穿到前端；
- 水库：达到警戒/汛限水位标 `danger`，低于死水位标 `warning`；河道：达到警戒水位标 `danger`；
- 土壤按主值 `moisture` 判定：`>=60 wet`、`>=40 normal`、`>=20 dry`、否则 `drought`；保留 `SLM10/20/40`、`AVG`、`FDCP`、`XDSD` 映射为分层含水量、平均、饱和与相对含水率。

### `getStationHistory`

- 水库历史与土壤历史走上游接口（其中水库历史为非官方渠道，上游随时可能变动中断，接口地址见云函数代码）；
- 默认时间范围为当前时间向前 `days` 天；响应统一为 `{ date, value, timestamp }`。

### `getWeather`

- **单一数据源：常规天气与短临都只用和风**（`WEATHER_PROVIDER: 'qweather'`），彩云代码保留为显式退路、不被自动回落命中；
- 和风常规天气走新结构 `/weather/v1/...`，不通时退回旧结构 `/v7/...`，两代都归一化；分钟级降水是 `/v7/minutely/5m`；
- 和风鉴权支持 JWT（`QWEATHER_KID` / `QWEATHER_ISSUER` / `QWEATHER_PROJECT` / `QWEATHER_PRIVATE_KEY(_B64)` + `QWEATHER_HOST`，私钥在函数内就地签名）与 API KEY（`QWEATHER_KEY`）两种；
- 乡镇短临：**12 个乡镇串行 + 间隔 150ms**（和风按 QPM 限流，并发会全灭），按 6 分钟聚合为 21 帧；窗口内进程缓存；前端按需获取（展开短临卡片才请求，5 分钟内不重复）；
- 常规天气有 5 分钟坐标缓存、429 后 90 秒退避、40 分钟内有界回落（带 `stale` / `staleMinutes`）；
- **HTTP 响应体必须走 `decodeHttpBody` / `decodeHttpBuffer` 解码**：和风新 API Host 无条件返回 gzip，直接拼接字符串再 parse 会整条链路全灭。

部署细节与函数环境变量清单见 `cloudfunctions/README.md`；和风凭据的可复制值保存在项目之外的本地密钥目录（含私钥，勿外传、勿入库）。

## 5. 接续重点与风险（2026-11-25 复核）

已完成的历史事项（Git 初始化、Canvas 2d 迁移、失败可见性、云函数鉴权、死代码清理）见 CHANGELOG.md，不再列为风险。

1. **云函数 `API_TOKEN` 环境变量需实际配置**：代码已支持，但需在阿里云控制台给三个函数都配置 `API_TOKEN` 并重新部署；未配置时校验不生效（仅日志警告）。
2. **`getStationHistory` 上游依赖脆弱**：水库历史走非官方接口，建议保持「上游连续失败时界面如实标注数据源不可用」的机制，不要静默空数据。
3. **天气密钥只放云函数环境变量**：前端任何文件不保存 Token / Key / Secret；改凭据后必须重新部署云函数才生效。
4. **前端请求域名合法性**：三个云函数 HTTPS 域名需配置在微信公众平台 `request` 合法域名；`urlCheck` 为 `true`。

## 6. 建议的验证清单

改动或发布前完成：

- [ ] `node scripts/run-tests.js` 全绿；
- [ ] 编译小程序，无 WXML/WXSS/JS 报错；
- [ ] 依次打开首页、地图、列表、详情、降水页，检查自定义 TabBar 高亮；
- [ ] 验证定位选择、下拉刷新、失败横幅与重试（可临时断网观察失败态）；
- [ ] 验证三类站点加载、地图 Marker、筛选、搜索、详情跳转；
- [ ] 验证四张趋势图 / 过程图在真机上的清晰度（Canvas 2d + dpr 缩放）；
- [ ] 验证天气鉴权、分钟降水柱图、小时/逐日预报、12 乡镇短临；
- [ ] 部署云函数后跑 `node scripts/check-deployed.js`，并在函数日志检查超时、上游失败与鉴权；
- [ ] 检查微信合法域名、隐私保护指引及位置权限说明。

## 7. 后续修改时的推荐步骤

1. 在微信开发者工具复现目标页面与问题，保留控制台/网络日志；
2. 明确改动在前端、云函数还是上游接口映射；
3. 改动后先跑 `node scripts/run-tests.js`，涉及页面行为的补一条回归测试（tests/ 下的既有模式可直接照抄）；
4. 同步检查 WXML、JS、WXSS 与页面 JSON，避免只改视图不改行为；
5. 部署云函数后，用函数公网 URL 直接核对 HTTP 状态和 JSON 结构；
6. 真机复测定位、地图、Canvas 与自定义 TabBar；
7. 每个有效改动建一个 Git 提交，并在 CHANGELOG.md 顶部补一条对应记录。
