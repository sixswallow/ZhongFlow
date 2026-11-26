// 和风天气 JWT（Ed25519）认证测试
//
// 背景（2026-09-23）：和风新版账号不再用「公共地址 + ?key=」，改为
//   「自有 API Host + JWT（Authorization: Bearer）」；JWT 用 Ed25519 签名，
//   私钥自己保管、公钥上传到和风控制台供其验签。
//   官方约束：alg 必须 EdDSA、三段必须 Base64URL（不是 Base64）、有效期最长 24 小时。
//
// 本文件用**本地生成的真 Ed25519 密钥对**签名并用公钥验签，所以不是「看起来像 JWT」，
// 而是「数学上确实被和风能验过的 JWT」。锁死三类容易出错的地方：
//   1) 编码：Base64URL（无填充、+→-、/→_），用错标准库会得到一个和风验不过的 token；
//   2) 载荷：iss=开发者ID、sub=项目ID、kid=凭据ID、iat=当前-30、exp 不超过 24 小时；
//   3) 私钥来自环境变量：换行常被写成字面量，必须还原，否则解析直接失败。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const R = path.join(__dirname, '..');
const fcPath = path.join(R, 'cloudfunctions/getWeather/index.js');

// —— 本地生成 Ed25519 密钥对（与控制台要求的一致：PKCS8 私钥 / SPKI 公钥 PEM）——
const pair = crypto.generateKeyPairSync('ed25519');
const PRIV_PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB_PEM = pair.publicKey.export({ type: 'spki', format: 'pem' });
const KID = 'ABCDE12345';
const ISSUER = 'Q12345ABCD';
const PROJECT = 'ABCDE23456';
const HOST = 'h2a9cf3mhs.xy.qweatherapi.com';

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('✓ ' + name);
  } catch (e) {
    failed += 1;
    console.error('✗ ' + name);
    console.error('   ' + ((e && e.message) || e));
  }
}

const fcSrc = fs.readFileSync(fcPath, 'utf8');
function load(env) {
  ['QWEATHER_KEY', 'QWEATHER_TOKEN', 'QWEATHER_KID', 'QWEATHER_ISSUER', 'QWEATHER_PROJECT',
    'QWEATHER_PRIVATE_KEY', 'QWEATHER_PRIVATE_KEY_B64', 'QWEATHER_HOST', 'NOWCAST_PROVIDER'].forEach((k) => { delete process.env[k]; });
  Object.keys(env).forEach((k) => { process.env[k] = env[k]; });
  delete require.cache[require.resolve(fcPath)];
  return require(fcPath).__test;
}
const decodePart = (s) => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

