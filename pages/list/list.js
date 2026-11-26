const api = require('../../utils/api');
const util = require('../../utils/util');
const navigation = require('../../utils/navigation');
const { filterStations } = require('../../utils/stationSearch');

Page({
  data: {
    activeTab: 'reservoir',
    keyword: '',
    reservoirList: [],
    riverList: [],
    soilList: [],
    filteredList: [],
    // 站点数据请求失败标记：与「真的没有数据」区分开，给出重试入口
    loadFailed: false
  },

  onLoad() {
    this.loadAllStations();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }

    const pendingType = navigation.consumePendingStationType();
    if (pendingType) {
      this.setData({ activeTab: pendingType });
    }

    if (this.data.reservoirList.length > 0) {
      this.filterList();
    }
  },

  onPullDownRefresh() {
    this.loadAllStations({ forceRefresh: true }).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadAllStations(options = {}) {
    try {
      util.showLoading('加载中...');
      // getStationGroups 保留失败信号：失败类别为空数组、其余类别正常展示
      const groups = await api.getStationGroups(options);

      this.setData({
        reservoirList: groups.reservoirs,
        riverList: groups.rivers,
        soilList: groups.soils,
        loadFailed: groups.failed
      });

      this.filterList();
      util.hideLoading();
      if (groups.failed) {
        util.showToast('部分站点数据获取失败，请重试');
      }
    } catch (e) {
      util.hideLoading();
      this.setData({ loadFailed: true });
      util.showToast('加载失败');
      console.error('加载站点列表失败', e);
    }
  },

  retryLoad() {
    this.loadAllStations({ forceRefresh: true });
  },

  switchTab(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ activeTab: type });
    this.filterList();
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    this.filterList();
  },

  onSearch() {
    this.filterList();
  },

  clearSearch() {
    this.setData({ keyword: '' });
    this.filterList();
  },

  filterList() {
    const { activeTab, keyword, reservoirList, riverList, soilList } = this.data;
    let list = [];

    switch (activeTab) {
      case 'reservoir':
        list = reservoirList;
        break;
      case 'river':
        list = riverList;
        break;
      case 'soil':
        list = soilList;
        break;
      default:
        list = [...reservoirList, ...riverList, ...soilList];
    }

    const filteredList = filterStations(list, keyword);
    this.setData({ filteredList });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    });
  }
});
