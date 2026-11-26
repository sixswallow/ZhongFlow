const { handler } = require('../cloudfunctions/getStations/index.js');

(async () => {
  const response = await handler({ queryParameters: { type: 'soil', adcd: '431221' } });
  const body = JSON.parse(response.body);
  const sample = body.list.find((item) => item.saturatedMoisture !== null || item.relativeMoisture !== null) || body.list[0];
  console.log(JSON.stringify({
    statusCode: response.statusCode,
    total: body.total,
    sample: sample && {
      id: sample.id,
      type: sample.type,
      moisture: sample.moisture,
      averageMoisture: sample.averageMoisture,
      moisture10: sample.moisture10,
      moisture20: sample.moisture20,
      moisture40: sample.moisture40,
      saturatedMoisture: sample.saturatedMoisture,
      relativeMoisture: sample.relativeMoisture
    }
  }, null, 2));

  if (response.statusCode !== 200 || !sample || sample.type !== 'soil') {
    process.exit(1);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
