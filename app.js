const DEFAULT_LOCATION = {
  latitude: 27.509196,
  longitude: 110.115186,
  city: '中方县'
};

App({
  globalData: {
    userInfo: null,
    location: { ...DEFAULT_LOCATION },
    weatherData: null
  },

  onLaunch() {
    const savedLocation = wx.getStorageSync('location');
    if (savedLocation) {
      this.globalData.location = savedLocation;
    }
  },

  setLocation(location) {
    this.globalData.location = location;
    wx.setStorageSync('location', location);
  }
});
