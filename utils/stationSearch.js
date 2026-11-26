const normalize = (value) => String(value || '').trim().replace(/\s+/g, '').toLowerCase();

const filterStations = (stations, keyword) => {
  const normalizedKeyword = normalize(keyword);
  if (!normalizedKeyword) return stations;
  return stations.filter((station) => {
    const name = normalize(station.name);
    const address = normalize(station.address);
    return name.includes(normalizedKeyword) || address.includes(normalizedKeyword);
  });
};

module.exports = { normalize, filterStations };
