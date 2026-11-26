const assert = require('assert');
const { handler } = require('../cloudfunctions/getStationHistory/index.js');

(async () => {
  const response = await handler({
    queryParameters: { stationId: '61328730', type: 'soil', days: '7' }
  });
  assert.strictEqual(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.ok(payload.list.length > 0, '土壤时序为空');
  const record = payload.list.find((item) => item.moisture10 !== null && item.moisture20 !== null && item.moisture40 !== null);
  assert.ok(record, '未获得三层含水量时序记录');
  ['averageMoisture', 'moisture10', 'moisture20', 'moisture40', 'relativeMoisture'].forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(record, key), `时序响应缺少 ${key}`);
  });
  console.log(JSON.stringify({
    verification: 'passed',
    total: payload.total,
    sample: record
  }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
