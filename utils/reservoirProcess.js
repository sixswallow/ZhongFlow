// 水库水文过程：判断某个水库站的入库/出库流量序列能不能作为过程线画出来，
// 并给出画布上实际要用的抽稀结果。
//
// 为什么要有判断，而不是「有就画」——2026-09-26 对全县 106 座水库实测的结果：
//   · 只有 5 座返回入库/出库序列（铜湾、三角滩、五龙溪、柏坡洞、白沙），
//     其余水库连蓄量都没有，更别说流量；
//   · 五龙溪的入库/出库 7 天一动不动（0.341 / 0.92，小数点后三位不变）——
//     那是抄录值，不是观测过程。画成曲线会是一条直线，看上去像「水流很稳」，
//     实际含义是「这一周没有观测」；
//   · 柏坡洞、白沙的流量与蓄量变化方向互相矛盾（净入库为正、蓄量却在降），
//     说明该站的流量与蓄量不是同一套口径，按「宁可不显示，也不显示错值」不画。
//
// 三个条件同时成立才画：
//   ① 至少有 MIN_FLOW_POINTS 条记录同时带入库与出库（点太少画不出过程）；
//   ② 入库与出库不能都是恒定值（都恒定说明是抄录值）；
//   ③ 若记录里带蓄量，Σ(入库−出库)×Δt 必须与蓄量变化同号；没有蓄量的站跳过这一条
//      （核不了不等于有问题，不因此判负）。
const MIN_FLOW_POINTS = 3;

// 画布上最多铺这么多点：铜湾 7 天有 169 个逐时点、30 天 700 点以上，
// 逐点铺在 250px 宽的过程图上每点不到 2px，三条线会糊成一片毛刺。
const MAX_CHART_POINTS = 48;

const isNumber = (value) => value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value));
const hasFlowPair = (item) => isNumber(item.inflow) && isNumber(item.outflow);

// 等间隔抽稀，首尾两点一定保留（否则曲线的起止时刻会对不上横轴）
const decimate = (records, max = MAX_CHART_POINTS) => {
  const list = Array.isArray(records) ? records : [];
  if (list.length <= max) return list;
  const step = (list.length - 1) / (max - 1);
  const out = [];
  for (let index = 0; index < max; index += 1) out.push(list[Math.round(index * step)]);
  return out;
};

const volumeConsistent = (records) => {
  const paired = records.filter((item) => hasFlowPair(item) && isNumber(item.volume));
  if (paired.length < 2) return true;
  let accumulated = 0;
  for (let index = 0; index + 1 < paired.length; index += 1) {
    const hours = (Number(paired[index + 1].timestamp) - Number(paired[index].timestamp)) / 3600000;
    // 间隔过大或时间戳缺失的段不参与累计，避免把跨天跳变当成过程
    if (!(hours > 0) || hours > 72) continue;
    accumulated += (Number(paired[index].inflow) - Number(paired[index].outflow)) * hours * 3600;
  }
  const delta = Number(paired[paired.length - 1].volume) - Number(paired[0].volume);
  if (delta === 0) return Math.abs(accumulated) < 1;
  return delta * accumulated > 0;
};

// 返回 { hasFlow, reason, records }：
//   hasFlow —— 是否画出入库/出库两条过程线；
//   reason  —— ok / insufficient / constant / inconsistent，便于排查与测试；
//   records —— 画图要用的记录（hasFlow 时已抽稀）。
const buildReservoirProcess = (records) => {
  const list = Array.isArray(records) ? records : [];
  const paired = list.filter(hasFlowPair);
  if (paired.length < MIN_FLOW_POINTS) return { hasFlow: false, reason: 'insufficient', records: list };
  const inflowValues = new Set(paired.map((item) => String(item.inflow)));
  const outflowValues = new Set(paired.map((item) => String(item.outflow)));
  if (inflowValues.size < 2 && outflowValues.size < 2) return { hasFlow: false, reason: 'constant', records: list };
  if (!volumeConsistent(list)) return { hasFlow: false, reason: 'inconsistent', records: list };
  return { hasFlow: true, reason: 'ok', records: decimate(list) };
};

module.exports = { buildReservoirProcess, decimate, MIN_FLOW_POINTS, MAX_CHART_POINTS };
