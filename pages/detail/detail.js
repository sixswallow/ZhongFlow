const api = require('../../utils/api');
const util = require('../../utils/util');
const { buildSoilDisplay } = require('../../utils/soilDisplay');
const { buildSoilTrendOptions } = require('../../utils/soilTrend');
const { buildReservoirProcess } = require('../../utils/reservoirProcess');
const { getStationStatusText } = require('../../utils/stationStatus');
const { applyFeatureLevels } = require('../../utils/featureLevels');
const canvas2d = require('../../utils/canvas2d');

// 十六进制色值转 rgba：用于图表渐变，避免散落硬编码色值
const hexToRgba = (hex, alpha) => {
  const raw = String(hex || '').replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
};

// 蓄量换算到万m³ 后数值放大约 100 倍，而主指标带只有半宽：
// 11255.00 万m³ 会把单位挤到下一行（真机上就是排版破损）。
// 因此按数量级决定小数位：四位数以上不带小数，三位带一位，两位带两位。
const formatVolume = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '--';
  if (number >= 1000) return number.toFixed(0);
  if (number >= 100) return number.toFixed(1);
  return number.toFixed(2);
};

Page({
  data: {
    station: null,
    // 加载失败态：避免失败后页面永久停在骨架屏上（原实现会静默弹回，用户看到的只是「加载中…」）
    loadFailed: false,
    // 历史时序数据加载失败态：与「该时段无记录」区分
    chartLoadFailed: false,
    chartDays: 7,
    canvasWidth: 320,
    canvasHeight: 200,
    chartData: [],
    riverHasFlow: false,
    // 水库：入库/出库序列能不能画成过程线。上游 106 座水库里只有 5 座返回该序列，
    // 且其中过半不可用（恒定值/与蓄量矛盾），因此默认按单线水位展示。
    reservoirHasFlow: false,
    reservoirProcessTitle: '水位趋势',
    soilTrendOptions: [],
    activeSoilTrend: 'averageMoisture',
    activeSoilTrendLabel: '平均含水量',
    activeSoilTrendUnit: '%'
  },

  onLoad(options) {
    const stationId = options.id;
    this.stationId = stationId;
    this.calculateCanvasSize();
    this.loadStationDetail();
  },

  calculateCanvasSize() {
    const systemInfo = wx.getWindowInfo();
    const windowWidth = systemInfo.windowWidth;
    // content padding: 24rpx*2 + card padding: 28rpx*2 = 104rpx
    const paddingRpx = 104;
    const paddingPx = paddingRpx * windowWidth / 750;
    const canvasWidth = windowWidth - paddingPx;
    const canvasHeight = 200;
    this.setData({ canvasWidth, canvasHeight });
  },

  async loadStationDetail(options = {}) {
    try {
      util.showLoading('加载中...');
      const station = await api.getStationDetail(this.stationId, options);
      
      if (!station) {
        // 修复：原分支缺少 hideLoading()，mask 遮罩会一直挂着直到 1.5s 后自动返回，
        // 现象就是「点进详情只看到加载中，然后自己弹回来」。
        // 并且无法区分「站点不存在」与「接口失败」，因此不再断言站点不存在，改为可重试的失败态。
        util.hideLoading();
        this.setData({ loadFailed: true });
        return;
      }

      const display = this.processStationDisplay(station);

      wx.setNavigationBarTitle({ title: station.name });
      
      this.setData({ station, display });
      this.loadHistoryData();
      util.hideLoading();
    } catch (e) {
      util.hideLoading();
      this.setData({ loadFailed: true });
      console.error('加载站点详情失败', e);
    }
  },

  // 失败后重试：详情页原本没有任何重试入口
  retryLoad() {
    this.setData({ loadFailed: false });
    // 强制回源：失败可能来自缓存中的空列表，普通重试会拿到同一份缓存
    this.loadStationDetail({ forceRefresh: true });
  },

  // 详情页开了 enablePullDownRefresh，但没有实现 onPullDownRefresh，下拉后转圈不会停
  onPullDownRefresh() {
    this.setData({ loadFailed: false });
    this.loadStationDetail({ forceRefresh: true })
      .then(() => wx.stopPullDownRefresh())
      .catch(() => wx.stopPullDownRefresh());
  },

  processStationDisplay(station) {
    // 上游不返回特征水位时，用内置官方特征水位表补齐「距汛限」等相对量；
    // 并做合理性哨兵（监测值高于已知坝顶高程 → 数据待核）。只填缺失字段，不覆盖上游值。
    station = applyFeatureLevels(station);
    const display = {};

    if (station.type === 'reservoir') {
      // 不再对水库计算/展示「距汛限/超汛限」：全县实测核对发现上游小水库的水位
      // 与官方特征水位明显不同口径（13 座可比站点中 8 座「高于坝顶」物理上不可能），
      // 任何相对量比较都会产生「超汛限 79.95m」这类荒谬且易引起恐慌的结论。
      // 只展示事实值（库水位·海拔）与官方特征水位（站点信息卡），见 utils/featureLevels.js。
      if (station.capacity && station.currentVolume != null && station.currentVolume > 0) {
        display.volumePercent = ((station.currentVolume / station.capacity) * 100).toFixed(1);
      }
      // 只显示有数据的字段，无数据时置空
      display.currentLevelText = station.currentLevel > 0 ? Number(station.currentLevel).toFixed(2) : '--';
      display.currentVolumeText = formatVolume(station.currentVolume);
      display.inflowText = station.inflow > 0 ? Number(station.inflow).toFixed(2) : '--';
      display.outflowText = station.outflow > 0 ? Number(station.outflow).toFixed(2) : '--';
      // 标记哪些字段有数据，用于控制显示
      display.showVolume = station.currentVolume > 0;
      display.showInflow = station.inflow > 0;
      display.showOutflow = station.outflow > 0;
      // ③ 入库/出库的净差值：只陈述两个数之差，不给「库容在涨/在退」这类方向性结论 ——
      // 上游的入库流量本身可能就是按蓄量变化反推出来的（实测其净入恒为库容变化率的整数倍），
      // 那种情况下任何方向性结论都是同义反复，而白沙那类自相矛盾的站会直接得出反的结论。
      if (display.showInflow && display.showOutflow) {
        const net = Number(station.inflow) - Number(station.outflow);
        display.hasNetFlow = true;
        if (Math.abs(net) < 0.005) {
          display.netFlowLabel = '入库与出库持平';
          display.netFlowValue = '';
        } else {
          display.netFlowLabel = net > 0 ? '净入库' : '净出库';
          display.netFlowValue = Math.abs(net).toFixed(2);
        }
      }
    }

    if (station.type === 'river') {
      if (station.warningLevel && station.waterLevel != null) {
        const diff = station.warningLevel - station.waterLevel;
        display.warningDiff = diff.toFixed(2);
        display.warningDiffText = diff >= 0 ? '距警戒' : '超警戒';
        display.warningDiffAbs = Math.abs(diff).toFixed(2);
        display.warningDiffState = diff >= 0 ? 'near' : 'over';
      }
      display.waterLevelText = station.waterLevel > 0 ? Number(station.waterLevel).toFixed(2) : '--';
      display.flowText = station.flow > 0 ? Number(station.flow).toFixed(2) : '--';
      display.temperatureText = station.temperature != null ? Number(station.temperature).toFixed(1) : '--';
      display.showFlow = station.flow > 0;
      display.showWaterQuality = !!station.waterQuality;
      display.showTemperature = station.temperature != null;
    }

    if (station.type === 'soil') {
      Object.assign(display, buildSoilDisplay(station));
    }

    const latitude = station.latitude === null || station.latitude === undefined || station.latitude === ''
      ? NaN
      : Number(station.latitude);
    const longitude = station.longitude === null || station.longitude === undefined || station.longitude === ''
      ? NaN
      : Number(station.longitude);
    display.hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
    if (display.hasCoordinates) {
      display.latitudeText = latitude.toFixed(4);
      display.longitudeText = longitude.toFixed(4);
    }

    // 「监测数据」卡片是否还有内容可展示：全字段缺失时给出明确空态，而不是一张只剩标题的空卡片
    const hasLevelMetric = (station.type === 'reservoir' && station.currentLevel > 0)
      || (station.type === 'river' && station.waterLevel > 0);
    const hasSecondaryMetric = (station.type === 'reservoir' && Boolean(display.showVolume || display.showInflow || display.showOutflow))
      || (station.type === 'river' && Boolean(display.showFlow || display.showWaterQuality || display.showTemperature));
    const hasSoilMetric = station.type === 'soil' && Boolean(
      display.showAverageMoisture || display.showRelativeMoisture || display.showDepthMoistures || display.showTemperature
    );
    display.hasMonitoringData = Boolean(hasLevelMetric || hasSecondaryMetric || hasSoilMetric);

    display.statusText = this.getStatusText(station.status, station.type);

    return display;
  },

  async loadHistoryData() {
    const { station, chartDays } = this.data;
    if (!station) return;

    let dataType = 'level';
    if (station.type === 'soil') {
      dataType = 'moisture';
    } else if (station.type === 'river') {
      dataType = 'river';
    }

    try {
      // throwOnError：历史数据失败时页面要给出「加载失败」空态，而不是一张静默的空白图
      const historyData = await api.getStationHistory(station.id, dataType, chartDays, { throwOnError: true });
      this.setData({ chartLoadFailed: false });
      if (station.type === 'soil') {
        const soilTrendOptions = buildSoilTrendOptions(historyData);
        if (soilTrendOptions.length === 0 && historyData.some((item) => item.value !== undefined && item.value !== null)) {
          soilTrendOptions.push({ key: 'value', label: '平均含水量', unit: '%', color: '#5f9e3a' });
        }
        const currentTrend = soilTrendOptions.find((item) => item.key === this.data.activeSoilTrend) || soilTrendOptions[0];
        this.setData({
          chartData: historyData,
          soilTrendOptions,
          activeSoilTrend: currentTrend ? currentTrend.key : '',
          activeSoilTrendLabel: currentTrend ? currentTrend.label : '土壤含水量',
          activeSoilTrendUnit: currentTrend ? currentTrend.unit : '%'
        });
      } else if (station.type === 'river') {
        this.setData({
          chartData: historyData,
          riverHasFlow: historyData.some((item) => item.flow !== null && item.flow !== undefined)
        });
      } else {
        // ② 水库：同一份记录里若真带入库/出库序列（且经校验可用），就画成水文过程图；
        // 否则保持原样只画水位单线，界面不升级（106 座里 101 座走这条路径）。
        const process = buildReservoirProcess(historyData);
        this.setData({
          chartData: process.records,
          reservoirHasFlow: process.hasFlow,
          reservoirProcessTitle: process.hasFlow ? '水库水文过程' : '水位趋势'
        });
      }
      if (station.type === 'river') {
        this.drawRiverProcessChart();
      } else if (station.type === 'reservoir' && this.data.reservoirHasFlow) {
        this.drawReservoirProcessChart();
      } else {
        this.drawChart();
      }
    } catch (e) {
      // 失败与「该时段无记录」必须区分：失败给出重试提示（下拉刷新即可重新拉取）
      this.setData({ chartData: [], chartLoadFailed: true });
      console.error('加载历史数据失败', e);
    }
  },

  async drawRiverProcessChart() {
    const { chartData, canvasWidth, canvasHeight, riverHasFlow } = this.data;
    if (!chartData || chartData.length === 0) return;

    const data = chartData.filter((item) => item.waterLevel !== null || item.flow !== null);
    if (data.length === 0) return;

    // canvas type="2d"：取节点是异步的（节点可能尚未渲染，助手内带有限重试），取不到时不画
    let ctx;
    try {
      ctx = await canvas2d.get2dContext(this, '#riverChart', canvasWidth, canvasHeight);
    } catch (e) {
      console.error('riverChart 画布不可用', e);
      return;
    }
    const padding = { top: 30, right: 46, bottom: 38, left: 48 };
    const chartW = canvasWidth - padding.left - padding.right;
    const chartH = canvasHeight - padding.top - padding.bottom;
    const levels = data.map((item) => item.waterLevel).filter((value) => value !== null);
    const flows = data.map((item) => item.flow).filter((value) => value !== null);
    const warnings = data.map((item) => item.warningLevel).filter((value) => value !== null);
    const range = (values) => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const gap = max - min || Math.max(Math.abs(max) * 0.1, 1);
      return { min: min - gap * 0.15, max: max + gap * 0.15 };
    };
    const levelRange = range(levels);
    const flowRange = riverHasFlow ? range(flows) : null;
    const pointX = (index) => padding.left + (chartW / Math.max(data.length - 1, 1)) * index;
    const pointY = (value, axisRange) => padding.top + chartH - ((value - axisRange.min) / (axisRange.max - axisRange.min)) * chartH;

    ctx.strokeStyle = '#eaf1f6';
    ctx.lineWidth = 1;
    ctx.font = 10 + 'px sans-serif';
    for (let index = 0; index <= 4; index++) {
      const y = padding.top + (chartH / 4) * index;
      ctx.beginPath();
      ctx.setLineDash(index === 0 || index === 4 ? [] : [4, 4]);
      ctx.moveTo(padding.left, y);
      ctx.lineTo(canvasWidth - padding.right, y);
      ctx.stroke();
      ctx.fillStyle = '#8aa5b4';
      ctx.textAlign = 'right';
      ctx.fillText((levelRange.max - (levelRange.max - levelRange.min) * index / 4).toFixed(2), padding.left - 8, y + 4);
      if (riverHasFlow) {
        ctx.textAlign = 'left';
        ctx.fillText((flowRange.max - (flowRange.max - flowRange.min) * index / 4).toFixed(2), canvasWidth - padding.right + 8, y + 4);
      }
    }
    ctx.setLineDash([]);

    const drawSeries = (values, axisRange, color, dash = []) => {
      const points = values.map((value, index) => value === null ? null : ({ x: pointX(index), y: pointY(value, axisRange) }));
      ctx.beginPath();
      let started = false;
      points.forEach((point) => {
        if (!point) return;
        if (!started) { ctx.moveTo(point.x, point.y); started = true; }
        else ctx.lineTo(point.x, point.y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
      const showAllPoints = points.length <= 12;
      const isKeyPoint = (index) => {
        if (!points[index]) return false;
        if (index === 0 || index === points.length - 1) return true;
        if (showAllPoints) return true;
        const previous = points[index - 1];
        const next = points[index + 1];
        return previous && next && ((points[index].y < previous.y && points[index].y < next.y)
          || (points[index].y > previous.y && points[index].y > next.y));
      };
      points.forEach((point, index) => {
        if (!isKeyPoint(index)) return;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    };

    drawSeries(data.map((item) => item.waterLevel), levelRange, '#0e9bb8');
    if (riverHasFlow) drawSeries(data.map((item) => item.flow), flowRange, '#0b4f8a');
    if (warnings.length > 0) drawSeries(data.map((item) => item.warningLevel), levelRange, '#d95f5f', [6, 4]);

    ctx.font = 10 + 'px sans-serif';
    ctx.fillStyle = '#7891a4';
    ctx.textAlign = 'left';
    ctx.fillText('水位 (m)', padding.left, 14);
    if (riverHasFlow) {
      ctx.textAlign = 'right';
      ctx.fillText('流量 (m³/s)', canvasWidth - padding.right, 14);
    }
    const labelStep = Math.max(1, Math.ceil(data.length / Math.min(5, Math.floor(chartW / 60))));
    ctx.textAlign = 'center';
    data.forEach((item, index) => {
      if (index % labelStep === 0 || index === data.length - 1) {
        ctx.fillText(item.date, pointX(index), canvasHeight - 10);
      }
    });
  },

  // 水库水文过程：水位（左轴，m）与入库/出库（右轴，m³/s）三条线同图。
  // 必须双轴：水位与流量是两个不同量纲的物理量，同轴不可比（河道过程图同理）；
  // 入库与出库同为 m³/s，共用右侧一套刻度，不各占一轴。
  // 不画「净入/净出」第三条线：该接口的净入本身就是按蓄量变化率算出来的
  //（实测恒为蓄量变化率的整数倍），画上去等于把水位曲线的斜率再画一遍，属于重复指标。
  // 结构沿用河道过程图里已验证的「双侧刻度 + 逐序列画线 + 关键点」写法，不引入新范式。
  async drawReservoirProcessChart() {
    const { chartData, canvasWidth, canvasHeight, reservoirHasFlow } = this.data;
    if (!chartData || chartData.length === 0 || !reservoirHasFlow) return;

    const hasNumber = (value) => value !== null && value !== undefined;
    const data = chartData.filter((item) => hasNumber(item.waterLevel));
    if (data.length === 0) return;

    // 流量序列不存在时直接退出，不发起画布获取（判定为「不该画」时零绘制调用）
    const flows = [];
    data.forEach((item) => {
      if (hasNumber(item.inflow)) flows.push(item.inflow);
      if (hasNumber(item.outflow)) flows.push(item.outflow);
    });
    if (flows.length === 0) return;

    let ctx;
    try {
      ctx = await canvas2d.get2dContext(this, '#levelChart', canvasWidth, canvasHeight);
    } catch (e) {
      console.error('levelChart 画布不可用', e);
      return;
    }
    const padding = { top: 30, right: 46, bottom: 38, left: 48 };
    const chartW = canvasWidth - padding.left - padding.right;
    const chartH = canvasHeight - padding.top - padding.bottom;

    const range = (values) => {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const gap = max - min || Math.max(Math.abs(max) * 0.1, 1);
      return { min: min - gap * 0.15, max: max + gap * 0.15 };
    };
    const levelRange = range(data.map((item) => item.waterLevel));
    const flowRange = range(flows);
    // 入库/出库最小就是 0，为它们加的 15% 留白不该把底部刻度压成负数（曾出现 −179 m³/s）
    if (Math.min(...flows) >= 0 && flowRange.min < 0) flowRange.min = 0;
    // 铜湾这类站的入库能到 1000 m³/s 以上，右侧刻度带两位小数会写不下
    const flowDigits = flowRange.max >= 100 ? 0 : (flowRange.max >= 10 ? 1 : 2);
    const pointX = (index) => padding.left + (chartW / Math.max(data.length - 1, 1)) * index;
    const pointY = (value, axisRange) => padding.top + chartH - ((value - axisRange.min) / (axisRange.max - axisRange.min)) * chartH;

    ctx.strokeStyle = '#eaf1f6';
    ctx.lineWidth = 1;
    ctx.font = 10 + 'px sans-serif';
    for (let index = 0; index <= 4; index++) {
      const y = padding.top + (chartH / 4) * index;
      ctx.beginPath();
      ctx.setLineDash(index === 0 || index === 4 ? [] : [4, 4]);
      ctx.moveTo(padding.left, y);
      ctx.lineTo(canvasWidth - padding.right, y);
      ctx.stroke();
      ctx.fillStyle = '#8aa5b4';
      ctx.textAlign = 'right';
      ctx.fillText((levelRange.max - (levelRange.max - levelRange.min) * index / 4).toFixed(2), padding.left - 8, y + 4);
      ctx.textAlign = 'left';
      ctx.fillText((flowRange.max - (flowRange.max - flowRange.min) * index / 4).toFixed(flowDigits), canvasWidth - padding.right + 8, y + 4);
    }
    ctx.setLineDash([]);

    const drawSeries = (key, axisRange, color) => {
      const points = data.map((item, index) => hasNumber(item[key])
        ? { x: pointX(index), y: pointY(item[key], axisRange) }
        : null);
      ctx.beginPath();
      let started = false;
      points.forEach((point) => {
        if (!point) return;
        if (!started) { ctx.moveTo(point.x, point.y); started = true; }
        else ctx.lineTo(point.x, point.y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();
      // 抽稀后点仍不少，只标首尾与拐点，避免三条线的圆点糊成一片
      const showAllPoints = points.length <= 12;
      const isKeyPoint = (index) => {
        if (!points[index]) return false;
        if (index === 0 || index === points.length - 1) return true;
        if (showAllPoints) return true;
        const previous = points[index - 1];
        const next = points[index + 1];
        return previous && next && ((points[index].y < previous.y && points[index].y < next.y)
          || (points[index].y > previous.y && points[index].y > next.y));
      };
      points.forEach((point, index) => {
        if (!isKeyPoint(index)) return;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    };

    drawSeries('waterLevel', levelRange, '#0e9bb8');
    drawSeries('inflow', flowRange, '#0b4f8a');
    drawSeries('outflow', flowRange, '#7a63c9');

    ctx.font = 10 + 'px sans-serif';
    ctx.fillStyle = '#7891a4';
    ctx.textAlign = 'left';
    ctx.fillText('水位 (m)', padding.left, 14);
    ctx.textAlign = 'right';
    ctx.fillText('入库 / 出库 (m³/s)', canvasWidth - padding.right, 14);

    const labelStep = Math.max(1, Math.ceil(data.length / Math.min(5, Math.floor(chartW / 60))));
    ctx.textAlign = 'center';
    data.forEach((item, index) => {
      if (index % labelStep === 0 || index === data.length - 1) {
        ctx.fillText(item.date, pointX(index), canvasHeight - 10);
      }
    });
  },

  async drawChart() {
    const { station, chartData, canvasWidth, canvasHeight, activeSoilTrend } = this.data;
    if (!chartData || chartData.length === 0) return;
    // 分层视角走多线绘制（10/20/40 同图）；单指标视角沿用下面的单线绘制
    if (station.type === 'soil' && activeSoilTrend === 'layers') {
      this.drawSoilLayersChart();
      return;
    }

    const chartRecords = station.type === 'soil' && activeSoilTrend
      ? chartData.filter((item) => item[activeSoilTrend] !== null && item[activeSoilTrend] !== undefined)
      : chartData;
    if (chartRecords.length === 0) return;

    let ctx;
    try {
      const selector = station.type === 'soil' ? '#moistureChart' : '#levelChart';
      ctx = await canvas2d.get2dContext(this, selector, canvasWidth, canvasHeight);
    } catch (e) {
      console.error('图表画布不可用', e);
      return;
    }

    const padding = { top: 24, right: 16, bottom: 36, left: 48 };
    const chartW = canvasWidth - padding.left - padding.right;
    const chartH = canvasHeight - padding.top - padding.bottom;

    const values = chartRecords.map(d => station.type === 'soil' ? d[activeSoilTrend] : d.value);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const valueRange = maxVal - minVal || 1;
    const yMax = maxVal + valueRange * 0.15;
    const yMin = minVal - valueRange * 0.15;

    // 计算每个数据点的坐标
    const points = chartRecords.map((d, i) => ({
      x: padding.left + (chartW / (chartRecords.length - 1 || 1)) * i,
      y: padding.top + chartH - (((station.type === 'soil' ? d[activeSoilTrend] : d.value) - yMin) / (yMax - yMin)) * chartH,
      value: station.type === 'soil' ? d[activeSoilTrend] : d.value,
      date: d.date
    }));

    // 颜色配置：青黛 v4 色板。土壤曲线取「当前所选指标自身的颜色」，
    // 保证曲线颜色始终与该指标的 chip 颜色一致（此前固定绿色导致与 chip 不符）。
    const soilTrend = station.type === 'soil'
      ? (this.data.soilTrendOptions || []).find((item) => item.key === this.data.activeSoilTrend)
      : null;
    let lineColor = '#0e9bb8';
    if (station.type === 'soil') lineColor = (soilTrend && soilTrend.color) || '#5f9e3a';
    else if (station.type === 'river') lineColor = '#0e9bb8';
    const gradientStart = hexToRgba(lineColor, 0.25);
    const gradientEnd = hexToRgba(lineColor, 0.02);

    // 绘制网格线（虚线）
    ctx.strokeStyle = '#eaf1f6';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      if (i > 0 && i < 4) {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.moveTo(padding.left, y);
      ctx.lineTo(canvasWidth - padding.right, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Y轴标签
    ctx.fillStyle = '#8aa5b4';
    ctx.font = 10 + 'px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      const value = yMax - ((yMax - yMin) / 4) * i;
      ctx.fillText(value.toFixed(1), padding.left - 10, y + 4);
    }

    // X轴标签（根据数据量动态调整，避免重叠）
    ctx.fillStyle = '#8aa5b4';
    ctx.font = 10 + 'px sans-serif';
    ctx.textAlign = 'center';
    const maxLabels = Math.min(7, Math.floor(chartW / 50));
    const labelStep = Math.max(1, Math.ceil(chartRecords.length / maxLabels));
    points.forEach((p, i) => {
      if (i % labelStep === 0 || i === points.length - 1) {
        ctx.fillText(p.date, p.x, canvasHeight - padding.bottom + 18);
      }
    });

    // 渐变填充
    const gradient = ctx.createLinearGradient(0, padding.top, 0, canvasHeight - padding.bottom);
    gradient.addColorStop(0, gradientStart);
    gradient.addColorStop(1, gradientEnd);

    ctx.beginPath();
    ctx.moveTo(points[0].x, canvasHeight - padding.bottom);
    points.forEach((p, i) => {
      if (i === 0) {
        ctx.lineTo(p.x, p.y);
      } else {
        const prev = points[i - 1];
        const cpX = (prev.x + p.x) / 2;
        ctx.quadraticCurveTo(cpX, prev.y, (cpX + p.x) / 2, (prev.y + p.y) / 2);
        ctx.quadraticCurveTo(p.x, (prev.y + p.y) / 2, p.x, p.y);
      }
    });
    ctx.lineTo(points[points.length - 1].x, canvasHeight - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // 绘制平滑折线
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        const prev = points[i - 1];
        const cpX = (prev.x + p.x) / 2;
        ctx.quadraticCurveTo(cpX, prev.y, p.x, p.y);
      }
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 数据点：数据量大时只显示关键点（起点、终点、极值点）
    const showAllPoints = points.length <= 15;
    const isKeyPoint = (i) => {
      if (i === 0 || i === points.length - 1) return true;
      if (showAllPoints) return true;
      const prev = points[i - 1];
      const next = points[i + 1];
      const curr = points[i];
      // 极值点
      if ((curr.y < prev.y && curr.y < next.y) || (curr.y > prev.y && curr.y > next.y)) return true;
      return false;
    };

    points.forEach((p, i) => {
      if (!isKeyPoint(i)) return;
      // 外圈白底
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      // 内圈色点
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
    });

  },

  // 分层含水量：10/20/40cm 三条线同图，共用一套纵轴（同为 %，同轴才可比）。
  // 颜色与上方「分层含水量」进度条一致；图例画在画布顶部，与河道过程图保持一致。
  // 结构沿用河道过程图里已验证的「逐层画线 + 关键点」写法，不引入新的绘制范式。
  async drawSoilLayersChart() {
    const { chartData, canvasWidth, canvasHeight, soilTrendOptions, activeSoilTrend } = this.data;
    if (!chartData || chartData.length === 0) return;
    const option = (soilTrendOptions || []).find((item) => item.key === activeSoilTrend);
    if (!option || !option.series || option.series.length === 0) return;

    const hasNumber = (value) => value !== null && value !== undefined;
    // 只画真的有数据的层，图例同步只列对应颜色，避免图例里出现没有曲线的层
    const data = chartData.filter((item) => option.series.some((layer) => hasNumber(item[layer.key])));
    if (data.length === 0) return;
    const series = option.series.filter((layer) => data.some((item) => hasNumber(item[layer.key])));
    if (series.length === 0) return;

    let ctx;
    try {
      ctx = await canvas2d.get2dContext(this, '#moistureChart', canvasWidth, canvasHeight);
    } catch (e) {
      console.error('moistureChart 画布不可用', e);
      return;
    }
    const padding = { top: 30, right: 16, bottom: 36, left: 48 };
    const chartW = canvasWidth - padding.left - padding.right;
    const chartH = canvasHeight - padding.top - padding.bottom;

    const values = [];
    data.forEach((item) => series.forEach((layer) => {
      if (hasNumber(item[layer.key])) values.push(item[layer.key]);
    }));
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const gap = maxVal - minVal || Math.max(Math.abs(maxVal) * 0.1, 1);
    const yMax = maxVal + gap * 0.15;
    const yMin = minVal - gap * 0.15;
    const pointX = (index) => padding.left + (chartW / Math.max(data.length - 1, 1)) * index;
    const pointY = (value) => padding.top + chartH - ((value - yMin) / (yMax - yMin)) * chartH;

    // 图例：三层颜色 + 深度标签。宽度按标签字符数估算，不依赖 measureText
    ctx.font = 10 + 'px sans-serif';
    let legendX = padding.left;
    series.forEach((layer) => {
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(legendX, 12);
      ctx.lineTo(legendX + 14, 12);
      ctx.stroke();
      ctx.fillStyle = layer.color;
      ctx.textAlign = 'left';
      ctx.fillText(layer.label, legendX + 18, 15);
      legendX += 18 + layer.label.length * 6 + 14;
    });

    // 网格线
    ctx.strokeStyle = '#eaf1f6';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.setLineDash(i > 0 && i < 4 ? [4, 4] : []);
      ctx.moveTo(padding.left, y);
      ctx.lineTo(canvasWidth - padding.right, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 纵轴标签（三层共用一套刻度）
    ctx.fillStyle = '#8aa5b4';
    ctx.font = 10 + 'px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.fillText((yMax - ((yMax - yMin) / 4) * i).toFixed(1), padding.left - 10, y + 4);
    }

    // 横轴标签（根据数据量动态调整，避免重叠）
    ctx.textAlign = 'center';
    const maxLabels = Math.min(7, Math.floor(chartW / 50));
    const labelStep = Math.max(1, Math.ceil(data.length / maxLabels));
    data.forEach((item, index) => {
      if (index % labelStep === 0 || index === data.length - 1) {
        ctx.fillText(item.date, pointX(index), canvasHeight - padding.bottom + 18);
      }
    });

    // 三条曲线：数据点多时只留首尾关键点，避免三色圆点糊成一片
    const showAllPoints = data.length <= 12;
    series.forEach((layer) => {
      const points = data.map((item, index) => hasNumber(item[layer.key])
        ? { x: pointX(index), y: pointY(item[layer.key]) }
        : null);
      ctx.beginPath();
      let started = false;
      points.forEach((point) => {
        if (!point) return;
        if (!started) { ctx.moveTo(point.x, point.y); started = true; }
        else ctx.lineTo(point.x, point.y);
      });
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();
      points.forEach((point, index) => {
        if (!point) return;
        if (!showAllPoints && index !== 0 && index !== points.length - 1) return;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = layer.color;
        ctx.fill();
      });
    });

  },

  setChartDays(e) {
    const days = parseInt(e.currentTarget.dataset.days);
    this.setData({ chartDays: days });
    this.loadHistoryData();
  },

  setSoilTrend(e) {
    const { key, label, unit } = e.currentTarget.dataset;
    this.setData({
      activeSoilTrend: key,
      activeSoilTrendLabel: label,
      activeSoilTrendUnit: unit
    });
    this.drawChart();
  },

  getStatusText(status, type) {
    return getStationStatusText(status, type);
  }
});
