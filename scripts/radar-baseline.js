// 短期外推的「能力上界参照」：把 T 时刻的雷达回波原样照搬到 T+L，与 T+L 的实况比对。
//
// 重要口径：
//  · 这不是彩云短临的评分，而是「外推类方法在中方县、本期天气下的上限参照」；
//    彩云 minutely 本质上也是外推类产品，所以这个上限对它有参考意义。
//  · 雷达是遥感参照，只判「有无雨」，不给毫米数。
//  · 免费档雷达只有过去约 2 小时、每 10 分钟一帧，因此单次运行样本量有限；
//    并且若本期基准率接近 0（全县基本无雨），一致率必然虚高——脚本会显著提示。
//
// 用法：node.exe scripts/radar-baseline.js [提前量(分钟),逗号分隔]   默认 30,60
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const radarTruth = require(path.join(ROOT, 'cloudfunctions/getWeather/lib/radarTruth.js'));
const { TOWNSHIP_RINGS } = require(path.join(ROOT, 'cloudfunctions/getWeather/lib/radarTownships.js'));
const RT = radarTruth.RADAR_TRUTH;

function get(url, binary) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const b = Buffer.concat(chunks); resolve(binary ? b : JSON.parse(b.toString('utf8'))); });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

const pct = (x, n) => (n ? ((x / n) * 100).toFixed(1) + '%' : '—');

(async () => {
  const leads = (process.argv[2] || '30,60').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
  const meta = await get(RT.META_URL, false);
  const frames = ((meta.radar && meta.radar.past) || []).slice().sort((a, b) => a.time - b.time);
  if (!frames.length) throw new Error('雷达帧为空');

  const tiles = radarTruth.tilesForRings(TOWNSHIP_RINGS, RT.ZOOM);
  const bj = (t) => new Date((t + 8 * 3600) * 1000).toISOString().slice(11, 16);
  console.log('雷达参照基线（' + frames.length + ' 帧，' + bj(frames[0].time) + ' → ' + bj(frames[frames.length - 1].time) + ' 北京时）');
  console.log('瓦片 z=' + RT.ZOOM + ' ' + tiles.map((t) => t.x + '/' + t.y).join(',') + '（全县 1 张）');

  // 逐帧实况
  const byTime = {};
  console.log('\n逐帧回波实况：');
  for (const f of frames) {
    const imgs = {};
    for (const tl of tiles) {
      imgs[tl.key] = radarTruth.decodePng(await get(radarTruth.tileUrl(meta.host, f.path, tl.z, tl.x, tl.y), true));
    }
    const sums = radarTruth.summarizeFrame(imgs, TOWNSHIP_RINGS, RT.ZOOM);
    const echo = sums.reduce((s, x) => s + (x.echoPixels || 0), 0);
    const rainNames = sums.filter((x) => x.hasRain).map((x) => x.name);
    byTime[f.time] = sums;
    console.log('  ' + bj(f.time) + '  回波像素 ' + String(echo).padStart(4) + '  有雨 ' +
      String(rainNames.length).padStart(2) + '/12' + (rainNames.length ? '  ' + rainNames.join('、') : ''));
  }

  const need = ['提前量', '帧对', '样本', '实际有雨', '基准率', '一致率', '命中率', '空报率', '漏报'];
  console.log('\n外推（把 T 时刻回波照搬到 T+L）与实况比对：');
  console.log('  ' + need[0].padStart(6) + need[1].padStart(6) + need[2].padStart(7) +
    '   ' + need[4] + '   ' + need[5] + '   ' + need[6] + '   ' + need[7] + '  ' + need[8]);

  const all = [];
  for (const lead of leads) {
    let tp = 0, fp = 0, fn = 0, tn = 0, pairs = 0, skipped = 0;
    for (let i = 0; i < frames.length; i++) {
      const target = frames[i].time + lead * 60;
      const j = frames.findIndex((f) => Math.abs(f.time - target) <= 300);
      if (j < 0) continue;
      pairs++;
      const pred = byTime[frames[i].time], obs = byTime[frames[j].time];
      for (let k = 0; k < TOWNSHIP_RINGS.length; k++) {
        const p = pred[k], o = obs[k];
        if (!p.ok || !o.ok || p.hasRain === null || o.hasRain === null) { skipped++; continue; }
        if (p.hasRain && o.hasRain) tp++;
        else if (p.hasRain && !o.hasRain) fp++;
        else if (!p.hasRain && o.hasRain) fn++;
        else tn++;
      }
    }
    const n = tp + fp + fn + tn;
    const base = (tp + fn) / (n || 1);
    const agree = (tp + tn) / (n || 1);
    all.push({ lead, pairs, n, tp, fp, fn, tn, base, agree });
    console.log('  ' + String(lead + ' 分钟').padStart(6) + String(pairs).padStart(6) + String(n).padStart(7) +
      '   ' + pct(tp + fn, n).padStart(6) + '   ' + pct(tp + tn, n).padStart(6) + '   ' +
      pct(tp, tp + fn).padStart(6) + '   ' + pct(fp, tp + fp).padStart(6) + '   ' + String(fn).padStart(4) +
      (skipped ? '   （跳过不可判定 ' + skipped + '）' : ''));
  }

  const maxBase = Math.max.apply(null, all.map((a) => a.base));
  console.log('\n结论：');
  if (maxBase < 0.05) {
    console.log('  ⚠ 本期基准率 ' + (maxBase * 100).toFixed(1) + '%（全县基本无降水），一致率必然虚高，');
    console.log('    本表只能证明「方法与管道可用」，不能作为准确率结论。');
    console.log('    需要跨降水过程多次运行（或让小程序端持续累积对照样本）才具备代表性。');
  } else {
    console.log('  本期基准率最高 ' + (maxBase * 100).toFixed(1) + '%，一致率/命中率具备一定参考性。');
    console.log('  横向看：提前量越大，命中率越低、空报率越高——这就是外推类方法的能力上界。');
  }
  console.log('  提醒：雷达是遥感参照（z=' + RT.ZOOM + '，约 1.1km/像素，帧间隔 10 分钟），只判有无雨，不给毫米数。');
})().catch((e) => { console.log('✗ ' + e.message + '\n' + e.stack); process.exit(1); });
