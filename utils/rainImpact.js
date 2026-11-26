// 未来降雨影响：累计降雨、雨量等级、最强小时、短临雨中心。
//
// 数据源（均为前端已拿到的字段，无需改云函数、无需新接口）：
// - 逐小时预报 hourly[].rain —— 该小时降水量（mm，预报值），彩云 / 和风两条链路都提供；
// - 乡镇短临 townships[].totalRain —— 未来 2 小时累计降水（mm）；ok === false 表示该乡镇取数失败，
//   此时 totalRain 为 null，既不参与雨中心、也不按 0mm 计入。
//
// 口径说明（避免误读，本项目吃过「图例与数据不符」的亏）：
// - 6h / 12h / 24h 都是**未来**累计，取逐小时数组前 N 小时求和；不是实况回顾（数据源不提供历史降水）；
// - 雨量等级按 GB/T 28592-2012，12h 与 24h 各有一套表，**只有覆盖时长正好是 12 / 24 小时才给等级**；
//   数据时长不够时不给等级，也不套错表（宁可不显示，也不显示错值）；
// - 小时雨强的 light/moderate/heavy/storm 是**强度参考档**（≤2.5 / ≤8 / ≤16 / >16 mm/h），
//   国标没有 1 小时等级表，所以这里只用来说明柱高与配色，不对外称「等级」。
'use strict';

const RAIN_TABLES = {
  12: [[0.1, '小雨'], [5, '中雨'], [15, '大雨'], [30, '暴雨'], [70, '大暴雨'], [140, '特大暴雨']],
  24: [[0.1, '小雨'], [10, '中雨'], [25, '大雨'], [50, '暴雨'], [100, '大暴雨'], [250, '特大暴雨']],
};

const TONES = { 小雨: 'light', 中雨: 'moderate', 大雨: 'heavy', 暴雨: 'storm', 大暴雨: 'storm', 特大暴雨: 'storm' };

// 文案只做事实描述，不使用「关注 / 预警 / 风险 / 态势」一类措辞（与本项目首页口径保持一致）
const TIPS = {
  小雨: '降雨量级小，对水库来水影响有限',
  中雨: '降雨量级中等，水库来水略有增加',
  大雨: '降雨较明显，水库来水与河道水位将有所上涨',
  暴雨: '降雨强度大，水位与库容上涨明显',
  大暴雨: '降雨强度很大，水位与库容上涨显著',
  特大暴雨: '降雨极强，水位与库容将大幅上涨',
};

const SPANS = [6, 12, 24];
const BAR_FULL_MM = 16;   // 小时雨强满格参考值：16mm/h

const round1 = (n) => Math.round(n * 10) / 10;
const toMm = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// 归一化逐小时数组：只保留带 time 的行，雨量取非负有限值
const normalize = (hourly) => (hourly || [])
  .filter((h) => h && typeof h.time === 'string' && h.time)
  // known=false 表示上游没给这一小时的雨量（不是 0mm）：它按 0 参与累计，
  // 但必须阻断「无明显降雨」这类结论，也要挡住雨量等级的判定。
  .map((h) => ({ time: h.time, rain: toMm(h.rain), known: h.rainKnown !== false }));

const sumFirst = (rows, n) => round1(rows.slice(0, n).reduce((a, r) => a + r.rain, 0));

// 按国标表取等级；spanHours 必须正好命中表（12/24），否则返回 null
const gradeOf = (mm, spanHours) => {
  const table = RAIN_TABLES[spanHours];
  if (!table) return null;
  if (!(mm >= table[0][0])) return null;
  let grade = table[0][1];
  table.forEach(([min, label]) => { if (mm >= min) grade = label; });
  return grade;
};

const peakOf = (rows, n) => rows.slice(0, n)
  .reduce((best, r) => (r.rain > best.rain ? r : best), { time: '', rain: 0 });

