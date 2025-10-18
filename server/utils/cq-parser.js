/**
 * CQ码解析器
 * 用于解析和构建CQ码消息段
 * 
 * @module cq-parser
 * @version 1.0.0
 * @author KiBot Team
 */

/**
 * CQ码解析器
 */
export class CQParser {
  /**
   * 解析CQ码字符串为消息段数组
   * @param {string} message - 包含CQ码的消息字符串
   * @returns {Array} 消息段数组
   */
  static parse(message) {
    if (!message || typeof message !== 'string') {
      return [];
    }

    const segments = [];
    const cqRegex = /\[CQ:([^,\]]+)((?:,[^\]]+)?)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = cqRegex.exec(message)) !== null) {
      // 添加CQ码之前的文本
      if (match.index > lastIndex) {
        const text = message.substring(lastIndex, match.index);
        if (text) {
          segments.push({
            type: 'text',
            data: { text }
          });
        }
      }

      // 解析CQ码
      const type = match[1];
      const paramsStr = match[2] || '';
      const data = this.parseParams(paramsStr);

      segments.push({
        type,
        data
      });

      lastIndex = match.index + match[0].length;
    }

    // 添加最后剩余的文本
    if (lastIndex < message.length) {
      const text = message.substring(lastIndex);
      if (text) {
        segments.push({
          type: 'text',
          data: { text }
        });
      }
    }

    return segments;
  }

  /**
   * 解析CQ码参数
   * @param {string} paramsStr - 参数字符串
   * @returns {Object} 参数对象
   */
  static parseParams(paramsStr) {
    const params = {};
    if (!paramsStr) return params;

    // 移除开头的逗号
    const cleanStr = paramsStr.startsWith(',') ? paramsStr.substring(1) : paramsStr;
    
    // 使用正则匹配 key=value 对
    const paramRegex = /([^,=]+)=([^,]*?)(?=,|$)/g;
    let match;

    while ((match = paramRegex.exec(cleanStr)) !== null) {
      const key = match[1].trim();
      let value = match[2].trim();
      
      // 解码特殊字符
      value = this.decodeCQValue(value);
      
      params[key] = value;
    }

    return params;
  }

  /**
   * 解码CQ码值中的特殊字符
   * @param {string} value - 待解码的值
   * @returns {string} 解码后的值
   */
  static decodeCQValue(value) {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&#91;/g, '[')
      .replace(/&#93;/g, ']')
      .replace(/&#44;/g, ',');
  }

  /**
   * 编码CQ码值中的特殊字符
   * @param {string} value - 待编码的值
   * @returns {string} 编码后的值
   */
  static encodeCQValue(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/\[/g, '&#91;')
      .replace(/\]/g, '&#93;')
      .replace(/,/g, '&#44;');
  }

  /**
   * 构建CQ码字符串
   * @param {string} type - CQ码类型
   * @param {Object} data - CQ码数据
   * @returns {string} CQ码字符串
   */
  static build(type, data = {}) {
    const params = Object.entries(data)
      .map(([key, value]) => `${key}=${this.encodeCQValue(value)}`)
      .join(',');
    
    return params ? `[CQ:${type},${params}]` : `[CQ:${type}]`;
  }

  /**
   * 从消息段数组中提取纯文本
   * @param {Array} segments - 消息段数组
   * @returns {string} 纯文本
   */
  static extractText(segments) {
    return segments
      .filter(seg => seg.type === 'text')
      .map(seg => seg.data.text)
      .join('');
  }

  /**
   * 从消息段数组中提取指定类型的段
   * @param {Array} segments - 消息段数组
   * @param {string} type - 消息段类型
   * @returns {Array} 指定类型的消息段数组
   */
  static extractByType(segments, type) {
    return segments.filter(seg => seg.type === type);
  }

  /**
   * 检查消息段中是否包含指定类型
   * @param {Array} segments - 消息段数组
   * @param {string} type - 消息段类型
   * @returns {boolean} 是否包含
   */
  static hasType(segments, type) {
    return segments.some(seg => seg.type === type);
  }

  /**
   * 将消息段数组转换为字符串
   * @param {Array} segments - 消息段数组
   * @returns {string} 消息字符串
   */
  static stringify(segments) {
    return segments.map(seg => {
      if (seg.type === 'text') {
        return seg.data.text || '';
      }
      return this.build(seg.type, seg.data);
    }).join('');
  }
}

/**
 * 常用CQ码构建器
 */
export class CQBuilder {
  /**
   * 构建文本消息
   * @param {string} text - 文本内容
   * @returns {string} 文本
   */
  static text(text) {
    return text;
  }

  /**
   * 构建@某人
   * @param {number|string} qq - QQ号，或"all"表示@全体成员
   * @returns {string} CQ码
   */
  static at(qq) {
    return CQParser.build('at', { qq });
  }

