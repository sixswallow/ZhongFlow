const api = require('../../utils/api');
const canvas2d = require('../../utils/canvas2d');

// 天气图标映射：全页唯一来源（此前页面级方法与 processWeatherDisplay 内各有一份重复定义）
const WEATHER_ICON_MAP = {
  '晴': '☀️',
  '多云': '⛅',
  '阴': '☁️',
  '小雨': '🌦️',
  '中雨': '🌧️',
  '大雨': '⛈️',
  '暴雨': '🌩️',
  '雷阵雨': '⛈️',
  '阵雨': '🌦️',
  '小雪': '🌨️',
  '中雪': '❄️',
  '大雪': '🌨️',
  '雾': '🌫️',
  '霾': '😷'
};

const getWeatherIcon = (weather) => {
  for (const key in WEATHER_ICON_MAP) {
    if (weather && weather.includes(key)) return WEATHER_ICON_MAP[key];
  }
  return '🌤️';
};

const util = require('../../utils/util');
const config = require('../../utils/config');
const geoLayer = require('../../utils/geoLayer');
const layerRadar = require('../../utils/layerRadar');
const layerWind = require('../../utils/layerWind');
const { TOWNSHIP_BOUNDARIES } = require('../../utils/townshipBoundaries');
const { REGION_BOUNDARIES } = require('../../utils/regionBoundaries');
const geoDatum = require('../../utils/geoDatum');

// 乡镇级视野（跨度 ≤ 此值）时隐藏邻县：那个尺度下两套边界数据的几百米错位会露出来，
// 而且用户要看的是本县乡镇，邻县反而是干扰。
const REGION_HIDE_SPAN_KM = 40;

// 周边区划（怀化市各区县）：REGION_BOUNDARIES = { source, datum, minSpacingM, regions[] }
// 数据源是 GCJ-02，而本页底图/乡镇边界是 WGS-84
// ⇒ 必须换算成 WGS-84 才画得准。只换算一次并缓存（每帧重算是白烧 CPU）。
// 注意方向：这里是「GCJ-02 → WGS-84」（把外来数据拉回本页的坐标系），
// 不是把本页数据推成 GCJ-02 —— 后者会整体偏 594m（见 tests/map-datum-correction.test.js）。
let REGION_WGS84 = null;
const regionRingsWgs84 = () => {
  if (!REGION_WGS84) {
    REGION_WGS84 = REGION_BOUNDARIES.regions
      .filter((r) => r.self !== true)
      .map((r) => ({
        name: r.name,
        rings: r.rings.map((ring) => ring.map((p) => {
          const w = geoDatum.gcjToWgs(p.longitude, p.latitude);
          return { longitude: w.longitude, latitude: w.latitude };
        })),
        center: r.center ? (function () {
          const w = geoDatum.gcjToWgs(r.center.longitude, r.center.latitude);
          return { longitude: w.longitude, latitude: w.latitude };
        })() : null
      }));
  }
  return REGION_WGS84;
};
const { getTownshipOptions, getTownshipIndex, resolveTownshipLocation } = require('../../utils/locationOptions');
const rainImpact = require('../../utils/rainImpact');

const app = getApp();

// 短临时间标签：同一天只显示 HH:mm（「更新于 14:28」），跨天补月日
function formatIssueTimeText(issueTime) {
  if (!issueTime) return '';
  const m = String(issueTime).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/);
  if (!m) return String(issueTime);
  const now = new Date();
  const today = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  const day = m[1] + '-' + m[2] + '-' + m[3];
  return '更新于 ' + (day === today ? m[4] : m[2] + '-' + m[3] + ' ' + m[4]);
}

// 起始时刻文案：startMinute 现在是真分钟级（0 表示当前就在下）
function startTextOf(t) {
  if (!t || t.willRain !== true) return '暂无降雨';
  if (!(t.startMinute > 0)) return '当前正在降雨';
  return t.startMinute + '分钟后开始降雨';
}

// 短临按需加载：5 分钟内重复展开不重复请求（上游分钟级数据本身是 5 分钟一档）
const NOWCAST_FRESH_MS = 5 * 60 * 1000;

