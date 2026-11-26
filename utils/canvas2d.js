// canvas type="2d" 统一取上下文助手
//
// 背景：页面图表原先用 wx.createCanvasContext（旧版 CanvasContext，基础库 2.9 起废弃，
// 无同层渲染、真机性能差，且 setLineDash 之类的方法签名与标准 Canvas 不一致）。
// 现统一迁移到 <canvas type="2d"> + 标准 CanvasRenderingContext2D，本助手负责三件事：
//   ① 通过 SelectorQuery 拿到 canvas 节点（canvas 常在 wx:if 卡片里、随 setData 渲染，
//      首次查询可能查不到节点，故带有限重试）；
//   ② 按屏幕 pixelRatio 设置节点的物理像素尺寸并 ctx.scale(dpr)——2d 模式默认只有
//      CSS 尺寸分辨率，不缩放的话图表在高清屏上是糊的；
//   ③ 返回标准 2d 上下文，绘制代码写法与 Web Canvas 完全一致（属性赋值 + setLineDash 标准
//      签名），不再需要 ctx.draw() 一次性提交。
// 注意：每次获取都会重设节点尺寸，这会自然清空画布，避免旧帧残留。

const MAX_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 80;

const get2dContext = (pageOrComponent, selector, cssWidth, cssHeight) => {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryGet = () => {
      attempts += 1;
      const query = wx.createSelectorQuery();
      if (pageOrComponent && typeof query.in === 'function') {
        query.in(pageOrComponent);
      }
      query.select(selector).fields({ node: true, size: true }).exec((res) => {
        const entry = res && res[0];
        if (!entry || !entry.node) {
          if (attempts < MAX_ATTEMPTS) {
            setTimeout(tryGet, RETRY_INTERVAL_MS);
            return;
          }
          reject(new Error('未取到 canvas 节点：' + selector + '（可能不在当前渲染树中）'));
          return;
        }
        const canvas = entry.node;
        const info = typeof wx.getWindowInfo === 'function'
          ? wx.getWindowInfo()
          : wx.getSystemInfoSync();
        const dpr = (info && info.pixelRatio) || 2;
        canvas.width = Math.max(1, Math.round(cssWidth * dpr));
        canvas.height = Math.max(1, Math.round(cssHeight * dpr));
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        resolve(ctx);
      });
    };
    tryGet();
  });
};

module.exports = { get2dContext };
