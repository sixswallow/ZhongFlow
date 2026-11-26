// 含水量趋势只保留两个「视角」，而不是五个互相重叠的指标：
//
//  · averageMoisture —— 整体。平均含水量本身就是 10/20/40cm 的合成值，
//    用来一眼回答「这块地越来越干还是越来越湿」。
//  · layers          —— 分层。10/20/40cm 三条线画在同一张图上、共用一套纵轴（同为 %），
//    用来回答「是哪一层在变干」。颜色与上方「分层含水量」进度条一致。
//
// 为什么不再把 10/20/40cm 各占一个可选项：平均与分层是同一件事的「合成 / 分解」，
// 拆成四个 chip 既排不进一行（末尾会被裁掉），又必须来回点选、凭记忆对比三层。
//
// 为什么不再单列「相对含水率」趋势：相对含水率是含水量除以该站土壤本身的一个常数
// （田间持水量，按《土壤墒情监测规范》口径）得到的换算值，曲线形状与含水量完全一致、
// 只是纵轴刻度不同，作为一条独立的趋势线属于重复。它的意义在「当前值」——
// 旱情程度，已经展示在主指标带上。仅当上游只回传相对含水率时，才兜底提供它。
const LAYER_SERIES = [
  { key: 'moisture10', label: '10cm', color: '#1f8fc4' },
  { key: 'moisture20', label: '20cm', color: '#12a5ac' },
  { key: 'moisture40', label: '40cm', color: '#7a63c9' }
];

const TREND_DEFINITIONS = {
  averageMoisture: { key: 'averageMoisture', label: '平均含水量', unit: '%', color: '#5f9e3a' },
  layers: { key: 'layers', label: '分层含水量', unit: '%', color: '#1f8fc4', series: LAYER_SERIES },
  relativeMoisture: { key: 'relativeMoisture', label: '相对含水率', unit: '%', color: '#d49a2a' }
};

const hasValue = (records, key) => records.some((record) => {
  const value = record[key];
  return value !== undefined && value !== null && value !== '';
});

const buildSoilTrendOptions = (records = []) => {
  const options = [];
  if (hasValue(records, 'averageMoisture')) options.push(TREND_DEFINITIONS.averageMoisture);
  if (LAYER_SERIES.some((layer) => hasValue(records, layer.key))) options.push(TREND_DEFINITIONS.layers);
  // 兜底：上游只给了相对含水率时，至少还能看到一条趋势
  if (options.length === 0 && hasValue(records, 'relativeMoisture')) options.push(TREND_DEFINITIONS.relativeMoisture);
  return options;
};

module.exports = { buildSoilTrendOptions, LAYER_SERIES };