Page({
  data: {
    location: {
      city: '中方县',
      latitude: 27.509196,
      longitude: 110.115186
    },
    weather: {
      current: {},
      hourly: [],
      daily: [],
      minute: {
        // 占位值绝不能说「无降水」：取不到就显示「不可用」（假阴性比空白更危险）
        available: false,
        summary: '',
        stepMinutes: 1,
        source: '',
        reason: '',
        legendText: '',
        precipitation: []
      }
    },
    nowcast: {
      townships: [],
      sourceLabel: '',
      issueTime: '',
      issueTimeText: '',
      integrityText: '',
      degraded: false,
      note: ''
    },
    canvasWidth: 320,
    canvasHeight: 160,
    weatherProviderName: '彩云天气',
    weatherStatus: 'loading',
    weatherErrorMessage: '',
    // 短临按需获取：idle 表示「尚未取数」，不是「没有降雨」，也不是「数据缺失」
    nowcastStatus: 'idle',
    nowcastExpanded: false,
    nowcastErrorMessage: '',
    rainImpact: { ready: false, empty: false, spans: [], gradeText: '', tone: 'none', peakText: '', centerText: '', metaText: '', tip: '' },
    // 雨量柱图例：满格口径来自 utils/rainImpact.js 的 BAR_FULL_MM，界面不另写 16mm
    hourBarLegend: '',
    // —— 气象图层（雷达回波 / 风向风速）——
    layerMode: 'radar',
    layerStatus: 'loading',
    layerSpanText: '',
    layerZoomHint: '',
    layerErrorText: '',
    layerCanvasWidth: 320,
    layerCanvasHeight: 294,
    layerTimeText: '',
    layerSubtitle: '过去 2 小时回波',
    radarFrames: [],
    radarFrameIndex: 0,
    isLayerPlaying: false,
    windSummary: '',
    townshipOptions: getTownshipOptions(),
    townshipIndex: 0,
    // 气象图层的取景范围：全县 or 某个乡镇（乡镇级才看得清回波落在哪个乡镇）
    layerScopeIndex: 0,
    layerScope: '中方县（全县）',
    layerGridText: '',
  },

  onLoad() {
    const systemInfo = wx.getWindowInfo();
    this.setData({ statusBarHeight: systemInfo.statusBarHeight });

    const location = app.globalData.location;
    if (location) {
      this.setData({ location, townshipIndex: getTownshipIndex(location) });
    }

    const providerMap = {
      caiyun: '彩云天气',
      qweather: '和风天气',
      moji: '墨迹天气'
    };
    this.setData({
      weatherProviderName: providerMap[config.WEATHER_PROVIDER] || '彩云天气',
      hourBarLegend: rainImpact.barLegendText()
    });

    this.calculateCanvasSize();
    this.calculateLayerCanvasSize();
    this.loadAllData();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    // 全局定位回读：首页/地图选了别的乡镇，进来时实况与雷达/风场图层都取景过去
    const location = app.globalData.location;
    if (location) {
      const idx = getTownshipIndex(location);
      if (idx !== this.data.townshipIndex) {
        const loc = resolveTownshipLocation(this.data.townshipOptions[idx]);
        this.setData({ location: loc, townshipIndex: idx });
        // 图层取景跟着定位走（onLayerScope 内部的 syncWeatherLocation 会因同乡镇早退，不会重复请求）
        this.onLayerScope({ detail: { value: idx } });
        this.loadAllData();
      }
    }
    // 回到页面时恢复风场动画（离开时已停止，避免后台空转）
    if (this.data.layerMode === 'wind' && this.windField && this.layerNode) this.startWindLoop();
  },

  onHide() {
    this.stopLayerPlay();
    this.stopWindLoop();
    if (this.viewSyncTimer) { clearTimeout(this.viewSyncTimer); this.viewSyncTimer = null; }
  },

  onPullDownRefresh() {
    this.loadAllData().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 刷新「已经展示出来的东西」：天气必刷；短临只在用户已经展开过时才跟着刷。
  // 短临是 12 个乡镇 = 12 次请求，页面打开时不主动取，避免无谓消耗上游额度。
  async loadAllData() {
    this.setData({ weatherStatus: 'loading', weatherErrorMessage: '', nowcastErrorMessage: '' });
    util.showLoading('加载中...');
    try {
      const weatherLoaded = await this.loadWeather();
      if (weatherLoaded) this.initLayer();
      if (this.data.nowcastExpanded && !this.nowcastFresh()) await this.loadNowcast();
    } finally {
      util.hideLoading();
    }
  },

  // 短临新鲜度：上游分钟级数据本身 5 分钟一档，5 分钟内重复展开不再产生请求
  // （云函数侧同样按窗口缓存，这里再挡一道，省下的是实打实的调用次数）
  nowcastFresh() {
    return this.data.nowcastStatus === 'success'
      && !!this.nowcastLoadedAt
      && (Date.now() - this.nowcastLoadedAt) < NOWCAST_FRESH_MS;
  },

  // 展开 / 收起：短临唯一的取数入口。收起只隐藏，不丢数据、也不重新请求。
  onToggleNowcast() {
    if (this.data.nowcastExpanded) {
      this.setData({ nowcastExpanded: false });
      return;
    }
    this.setData({ nowcastExpanded: true }, () => {
      if (this.data.nowcastStatus === 'success' && this.nowcastFresh()) return;
      this.loadNowcast();
    });
  },

  // 短临卡片里的「重试」：只重取短临，不连带刷新天气
  onNowcastRefresh() {
    if (!this.data.nowcastExpanded) {
      this.setData({ nowcastExpanded: true }, () => this.loadNowcast());
      return;
    }
    this.loadNowcast();
  },

  calculateCanvasSize() {
    const systemInfo = wx.getWindowInfo();
    const canvasWidth = systemInfo.windowWidth - 104;
    const canvasHeight = 160;
    this.setData({ canvasWidth, canvasHeight });
  },

  calculateLayerCanvasSize() {
    const systemInfo = wx.getWindowInfo();
    // 卡片态：画布铺满卡片内容区（页面 24rpx + 卡片 28rpx + 外壳 8rpx）
    const gutter = (24 + 28 + 8) * 2 * (systemInfo.windowWidth / 750);
    const width = Math.round(systemInfo.windowWidth - gutter);
    // 全屏态：左右只留 24rpx，纵向略高一点（县域形状偏方，竖一点更耐看）
    this.cardCanvasWidth = width;
    this.cardCanvasHeight = Math.round(width * 0.92);
    this.fsCanvasWidth = Math.round(systemInfo.windowWidth - 24);
    this.fsCanvasHeight = Math.round(this.fsCanvasWidth * 1.06);
    this.windowWidth = systemInfo.windowWidth;
    this.setData({ layerCanvasWidth: width, layerCanvasHeight: this.cardCanvasHeight });
  },

  async loadWeather() {
    try {
      const { latitude, longitude } = this.data.location;
      const weather = await api.getWeather(latitude, longitude);
      if (!weather) throw new Error('天气数据未返回有效内容');

      const processed = this.processWeatherDisplay(weather);
      this.setData({ weather: processed, weatherStatus: 'success', weatherErrorMessage: '' });
      app.globalData.weatherData = processed;
      this.drawRainChart();
      this.updateRainImpact();
      return true;
    } catch (e) {
      const reason = typeof api.describeError === 'function' ? api.describeError(e) : '';
      this.setData({
        weatherStatus: 'error',
        weatherErrorMessage: '暂未获取到天气数据' + (reason ? '（' + reason + '）' : '') + '，请点击刷新重试'
      });
      console.error('加载天气数据失败：' + reason, e);
      return false;
    }
  },

  // 未来降雨影响：逐小时预报求和 + 短临雨中心，纯前端计算（无需改云函数）。
  // 天气与短临是两条独立链路，任一完成都要重算——雨中心来自短临。
  updateRainImpact() {
    const hourly = (this.data.weather && this.data.weather.hourly) || [];
    const townships = (this.data.nowcast && this.data.nowcast.townships) || [];
    this.setData({ rainImpact: rainImpact.buildRainImpact(hourly, townships) });
  },

  processWeatherDisplay(weather) {
    const result = { ...weather };
    // 分钟级降水三态：真拿到序列才 available；否则明确「暂不可用」，绝不给「无降水」结论
    const minute = result.minute || {};
    const minuteSeries = minute.precipitation || [];
    const minuteReady = !!minute.available && minuteSeries.length > 0;
    // 粒度与来源都跟着上游走：和风是 5 分钟一档，彩云是 1 分钟一档，纵轴单位是 mm/h（强度）。
    // 旧图例写「逐分钟降水量（mm）」既不真（彩云给的是强度）也不分源。
    const minuteStep = Number(minute.stepMinutes) > 0 ? Number(minute.stepMinutes) : 1;
    const minuteSource = minute.source === 'qweather' ? '和风天气' : (minute.source === 'caiyun' ? '彩云天气' : '');
    result.minute = {
      available: minuteReady,
      stepMinutes: minuteStep,
      source: minute.source || '',
      summary: minuteReady && minute.summary ? minute.summary : '分钟级数据暂不可用',
      // 取不到时把上游原因带上（未配密钥 / 限流 / 超时 / 无该接口权限），不写「无降水」这类结论
      reason: minuteReady ? '' : (minute.reason || ''),
      // 图例一句话说清柱子含义即可；数据来源页脚已有，不再重复
      legendText: '柱高为' + (minuteStep >= 5 ? ' 5 分钟档' : '逐分钟') + '降水强度（mm/h）',
      precipitation: minuteSeries
    };
    if (result.current) {
      result.current = { ...result.current, weatherIcon: getWeatherIcon(result.current.weather) };
    }
    if (result.hourly && result.hourly.length > 0) {
      result.hourly = result.hourly.map(h => ({
        ...h,
        weatherIcon: getWeatherIcon(h.weather),
        // 雨量柱：柱高按小时雨强归一化、配色按强度分档（模板直接用，不在 WXML 里算）
        rainBar: rainImpact.barPercent(h.rain),
        rainLevel: rainImpact.levelOf(h.rain),
        // 无雨 / 未取到时不画那个空槽（轨道仍占位，六列气温才不会错行）
        rainQuiet: !(h.rain > 0),
        // 云函数给 rainKnown=false 表示「上游没给这一小时的雨量」，与 0mm 不是一回事
        rainKnown: h.rainKnown !== false
      }));
    }
    if (result.daily && result.daily.length > 0) {
      result.daily = result.daily.map(d => {
        // 降雨概率只在数据源真的给了才显示。和风的逐日不一定给概率，
        // 云函数不会拿降水量去反推概率，这里再兜一道：不是有限数就是 null，
        // 模板据此显示「--」，绝不把毫米数当百分比打出去。
        const prob = typeof d.rainProb === 'number' && isFinite(d.rainProb) ? d.rainProb : null;
        return {
          ...d,
          rainProb: prob,
          hasRainProb: prob !== null,
          dayWeatherIcon: getWeatherIcon(d.dayWeather),
          nightWeatherIcon: getWeatherIcon(d.nightWeather)
        };
      });
    }
    return result;
  },

  async drawRainChart() {
    const { weather, canvasWidth, canvasHeight } = this.data;
    const precipitation = (weather.minute && weather.minute.precipitation) || [];
    
    if (precipitation.length === 0) return;

    let ctx;
    try {
      ctx = await canvas2d.get2dContext(this, '#rainChart', canvasWidth, canvasHeight);
    } catch (e) {
      console.error('rainChart 画布不可用', e);
      return;
    }
    
    // 左边距要放得下「10mm/h」这类刻度（换成 mm/h 后比「10mm」更宽，40 会把顶格裁掉）
    const padding = { top: 20, right: 10, bottom: 25, left: 54 };
    const chartW = canvasWidth - padding.left - padding.right;
    const chartH = canvasHeight - padding.top - padding.bottom;

    const values = precipitation.map(d => d.value || 0);
    const maxVal = Math.max(...values, 10);
    
    ctx.strokeStyle = '#eaf1f6';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padding.top + (chartH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(canvasWidth - padding.right, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#8aa5b4';
    ctx.font = 10 + 'px sans-serif';
    ctx.textAlign = 'right';
    const yLabels = [maxVal.toFixed(0), (maxVal * 2/3).toFixed(0), (maxVal / 3).toFixed(0), '0'];
    yLabels.forEach((label, i) => {
      const y = padding.top + (chartH / 3) * i;
      ctx.fillText(label + 'mm/h', padding.left - 6, y + 4);
    });

    const labelCount = Math.min(6, precipitation.length);
    const labelStep = Math.floor(precipitation.length / (labelCount - 1));
    ctx.fillStyle = '#8aa5b4';
    ctx.font = 10 + 'px sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < precipitation.length; i += labelStep) {
      const x = padding.left + (chartW / (precipitation.length - 1)) * i;
      const timeStr = precipitation[i].time || '';
      ctx.fillText(timeStr, x, canvasHeight - padding.bottom + 16);
    }

    ctx.beginPath();
    precipitation.forEach((d, i) => {
      const x = padding.left + (chartW / (precipitation.length - 1)) * i;
      const val = d.value || 0;
      const barHeight = (val / maxVal) * chartH;
      const y = padding.top + chartH - barHeight;
      
      const gradient = ctx.createLinearGradient(x, y, x, padding.top + chartH);
      gradient.addColorStop(0, '#0b4f8a');
      gradient.addColorStop(1, '#9fd8ef');
      
      // 标准 2d 上下文直接支持属性赋值与 CanvasGradient（旧版 CanvasContext 只认 setFillStyle 方法的坑已随迁移消失）
      ctx.fillStyle = gradient;
      const barWidth = Math.max(2, chartW / precipitation.length - 2);
      ctx.fillRect(x - barWidth / 2, y, barWidth, barHeight);
    });

  },


  onTownshipChange(e) {
    const index = Number(e.detail.value);
    const newLocation = resolveTownshipLocation(this.data.townshipOptions[index]);
    
    // ★ 与气象图层联动：顶部选了乡镇，图层也取景到同一个乡镇（首次可能早于图层就绪，返回即可）
    this.setData({ location: newLocation, townshipIndex: index });
    this.onLayerScope({ detail: { value: index } });
    app.setLocation(newLocation);
    this.loadAllData();
  },

  async loadNowcast() {
    this.nowcastFailReason = "";
    // 展开后立刻给「正在获取」的反馈：12 个乡镇串行取数本身就慢
    if (this.data.nowcastStatus !== 'loading') this.setData({ nowcastStatus: 'loading' });
    try {
      const nowcast = await api.getNowcast();
      const list = (nowcast && Array.isArray(nowcast.townships)) ? nowcast.townships : [];
      // 全部乡镇取数失败时必须按「数据缺失」处理，绝不降级展示成「全县无降雨」
      if (!nowcast || nowcast.success === false || !list.length) {
        // 云函数会带回失败原因（限流 / 超时 / 无权限 / 字段缺失），先记下再抛错
        this.nowcastFailReason = (nowcast && nowcast.failedReason) || "";
        throw new Error('短临预报数据获取失败');
      }
      const total = nowcast.townshipCount || list.length;
      const failed = typeof nowcast.failedCount === 'number'
        ? nowcast.failedCount
        : list.filter(t => t && t.ok === false).length;
      // 数据来源标签：短临可能来自和风（1km/5 分钟）而实况来自彩云，界面必须说清哪一段是谁给的
      const nowcastSourceLabel = nowcast.source === 'qweather'
        ? '和风天气'
        : (nowcast.source === 'caiyun' ? '彩云天气' : '');
      const processed = {
        ...nowcast,
        sourceLabel: nowcastSourceLabel,
        issueTimeText: formatIssueTimeText(nowcast.issueTime),
        degraded: failed > 0,
        failedReasonText: failed > 0 && nowcast.failedReason ? '失败原因：' + nowcast.failedReason : '',
        integrityText: failed > 0
          ? total + ' 个乡镇中 ' + failed + ' 个取数失败，缺失乡镇已标注为数据缺失'
          : total + ' 个乡镇数据正常',
        townships: list.map(t => {
          const okTown = !!t && t.ok !== false;
          return {
            ...t,
            dataMissing: !okTown,
            ok: okTown,
            // 概率只在数据源真的给了概率序列时才显示（和风不提供概率，界面就不该出现百分比）
            hasProb: okTown && t.hasProbability === true && t.peakProb !== null && t.peakProb !== undefined,
            peakProbPercent: okTown && t.hasProbability === true ? Math.round((t.peakProb || 0) * 100) : 0,
            totalRainText: okTown ? (t.totalRain || 0).toFixed(1) : '',
            startText: okTown ? startTextOf(t) : '',
            peakMinuteText: okTown && t.willRain && t.peakMinute !== null && t.peakMinute !== undefined
              ? t.peakMinute + '分'
              : (okTown ? '—' : '')
          };
        })
      };
      this.setData({ nowcast: processed, nowcastStatus: 'success' });
      this.nowcastLoadedAt = Date.now();
      this.updateRainImpact();
      return true;
    } catch (e) {
      // 云函数带回来的原因比「短临预报数据获取失败」这句话更具体，优先用它
      const reason = this.nowcastFailReason || (typeof api.describeError === 'function' ? api.describeError(e) : '');
      this.nowcastFailReason = "";
      this.setData({ nowcastStatus: 'error', nowcastErrorMessage: reason ? '原因：' + reason : '' });
      console.error('加载短临预报失败：' + reason, e);
      return false;
    }
  },

  // ==================== 气象图层（雷达回波 / 风向风速） ====================
  // 数据源：RainViewer 雷达 + Open-Meteo 风场（实测结论见 utils/layerRadar.js 顶部注释）
  // 绘制：烘焙底图 + 距离环 + 图层内容；canvas type="2d" 为同层渲染，无需 cover-view

  initLayer() {
    // 卡片在 weatherStatus === 'success' 之后才渲染，必须等下一帧再取 canvas 节点
    wx.nextTick(() => {
      this.setupLayerCanvas()
        .then(() => this.refreshLayerData(true))
        .catch((err) => {
          console.error('初始化气象图层失败', err);
          this.setData({ layerStatus: 'error', layerErrorText: '图层画布初始化失败，请重试' });
        });
    });
  },

  setupLayerCanvas() {
    const { layerCanvasWidth: width, layerCanvasHeight: height } = this.data;
    return new Promise((resolve, reject) => {
      // rect 用于把手势的 clientX/clientY 换算成画布内归一化坐标（捏合锚点）
      wx.createSelectorQuery().select('#layerCanvas').fields({ node: true, size: true, rect: true }).exec((res) => {
        const item = res && res[0];
        const node = item && item.node;
        if (!node) { reject(new Error('未取到 canvas 节点')); return; }
        const dpr = Math.min(3, Math.max(1, wx.getWindowInfo().pixelRatio || 2));
        node.width = Math.round(width * dpr);
        node.height = Math.round(height * dpr);
        const ctx = node.getContext('2d');
        ctx.scale(dpr, dpr); // 之后一律按 CSS 像素坐标绘制
        ctx.lineJoin = 'round';
        this.layerNode = node;
        this.layerCtx = ctx;
        this.layerDpr = dpr;
        this.layerRect = { left: item.left || 0, top: item.top || 0 };
        // 首次进入按当前定位取景（全局选了乡镇就直接取景到该乡镇，而不是先全县）；
        // 之后（全屏切换、尺寸变化）保留中心与跨度，只按新宽高比重算——
        // 否则卡片与全屏比例不同会把底图和站点拉长。
        if (!this.layerView) {
          const idx = this.data.townshipIndex;
          const scopeName = this.data.townshipOptions[idx];
          let view = geoLayer.viewForCounty(width / height);
          if (idx > 0) {
            const t = TOWNSHIP_BOUNDARIES.filter((item) => item.name === scopeName)[0];
            if (t && t.bounds) view = geoLayer.fitView(t.bounds, width / height, 1.18);
          }
          this.layerView = geoLayer.clampView(view, geoLayer.BAKE_BOUNDS);
          if (idx !== this.data.layerScopeIndex) {
            this.setData({ layerScopeIndex: idx, layerScope: scopeName });
          }
        } else {
          this.layerView = geoLayer.applyAspect(this.layerView, width / height);
        }
        this.layerView = geoLayer.clampView(this.layerView, geoLayer.BAKE_BOUNDS);
        this.layerProjector = geoLayer.makeProjector(this.layerView, width, height);
        this.updateWindSampler();
        this.tileCache = this.tileCache || layerRadar.createCache(60);
        this.downloadQueue = this.downloadQueue || [];
        this.activeDownloads = this.activeDownloads || 0;
        this.isWindRunning = false;
        this.radarDrawn = 0;
        this.radarPending = 0;
        this.loadBasemapImage().then(() => {
          this.drawLayer();
          this.updateSpanText();
          this.updateLayerHint();
          resolve(true);
        });
      });
    });
  },

  loadBasemapImage() {
    return new Promise((resolve) => {
      if (!this.layerNode) { resolve(false); return; }
      const img = this.layerNode.createImage();
      img.onload = () => { this.basemapImage = img; resolve(true); };
      img.onerror = () => { console.error('烘焙底图加载失败'); resolve(false); };
      img.src = '/assets/basemap/zhongfang.png';

      // 地形晕渲：与底图**同一范围**（烘焙时就按 BAKE_BOUNDS 对齐），所以能用同一个矩形叠加。
      // 目的是让值班能靠地形判断位置（山谷、山脊、河谷走向）。
      const shade = this.layerNode.createImage();
      shade.onload = () => { this.hillshadeReady = true; if (this.layerView) this.drawLayer(); };
      shade.onerror = () => { this.hillshadeReady = false; };
      shade.src = '/assets/basemap/hillshade.png';
      this.hillshadeImage = shade;
    });
  },

  requestLayer(url) {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        timeout: 12000,
        success: (res) => (res.statusCode === 200 ? resolve(res.data) : reject(new Error('HTTP ' + res.statusCode))),
        fail: (err) => reject(new Error((err && err.errMsg) || '网络请求失败'))
      });
    });
  },

  refreshLayerData(force) {
    if (this.data.layerMode === 'radar') this.loadRadarFrames(force);
    else this.loadWindField(force);
  },

  onLayerMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.layerMode) return;
    this.stopLayerPlay();
    this.stopWindLoop();
    this.windField = null;
    this.setData({ layerMode: mode, layerStatus: 'loading', layerErrorText: '' }, () => {
      this.drawLayer();
      this.updateLayerHint();
      this.refreshLayerData(true);
    });
  },

  onLayerRetry() {
    this.setData({ layerStatus: 'loading', layerErrorText: '' }, () => {
      this.drawLayer();
      this.refreshLayerData(true);
    });
  },

  // ---------------- 雷达回波 ----------------
  async loadRadarFrames(force) {
    const fresh = this.radarFramesAt && Date.now() - this.radarFramesAt < 5 * 60 * 1000;
    if (!force && fresh && this.data.radarFrames.length) return;
    this.setData({ layerStatus: 'loading', layerErrorText: '' });
    try {
      const meta = await this.requestLayer(layerRadar.RADAR.META_URL);
      const frames = layerRadar.buildFrames(meta);
      if (!frames.length) throw new Error('未返回雷达帧');
      this.radarHost = meta.host || 'https://tilecache.rainviewer.com';
      this.radarFramesAt = Date.now();
      const last = frames.length - 1;
      this.setData({
        radarFrames: frames,
        radarFrameIndex: last,
        layerStatus: 'ready',
        layerTimeText: frames[last].time,
        layerSubtitle: '过去 2 小时回波'
      }, () => {
        this.ensureFrameTiles(last);
        this.drawLayer();
      });
    } catch (err) {
      console.error('雷达帧获取失败', err);
      this.setData({ layerStatus: 'error', layerErrorText: '雷达数据暂不可用，请检查网络与合法域名配置' });
      this.drawLayer();
    }
  },

  ensureFrameTiles(index) {
    const frames = this.data.radarFrames;
    if (!this.radarHost || !frames.length || !this.layerNode) return;
    const frame = frames[layerRadar.clampIndex(index, frames.length)];
    if (!frame) return;
    const plan = layerRadar.planFrameTiles(
      this.radarHost, frame, this.layerView,
      { width: this.data.layerCanvasWidth, height: this.data.layerCanvasHeight },
      this.data.layerCanvasWidth * (this.layerDpr || 2),
      this.radarTileOptions()
    );
    plan.tiles.forEach((tile) => this.queueTile(tile));
  },

  queueTile(tile) {
    if (!this.tileCache || this.tileCache.has(tile.key)) return;
    this.tileCache.set(tile.key, { status: 'loading' });
    this.downloadQueue.push(tile);
    this.pumpDownloads();
  },

  pumpDownloads() {
    const MAX = 4; // 真机并发上限，避免拖时间轴时把网络打满
    while (this.activeDownloads < MAX && this.downloadQueue.length) {
      const tile = this.downloadQueue.shift();
      this.activeDownloads++;
      wx.downloadFile({
        url: tile.url,
        timeout: 15000,
        success: (res) => {
          if (res.statusCode !== 200 || !this.layerNode) {
            this.tileCache.set(tile.key, { status: 'error' });
            return;
          }
          const img = this.layerNode.createImage();
          img.onload = () => {
            this.tileCache.set(tile.key, { status: 'ok', img });
            if (this.data.layerMode === 'radar' && !this.isWindRunning) this.drawLayer();
          };
          img.onerror = () => this.tileCache.set(tile.key, { status: 'error' });
          img.src = res.tempFilePath;
        },
        fail: () => this.tileCache.set(tile.key, { status: 'error' }),
        complete: () => { this.activeDownloads--; this.pumpDownloads(); }
      });
    }
  },

  toggleLayerPlay() {
    if (this.data.isLayerPlaying) { this.stopLayerPlay(); return; }
    const { radarFrames, radarFrameIndex } = this.data;
    if (radarFrames.length < 2) return;
    // 停在最后一帧时再按播放：先回到第一帧，从头播
    if (radarFrameIndex >= radarFrames.length - 1) {
      const frame = radarFrames[0];
      this.setData({ radarFrameIndex: 0, layerTimeText: frame.time }, () => {
        this.ensureFrameTiles(0);
        this.drawLayer();
      });
    }
    this.layerTimer = setInterval(() => this.nextRadarFrame(), 1200);
    this.setData({ isLayerPlaying: true });
  },

  stopLayerPlay() {
    if (this.layerTimer) clearInterval(this.layerTimer);
    this.layerTimer = null;
    if (this.data.isLayerPlaying) this.setData({ isLayerPlaying: false });
  },

  nextRadarFrame() {
    // 播放到最后一帧：自动停在最新回波并暂停（不循环，结尾明确）
    if (this.isWindMode() && (this.windFrames || []).length) {
      this.setWindFrame(this.windFrameIdx + 1);
      return;
    }
    const { radarFrames, radarFrameIndex } = this.data;
    if (radarFrameIndex >= radarFrames.length - 1) {
      this.stopLayerPlay();
      return;
    }
    const next = layerRadar.nextIndex(radarFrameIndex, radarFrames.length);
    this.setData({
      radarFrameIndex: next,
      layerTimeText: radarFrames[next] ? radarFrames[next].time : ''
    }, () => {
      this.ensureFrameTiles(next);
      this.ensureFrameTiles(layerRadar.nextIndex(next, radarFrames.length)); // 预取下一帧
      this.drawLayer();
    });
  },

  // 进度条拖动中：实时预览帧（顺带暂停播放，避免定时器与拖动抢帧）
  onRadarSlideChanging(e) {
    this.stopLayerPlay();
    this.scrubRadarFrame(e.detail.value);
  },

  // 松手落定：与拖动同一处理
  onRadarSlideChange(e) {
    this.scrubRadarFrame(e.detail.value);
  },

  scrubRadarFrame(index) {
    // 风场模式复用同一条进度条逻辑，落到对应小时帧
    if (this.isWindMode() && (this.windFrames || []).length) {
      this.setWindFrame(Number(index));
      return;
    }
    const i = layerRadar.clampIndex(Number(index), this.data.radarFrames.length);
    const frame = this.data.radarFrames[i];
    if (!frame) return;
    this.setData({ radarFrameIndex: i, layerTimeText: frame.time }, () => {
      this.ensureFrameTiles(i);
      this.drawLayer();
    });
  },

  // ---------------- 风向风速 ----------------
  async loadWindField(force, view) {
    const target = view || this.layerView;
    if (!target) return;
    const fresh = this.windAt && Date.now() - this.windAt < layerWind.WIND.TTL;
    const covered = layerWind.fieldCovers(this.windField, target, 0.02);
    const dense = !layerWind.needsDenserGrid(this.windField, target, 2.2);
    if (!force && fresh && covered && dense) { this.startWindLoop(); return; }
    this.stopWindLoop();
    this.setData({ layerStatus: 'loading', layerErrorText: '' });
    try {
      // 取样范围比视窗大一圈：小幅平移不必重新请求
      const box = geoLayer.expandView(target, 1.3, geoLayer.BAKE_BOUNDS);
      const points = layerWind.buildPoints(box);
      // ★ 逐小时：一次请求拿回未来若干小时的整片网格（风场有未来数据，雷达回波没有）
      const data = await this.requestLayer(layerWind.buildHourlyUrl(points));
      const parsed = layerWind.parseHourly(data, undefined, undefined, box, Date.now());
      this.windFrames = parsed.frames || [];
      this.windFrameIdx = 0;
      this.windField = this.windFrames.length ? this.windFrames[0].field : null;
      this.windScale = layerWind.scaleForField(this.windField || { minSpeed: 0, maxSpeed: 0 });
      const mean = layerWind.meanVector(this.windField);
      if (!this.windField) throw new Error('风场没有可用时段');
      this.publishWindFrame();
      this.windAt = Date.now();
      this.windBucket = layerWind.spanBucket(geoLayer.viewSpanKm(target));
      this.particles = null;
      this.updateWindSampler();
      this.setData({
        layerStatus: 'ready',
        // 时间轴文案由 publishWindFrame() 负责（现在 / +N 小时），这里只给一句平均风概要
        layerSubtitle: '平均风 ' + mean.label + ' ' + mean.speed.toFixed(1) + ' m/s（' + layerWind.beaufort(mean.speed) +
          ' 级）· 未来 ' + (this.windFrames.length - 1) + ' 小时可播放'
      }, () => {
        this.updateSpanText();
        this.updateLayerHint();
        this.startWindLoop();
      });
    } catch (err) {
      console.error('风场获取失败', err);
      this.setData({ layerStatus: 'error', layerErrorText: '风场数据暂不可用，请检查网络与合法域名配置' });
      this.drawLayer();
    }
  },

  // 风场帧 → 界面文案（「现在 15:00」/「+3 小时 18:00」）
  publishWindFrame() {
    const frame = (this.windFrames || [])[this.windFrameIdx];
    if (!frame) return;
    const when = (frame.label === '现在' ? '现在 ' : frame.label + ' ') + (frame.time || '').slice(11, 16);
    this.setData({
      windSummary: when,
      layerTimeText: when
    });
  },

  // 切到风场某一帧：只换场、不重建粒子 ⇒ 动画连续
  setWindFrame(index) {
    const frames = this.windFrames || [];
    if (!frames.length) return;
    const i2 = ((index % frames.length) + frames.length) % frames.length;
    this.windFrameIdx = i2;
    this.windField = frames[i2].field;
    this.windScale = layerWind.scaleForField(this.windField);
    this.publishWindFrame();
    if (this.layerNode) this.drawLayer();
  },

  startWindLoop() {
    if (!this.layerNode || this.data.layerMode !== 'wind' || !this.windField) return;
    this.stopWindLoop();
    const { layerCanvasWidth: w, layerCanvasHeight: h } = this.data;
    if (!this.particles) {
      this.particles = layerWind.createParticles(
        layerWind.particleCountFor(w, h), w, h, Math.random, layerWind.WIND.TRAIL_LEN
      );
    }
    let last = Date.now();
    const tick = () => {
      if (this.data.layerMode !== 'wind' || !this.layerNode) { this.layerRaf = null; return; }
      const now = Date.now();
      const dt = Math.min(0.06, Math.max(0.008, (now - last) / 1000));
      last = now;
      layerWind.advanceParticles(this.particles, this.windSampler, dt, w, h);
      this.drawWindFrame();
      this.layerRaf = this.layerNode.requestAnimationFrame(tick);
    };
    this.isWindRunning = true;
    this.layerRaf = this.layerNode.requestAnimationFrame(tick);
  },

  stopWindLoop() {
    if (this.layerRaf && this.layerNode && this.layerNode.cancelAnimationFrame) {
      this.layerNode.cancelAnimationFrame(this.layerRaf);
    }
    this.layerRaf = null;
    this.isWindRunning = false;
  },

  // ---------------- 全屏查看：缩放 / 平移 ----------------

  // 重定位：把视野拉回县域正中。若当前比「能看全县域」还近，
  // 则退回到能看全县域的那一档，保证按一下一定看得到县域；
  // 本来就看得更远时只回中，不动缩放倍数。
  // ——— 「乡镇」取景 ———
  // 为什么需要：县域 73×53km，免费档回波 1km 一格在 375px 屏上只有 1.9px，看不出落区。
  // 收到乡镇级（8~23km）后 1 格变成 15~37px，这才叫「看得出每个乡镇的大致情况」。
  onLayerScope(e) {
    const index = Number(e.detail && e.detail.value);
    const options = this.data.townshipOptions;
    if (!isFinite(index) || index < 0 || index >= options.length) return;
    if (!this.layerView) return;
    const name = options[index];
    const aspect = this.data.layerCanvasWidth / this.data.layerCanvasHeight;
    let view = geoLayer.viewForCounty(aspect);
    if (index > 0) {
      const t = TOWNSHIP_BOUNDARIES.filter((item) => item.name === name)[0];
      if (!t || !t.bounds) return;
      view = geoLayer.fitView(t.bounds, aspect, 1.18);
    }
    this.layerView = geoLayer.clampView(view, geoLayer.BAKE_BOUNDS);
    
    // ★ 与顶部实况联动：同一乡镇（「全县」＝县城中心）
    this.setData({ layerScopeIndex: index, layerScope: name });
    this.syncWeatherLocation(index, name);
    this.applyViewChange(true);
  },

  // 当前把原始瓦片放大了几倍（取瓦片层级与是否插值都看它）
  currentUpscale() {
    if (!this.layerView) return 1;
    const px = this.data.layerCanvasWidth * (this.layerDpr || 2);
    const zoom = geoLayer.pickZoom(this.layerView, px);
    const srcPx = (this.layerView.east - this.layerView.west) * ((256 * Math.pow(2, zoom)) / 360);
    return srcPx > 0 ? px / srcPx : 1;
  },

  // 所有取瓦片的地方都过这里：同一次渲染只允许一种插值策略
  radarTileOptions() {
    return layerRadar.optionsForUpscale(this.currentUpscale());
  },

  // 如实标注分辨率：一格 1km，当前一格拉到多少像素
  updateLayerGridText() {
    if (!this.layerView) return;
    const px = this.data.layerCanvasWidth * (this.layerDpr || 2);
    const text = layerRadar.radarGridText(geoLayer.viewSpanKm(this.layerView), px);
    if (text !== this.data.layerGridText) this.setData({ layerGridText: text });
  },

  onLayerRecenter() {
    if (!this.layerView) return;
    const aspect = this.data.layerCanvasWidth / this.data.layerCanvasHeight;
    const county = geoLayer.viewForCounty(aspect);
    this.layerView = geoLayer.viewSpanKm(this.layerView) > geoLayer.viewSpanKm(county)
      ? geoLayer.recenterView(this.layerView, geoLayer.boundsCenter(geoLayer.COUNTY_BOUNDS))
      : county;
    // 重定位＝回到全县取景，乡镇选择也要跟着回到「全县」
    
    this.syncWeatherLocation(0, this.data.townshipOptions[0]);
    this.applyViewChange(true);
  },

  resetLayerView() {
    this.layerView = geoLayer.viewForCounty(this.data.layerCanvasWidth / this.data.layerCanvasHeight);
    this.applyViewChange(true);
  },

  // 视窗变化后统一收口：重建投影与采样器 → 重绘 → 提示 → （延迟）补数据
  applyViewChange(immediate) {
    if (!this.layerView) return;
    this.layerView = geoLayer.clampView(this.layerView, geoLayer.BAKE_BOUNDS);
    this.layerProjector = geoLayer.makeProjector(this.layerView, this.data.layerCanvasWidth, this.data.layerCanvasHeight);
    this.updateWindSampler();
    this.drawLayer();
    this.updateLayerHint();
    if (immediate) this.syncViewData(); else this.scheduleViewSync();
  },

  syncViewData() {
    this.ensureFrameTiles(this.data.radarFrameIndex);
    this.ensureWindField();
    this.updateSpanText();
  },

  scheduleViewSync() {
    if (this.viewSyncTimer) clearTimeout(this.viewSyncTimer);
    this.viewSyncTimer = setTimeout(() => {
      this.viewSyncTimer = null;
      this.syncViewData();
    }, 420);
  },

  onLayerTouchStart(e) {
    const touches = e.touches || [];
    if (touches.length >= 2) {
      const a = touches[0], b = touches[1];
      this.gesture = {
        mode: 'pinch',
        startDist: Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)),
        startView: this.layerView,
        anchor: this.anchorFromClient(a, b),
      };
    } else if (touches.length === 1) {
      const p = touches[0];
      this.gesture = { mode: 'pan', startX: p.clientX, startY: p.clientY, startView: this.layerView };
    }
  },

  onLayerTouchMove(e) {
    if (!this.gesture || !this.gesture.startView) return;
    const touches = e.touches || [];
    const width = this.data.layerCanvasWidth;
    if (this.gesture.mode === 'pinch') {
      if (touches.length < 2) return;
      const a = touches[0], b = touches[1];
      const dist = Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY));
      this.layerView = geoLayer.zoomView(
        this.gesture.startView, dist / this.gesture.startDist,
        this.gesture.anchor.x, this.gesture.anchor.y,
        geoLayer.LAYER.MIN_SPAN_KM, geoLayer.LAYER.MAX_SPAN_KM
      );
      this.applyViewChange(false);
    } else if (this.gesture.mode === 'pan') {
      if (touches.length !== 1) return;
      const p = touches[0];
      this.layerView = geoLayer.panView(
        this.gesture.startView, p.clientX - this.gesture.startX, p.clientY - this.gesture.startY, width
      );
      this.applyViewChange(false);
    }
  },

  onLayerTouchEnd() {
    if (!this.gesture) return;
    this.gesture = null;
    this.applyViewChange(true);
  },

  // 以双指中点为锚点归一化到画布：捏合时手指下的地块保持不动
  anchorFromClient(a, b) {
    const rect = this.layerRect || { left: 0, top: 0 };
    const width = this.data.layerCanvasWidth || 1;
    const height = this.data.layerCanvasHeight || 1;
    const nx = ((a.clientX + b.clientX) / 2 - rect.left) / width;
    const ny = ((a.clientY + b.clientY) / 2 - rect.top) / height;
    return { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
  },

  updateWindSampler() {
    const proj = this.layerProjector;
    const field = this.windField;
    this.windSampler = (x, y) => {
      if (!proj || !field) return { u: 0, v: 0 };
      const geo = proj.toLngLat(x, y);
      return layerWind.sampleFieldAt(field, geo.longitude, geo.latitude);
    };
  },

  // 顶部实况、气象图层与全局定位三者共用一个「当前乡镇」：
  //   选中乡镇 ⇒ 顶部实况取该乡镇中心的天气；选「全县」⇒ 回到县城中心（与其他页面同一点）。
  //   同时写回 app 全局定位——在天气页选乡镇，首页/地图也跟着切（双向统一的另一半）。
  //   同一个乡镇不重复请求（这也是双向联动不会来回打的保证）。
  syncWeatherLocation(index, name) {
    const loc = resolveTownshipLocation(index > 0 ? name : '中方县（全县）');
    if (!loc) return;
    if (this.data.location && this.data.location.city === loc.city && this.data.townshipIndex === index) return;
    this.setData({ location: loc, townshipIndex: index });
    app.setLocation(loc);
    this.loadAllData();
  },

  updateSpanText() {
    if (!this.layerView) return;
    const text = '视野约 ' + Math.round(geoLayer.viewSpanKm(this.layerView)) + ' km';
    if (text !== this.data.layerSpanText) this.setData({ layerSpanText: text });
  },

  // 风场数据：视窗没跑出已有范围、网格也不明显偏粗时就不重复请求
  ensureWindField() {
    if (this.data.layerMode !== 'wind' || !this.layerView) return;
    const fresh = this.windAt && Date.now() - this.windAt < layerWind.WIND.TTL;
    const bucket = layerWind.spanBucket(geoLayer.viewSpanKm(this.layerView));
    const covered = layerWind.fieldCovers(this.windField, this.layerView, 0.02);
    const dense = !layerWind.needsDenserGrid(this.windField, this.layerView, 2.2);
    if (fresh && covered && dense && this.windBucket === bucket) return;
    this.loadWindField(true, this.layerView);
  },

  // 分辨率提示：只保留一句必要的话（用户反馈：过多技术说明看不懂）
  updateLayerHint() {
    if (!this.layerView) return;
    let hint = '';
    if (this.data.layerMode === 'radar') {
      const upscale = this.currentUpscale();
      if (upscale > 6) hint = '放大后为插值效果';
    } else {
      const scale = this.windScale || layerWind.scaleForField(this.windField || { minSpeed: 0, maxSpeed: 0 });
      hint = '风速色阶 ' + scale.lo.toFixed(1) + '~' + scale.hi.toFixed(1) + ' m/s';
    }
    if (hint !== this.data.layerZoomHint) this.setData({ layerZoomHint: hint });
    this.updateLayerGridText();
  },

  // ---------------- 绘制 ----------------
  isWindMode() {
    return this.data.layerMode === 'wind';
  },

  drawLayer() {
    const ctx = this.layerCtx;
    if (!ctx) return;
    const w = this.data.layerCanvasWidth;
    const h = this.data.layerCanvasHeight;
    ctx.clearRect(0, 0, w, h);
    this.drawBasemapLayer(ctx, w, h);
    // ★ 层次：底图 → 风速填色 → 粒子 → 乡镇边界/名称 → 提示
    //   （真机预览验证过：填色压在边界之上会把乡镇盖住，所以边界必须最后画）
    if (this.isWindMode()) {
      this.drawWindFill(ctx);
      // ★ 地形起伏：填色之上、粒子之下（否则不是被填色盖住、就是压住流线）
      this.overlayHillshade(ctx, 0.24);
      this.drawWindParticles(ctx);
    } else {
      this.drawRadarLayer(ctx);
    }
    this.drawLayerTop(ctx);
    this.drawLayerHint(ctx, w, h);
  },

  drawWindFrame() {
    const ctx = this.layerCtx;
    if (!ctx) return;
    const w = this.data.layerCanvasWidth;
    const h = this.data.layerCanvasHeight;
    ctx.clearRect(0, 0, w, h);
    this.drawBasemapLayer(ctx, w, h);
    this.drawWindFill(ctx);
    this.overlayHillshade(ctx, 0.24);
    this.drawWindParticles(ctx);
    this.drawLayerTop(ctx);
    this.drawLayerHint(ctx, w, h);
  },

  drawBasemapLayer(ctx, w, h) {
    ctx.fillStyle = '#f2f8fc';
    ctx.fillRect(0, 0, w, h);
    if (this.basemapImage && this.layerProjector) {
      const rect = this.layerProjector.rectOfBounds(geoLayer.BAKE_BOUNDS);
      ctx.drawImage(this.basemapImage, rect.x, rect.y, rect.width, rect.height);
      // ★ 地形起伏已在烘焙时并入底图（真实 DEM 晕渲）；这里只补一层很轻的运行期叠加，
      //   保持「底图与晕渲同一 rect」的结构约束（见 tests/region-outlines.test.js）。
      if (this.hillshadeImage && this.hillshadeReady) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.drawImage(this.hillshadeImage, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
      }
    }
    this.drawDistanceRings(ctx);
    this.drawPlaceLabel(ctx);
    // 乡镇名与边界改在 drawLayerTop 里画（必须压在风速填色之上）
  },

  // 在风场填色之上再叠一层地形晕渲：让值班能靠地形判断位置。
  // 与底图用**同一套 rect 算法**，所以不会错位；alpha 低于风速色阶的视觉权重，避免压住色阶。
  overlayHillshade(ctx, alpha) {
    const proj = this.layerProjector;
    if (!proj || !this.hillshadeImage || !this.hillshadeReady) return;
    const rect = this.layerProjector.rectOfBounds(geoLayer.BAKE_BOUNDS);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.hillshadeImage, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  },

  // 风速填色：按当前视窗逐块采样，色阶按本帧实际范围自适应（最小跨度见 layerWind.WIND.MIN_SPEED_SPAN）
  drawWindFill(ctx) {
    const field = this.windField;
    const proj = this.layerProjector;
    if (!field || !proj || !this.windScale) return;
    const w = this.data.layerCanvasWidth;
    const h = this.data.layerCanvasHeight;
    const step = 7; // 采样块大小（CSS 像素）
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const geo2 = proj.toLngLat(x + step / 2, y + step / 2);
        const s = layerWind.sampleFieldAt(field, geo2.longitude, geo2.latitude);
        const color = layerWind.fillColorAt(Math.sqrt(s.u * s.u + s.v * s.v), this.windScale);
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, step + 1, step + 1);
      }
    }
  },

  // 最上层：乡镇边界与乡镇名（压在填色与粒子之上，保证「哪片是哪乡镇」始终看得见）
  drawLayerTop(ctx) {
    this.drawRegionOutlines(ctx);   // 周边区划当背景（先画，保证本县边界更醒目）
    this.drawTownshipOutlines(ctx);
    this.drawTownshipLabels(ctx);
  },

  // 周边区划轮廓与名称：只为显示中方县与邻县的相对位置；线细、色浅，不抢本县边界
  drawRegionOutlines(ctx) {
    const proj = this.layerProjector;
    if (!proj) return;
    // 乡镇级视野下不画邻县（见 REGION_HIDE_SPAN_KM 的说明）
    if (geoLayer.viewSpanKm(this.layerView) <= REGION_HIDE_SPAN_KM) return;
    const w = this.data.layerCanvasWidth;
    const h = this.data.layerCanvasHeight;
    const regions = regionRingsWgs84();
    ctx.save();
    ctx.strokeStyle = 'rgba(122,146,162,.6)';
    ctx.lineWidth = 0.9;
    regions.forEach((r) => {
      r.rings.forEach((ring) => {
        ctx.beginPath();
        let started = false;
        ring.forEach((p) => {
          const q = proj.toPx(p.longitude, p.latitude);
          if (q.x < -40 || q.x > w + 40 || q.y < -40 || q.y > h + 40) { started = false; return; }
          if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
      });
    });
    ctx.fillStyle = 'rgba(126,151,166,.85)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    regions.forEach((r) => {
      if (!r.center) return;
      const q = proj.toPx(r.center.longitude, r.center.latitude);
      if (q.x < 24 || q.x > w - 24 || q.y < 16 || q.y > h - 16) return;
      ctx.fillText(r.name, q.x, q.y);
    });
    ctx.restore();
  },

  drawTownshipOutlines(ctx) {
    const proj = this.layerProjector;
    if (!proj) return;
    const w = this.data.layerCanvasWidth;
    const h = this.data.layerCanvasHeight;
    ctx.save();
    ctx.strokeStyle = 'rgba(14,77,100,.55)';
    ctx.lineWidth = 1.1;
    TOWNSHIP_BOUNDARIES.forEach((t) => {
      ctx.beginPath();
      let started = false;
      (t.points || []).forEach((pt) => {
        const q = proj.toPx(pt.longitude, pt.latitude);
        if (q.x < -40 || q.x > w + 40 || q.y < -40 || q.y > h + 40) { started = false; return; }
        if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    });
    ctx.restore();
  },

  // 县名标注：距离环给出「多远」，这里给出「哪里」
  drawPlaceLabel(ctx) {
    const proj = this.layerProjector;
    if (!proj) return;
    // 收到乡镇级后改画乡镇名（县名会与「中方镇」叠在一起）
    if (geoLayer.viewSpanKm(this.layerView) <= 60) return;
    const center = geoLayer.COUNTY_CENTER;
    const p = proj.toPx(center.longitude, center.latitude);
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.94)';
    ctx.strokeText('中方县', p.x, p.y - 2);
    ctx.fillStyle = '#0e4d64';
    ctx.fillText('中方县', p.x, p.y - 2);
    ctx.restore();
  },

  // 乡镇名标注：视野收到乡镇级时把 12 个乡镇名画在各自中心，
  // 解决「看得出有回波、但不知道是哪个乡镇」——这是从卫星/矢量数据都拿不到的本地知识，
  // 直接来自 utils/townshipBoundaries.js 的真实中心点。
  drawTownshipLabels(ctx) {
    const proj = this.layerProjector;
    if (!proj) return;
    // 只在视野 ≤ 60km 时画：县域尺度下 12 个名字会挤成一团
    if (geoLayer.viewSpanKm(this.layerView) > 60) return;
    const w = this.data.layerCanvasWidth;
    const h = this.data.layerCanvasHeight;
    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.fillStyle = '#34566a';
    TOWNSHIP_BOUNDARIES.forEach((t) => {
      if (!t.center) return;
      const p = proj.toPx(t.center.longitude, t.center.latitude);
      if (p.x < -30 || p.x > w + 30 || p.y < -20 || p.y > h + 20) return;
      ctx.strokeText(t.name, p.x, p.y);
      ctx.fillText(t.name, p.x, p.y);
    });
    ctx.restore();
  },

  // 距离环：把「降雨带离县城多远」变成可读信息（25/50/100km）
  drawDistanceRings(ctx) {
    const proj = this.layerProjector;
    if (!proj) return;
    const center = geoLayer.COUNTY_CENTER;
    const origin = proj.toPx(center.longitude, center.latitude);
    const canDash = typeof ctx.setLineDash === 'function';
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,155,180,.5)';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(104,140,166,.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    [25, 50, 100].forEach((km) => {
      const radius = km * proj.pxPerKm;
      if (radius < 10) return;
      if (canDash) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      if (canDash) ctx.setLineDash([]);
      ctx.fillText(km + ' km', origin.x, origin.y - radius - 3);
    });
    ctx.restore();
  },

  drawRadarLayer(ctx) {
    const frames = this.data.radarFrames;
    const frame = frames[this.data.radarFrameIndex];
    if (!frame || !this.radarHost) { this.radarDrawn = 0; this.radarPending = 0; return; }
    const plan = layerRadar.planFrameTiles(
      this.radarHost, frame, this.layerView,
      { width: this.data.layerCanvasWidth, height: this.data.layerCanvasHeight },
      this.data.layerCanvasWidth * (this.layerDpr || 2),
      this.radarTileOptions()
    );
    let drawn = 0;
    let pending = 0;
    ctx.save();
    ctx.globalAlpha = 0.92; // 回波主体要显眼；轻微透底只为不彻底盖死边界
    plan.tiles.forEach((tile) => {
      const entry = this.tileCache && this.tileCache.get(tile.key);
      if (entry && entry.status === 'ok' && entry.img) {
        ctx.drawImage(entry.img, tile.rect.x, tile.rect.y, tile.rect.width, tile.rect.height);
        drawn++;
      } else if (!entry || entry.status === 'loading') {
        pending++;
      }
    });
    ctx.restore();
    this.radarDrawn = drawn;
    this.radarPending = pending;
  },

  // 风场流线：把同一批粒子按拖尾长度分三段递增透明度描边，形成「头亮尾淡」
  drawWindParticles(ctx) {
    const parts = this.particles;
    if (!parts || !parts.length) return;
    const passes = [
      { from: 0, alpha: 0.24, width: 1 },
      { from: 0.34, alpha: 0.5, width: 1.1 },
      { from: 0.66, alpha: 0.86, width: 1.3 }
    ];
    ctx.save();
    ctx.lineCap = 'round';
    passes.forEach((pass) => {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < parts.length; i++) {
        const trail = parts[i].trail;
        if (!trail || trail.length < 2) continue;
        const from = Math.floor(trail.length * pass.from);
        ctx.moveTo(trail[from].x, trail[from].y);
        for (let k = from + 1; k < trail.length; k++) ctx.lineTo(trail[k].x, trail[k].y);
        any = true;
      }
      if (!any) return;
      ctx.strokeStyle = 'rgba(11,79,138,' + pass.alpha + ')';
      ctx.lineWidth = pass.width;
      ctx.stroke();
    });
    ctx.restore();
  },

  // 画布内提示：替代覆盖层（canvas 是原生组件，叠 cover-view 在真机上有兼容风险）
  drawLayerHint(ctx, w, h) {
    let text = '';
    const { layerStatus, layerErrorText } = this.data;
    if (layerStatus === 'loading') {
      text = this.isWindMode() ? '正在获取风场数据…' : '正在获取雷达数据…';
    } else if (layerStatus === 'error') {
      text = layerErrorText || '图层数据暂不可用';
    } else if (!this.isWindMode() && this.data.radarFrames.length) {
      if (!this.radarDrawn) text = this.radarPending ? '正在加载雷达瓦片…' : '当前时刻该区域无雷达回波';
    } else if (this.isWindMode() && !this.windField) {
      text = '风场数据未就绪';
    }
    if (!text) return;
    ctx.save();
    ctx.font = '12px sans-serif';
    const textWidth = ctx.measureText(text).width;
    const boxW = textWidth + 26;
    const boxH = 28;
    const x = (w - boxW) / 2;
    const y = h - boxH - 12;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    this.roundRectPath(ctx, x, y, boxW, boxH, 14);
    ctx.fill();
    ctx.fillStyle = '#5e7f90';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, y + boxH / 2 + 0.5);
    ctx.restore();
  },

  roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  },

  onUnload() {
    this.stopLayerPlay();
    this.stopWindLoop();
    if (this.viewSyncTimer) { clearTimeout(this.viewSyncTimer); this.viewSyncTimer = null; }
    this.gesture = null;
    this.layerNode = null;
    this.layerCtx = null;
    this.particles = null;
    this.tileCache = null;
    this.downloadQueue = [];
  },

  onRefresh() {
    this.loadAllData().then(() => {
      const weatherOk = this.data.weatherStatus === 'success';
      const nowcastOk = this.data.nowcastStatus === 'success';
      const nowcastDegraded = nowcastOk && this.data.nowcast.degraded;
      // 短临没展开过只是「本轮没取」，不能提示成「暂不可用」
      const nowcastIdle = this.data.nowcastStatus === 'idle';
      if (weatherOk && (nowcastIdle || (nowcastOk && !nowcastDegraded))) {
        util.showToast('刷新成功');
      } else if (weatherOk && nowcastDegraded) {
        util.showToast('天气已更新，短临预报部分乡镇数据缺失');
      } else if (weatherOk) {
        util.showToast('天气已更新，乡镇短临预报暂不可用');
      } else {
        util.showToast('天气数据暂不可用');
      }
    });
  }
});
