const { getStationStatusText } = require('./stationStatus.js');

// 青黛 v4 色板：与详情页图表、列表状态胶囊同源，避免地图另起一套配色
const TYPE_VISUALS = {
  reservoir: {
    iconPath: '/assets/map-markers/reservoir.png',
    label: '💧 水库',
    color: '#0b4f8a'
  },
  river: {
    iconPath: '/assets/map-markers/river.png',
    label: '〰 河道',
    color: '#0e9bb8'
  },
  soil: {
    iconPath: '/assets/map-markers/soil.png',
    label: '🌱 墒情',
    color: '#5f9e3a'
  },
  default: {
    iconPath: '/assets/map-markers/default.png',
    label: '站点',
    color: '#5e7f90'
  }
};

// 告警红与图表警戒线同色（#d95f5f）；偏低/偏干为琥珀（#d49a2a）；
// 过湿为品牌蓝（#0b4f8a）；暂无数据为中性灰蓝，不作旱涝结论。
// 状态配色。文字统一由 utils/stationStatus.js 提供（水库 danger = 超汛限、河道 = 超警戒），
// 避免同一句文案在地图气泡、列表胶囊、详情页三处各写一遍、各自漂移。
const STATUS_VISUALS = {
  warning: { color: '#d49a2a', bgColor: '#fdf4e3' },
  danger: { color: '#d95f5f', bgColor: '#fdeeee' },
  dry: { color: '#d49a2a', bgColor: '#fdf4e3' },
  drought: { color: '#d95f5f', bgColor: '#fdeeee' },
  wet: { color: '#0b4f8a', bgColor: '#e6f5fb' },
  unknown: { color: '#5e7f90', bgColor: '#eef4f8' }
};

// options.selected：选中态——气泡常驻（BYALWAYS）并放大字号，
// 配合地图页把选中 marker 的图标放大，让用户在密集点位里一眼认出当前选中的站。
const buildMarkerVisual = (station = {}, options = {}) => {
  const typeVisual = TYPE_VISUALS[station.type] || TYPE_VISUALS.default;
  const statusVisual = STATUS_VISUALS[station.status];

  return {
    iconPath: typeVisual.iconPath,
    callout: {
      content: statusVisual ? getStationStatusText(station.status, station.type) : typeVisual.label,
      color: statusVisual ? statusVisual.color : typeVisual.color,
      bgColor: statusVisual ? statusVisual.bgColor : '#ffffff',
      fontSize: options.selected ? 12 : 11,
      borderRadius: 10,
      padding: 5,
      display: options.selected ? 'BYALWAYS' : 'BYCLICK',
      textAlign: 'center'
    }
  };
};

module.exports = { buildMarkerVisual };
