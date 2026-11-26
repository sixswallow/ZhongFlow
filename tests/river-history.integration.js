const assert = require('assert');
const { handler } = require('../cloudfunctions/getStationHistory/index.js');

(async () => {
  const response = await handler({
    queryParameters: {
      stationId: '61310900',
      type: 'river',
      dateBegin: '2026-08-12 15:55',
      dateEnd: '2026-08-13 15:55'
    }
  });
  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.ok(payload.total > 0, '花桥河道水文过程为空');
  const sample = payload.list[0];
  assert.ok(Number.isFinite(sample.waterLevel), '河道过程记录缺少水位');
  assert.ok(Number.isFinite(sample.flow), '河道过程记录缺少流量');
  assert.ok(Number.isFinite(sample.warningLevel), '河道过程记录缺少警戒水位');
  console.log(JSON.stringify({ verification: 'passed', total: payload.total, sample }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
