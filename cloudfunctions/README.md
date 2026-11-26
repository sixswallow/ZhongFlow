# ZhongFlow 云函数部署与维护说明

## 正式云函数

本小程序前端仅调用以下三个**独立阿里云函数**。后续新功能、修复和部署均应在对应目录中进行。

| 函数目录 | 职责 | 前端配置项 |
| --- | --- | --- |
| `getStations/` | 水库、河道、土壤墒情站点列表与统一字段格式化 | `ALIYUN_FUNCTION_STATIONS_URL` |
| `getStationHistory/` | 水库水位、河道水文过程、土壤墒情历史趋势数据 | `ALIYUN_FUNCTION_HISTORY_URL` |
| `getWeather/` | 常规天气、分钟级降水和全县乡镇短临预报 | `ALIYUN_FUNCTION_WEATHER_URL` |

前端公网地址统一配置在：`../utils/config.js`。

## 部署原则

1. 只部署上述三个目录中各自的 `index.js`。
2. 一个函数只处理一类职责；不要重新合并为通过 `type` 参数分流的“大而全”函数。
3. 部署后直接请求对应公网 URL，核对 HTTP 状态码和 JSON 字段，再在微信开发者工具及真机中复测。
4. 修改上游接口字段或状态阈值时，同步检查前端 `utils/api.js` 与相关页面是否仍兼容。

## 共享密钥（API_TOKEN）

三个函数的公网地址都写在小程序包里，任何人抓包即可直连（尤其短临每次触发会向上游打 12 次请求，会刷光和风配额）。因此三个函数都做了**共享密钥校验**：

- 前端每次请求自动携带 `token` 参数（`utils/config.js` 的 `API_TOKEN`，`utils/api.js` 的 `httpGet` 统一附加）；
- 云函数从环境变量 `API_TOKEN` 读取期望值，不匹配返回 403；
- **环境变量未配置时放行并打警告日志**（fail-open），保证先部署函数、后改配置的顺序不会造成线上不可用；
- 改值必须两端同步：改 `utils/config.js` 一次 + 三个函数的环境变量各改一次并**重新部署**；
- 这是防滥用的低成本手段（token 在小程序包里可被解出），不是安全边界；上游配额保护仍以云函数内的缓存与退避为主。

## 天气函数环境变量

`getWeather` 的正式密钥只能在阿里云函数计算环境变量中配置，严禁写入小程序前端文件或提交到仓库。

**当前数据源：只用和风**（`utils/config.js` 的 `WEATHER_PROVIDER: 'qweather'`）。必需配置：

```text
QWEATHER_HOST=<API Host，不要带 https://>        例：xxxxxxxxxx.re.qweatherapi.com
QWEATHER_KID=<凭据 ID>
QWEATHER_ISSUER=<开发者 ID>
QWEATHER_PROJECT=<项目 ID>
QWEATHER_PRIVATE_KEY_B64=<Ed25519 私钥整份 PEM 做 base64 后的单行文本>
```

- 云函数用私钥**就地签名**并自动续签 JWT（有效期 15 分钟、留 60 秒余量），不需要手工填 token；
- 私钥与 `env-values.txt` 放在**项目之外**（`../ZhongFlow-keys/`），不要拷进任何函数目录，更不要进前端目录；
- 私钥与 `env-values.txt` 放在**项目之外**（`../ZhongFlow-keys/`），不要拷进任何函数目录，更不要进前端目录；
- **私钥变量只填一个**：优先 `QWEATHER_PRIVATE_KEY_B64`（单行 base64，最不容易被粘贴毁掉），不要两个都填（两个都填时优先取 `_B64`）；
- 五种常见粘贴失误云函数都会自动修正：换行丢失被压成一行、把 PEM 原文错填进 `_B64`、值里连着 `KEY=` 前缀一起粘、值被成对引号包住、**末尾被截断（只要正文完整、结束标记残缺就补回标准结束行）**。真的修不了时（例如正文也被截掉），报错会带「读到的是——候选N：…」的形状与可解析性描述，照着就能定位；
- **粘贴完建议核对一下长度**：正确值是一整段单行 base64、以标准 base64 结束符（`=` 结尾）收尾。少几个字符是最常见的翻车方式；
- 可选：`NOWCAST_PROVIDER=qweather` —— 把短临也钉死成单一源。不填时默认 `auto`，行为是「有和风凭据就用和风，失败时回落彩云」；
- 彩云已不是默认源，只在显式切回时才需要 `CAIYUN_APP_KEY` / `CAIYUN_APP_SECRET`（或 `CAIYUN_TOKEN`）；`QWEATHER_KEY` 仅在使用 API KEY 鉴权时需要（官方已宣布 2027-02-01 起逐步限制每日请求量，优先用 JWT）。

### 两个必踩的坑

1. **改完环境变量必须「重新部署」函数才生效。** 只改配置不重部署，是最常见的假成功。
2. **和风新 API Host 会无条件返回 gzip**（请求里不写 `Accept-Encoding` 也照样压缩）。取响应体必须先收集 Buffer，再经 `decodeHttpBody` / `decodeHttpBuffer` 解码后 `JSON.parse`；写成 `data += chunk` 再 `JSON.parse` 会报「JSON 解析失败」，**整条和风链路（短临 + 常规天气）全部取不到数**。详见根目录 `CHANGELOG.md` 的「和风凭据落地 + 修掉一个『照原样部署必然全灭』的缺陷」小节。

### 部署后自查

```text
node.exe scripts/check-deployed.js
```

脚本直接请求线上三个函数并逐项判定：新版代码是否生效（`current` 是否含 `windSpeedKmh`）、和风凭据是否生效（`source=qweather`）、短临是否取满 12 个乡镇，并顺带核对站点列表。任一项不符合会打印原因并以退出码 1 结束。

另外确认函数日志中未出现占位符鉴权、401/403、超时或上游字段解析异常，且能看到 `[qweather] 形态自检` 与 `[nowcast-q] 口径自检` 两行口径日志。

## 历史归档：已移除（2026-09-22）

早期的单聚合云函数实现（通过 `type` 参数分发水库、河道、土壤、历史数据和短临预报）曾归档在 `_archive/legacy-aggregate-function.js`，现已删除。

删除原因：该文件保留着旧的状态映射（把「水库水位低于死水位」标注为洪水「预警」），与现行 `STATUS_TEXT` 的语义不一致；留在 `cloudfunctions/` 下存在被误部署或复制回流到现行函数的风险。

如需查阅旧逻辑，请从批次备份中恢复，**不要**将其覆盖到任何现行函数目录：

```text
ZhongFlow-backups/<批次前备份>/cloudfunctions/_archive/legacy-aggregate-function.js
```

现行实现只保留上表的三个独立函数。

## 发布前检查

- [ ] 确认仅修改了目标独立函数目录。
- [ ] 使用 `node --check <函数目录>/index.js` 完成语法检查。
- [ ] 核对阿里云函数环境变量，确认没有在源码中写入密钥。
- [ ] 调用函数公网 URL，确认返回结构符合前端 `utils/api.js` 预期。
- [ ] 运行 `node.exe scripts/check-deployed.js`，确认线上三个函数逐项通过（含和风凭据是否生效、短临是否 12/12）。
- [ ] 检查阿里云函数日志中的超时、上游 HTTP 错误与 JSON 解析错误。
- [ ] 在微信开发者工具和真机完成页面验证。
