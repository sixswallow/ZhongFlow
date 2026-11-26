const { getTownshipBoundary } = require('./townshipBoundaries');

const ZHONGFANG_CENTER = {
  city: '中方县',
  latitude: 27.509196,
  longitude: 110.115186
};

const VIEW_TOWNSHIP_ORDER = ['中方镇', '桐木镇', '花桥镇', '铜湾镇', '泸阳镇', '新建镇', '接龙镇', '铁坡镇', '袁家镇', '新路河镇', '铜鼎镇', '蒿吉坪瑶族乡'];

// 坐标由公开村级边界按乡镇聚合后计算，仅用于用户手动选择查看区域，不等同于设备实时定位。
const TOWNSHIPS = VIEW_TOWNSHIP_ORDER.map((city) => {
  const boundary = getTownshipBoundary(city);
  return {
    city,
    latitude: boundary.center.latitude,
    longitude: boundary.center.longitude
  };
});

const getTownshipOptions = () => ['中方县（全县）'].concat(TOWNSHIPS.map((item) => item.city));

const resolveTownshipLocation = (name) => {
  if (name === '中方县（全县）') return { ...ZHONGFANG_CENTER };
  const township = TOWNSHIPS.find((item) => item.city === name);
  return township ? { ...township } : { ...ZHONGFANG_CENTER };
};

const getTownshipIndex = (location) => {
  const city = location && location.city;
  const target = city === '中方县' ? '中方县（全县）' : city;
  return Math.max(0, getTownshipOptions().indexOf(target));
};

module.exports = { ZHONGFANG_CENTER, TOWNSHIPS, getTownshipOptions, getTownshipIndex, resolveTownshipLocation };
