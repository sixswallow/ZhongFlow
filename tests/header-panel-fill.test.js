// 天气页头部面板必须「跟着头部盒子走」，不得写死高度（2026-09-27）
//
// 起因：用户反馈「气象图层和头部天气之间存在间隔，感觉不协调」。
// 实测（375px 真宽，状态栏 20px）：
//   改前 .header 高 273px，而 .header-bg 写死 height:400rpx(=200px)
//     → 玻璃条（体感/湿度/风向）下半截 49px 露在面板外
//     → 面板底边到「气象图层」卡顶还有 61px 空白（卡片间距才 11px）
//   改后 .header-bg 用 bottom:0 跟到头部底（273px）→ 卡片上叠 12px，玻璃条全在面板内。
// 另一个同类隐患：该写法在状态栏 47px 的机型上更糟（头部 300px vs 面板 200px → 88px 空白）。
//
// 本文件锁住这条不变量：任何页面的 .header-bg 都必须锚定在头部盒子（top/bottom/left 都为 0），
// 且不得声明固定高度 —— 否则头部内容一变（多一行、状态栏更高）就会重新裂开。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const PAGES = ['index', 'map', 'list', 'detail', 'rainfall'];

// 取出某页某条选择器的规则体（这些规则都是单行写法）
const readRule = (rel, selector) => {
  const src = fs.readFileSync(path.join(R, rel), 'utf8');
  const line = src.split('\n').find((l) => l.startsWith(selector + '{'));
  if (!line) return null;
  const end = line.indexOf('}');
  return { line, body: line.slice(selector.length + 1, end === -1 ? undefined : end) };
};

const pagesWithHeaderBg = PAGES.map((p) => ({ page: p, rel: 'pages/' + p + '/' + p + '.wxss' }))
  .filter((x) => fs.existsSync(path.join(R, x.rel)))
  .filter((x) => readRule(x.rel, '.header-bg'));

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('✓ ' + name);
  } catch (e) {
    failed += 1;
    console.error('✗ ' + name);
    console.error('   ' + ((e && e.message) || e));
  }
}

test('至少要有页面在用 .header-bg（否则本测试失去意义）', () => {
  assert.ok(pagesWithHeaderBg.length >= 2, '应有 detail 与 rainfall 两页使用 .header-bg，实际 ' + pagesWithHeaderBg.length);
});

test('.header-bg 必须锚定头部盒子（top/bottom/left 同时为 0）', () => {
  pagesWithHeaderBg.forEach((x) => {
    const r = readRule(x.rel, '.header-bg');
    assert.ok(/position:\s*absolute/.test(r.body), x.page + ' 的 .header-bg 必须是绝对定位');
    assert.ok(/(^|;)\s*top:0/.test(r.body), x.page + ' 的 .header-bg 缺少 top:0');
    assert.ok(/(^|;)\s*bottom:0/.test(r.body), x.page + ' 的 .header-bg 必须 bottom:0（锚到头部底），实际：' + r.body.slice(0, 120));
    assert.ok(/(^|;)\s*left:0/.test(r.body), x.page + ' 的 .header-bg 缺少 left:0');
  });
});

test('★ .header-bg 不得声明固定高度（这正是本次裂缝的根因）', () => {
  pagesWithHeaderBg.forEach((x) => {
    const r = readRule(x.rel, '.header-bg');
    assert.ok(!/(^|;)\s*height\s*:/.test(r.body), x.page + ' 的 .header-bg 不得写死高度（头部内容一变就会裂开），实际：' + r.body.slice(0, 120));
  });
});

test('天气页 .header-bg 保留圆角底边（这是头部与卡片的视觉语言）', () => {
  const r = readRule('pages/rainfall/rainfall.wxss', '.header-bg');
  assert.ok(r, '天气页应有 .header-bg');
  assert.match(r.body, /border-radius:0 0 36rpx 36rpx/, '头部底边圆角不能丢，实际：' + r.body.slice(0, 160));
});

test('天气页 .header 仍 clip 住装饰（overflow:hidden），且内容区上叠头部', () => {
  const header = readRule('pages/rainfall/rainfall.wxss', '.header');
  assert.ok(header, '天气页应有 .header');
  assert.match(header.body, /overflow:hidden/, '.header 要靠 overflow:hidden 把极光/圆环裁在头部内');
  assert.match(header.body, /padding-bottom:48rpx/, '.header 的底部留白是间距节奏的一半，别随手改');

  const content = readRule('pages/rainfall/rainfall.wxss', '.content');
  assert.ok(content, '天气页应有 .content');
  assert.match(content.body, /margin-top:-24rpx/, '.content 要上叠 24rpx，让首卡压进头部圆角（配 padding-bottom:48rpx 得净 24rpx）');
});

test('头部→首卡 与 卡→卡 的间距节奏一致（48-24=24rpx ≈ 22rpx）', () => {
  const header = readRule('pages/rainfall/rainfall.wxss', '.header').body;
  const content = readRule('pages/rainfall/rainfall.wxss', '.content').body;
  const card = readRule('pages/rainfall/rainfall.wxss', '.card').body;
  const num = (s, re) => Number((s.match(re) || [])[1]);
  const padBottom = num(header, /padding-bottom:(\d+)rpx/);
  const negTop = num(content, /margin-top:-(\d+)rpx/);
  const cardGap = num(card, /margin-bottom:(\d+)rpx/);
  assert.strictEqual(padBottom - negTop, 24, '头部留白减去上叠量应等于 24rpx（12px）');
  assert.ok(Math.abs(padBottom - negTop - cardGap) <= 4, '头部到首卡的距离应与卡片间距同量级，实际 ' + (padBottom - negTop) + 'rpx vs ' + cardGap + 'rpx');
});

test('各页头部面板做法保持一致（不允许某一页偷偷写死高度）', () => {
  const bodies = pagesWithHeaderBg.map((x) => ({ page: x.page, hasBottom: /(^|;)\s*bottom:0/.test(readRule(x.rel, '.header-bg').body) }));
  bodies.forEach((b) => assert.ok(b.hasBottom, b.page + ' 的头部面板没有跟到头部底，与其他页不一致'));
});

if (failed) {
  console.error('\n头部面板跟随性测试：失败 ' + failed + ' 项');
  process.exitCode = 1;
} else {
  console.log('\n头部面板跟随性测试：全部通过');
}