  /**
   * 构建表情
   * @param {number} id - 表情ID
   * @returns {string} CQ码
   */
  static face(id) {
    return CQParser.build('face', { id });
  }

  /**
   * 构建图片
   * @param {string} file - 图片文件名、URL或base64
   * @param {Object} options - 其他选项
   * @returns {string} CQ码
   */
  static image(file, options = {}) {
    return CQParser.build('image', { file, ...options });
  }

  /**
   * 构建语音
   * @param {string} file - 语音文件名或URL
   * @returns {string} CQ码
   */
  static record(file) {
    return CQParser.build('record', { file });
  }

  /**
   * 构建视频
   * @param {string} file - 视频文件名或URL
   * @returns {string} CQ码
   */
  static video(file) {
    return CQParser.build('video', { file });
  }

  /**
   * 构建回复
   * @param {number|string} id - 消息ID
   * @returns {string} CQ码
   */
  static reply(id) {
    return CQParser.build('reply', { id });
  }

  /**
   * 构建戳一戳
   * @param {number|string} qq - QQ号
   * @returns {string} CQ码
   */
  static poke(qq) {
    return CQParser.build('poke', { qq });
  }

  /**
   * 构建链接分享
   * @param {string} url - 链接URL
   * @param {string} title - 标题
   * @param {Object} options - 其他选项
   * @returns {string} CQ码
   */
  static share(url, title, options = {}) {
    return CQParser.build('share', { url, title, ...options });
  }

  /**
   * 构建音乐分享
   * @param {string} type - 音乐类型（qq/163/xm）
   * @param {string} id - 音乐ID
   * @returns {string} CQ码
   */
  static music(type, id) {
    return CQParser.build('music', { type, id });
  }

  /**
   * 构建自定义音乐分享
   * @param {string} url - 跳转URL
   * @param {string} audio - 音频URL
   * @param {string} title - 标题
   * @param {Object} options - 其他选项
   * @returns {string} CQ码
   */
  static customMusic(url, audio, title, options = {}) {
    return CQParser.build('music', { type: 'custom', url, audio, title, ...options });
  }

  /**
   * 构建位置分享
   * @param {number} lat - 纬度
   * @param {number} lon - 经度
   * @param {string} title - 标题
   * @param {Object} options - 其他选项
   * @returns {string} CQ码
   */
  static location(lat, lon, title, options = {}) {
    return CQParser.build('location', { lat, lon, title, ...options });
  }

  /**
   * 构建合并转发消息
   * @param {string} id - 合并转发ID
   * @returns {string} CQ码
   */
  static forward(id) {
    return CQParser.build('forward', { id });
  }

  /**
   * 构建XML消息
   * @param {string} data - XML数据
   * @returns {string} CQ码
   */
  static xml(data) {
    return CQParser.build('xml', { data });
  }

  /**
   * 构建JSON消息
   * @param {string} data - JSON数据
   * @returns {string} CQ码
   */
  static json(data) {
    return CQParser.build('json', { data });
  }
}

/**
 * 消息段辅助类
 */
export class MessageSegment {
  /**
   * 检查是否是图片消息段
   * @param {Object} segment - 消息段
   * @returns {boolean}
   */
  static isImage(segment) {
    return segment && segment.type === 'image';
  }

  /**
   * 检查是否是@消息段
   * @param {Object} segment - 消息段
   * @returns {boolean}
   */
  static isAt(segment) {
    return segment && segment.type === 'at';
  }

  /**
   * 检查是否是文本消息段
   * @param {Object} segment - 消息段
   * @returns {boolean}
   */
  static isText(segment) {
    return segment && segment.type === 'text';
  }

  /**
   * 检查是否是回复消息段
   * @param {Object} segment - 消息段
   * @returns {boolean}
   */
  static isReply(segment) {
    return segment && segment.type === 'reply';
  }

  /**
   * 获取图片URL
   * @param {Object} segment - 图片消息段
   * @returns {string|null}
   */
  static getImageUrl(segment) {
    if (!this.isImage(segment)) return null;
    return segment.data?.url || null;
  }

  /**
   * 获取@的QQ号
   * @param {Object} segment - @消息段
   * @returns {string|null}
   */
  static getAtQQ(segment) {
    if (!this.isAt(segment)) return null;
    return segment.data?.qq || null;
  }

  /**
   * 获取文本内容
   * @param {Object} segment - 文本消息段
   * @returns {string|null}
   */
  static getText(segment) {
    if (!this.isText(segment)) return null;
    return segment.data?.text || null;
  }

  /**
   * 获取回复的消息ID
   * @param {Object} segment - 回复消息段
   * @returns {string|null}
   */
  static getReplyId(segment) {
    if (!this.isReply(segment)) return null;
    return segment.data?.id || null;
  }
}

export default {
  CQParser,
  CQBuilder,
  MessageSegment
};

