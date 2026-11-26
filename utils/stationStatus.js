// 站点状态文案的唯一前端来源（与云函数 getStations/index.js 的 STATUS_TEXT 保持一致）。
// - warning 只用于「水库水位低于死水位」，是供水不足提示，不是洪水预警结论；
// - unknown 表示上游未返回可用数据，不推断旱涝等级。
const STATION_STATUS_TEXT = {
  normal: '正常',
  unknown: '暂无数据',
  warning: '水位偏低',
  danger: '超警戒',
  dry: '偏干',
  drought: '干旱',
  wet: '过湿'
};

// 水库的控制水位叫「汛限水位」（上游字段 FSLTDZ），河道的才叫「警戒水位」（HLZ）——
// 同一个「水位达到控制水位」的状态，两类站用词不同，不能共用一个 danger 文案。
const DANGER_TEXT_BY_TYPE = {
  reservoir: '超汛限',
  river: '超警戒'
};

const getStationStatusText = (status, type) => {
  if (status === 'danger' && DANGER_TEXT_BY_TYPE[type]) return DANGER_TEXT_BY_TYPE[type];
  return STATION_STATUS_TEXT[status] || status || '--';
};

module.exports = { STATION_STATUS_TEXT, DANGER_TEXT_BY_TYPE, getStationStatusText };
