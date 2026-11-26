// 青黛 v4 样式一致性审计：类名引用、括号平衡、视觉契约与动效落地
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const problems = [];
const notes = [];

// 仅作为结构/语义钩子存在、按设计不需要声明的类
const STRUCTURAL_ONLY = new Set(['daily-list', 'township-list', 'info-list']);

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/* ---------- 1) 花括号平衡 + 本地路径引用 ---------- */
const pageFiles = ['index', 'map', 'list', 'detail', 'rainfall'];
const styleFiles = [
  'app.wxss',
  'assets/icons.wxss',
  'custom-tab-bar/index.wxss',
  ...pageFiles.map((p) => `pages/${p}/${p}.wxss`),
];
for (const f of styleFiles) {
  const s = read(f);
  const open = (s.match(/\{/g) || []).length;
  const close = (s.match(/\}/g) || []).length;
  if (open !== close) problems.push(`[括号不平衡] ${f}: { ${open} 个, } ${close} 个`);
  if (/file:|[A-Za-z]:[\\/]/.test(s)) problems.push(`[本地绝对路径引用] ${f}`);
}

/* ---------- 2) 类名定义集合 ---------- */
const collectClasses = (css, into) => {
  for (const m of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) into.add(m[1]);
  return into;
};
const globalClasses = new Set();
collectClasses(read('app.wxss'), globalClasses);
collectClasses(read('assets/icons.wxss'), globalClasses);

const pageClasses = {};
for (const p of pageFiles) {
  const set = new Set(globalClasses);
  collectClasses(read(`pages/${p}/${p}.wxss`), set);
  pageClasses[p] = set;
}
const tabClasses = new Set(globalClasses);
collectClasses(read('custom-tab-bar/index.wxss'), tabClasses);

/* ---------- 3) 模板类名引用检查（先剥离 mustache 表达式） ---------- */
const checkTemplate = (rel, defined) => {
  const s = read(rel);
  for (const m of s.matchAll(/class="([^"]*)"/g)) {
    // mustache 表达式替换为占位符 X：与其相邻的组合类（如 active-{{x}}）不参与字面量校验
    const literal = m[1].replace(/\{\{[\s\S]*?\}\}/g, 'X');
    for (const token of literal.split(/\s+/)) {
      if (!token || token.includes('X')) continue;
      if (STRUCTURAL_ONLY.has(token)) continue;
      if (!defined.has(token)) problems.push(`[未定义类] ${rel} -> .${token}`);
    }
  }
  if (/file:|[A-Za-z]:[\\/]/.test(s)) problems.push(`[本地绝对路径引用] ${rel}`);
};
for (const p of pageFiles) checkTemplate(`pages/${p}/${p}.wxml`, pageClasses[p]);
checkTemplate('custom-tab-bar/index.wxml', tabClasses);

/* ---------- 4) 动态类所需的组合选择器 ---------- */
const dynExpect = [
  ['pages/map/map.wxss', ['.filter-bar.active-all', '.filter-bar.active-reservoir', '.filter-bar.active-river', '.filter-bar.active-soil']],
  ['pages/list/list.wxss', ['.tab-bar.active-reservoir', '.tab-bar.active-river', '.tab-bar.active-soil']],
];
for (const [file, sels] of dynExpect) {
  const s = read(file);
  for (const sel of sels) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(esc).test(s)) problems.push(`[缺少动态选择器] ${file} 需要 ${sel}`);
  }
}

