const numOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = parseFloat(value);
  return Number.isNaN(number) ? null : number;
};

const formatSoilHistoryRow = (row = {}) => {
  const rawTime = row.TM || row.tm || '';
  const time = rawTime ? new Date(rawTime) : null;
  const timestamp = time && !Number.isNaN(time.getTime()) ? time.getTime() : 0;
  const date = timestamp ? `${time.getMonth() + 1}/${time.getDate()}` : '';
  const averageMoisture = numOrNull(row.AVG ?? row.avg ?? row.SMV ?? row.smv);
  const moisture10 = numOrNull(row.SLM10 ?? row.slm10);
  const moisture20 = numOrNull(row.SLM20 ?? row.slm20);
  const moisture40 = numOrNull(row.SLM40 ?? row.slm40);
  const relativeMoisture = numOrNull(row.XDSD ?? row.xdsd);
  const value = averageMoisture ?? moisture10 ?? moisture20 ?? moisture40 ?? 0;

  return {
    date,
    timestamp,
    value,
    averageMoisture,
    moisture10,
    moisture20,
    moisture40,
    relativeMoisture
  };
};

module.exports = { formatSoilHistoryRow };
