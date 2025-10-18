/**
 * 腾讯云机器翻译API工具
 * 文档：https://cloud.tencent.com/document/product/551/15619
 */

import https from 'https';
import crypto from 'crypto';

// 从环境变量读取密钥（安全方式）
const SECRET_ID = process.env.TENCENTCLOUD_SECRET_ID || '';
const SECRET_KEY = process.env.TENCENTCLOUD_SECRET_KEY || '';

// SHA256哈希
function sha256(message, secret = '', encoding) {
  const hmac = crypto.createHmac('sha256', secret);
  return hmac.update(message).digest(encoding);
}

// 获取哈希值
function getHash(message, encoding = 'hex') {
  const hash = crypto.createHash('sha256');
  return hash.update(message).digest(encoding);
}

// 获取日期字符串
function getDate(timestamp) {
  const date = new Date(timestamp * 1000);
  const year = date.getUTCFullYear();
  const month = ('0' + (date.getUTCMonth() + 1)).slice(-2);
  const day = ('0' + date.getUTCDate()).slice(-2);
  return `${year}-${month}-${day}`;
}

// 语言代码映射
const LANG_MAP = {
  'zh': 'zh',      // 中文
  'en': 'en',      // 英文
  'ja': 'ja',      // 日文
  'ko': 'ko',      // 韩文
  'es': 'es',      // 西班牙语
  'fr': 'fr',      // 法语
  'de': 'de',      // 德语
  'tr': 'tr',      // 土耳其语
  'ru': 'ru',      // 俄语
  'pt': 'pt',      // 葡萄牙语
  'vi': 'vi',      // 越南语
  'id': 'id',      // 印尼语
  'th': 'th',      // 泰语
  'ms': 'ms',      // 马来语
  'ar': 'ar',      // 阿拉伯语
  'hi': 'hi',      // 印地语
  'it': 'it'       // 意大利语
};

/**
 * 翻译文本
 * @param {string} text - 要翻译的文本
 * @param {string} targetLang - 目标语言（默认中文）
 * @param {string} sourceLang - 源语言（auto=自动检测）
 * @returns {Promise<object>} 翻译结果
 */
async function translateText(text, targetLang = 'zh', sourceLang = 'auto') {
  return new Promise((resolve, reject) => {
    // 检查密钥配置
    if (!SECRET_ID || !SECRET_KEY) {
      return reject(new Error('未配置腾讯云密钥，请设置环境变量 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY'));
    }

    // 验证并标准化语言代码
    const target = LANG_MAP[targetLang] || 'zh';
    const source = sourceLang === 'auto' ? 'auto' : (LANG_MAP[sourceLang] || 'auto');

    // API配置
    const host = 'tmt.tencentcloudapi.com';
    const service = 'tmt';
    const region = 'ap-beijing';
    const action = 'TextTranslate';
    const version = '2018-03-21';
    const timestamp = parseInt(String(new Date().getTime() / 1000));
    const date = getDate(timestamp);

    // 构建请求体
    const payload = JSON.stringify({
      SourceText: text,
      Source: source,
      Target: target,
      ProjectId: 0
    });

    // ************* 步骤 1：拼接规范请求串 *************
    const signedHeaders = 'content-type;host';
    const hashedRequestPayload = getHash(payload);
    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const canonicalHeaders = 
      'content-type:application/json; charset=utf-8\n' + 
      'host:' + host + '\n';

    const canonicalRequest =
      httpRequestMethod + '\n' +
      canonicalUri + '\n' +
      canonicalQueryString + '\n' +
      canonicalHeaders + '\n' +
      signedHeaders + '\n' +
      hashedRequestPayload;

    // ************* 步骤 2：拼接待签名字符串 *************
    const algorithm = 'TC3-HMAC-SHA256';
    const hashedCanonicalRequest = getHash(canonicalRequest);
    const credentialScope = date + '/' + service + '/' + 'tc3_request';
    const stringToSign =
      algorithm + '\n' +
      timestamp + '\n' +
      credentialScope + '\n' +
      hashedCanonicalRequest;

    // ************* 步骤 3：计算签名 *************
    const kDate = sha256(date, 'TC3' + SECRET_KEY);
    const kService = sha256(service, kDate);
    const kSigning = sha256('tc3_request', kService);
    const signature = sha256(stringToSign, kSigning, 'hex');

    // ************* 步骤 4：拼接 Authorization *************
    const authorization =
      algorithm + ' ' +
      'Credential=' + SECRET_ID + '/' + credentialScope + ', ' +
      'SignedHeaders=' + signedHeaders + ', ' +
      'Signature=' + signature;

    // ************* 步骤 5：构造并发起请求 *************
    const headers = {
      'Authorization': authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Timestamp': timestamp,
      'X-TC-Version': version,
      'X-TC-Region': region
    };

    const options = {
      hostname: host,
      method: httpRequestMethod,
      headers: headers,
      timeout: 10000 // 10秒超时
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          if (result.Response && result.Response.Error) {
            // API返回错误
            reject(new Error(result.Response.Error.Message || '翻译失败'));
          } else if (result.Response && result.Response.TargetText) {
            // 翻译成功
            resolve({
              success: true,
              sourceText: text,
              targetText: result.Response.TargetText,
              sourceLang: result.Response.Source || source,
              targetLang: result.Response.Target || target
            });
          } else {
            reject(new Error('翻译API返回格式异常'));
          }
        } catch (error) {
          reject(new Error('解析翻译结果失败: ' + error.message));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error('翻译请求失败: ' + error.message));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('翻译请求超时'));
    });

    req.write(payload);
    req.end();
  });
}

export {
  translateText,
  LANG_MAP
};

