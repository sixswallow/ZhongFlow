const PENDING_STATION_TYPE_KEY = 'pendingStationType';
const VALID_STATION_TYPES = ['reservoir', 'river', 'soil'];

const setPendingStationType = (type) => {
  if (!VALID_STATION_TYPES.includes(type)) return false;
  wx.setStorageSync(PENDING_STATION_TYPE_KEY, type);
  return true;
};

const consumePendingStationType = () => {
  const type = wx.getStorageSync(PENDING_STATION_TYPE_KEY);
  wx.removeStorageSync(PENDING_STATION_TYPE_KEY);
  return VALID_STATION_TYPES.includes(type) ? type : '';
};

module.exports = {
  PENDING_STATION_TYPE_KEY,
  setPendingStationType,
  consumePendingStationType
};