(async () => {
  // ==================== 一、签名与编码 ====================
  await test('JWT：用本地私钥签名，公钥能验过（不是「看起来像」，是数学上成立）', () => {
    const T = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: PRIV_PEM, QWEATHER_HOST: HOST });
    const now = Math.floor(Date.now() / 1000);
    const { token } = T.createQWeatherJwt(now);
    const parts = token.split('.');
    assert.strictEqual(parts.length, 3, '必须是 header.payload.signature 三段');
    const ok = crypto.verify(null, Buffer.from(parts[0] + '.' + parts[1], 'utf8'), PUB_PEM, Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    assert.strictEqual(ok, true, '公钥必须能验过私钥的签名');
  });

  await test('JWT：三段必须是 Base64URL（无填充、+→-、/→_），用错标准库和风会验不过', () => {
    const T = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: PRIV_PEM, QWEATHER_HOST: HOST });
    const { token } = T.createQWeatherJwt(Math.floor(Date.now() / 1000));
    assert.ok(!/[+/=]/.test(token), 'JWT 里不得出现 + / = ：' + token.slice(0, 40));
    assert.strictEqual(T.base64Url(Buffer.from([0xfb, 0xff, 0xbf])), '-_-_', 'base64 的 +/ 必须换成 -_');
    assert.strictEqual(T.base64Url(Buffer.from('a')), 'YQ', '必须去掉 = 填充');
  });

  await test('JWT：header 必须 alg=EdDSA、kid=凭据ID', () => {
    const T = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: PRIV_PEM, QWEATHER_HOST: HOST });
    const { token } = T.createQWeatherJwt(Math.floor(Date.now() / 1000));
    const header = decodePart(token.split('.')[0]);
    assert.strictEqual(header.alg, 'EdDSA', '算法必须是 EdDSA');
    assert.strictEqual(header.kid, KID, 'kid 必须是凭据ID');
    assert.deepStrictEqual(Object.keys(header).sort(), ['alg', 'kid'], 'header 不得夹带别的字段（明文传输）');
  });

  await test('JWT：payload 必须 iss=开发者ID、sub=项目ID、iat=当前-30、exp 不超过 24 小时', () => {
    const T = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: PRIV_PEM, QWEATHER_HOST: HOST });
    const now = Math.floor(Date.now() / 1000);
    const { token, exp } = T.createQWeatherJwt(now);
    const payload = decodePart(token.split('.')[1]);
    assert.strictEqual(payload.iss, ISSUER, 'iss 是开发者ID');
    assert.strictEqual(payload.sub, PROJECT, 'sub 是项目ID');
    assert.strictEqual(payload.iat, now - 30, 'iat 应比当前时间早 30 秒（官方建议，容忍时钟偏差）');
    assert.strictEqual(payload.exp, exp, '返回的 exp 与载荷一致');
    assert.ok(exp - payload.iat <= 86400, '有效期不得超过 24 小时，实际 ' + (exp - payload.iat) + ' 秒');
    assert.ok(T.QWEATHER_JWT_TTL_SEC <= 86400, '常量本身也不得超过 24 小时');
    assert.deepStrictEqual(Object.keys(payload).sort(), ['exp', 'iat', 'iss', 'sub'], 'payload 不得夹带别的字段');
  });

  // ==================== 二、私钥来自环境变量 ====================
  await test('私钥：环境变量里换行写成字面量时必须还原（云函数环境变量里换行经常被吃掉）', () => {
    const flatPem = PRIV_PEM.replace(/\n/g, '\\n');
    const T = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: flatPem, QWEATHER_HOST: HOST });
    assert.ok(T.qweatherPrivateKeyPem().indexOf('\n') > 0, '必须还原成真正的换行');
    assert.strictEqual(T.qweatherJwtConfigured(), true);
    const { token } = T.createQWeatherJwt(Math.floor(Date.now() / 1000));
    assert.strictEqual(token.split('.').length, 3, '字面量换行的私钥也必须能签出 token');
  });

  await test('私钥：也支持 base64 形式（QWEATHER_PRIVATE_KEY_B64）', () => {
    const T = load({
      QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_HOST: HOST,
      QWEATHER_PRIVATE_KEY_B64: Buffer.from(PRIV_PEM, 'utf8').toString('base64')
    });
    assert.strictEqual(T.qweatherJwtConfigured(), true);
    assert.strictEqual(T.qweatherPrivateKeyPem().trim(), PRIV_PEM.trim(), '还原出的 PEM 应与原文一致');
  });

  await test('私钥：写错时必须给出可读的原因（而不是一个看不懂的 OpenSSL 报错）', () => {
    const T = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: '这不是一个 PEM 私钥', QWEATHER_HOST: HOST });
    assert.strictEqual(T.qweatherJwtConfigured(), true, '配置齐了就会走 JWT 分支');
    let msg = '';
    try { T.createQWeatherJwt(Math.floor(Date.now() / 1000)); } catch (e) { msg = (e && e.message) || ''; }
    assert.match(msg, /和风私钥无法解析/, '应给出可读原因，实际：「' + msg + '」');
  });

  // ==================== 三、请求接线 ====================
  await test('请求：JWT 模式下发 Authorization 头，且 URL 上不再带 key（避免多认证方式冲突）', () => {
    const T = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: PRIV_PEM, QWEATHER_HOST: HOST, QWEATHER_KEY: 'legacy-key-should-not-be-used' });
    const headers = T.qweatherAuthHeaders();
    assert.match(headers.Authorization, /^Bearer eyJ/, '必须带 Bearer JWT，实际 ' + String(headers.Authorization).slice(0, 20));
    const url = T.qweatherUrl('/v7/minutely/5m', { location: '109.95,27.38' });
    assert.strictEqual(url, 'https://' + HOST + '/v7/minutely/5m?location=109.95%2C27.38', 'URL 主机与路径，实际 ' + url);
    assert.ok(url.indexOf('key=') < 0, '已有 Authorization 时不得再挂 key');
    assert.strictEqual(T.hasQWeatherCreds(), true);
    assert.deepStrictEqual(T.resolveNowcastProviders(undefined), ['qweather', 'caiyun'], '配齐 JWT 后 auto 应优先和风');
  });

  await test('请求：token 会被缓存复用，避免每个乡镇都重签一次', () => {
    const T = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: PRIV_PEM, QWEATHER_HOST: HOST });
    const a = T.qweatherJwt();
    const b = T.qweatherJwt();
    assert.strictEqual(a, b, '窗口内必须复用同一个 token');
    const payload = decodePart(a.split('.')[1]);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(payload.exp - 60 > now, '缓存的 token 必须有 60 秒以上余量才继续用');
    assert.ok(payload.exp - payload.iat <= 86400, '缓存的 token 也得守 24 小时上限');
    // 换个更晚的时间点签，exp 必须随之前移（说明不是写死的时间）
    const later = T.createQWeatherJwt(now + 3600);
    assert.strictEqual(decodePart(later.token.split('.')[1]).exp, payload.exp + 3600, 'exp 必须随时间推进');
  });

  await test('请求：只配 API KEY（不配密钥对）时走老路，URL 上带 key', () => {
    const T = load({ QWEATHER_HOST: 'devapi.qweather.com', QWEATHER_KEY: 'legacy-key' });
    assert.deepStrictEqual(T.qweatherAuthHeaders(), {}, '没有 JWT 就不该带 Authorization');
    assert.match(T.qweatherUrl('/v7/minutely/5m', { location: '1,2' }), /key=legacy-key/, 'API KEY 走 URL 参数');
    assert.strictEqual(T.qweatherJwtConfigured(), false, '半配（缺 kid 等）不算配好');
  });

  await test('请求：凭据一个都没配时，失败原因必须列出两条可行路径', () => {
    const T = load({});
    assert.strictEqual(T.hasQWeatherCreds(), false);
    assert.strictEqual(T.qweatherJwtConfigured(), false);
    assert.match(fcSrc, /未配置和风天气凭据（JWT 用 QWEATHER_KID/, '提示里要写清 JWT 需要的变量');
    assert.match(fcSrc, /API KEY 用 QWEATHER_KEY/, '提示里也要给出 API KEY 这条路');
  });

  await test('文档：新版端点写法与「公共地址 2026 年停服」必须写在源码注释里', () => {
    assert.match(fcSrc, /QWEATHER_HOST（控制台-设置里的 API Host）/, '要写明 API Host 从哪来');
    assert.match(fcSrc, /公共地址从 2026 年起逐步停止服务/, '要写明公共地址会停服');
    assert.match(fcSrc, /'\/v7\/minutely\/5m'|QWEATHER_MINUTELY_PATH/, '分钟级路径必须有出处');
    assert.match(fcSrc, /公钥上传到和风控制台供其验签，私钥只留在云函数里/, '要写清公私钥的分工');
  });

  await test('主机名：控制台复制出来的「https://xxx/」必须被规范成裸主机名（否则会拼成 https://https://）', () => {
    const withScheme = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: PRIV_PEM, QWEATHER_HOST: 'https://' + HOST + '/' });
    assert.strictEqual(withScheme.qweatherHost(), HOST, '要去掉协议头和结尾斜杠');
    const url = withScheme.qweatherUrl('/v7/minutely/5m', { location: '1,2' });
    assert.strictEqual(url, 'https://' + HOST + '/v7/minutely/5m?location=1%2C2', '拼出的 URL 不能出现双 https，实际 ' + url);
    const spaced = load({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_PRIVATE_KEY: PRIV_PEM, QWEATHER_HOST: '  ' + HOST + '  ' });
    assert.strictEqual(spaced.qweatherHost(), HOST, '要去掉首尾空白');
    const empty = load({});
    assert.strictEqual(empty.qweatherHost(), 'devapi.qweather.com', '没配时回退到公共地址');
  });

  // ==================== 四、控制台粘贴私钥的容错（2026-09-26） ====================
  // 线上实测：私钥变量被粘贴毁掉时，云函数只报 error:1E08010C:DECODER routines::unsupported，
  // 用户根本看不出是哪里不对。下面把几种常见毁法都修好，并保证「真的坏了」时仍然如实报错。
  const signAndVerify = (T) => {
    const { token } = T.createQWeatherJwt(Math.floor(Date.now() / 1000));
    const parts = token.split('.');
    return crypto.verify(null, Buffer.from(parts[0] + '.' + parts[1], 'utf8'), PUB_PEM,
      Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  };
  const baseEnv = () => ({ QWEATHER_KID: KID, QWEATHER_ISSUER: ISSUER, QWEATHER_PROJECT: PROJECT, QWEATHER_HOST: HOST });

  await test('私钥容错：换行全丢、整份 PEM 被压成一行时，仍须签得出可用 token', () => {
    const T = load(Object.assign(baseEnv(), { QWEATHER_PRIVATE_KEY: PRIV_PEM.split('\n').join('') }));
    assert.strictEqual(T.qweatherJwtConfigured(), true);
    assert.strictEqual(T.qweatherPrivateKeyPem().indexOf('\n') > 0, true, '压成一行的 PEM 必须被重新折行');
    assert.strictEqual(signAndVerify(T), true, '公钥必须能验过');
  });

  await test('私钥容错：PEM 原文被错填进 *_B64，也要能识别出来用', () => {
    const T = load(Object.assign(baseEnv(), { QWEATHER_PRIVATE_KEY_B64: PRIV_PEM }));
    assert.strictEqual(signAndVerify(T), true, '公钥必须能验过');
  });

  await test('私钥容错：值里连着「QWEATHER_...=」一起粘进来时要剥掉前缀', () => {
    const b64 = Buffer.from(PRIV_PEM, 'utf8').toString('base64');
    const T = load(Object.assign(baseEnv(), { QWEATHER_PRIVATE_KEY_B64: 'QWEATHER_PRIVATE_KEY_B64=' + b64 }));
    assert.strictEqual(signAndVerify(T), true, '公钥必须能验过');
    assert.strictEqual(T.normalizePemText(b64), b64, '大小写混合的 base64 不得被当成 key=value 前缀削掉');
    assert.strictEqual(T.normalizePemText('QWEATHER_PRIVATE_KEY_B64=' + b64), b64, '带前缀时必须剥掉');
  });

  await test('私钥容错：值被成对引号包住时要能解开', () => {
    const T = load(Object.assign(baseEnv(), { QWEATHER_PRIVATE_KEY: '"' + PRIV_PEM + '"' }));
    assert.strictEqual(signAndVerify(T), true, '公钥必须能验过');
  });

  await test('私钥容错：真的坏掉时不得假装成功，且报错要带上「读到的是什么形状」', () => {
    const T = load(Object.assign(baseEnv(), {
      QWEATHER_PRIVATE_KEY_B64: Buffer.from(PRIV_PEM, 'utf8').toString('base64').slice(0, -40)
    }));
    let msg = '';
    try { T.createQWeatherJwt(Math.floor(Date.now() / 1000)); } catch (e) { msg = (e && e.message) || ''; }
    assert.match(msg, /和风私钥无法解析/, '必须如实报错');
    assert.match(msg, /读到的是——/, '要带形状描述，否则用户无法自查，实际：「' + msg + '」');
    assert.ok(msg.indexOf(PRIV_PEM.slice(0, 20)) < 0, '报错里不得回显私钥内容');
    assert.match(T.describePemCandidates(), /候选1：/, '形状描述应逐个候选列出');
  });

  await test('私钥容错：*_B64 末尾少 3 个字符（线上真实形态）必须自动补全，且公钥能验过', () => {
    const full = Buffer.from(PRIV_PEM, 'utf8').toString('base64');
    assert.strictEqual(full.length, 160, '正例基线：base64 应为 160 字符');
    const T = load(Object.assign(baseEnv(), { QWEATHER_PRIVATE_KEY_B64: full.slice(0, -3) }));
    assert.match(T.describePemCandidates(), /可用/, '补全后的候选应当可解析，实际：' + T.describePemCandidates());
    assert.strictEqual(signAndVerify(T), true, '公钥必须能验过 —— 证明补出来的是同一把密钥，不是猜出来的别的密钥');
  });

  await test('私钥容错：只有「正文完整、结束标记残缺」才补；正文也残缺时必须放弃猜测', () => {
    const T = load(Object.assign(baseEnv(), { QWEATHER_PRIVATE_KEY_B64: Buffer.from(PRIV_PEM, 'utf8').toString('base64') }));
    const flat = PRIV_PEM.split('\n').join('');
    assert.ok(String(T.repairTruncatedPem(flat.slice(0, -3))).indexOf('-----END PRIVATE KEY-----') > 0,
      '只缺结束标记尾巴时应补回标准结束行');
    assert.strictEqual(T.repairTruncatedPem(flat.slice(0, -20)), '', '正文也被截掉时不得补');
    assert.strictEqual(T.repairTruncatedPem(PRIV_PEM), '', '完整 PEM 不需要补');
  });

  if (failed) {
    console.error('\n和风 JWT 认证测试：失败 ' + failed + ' 项');
    process.exitCode = 1;
  } else {
    console.log('\n和风 JWT 认证测试：全部通过');
  }
})();
