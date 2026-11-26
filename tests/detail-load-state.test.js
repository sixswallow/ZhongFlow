// 详情页加载态回归测试
// 覆盖历史缺陷：取不到站点时既没有 hideLoading()（mask 遮罩一直挂着），
// 又会在 1.5s 后静默 navigateBack，用户看到的只是「正在加载站点数据…」然后被弹回。
const assert = require('assert');

const calls = { showLoading: 0, hideLoading: 0, navigateBack: 0 };

// canvas type="2d" 迁移后：绘制经 SelectorQuery 取节点 + getContext('2d')。
// 本测试聚焦加载态，不触发绘制路径，这里给一个可用的兜底桩。
const stubQuery = () => {
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === 'then') return undefined;
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set() { return true; }
  });
  const node = { width: 0, height: 0, getContext: () => ctx };
  const query = {
    in() { return query; },
    select() { return query; },
    fields() { return query; },
    exec(cb) { cb([{ node, width: 320, height: 200 }]); }
  };
  return query;
};

global.wx = {
  // getSystemInfoSync 已废弃，页面统一改用 getWindowInfo（窗口尺寸类信息）
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, pixelRatio: 2 }),
  showLoading: () => { calls.showLoading++; },
  hideLoading: () => { calls.hideLoading++; },
  showToast: () => {},
  navigateBack: () => { calls.navigateBack++; },
  setNavigationBarTitle: () => {},
  stopPullDownRefresh: () => {},
  createSelectorQuery: stubQuery
};
global.getApp = () => ({ globalData: {} });

let pageDef = null;
global.Page = (o) => { pageDef = o; };

const api = require('../utils/api.js');
require('../pages/detail/detail.js');

const STATION = {
  id: 'T1', name: '测试墒情站', type: 'soil', address: '中方县测试村',
  status: 'unknown', statusText: '暂无数据', moisture: null, updateTime: '2026-09-22 10:00'
};

const reset = () => { calls.showLoading = 0; calls.hideLoading = 0; calls.navigateBack = 0; };
const build = () => {
  const inst = Object.create(pageDef);
  inst.data = JSON.parse(JSON.stringify(pageDef.data));
  inst.setData = function (d) { Object.assign(this.data, d); };
  return inst;
};
const wait = () => new Promise((r) => setTimeout(r, 120));

(async () => {
  assert.ok(pageDef, '未取到详情页定义');

  // 1. 正常加载
  reset();
  api.getStationDetail = async () => STATION;
  api.getStationHistory = async () => [];
  let inst = build();
  inst.onLoad({ id: 'T1' });
  await wait();
  assert.ok(inst.data.station, '正常加载时应设置 station');
  assert.strictEqual(inst.data.loadFailed, false);
  assert.strictEqual(calls.showLoading, calls.hideLoading, '正常路径的加载遮罩必须关闭');
  assert.strictEqual(calls.navigateBack, 0);

  // 2. 取不到站点：必须是可见失败态，而不是「遮罩挂着 + 静默弹回」
  reset();
  api.getStationDetail = async () => null;
  inst = build();
  inst.onLoad({ id: 'NOPE' });
  await wait();
  assert.strictEqual(inst.data.loadFailed, true, '取不到数据必须进入可见失败态');
  assert.strictEqual(calls.showLoading, calls.hideLoading, '失败分支也必须关闭加载遮罩（历史缺陷：此处漏了 hideLoading）');
  assert.strictEqual(calls.navigateBack, 0, '不得静默自动返回');

  // 3. 接口抛错
  reset();
  api.getStationDetail = async () => { throw new Error('network down'); };
  inst = build();
  inst.onLoad({ id: 'ERR' });
  await wait();
  assert.strictEqual(inst.data.loadFailed, true, '接口抛错应进入失败态');
  assert.strictEqual(calls.showLoading, calls.hideLoading, '异常路径也必须关闭加载遮罩');

  // 4. 失败后重试
  reset();
  api.getStationDetail = async () => STATION;
  inst.retryLoad();
  await wait();
  assert.strictEqual(inst.data.loadFailed, false, '重试后应复位失败态');
  assert.ok(inst.data.station, '重试后应成功加载');

  // 5. 下拉刷新不留转圈
  let stopped = 0;
  global.wx.stopPullDownRefresh = () => { stopped++; };
  inst.onPullDownRefresh();
  await wait();
  assert.ok(stopped > 0, 'onPullDownRefresh 必须调用 stopPullDownRefresh，否则下拉转圈不会停');

  console.log('详情页加载态测试通过。');
})().catch((e) => {
  console.error('✗ 详情页加载态测试失败');
  console.error(e && e.message);
  process.exit(1);
});
