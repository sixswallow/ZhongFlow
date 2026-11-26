Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '首页',
        icon: 'ic-home-g',
        iconActive: 'ic-home-a'
      },
      {
        pagePath: '/pages/map/map',
        text: '地图监测',
        icon: 'ic-map-g',
        iconActive: 'ic-map-a'
      },
      {
        pagePath: '/pages/list/list',
        text: '站点列表',
        icon: 'ic-list-g',
        iconActive: 'ic-list-a'
      },
      {
        pagePath: '/pages/rainfall/rainfall',
        text: '天气',
        icon: 'ic-cloud-g',
        iconActive: 'ic-cloud-a'
      }
    ]
  },
  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const url = this.data.list[index].pagePath;
      wx.switchTab({ url });
    }
  }
});
