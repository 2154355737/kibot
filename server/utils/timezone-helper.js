/**
 * 时区辅助工具
 * 统一处理时间格式和时区转换
 * 默认使用中国时区 (Asia/Shanghai, UTC+8)
 */

// 默认时区
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_LOCALE = 'zh-CN';

/**
 * 获取当前本地时间字符串（格式化）
 * @param {Date} date - 日期对象，默认当前时间
 * @param {string} format - 格式类型: 'full', 'date', 'time', 'datetime'
 * @returns {string} 格式化的本地时间字符串
 */
function getLocalTimeString(date = new Date(), format = 'datetime') {
  const options = {
    timeZone: DEFAULT_TIMEZONE,
    hour12: false
  };

  switch (format) {
    case 'full':
      // 完整格式: 2025-10-17 15:47:01
      return date.toLocaleString(DEFAULT_LOCALE, {
        ...options,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).replace(/\//g, '-');

    case 'date':
      // 仅日期: 2025-10-17
      return date.toLocaleDateString(DEFAULT_LOCALE, {
        ...options,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).replace(/\//g, '-');

    case 'time':
      // 仅时间: 15:47:01
      return date.toLocaleTimeString(DEFAULT_LOCALE, {
        ...options,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

    case 'datetime':
    default:
      // 日期时间: 2025-10-17 15:47:01
      return date.toLocaleString(DEFAULT_LOCALE, {
        ...options,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).replace(/\//g, '-');
  }
}

/**
 * 获取当前本地日期（用于日志文件名）
 * @returns {string} YYYY-MM-DD 格式
 */
function getLocalDate() {
  return getLocalTimeString(new Date(), 'date');
}

/**
 * 获取当前本地时间（用于控制台输出）
 * @returns {string} HH:mm:ss 格式
 */
function getLocalTime() {
  return getLocalTimeString(new Date(), 'time');
}

/**
 * 获取格式化的本地日期时间（用于日志记录）
 * @param {Date} date - 日期对象，默认当前时间
 * @returns {string} YYYY-MM-DD HH:mm:ss 格式
 */
function getLocalDateTime(date = new Date()) {
  return getLocalTimeString(date, 'full');
}

/**
 * 将 ISO 字符串转换为本地时间字符串
 * @param {string} isoString - ISO 8601 格式的时间字符串
 * @param {string} format - 格式类型
 * @returns {string} 本地时间字符串
 */
function isoToLocal(isoString, format = 'datetime') {
  const date = new Date(isoString);
  return getLocalTimeString(date, format);
}

/**
 * 获取本地时区偏移（小时）
 * @returns {number} 时区偏移，例如 +8
 */
function getTimezoneOffset() {
  const offset = new Date().getTimezoneOffset();
  return -offset / 60;
}

/**
 * 获取本地时区信息
 * @returns {object} 时区信息对象
 */
function getTimezoneInfo() {
  const date = new Date();
  const offsetMinutes = date.getTimezoneOffset();
  const offsetHours = -offsetMinutes / 60;
  const offsetString = `UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}`;
  
  return {
    timezone: DEFAULT_TIMEZONE,
    locale: DEFAULT_LOCALE,
    offset: offsetHours,
    offsetString: offsetString,
    localTime: getLocalDateTime(date),
    utcTime: date.toISOString()
  };
}

/**
 * 为日志创建时间戳对象（同时包含本地时间和UTC时间）
 * @param {Date} date - 日期对象，默认当前时间
 * @returns {object} 包含多种时间格式的对象
 */
function createTimestamp(date = new Date()) {
  return {
    local: getLocalDateTime(date),      // 本地时间: 2025-10-17 15:47:01
    utc: date.toISOString(),             // UTC时间: 2025-10-17T07:47:01.000Z
    timestamp: date.getTime(),           // Unix时间戳（毫秒）
    date: getLocalDate(),                // 日期: 2025-10-17
    time: getLocalTime()                 // 时间: 15:47:01
  };
}

/**
 * 格式化友好的时间显示（相对时间）
 * @param {Date|string|number} date - 日期对象、ISO字符串或时间戳
 * @returns {string} 友好的时间显示，如"刚刚"、"5分钟前"
 */
function formatRelativeTime(date) {
  const now = Date.now();
  const timestamp = date instanceof Date ? date.getTime() : 
                   typeof date === 'string' ? new Date(date).getTime() : date;
  
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 10) return '刚刚';
  if (seconds < 60) return `${seconds}秒前`;
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  
  // 超过7天显示具体日期
  return getLocalTimeString(new Date(timestamp), 'datetime');
}

export {
  // 配置
  DEFAULT_TIMEZONE,
  DEFAULT_LOCALE,
  
  // 基础时间函数
  getLocalTimeString,
  getLocalDate,
  getLocalTime,
  getLocalDateTime,
  
  // 转换函数
  isoToLocal,
  
  // 时区信息
  getTimezoneOffset,
  getTimezoneInfo,
  
  // 高级功能
  createTimestamp,
  formatRelativeTime
};

