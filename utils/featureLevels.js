// 小型水库「特征水位」内置表：来自官方公开文件，用于在上游不返回特征水位时
// 补齐「距汛限」等相对量展示。口径说明见各条目 source。
//
// 数据来源：
// ① 《2021年中方县小型水库度汛方案》 中方县人民政府 www.zhongfang.gov.cn
//    （政府网页 HTML 表格，非扫描件，可信度较高；三类坝「控制运用」水库的
//    汛限水位低于正常蓄水位，表中已区分）
// ② 《湖南省中方县大中型及重点小型水利工程管理与保护范围划界方案》2021（网页）
// ③ 《中方县小(2)型水库工程管理与保护范围划界方案》2022（扫描 OCR 件，数字
//    与①冲突，不采信，仅作参考）
// ④ 怀化市水利局《关于中方县板山溪等11座水库除险加固工程初步设计的批复》2025-04
//    （阳务坡已批复除险加固，特征水位可能调整，待向县水利局核实）
//
// 字段单位均为米（1985 国家高程基准，即黄海平均海水面）：
//   floodLimit  汛限水位（对应展示层的 warningLevel）
//   normalLevel 正常蓄水位（与汛限相同时不单列）
//   checkLevel  校核洪水位
//   damCrest    坝顶高程（仅作表内自洽校验用，不参与任何展示与比较）
//   controlled  三类坝控制运用（汛期限制运用水位）

const TABLE = {
  '613H0908': {
    aliases: ['芦茴溪', '芦回溪'],
    floodLimit: 249.70,
    checkLevel: 249.70,
    damCrest: 253.10,
    source: '2021年中方县小型水库度汛方案'
  },
  '613K0948': {
    aliases: ['阳务坡'],
    floodLimit: 396.06,
    designLevel: 397.06,
    checkLevel: 398.06,
    damCrest: 400.00,
    controlled: true,
    source: '2021年中方县小型水库度汛方案（2025年已批复除险加固，待核实）'
  },
  石旦冲: { floodLimit: 281.40, checkLevel: 281.40, damCrest: 283.05, source: '2021年中方县小型水库度汛方案' },
  石溪: { floodLimit: 246.00, checkLevel: 246.00, damCrest: 248.50, source: '2021年中方县小型水库度汛方案' },
  船溪: { floodLimit: 260.00, checkLevel: 260.00, damCrest: 264.41, source: '2021年中方县小型水库度汛方案' },
  上宝界溪: { floodLimit: 284.80, checkLevel: 284.80, damCrest: 286.84, source: '2021年中方县小型水库度汛方案' },
  下宝界溪: { floodLimit: 276.00, checkLevel: 276.00, damCrest: 278.80, source: '2021年中方县小型水库度汛方案' },
  铁溪: { floodLimit: 247.16, normalLevel: 249.16, checkLevel: 250.16, damCrest: 251.43, controlled: true, source: '2021年中方县小型水库度汛方案' },
  岩板桥: { floodLimit: 432.96, checkLevel: 432.96, damCrest: 436.37, source: '2021年中方县小型水库度汛方案' },
  雷家: { floodLimit: 263.60, normalLevel: 264.60, checkLevel: 265.60, damCrest: 267.68, controlled: true, source: '2021年中方县小型水库度汛方案' },
  阿叉溪: { floodLimit: 281.70, checkLevel: 281.70, damCrest: 284.30, source: '2021年中方县小型水库度汛方案' },
  泥水溪: { floodLimit: 248.50, checkLevel: 248.50, damCrest: 251.00, source: '2021年中方县小型水库度汛方案' },
  细毛冲: { floodLimit: 247.75, checkLevel: 247.75, damCrest: 250.65, source: '2021年中方县小型水库度汛方案' },
  孔石溪: { floodLimit: 262.20, checkLevel: 262.20, damCrest: 263.40, source: '2021年中方县小型水库度汛方案' },
  岩屋冲: { floodLimit: 329.40, checkLevel: 330.54, deadLevel: 317.48, damCrest: 331.87, source: '2021年中方县小型水库度汛方案；划界方案（2022 OCR 件）补充死水位' }
};

// 归一化站点名：去空白与「水库」后缀（芦茴溪水库 → 芦茴溪）
const normalizeName = (name) =>
  String(name || '').replace(/\s+/g, '').replace(/水库$/, '');

const lookup = (station) => {
  if (!station) return null;
  if (station.id != null && TABLE[station.id]) return TABLE[station.id];
  const name = normalizeName(station.name);
  if (!name || name.length < 2) return null;
  for (const key of Object.keys(TABLE)) {
    const entry = TABLE[key];
    if (key === name || (entry.aliases || []).some((alias) => alias === name)) {
      return entry;
    }
  }
  return null;
};

// 把官方特征水位补进站点对象（只填上游缺失的字段，不覆盖上游已有值），
// 供站点信息卡展示「汛限水位/正常蓄水位」及口径来源标注。
// 注意：不做「监测值 vs 坝顶」合理性比较——上游小水库水位与官方特征水位
// 不同口径（2026-11-25 全县核对：8/13 站「高于坝顶」物理不可能），任何
// 相对量（含告警哨兵）都会误导，已按用户决策全部移除。
// 返回原对象（详情页 setData 的 station 与 display 共用同一份数据）。
const applyFeatureLevels = (station) => {
  if (!station || station.type !== 'reservoir') return station;
  const entry = lookup(station);
  if (!entry) return station;

  if (station.warningLevel == null && entry.floodLimit != null) {
    station.warningLevel = entry.floodLimit;
  }
  if (station.normalLevel == null && entry.normalLevel != null) {
    station.normalLevel = entry.normalLevel;
  }
  station.featureLevelSource = entry.source;
  return station;
};

module.exports = { TABLE, normalizeName, lookup, applyFeatureLevels };
