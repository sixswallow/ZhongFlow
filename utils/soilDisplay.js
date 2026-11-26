const hasNumber = (value) => value !== undefined && value !== null && value !== '' && Number(value) > 0;

const formatNumber = (value) => hasNumber(value) ? Number(value).toFixed(1) : '--';

const buildSoilDisplay = (station = {}) => {
  const averageMoisture = station.averageMoisture;
  const basicMoisture = station.moisture;
  const moisture10 = station.moisture10;
  const moisture20 = station.moisture20;
  const moisture40 = station.moisture40;
  const saturatedMoisture = station.saturatedMoisture;
  const relativeMoisture = station.relativeMoisture;
  const hasAverageMoisture = hasNumber(averageMoisture);
  const overviewMoisture = hasAverageMoisture ? averageMoisture : basicMoisture;

  return {
    averageMoistureText: formatNumber(overviewMoisture),
    averageMoistureLabel: hasAverageMoisture ? '平均土壤含水量' : '土壤含水量',
    moisture10Text: formatNumber(moisture10),
    moisture20Text: formatNumber(moisture20),
    moisture40Text: formatNumber(moisture40),
    saturatedMoistureText: formatNumber(saturatedMoisture),
    relativeMoistureText: formatNumber(relativeMoisture),
    temperatureText: formatNumber(station.temperature),
    showAverageMoisture: hasNumber(overviewMoisture),
    showMoisture10: hasNumber(moisture10),
    showMoisture20: hasNumber(moisture20),
    showMoisture40: hasNumber(moisture40),
    showDepthMoistures: hasNumber(moisture10) || hasNumber(moisture20) || hasNumber(moisture40),
    showSaturatedMoisture: hasNumber(saturatedMoisture),
    showRelativeMoisture: hasNumber(relativeMoisture),
    showDroughtIndicators: hasNumber(saturatedMoisture) || hasNumber(relativeMoisture),
    showTemperature: hasNumber(station.temperature),
    depthText: station.depth || '',
    soilTypeText: station.soilType || '',
    showDepth: Boolean(station.depth),
    showSoilType: Boolean(station.soilType)
  };
};

module.exports = { buildSoilDisplay };