// 未来 2 小时雨中心：取乡镇累计降水最大者；全为 0 或缺数据时返回 null
const rainCenter = (townships) => {
  // 取数失败的乡镇（ok === false）不参与：它们没有 totalRain，不能被当成 0mm 或候选雨中心
  const list = (townships || []).filter((t) => t && t.ok !== false && t.name && toMm(t.totalRain) > 0);
  if (!list.length) return null;
  const top = list.reduce((a, b) => (toMm(b.totalRain) > toMm(a.totalRain) ? b : a));
  return { name: top.name, mm: round1(toMm(top.totalRain)) };
};

// 逐小时雨量柱的图例文字：满格口径（BAR_FULL_MM）只在这里出现一次，界面不再另写数字
const barLegendText = () => '柱高＝该小时雨量 · 满格 ' + BAR_FULL_MM + 'mm';

// 小时雨强 → 柱高百分比（有雨至少 12%，否则小雨看不出来）
const barPercent = (mm) => {
  const r = toMm(mm);
  if (r <= 0) return 0;
  return Math.max(12, Math.min(100, Math.round((r / BAR_FULL_MM) * 100)));
};

// 小时雨强 → 配色分档
const levelOf = (mm) => {
  const r = toMm(mm);
  if (r <= 0) return 'none';
  if (r <= 2.5) return 'light';
  if (r <= 8) return 'moderate';
  if (r <= 16) return 'heavy';
  return 'storm';
};

const EMPTY = {
  ready: false, empty: false, spans: [], gradeText: '', tone: 'none',
  peakText: '', centerText: '', metaText: '', tip: '',
};

const buildRainImpact = (hourly, townships) => {
  const rows = normalize(hourly);
  if (!rows.length) return { ...EMPTY };

  // 覆盖时长不足时如实降档：spans 只保留覆盖时长严格递增的项，避免出现两个相同标签
  const spans = [];
  SPANS.forEach((want) => {
    const cover = Math.min(want, rows.length);
    const prev = spans.length ? spans[spans.length - 1].cover : 0;
    if (cover <= prev) return;
    const mm = sumFirst(rows, cover);
    // 这一段窗口里有几个小时没取到雨量：累计只是「已知部分」
    const unknown = rows.slice(0, cover).filter((r) => !r.known).length;
    spans.push({ want, cover, label: cover + 'h', mm, mmText: mm.toFixed(1), partial: cover < want, unknown });
  });

  const main = spans[spans.length - 1];
  // 窗口里有「没取到」的小时：累计只是已知部分 —— 既不能给等级，也不能下「无雨」的结论
  const unknown = main.unknown;
  const grade = unknown > 0 ? null : gradeOf(main.mm, main.cover);
  const empty = unknown === 0 && main.mm < 0.1;
  const peak = peakOf(rows, Math.min(24, rows.length));
  const center = rainCenter(townships);

  // 有没取到的小时时，最强只能是「已知最强」，不能把部分当全部
  const peakText = (empty || peak.rain <= 0) ? '' : (unknown > 0 ? '已知最强 ' : '最强 ') + peak.time + ' ' + peak.rain.toFixed(1) + 'mm/h';
  const centerText = center ? '未来2小时雨中心 ' + center.name + ' ' + center.mm.toFixed(1) + 'mm' : '';
  let tip;
  if (unknown > 0) tip = '未来' + main.cover + '小时里有 ' + unknown + ' 小时雨量未取到，累计仅含已取到的部分';
  else if (empty) tip = '未来24小时无明显降雨';
  else if (grade) tip = TIPS[grade];
  else tip = '预报覆盖 ' + main.cover + ' 小时，时长不足 24 小时，仅给出累计降雨';

  return {
    ready: true,
    empty,
    spans,
    gradeText: empty ? '' : (grade || ''),
    tone: grade ? TONES[grade] : 'none',
    peakText,
    centerText,
    metaText: [peakText, centerText].filter(Boolean).join(' · '),
    tip,
  };
};

module.exports = {
  BAR_FULL_MM,
  barLegendText,
  buildRainImpact,
  gradeOf,
  sumFirst,
  peakOf,
  rainCenter,
  barPercent,
  levelOf,
  round1,
};