/* ---------- 5) 既有测试依赖的视觉/结构契约 ---------- */
const contracts = [
  ['pages/index/index.wxss', /\.hero-surface/, '首页缺少 .hero-surface'],
  ['pages/index/index.wxss', /#0e4d64/, '首页缺少品牌主色 #0e4d64'],
  ['pages/index/index.wxss', /linear-gradient\(150deg,#0e4d64 0%,#0b4f8a/, '首页缺少青黛水文渐变'],
  ['pages/index/index.wxss', /\.content\s*\{[^}]*margin-top:\s*0/, '首页 .content 需要 margin-top:0'],
  ['pages/map/map.wxss', /\.station-panel/, '地图缺少 .station-panel'],
  ['pages/map/map.wxss', /\.panel-status\s*\{([\s\S]*?)\n\}/, '地图缺少多行 .panel-status 规则'],
  ['pages/list/list.wxss', /\.station-item/, '列表缺少 .station-item'],
  ['pages/detail/detail.wxss', /\.header\.reservoir/, '详情缺少 .header.reservoir'],
  ['pages/rainfall/rainfall.wxss', /\.weather-layer/, '气象页缺少 .weather-layer'],
];
for (const [file, re, msg] of contracts) {
  if (!re.test(read(file))) problems.push(`[契约缺失] ${msg} (${file})`);
}
for (const p of pageFiles) {
  const s = read(`pages/${p}/${p}.wxss`);
  const checks = [
    [/#0b4f8a/, '缺少 #0b4f8a'],
    [/#f4f8fc/, '缺少 #f4f8fc'],
    [/border-radius:\s*(?:20|22|24|28)rpx/, '缺少统一圆角语言'],
  ];
  for (const [re, msg] of checks) if (!re.test(s)) problems.push(`[契约缺失] ${p}.wxss ${msg}`);
}

/* ---------- 6) 关键动效与设计系统 token ---------- */
const appCss = read('app.wxss');
for (const kf of ['qd-fade-up', 'qd-shimmer', 'qd-aurora', 'qd-float', 'qd-pop', 'qd-bar-grow', 'qd-breathe', 'qd-slide-up-panel']) {
  if (!appCss.includes(`@keyframes ${kf}`)) problems.push(`[缺少关键帧] ${kf}`);
}
for (const token of ['--qd-e2', '--qd-e3', '--qd-e-brand', '--qd-ease-spring', '--qd-hairline-top']) {
  if (!appCss.includes(`${token}:`)) problems.push(`[缺少 token] ${token}`);
}
const tabCss = read('custom-tab-bar/index.wxss');
if (!tabCss.includes('.tab-pill')) problems.push('[TabBar] 缺少滑动药丸 .tab-pill');

notes.push(`含入场动效的页面: ${pageFiles.filter((p) => /anim-(up|pop|fade|left)|stagger/.test(read(`pages/${p}/${p}.wxml`))).join(', ')}`);
notes.push(`含骨架屏的页面: ${pageFiles.filter((p) => /\bsk\b|sk-/.test(read(`pages/${p}/${p}.wxml`))).join(', ')}`);

/* ---------- 7) 页面级样式不得存在死代码 ---------- */
// app.wxss 的通用原子类允许预留；页面与组件 WXSS 必须全部被模板使用，避免改版后残留。
const usedTokens = (rel) => {
  const toks = new Set();
  const src = read(rel);
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].replace(/\{\{[\s\S]*?\}\}/g, " ").split(/\s+/)) if (t) toks.add(t);
  }
  for (const m of src.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    for (const q of m[1].matchAll(/'([^']+)'/g)) toks.add(q[1]);
  }
  return toks;
};
const deadScan = pageFiles.map((pg) => ["pages/" + pg + "/" + pg + ".wxss", "pages/" + pg + "/" + pg + ".wxml"]);
deadScan.push(["custom-tab-bar/index.wxss", "custom-tab-bar/index.wxml"]);
for (const pair of deadScan) {
  const used = usedTokens(pair[1]);
  const defined = [...new Set([...read(pair[0]).matchAll(/^\.([\w-]+)/gm)].map((m) => m[1]))];
  for (const c of defined) if (!used.has(c)) problems.push("[页面死样式] " + pair[0] + " -> ." + c + " 未被模板使用");
}

/* ---------- 8) 消除「假可点」：有按压态的元素必须可交互 ---------- */
// 例外：.weather-loading 主动抵消加载条继承的按压态；picker 内部的胶囊由原生 picker 接管点击。
const ACTIVE_WHITELIST = new Set(["weather-loading"]);
for (const pg of pageFiles) {
  const tpl = read("pages/" + pg + "/" + pg + ".wxml");
  const css = read("pages/" + pg + "/" + pg + ".wxss") + read("app.wxss");
  const pickerBlocks = [...tpl.matchAll(/<picker[\s\S]*?<\/picker>/g)].map((m) => m[0]).join("\n");
  const actives = [...new Set([...css.matchAll(/\.([\w-]+)[^,{]*:active/g)].map((m) => m[1]))].filter((c) => !ACTIVE_WHITELIST.has(c));
  for (const c of actives) {
    const re = new RegExp("<[\\w-]+[^>]*class=\"[^\"]*\\b" + c + "\\b[^\"]*\"[^>]*>", "g");
    const tags = [...tpl.matchAll(re)];
    if (!tags.length) continue;
    if (tags.some((t) => /bindtap|catchtap/.test(t[0]))) continue;
    const inPicker = new RegExp("<[\\w-]+[^>]*class=\"[^\"]*\\b" + c + "\\b[^\"]*\"").test(pickerBlocks);
    if (inPicker) continue;
    problems.push("[假可点] " + pg + ".wxss ." + c + ":active 有按压反馈但元素不可点击");
  }
}

/* ---------- 9) 禁止 flex gap ---------- */
// 真机（微信基础库）不支持 flex 的 gap：含 gap 的整条规则会失效，弹性布局会退化成块级堆叠。
for (const f of styleFiles) {
  read(f).split("\n").forEach((line, i) => {
    if (/(^|[^-\w])gap\s*:/.test(line)) problems.push("[真机不支持 gap] " + f + ":" + (i + 1) + " 请改用 justify-content:space-between + 子项 margin");
  });
}

/* ---------- 输出 ---------- */
console.log('=== 青黛 v4 样式一致性审计 ===');
console.log(notes.join('\n'));
console.log(`样式文件 ${styleFiles.length} 个；全局类名 ${globalClasses.size} 个`);
if (problems.length === 0) {
  console.log('\n✅ 未发现结构性或契约性问题。');
} else {
  console.log(`\n❌ 发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log('  - ' + p);
  process.exitCode = 1;
}
