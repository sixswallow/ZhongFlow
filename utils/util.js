const formatDate = date => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}-${formatNumber(month)}-${formatNumber(day)}`;
};

const formatNumber = n => {
  n = n.toString();
  return n[1] ? n : `0${n}`;
};

const showToast = (title, icon = 'none', duration = 2000) => {
  wx.showToast({
    title,
    icon,
    duration
  });
};

const showLoading = (title = '加载中...') => {
  wx.showLoading({
    title,
    mask: true
  });
};

const hideLoading = () => {
  wx.hideLoading();
};

const parseDate = (dateStr) => {
  if (!dateStr) return new Date(0);
  if (typeof dateStr === 'number') return new Date(dateStr);
  if (dateStr instanceof Date) return dateStr;
  
  // iOS 兼容：将 "yyyy-MM-dd HH:mm:ss" 转换为 "yyyy/MM/dd HH:mm:ss"
  let normalized = dateStr
    .replace(/-/g, '/')
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
  
  return new Date(normalized);
};

module.exports = {
  formatDate,
  formatNumber,
  showToast,
  showLoading,
  hideLoading,
  parseDate
};
