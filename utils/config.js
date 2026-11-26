const CONFIG = {
  ALIYUN_FUNCTION_STATIONS_URL: 'https://zf-getstation-skkqwvcjke.cn-shenzhen.fcapp.run',
  ALIYUN_FUNCTION_HISTORY_URL: 'https://zf-getsnhistory-nnvbkviycj.cn-shenzhen.fcapp.run',
  ALIYUN_FUNCTION_WEATHER_URL: 'https://zf-getweather-sgxbwutnwe.cn-shenzhen.fcapp.run',
  ADCD: '431221',

  // 云函数共享密钥：与三个云函数的环境变量 API_TOKEN 同值。
  // 作用是防止公网地址被第三方抓包滥用（刷上游配额/流量）；它写在小程序包里，
  // 只能挡住不动手解包的滥用者，不是真正的安全边界 —— 改值时必须两端同步：
  // 这里改一次 + 三个云函数环境变量改一次并重新部署。
  API_TOKEN: 'zf431221-monitor-2026',

  // 天气密钥仅在云函数环境变量中配置，前端不得保存 Token、App Key 或 App Secret。
  // 数据源只用一种服务：全部走和风（2026-09-23 起），不再和彩云混用。
  // 和风负责：实况 / 逐小时 / 未来几天 / 分钟级降水 / 乡镇短临。
  // 这个值会同时传给常规天气和短临两个接口，云函数据此只上和风、不在失败时回落彩云，
  // 所以界面上「数据来源」永远只有一个，失败原因也只有一个来源。
  WEATHER_PROVIDER: 'qweather',
  ZHONGFANG_CENTER: {
    latitude: 27.509196,
    longitude: 110.115186
  },
  REFRESH_INTERVAL: 5 * 60 * 1000,
  STATION_CACHE_TTL: 5 * 60 * 1000
};

module.exports = CONFIG;
