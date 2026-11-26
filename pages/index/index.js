const api = require('../../utils/api');
const util = require('../../utils/util');
const { getTownshipOptions, getTownshipIndex, resolveTownshipLocation } = require('../../utils/locationOptions');

const formatRecentStation = (station) => {
  const stationTypeLabel = station.type === 'reservoir'
    ? '水库站'
    : station.type === 'river'
      ? '河道站'
      : '土壤墒情站';
  const value = station.type === 'reservoir'
    ? station.currentLevel
    : station.type === 'river'
      ? station.waterLevel
      : station.moisture;
  return {
    id: station.id,
    type: station.type,
    name: station.name,
    stationTypeLabel,
    updateTime: station.updateTime,
    valueText: value !== null && value !== undefined ? `${value}${station.type === 'soil' ? '%' : 'm'}` : '--',
    valueLabel: station.type === 'soil' ? '湿度' : '水位'
  };
};

const getLatestUpdateTime = (recentList) => recentList.length > 0 ? recentList[0].updateTime : '暂无更新数据';

const app = getApp();

Page({
  data: {
    location: {
      city: '中方县',
      latitude: 27.509196,
      longitude: 110.115186
    },
    weather: { current: {} },
    weatherStatus: 'loading',
    weatherErrorMessage: '',
    recentList: [],
    latestUpdateTime: '正在获取数据',
    stationLoadFailed: false,
    zhongfangStationCount: 0,
    statusBarHeight: 0,
    townshipOptions: getTownshipOptions(),
    townshipIndex: 0
  },

  onLoad() {
    const systemInfo = wx.getWindowInfo();
    const savedLocation = app.globalData.location;
    this.setData({
      statusBarHeight: systemInfo.statusBarHeight,
      location: savedLocation,
      townshipIndex: getTownshipIndex(savedLocation)
    });
    this.initData();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    // 全局定位回读：地图/天气页选了别的乡镇，回首页时定位与天气跟着切
    // （用乡镇序号比较而不是 city 字符串，避免「中方县/中方县（全县）」命名差异造成误判）
    const location = app.globalData.location;
    if (location) {
      const idx = getTownshipIndex(location);
      if (idx !== this.data.townshipIndex) {
        const loc = resolveTownshipLocation(this.data.townshipOptions[idx]);
        this.setData({ location: loc, townshipIndex: idx });
        this.loadWeather();
      }
    }
    this.loadStationWorkbench();
  },

  onPullDownRefresh() {
    this.initData({ forceRefresh: true }).then(() => wx.stopPullDownRefresh());
  },

  initData(options = {}) {
    return Promise.all([this.loadWeather(), this.loadStationWorkbench(options)]);
  },

  async loadWeather() {
    this.setData({ weatherStatus: 'loading', weatherErrorMessage: '' });
    try {
      const { latitude, longitude } = this.data.location;
      const weather = await api.getWeather(latitude, longitude);
      if (!weather) throw new Error('天气数据未返回有效内容');
      this.setData({ weather, weatherStatus: 'success', weatherErrorMessage: '' });
      app.globalData.weatherData = weather;
    } catch (e) {
      const reason = typeof api.describeError === 'function' ? api.describeError(e) : '';
      this.setData({ weatherStatus: 'error', weatherErrorMessage: '暂未获取到天气数据' + (reason ? '（' + reason + '）' : '') });
      console.error('加载天气数据失败', e);
    }
  },

  async loadStationWorkbench(options = {}) {
    try {
      // getStationGroups 会带上失败信号：网络失败时页面能区分「失败」与「暂无数据」
      const groups = await api.getStationGroups(options);
      const recentList = groups.list
        .map(formatRecentStation)
        .sort((a, b) => util.parseDate(b.updateTime) - util.parseDate(a.updateTime));
      this.setData({
        zhongfangStationCount: recentList.length,
        latestUpdateTime: groups.failed
          ? '站点数据获取失败'
          : getLatestUpdateTime(recentList),
        stationLoadFailed: groups.failed && recentList.length === 0,
        recentList: recentList.slice(0, 3)
      });
    } catch (e) {
      this.setData({
        latestUpdateTime: '站点数据获取失败',
        stationLoadFailed: true
      });
      console.error('加载首页监测数据失败', e);
    }
  },

  onTownshipChange(e) {
    const index = Number(e.detail.value);
    const location = resolveTownshipLocation(this.data.townshipOptions[index]);
    this.setData({ location, townshipIndex: index });
    app.setLocation(location);
    this.loadWeather();
  },

  onRefresh() {
    util.showLoading('刷新中...');
    this.initData({ forceRefresh: true }).then(() => {
      util.hideLoading();
      util.showToast(this.data.weatherStatus === 'success' ? '刷新成功' : '天气数据暂不可用');
    });
  },

  goToMap() {
    wx.switchTab({ url: '/pages/map/map' });
  },

  goToRainfall() {
    wx.switchTab({ url: '/pages/rainfall/rainfall' });
  },

  goToDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  }
});
