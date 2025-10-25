// 后端事件响应规则执行引擎
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { logger } from '../utils/output-manager.js';
import { translateText, LANG_MAP } from '../utils/tencent-translate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 默认管理员列表（可配置）
const DEFAULT_ADMINS = [656906969]; // 根据实际需要配置

class EventResponseEngine {
  constructor() {
    this.rules = [];
    this.processedEvents = new Set();
    this.EVENT_CACHE_SIZE = 500;
    this.ENGINE_INSTANCE_ID = Math.random().toString(36).substr(2, 9);
    this.loginInfo = null;
    this.broadcastCallback = null; // 用于通知前端规则变更
    
    // 入群验证系统
    this.verifications = new Map(); // 存储进行中的验证 key: `${groupId}_${userId}`
    this.verificationTimers = new Map(); // 存储验证超时定时器
    
    // 消息缓存系统（用于撤回检测）
    this.messageCache = new Map(); // 存储最近的消息 key: message_id, value: { content, sender, time, ... }
    this.MESSAGE_CACHE_SIZE = 1000; // 缓存最近1000条消息
    this.MESSAGE_CACHE_TTL = 5 * 60 * 1000; // 消息缓存5分钟后自动清理
    
    // 统计数据
    this.stats = {
      dailyMessageCount: 0,
      totalRulesTriggered: 0,
      totalApiCalls: 0,
      totalErrors: 0,
      messageHistory: [], // 最近1000条消息记录
      userActivity: new Map(), // 用户活跃度
      groupActivity: new Map(), // 群组活跃度
      keywordStats: new Map(), // 关键词统计
      startTime: Date.now()
    };
    
    // 加载规则
    this.loadRules();
    
    // 加载历史统计数据
    this.loadStats();
    
    // 每小时保存一次统计数据
    setInterval(() => {
      this.saveStats();
    }, 60 * 60 * 1000);
    
    // 每5分钟清理过期的消息缓存
    setInterval(() => {
      this.cleanExpiredMessageCache();
    }, 5 * 60 * 1000);
    
    logger.startup('事件处理引擎', `已启动 (ID: ${this.ENGINE_INSTANCE_ID})`);
  }

  // 设置回调函数
  setSendMessageCallback(callback) {
    this.sendMessageCallback = callback;
  }

  setAddLogCallback(callback) {
    this.addLogCallback = callback;
  }

  setCallApiCallback(callback) {
    this.callApiCallback = callback;
  }

  setBroadcastCallback(callback) {
    this.broadcastCallback = callback;
  }

  // 设置登录信息
  setLoginInfo(loginInfo) {
    this.loginInfo = loginInfo;
  }

  // 检查是否为管理员
  isAdmin(userId) {
    return DEFAULT_ADMINS.includes(userId) || userId === this.loginInfo?.user_id;
  }

  // 检查环境匹配
  checkEnvironment(ruleEnvironment, event) {
    if (ruleEnvironment === 'all') {
      return true;
    }
    
    const eventEnvironment = event.message_type;
    
    if (ruleEnvironment === 'group') {
      return eventEnvironment === 'group';
    }
    
    if (ruleEnvironment === 'private') {
      return eventEnvironment === 'private';
    }
    
    return false;
  }

  // 从关键词模式中提取自定义变量
  extractCustomVariables(keywordPattern) {
    const variableRegex = /\{([^}]+)\}/g;
    const variables = [];
    let match;
    
    while ((match = variableRegex.exec(keywordPattern)) !== null) {
      const varName = match[1].trim();
      // 排除系统变量
      const systemVars = ['sender', 'sender_id', 'text', 'group', 'group_id', 'time', 'date', 'bot', 'bot_id', 'at_sender', 'random', 'result'];
      if (varName && !systemVars.includes(varName)) {
        variables.push(varName);
      }
    }
    
    return [...new Set(variables)]; // 去重
  }

  // 生成变量提取的正则表达式
  generateExtractionRegex(keywordPattern) {
    // 转义特殊字符，但保留变量占位符
    let regexPattern = keywordPattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
      .replace(/\\\{([^}]+)\\\}/g, (match, varName) => {
        // 将{变量名}替换为命名捕获组
        return `(?<${varName.replace(/[^a-zA-Z0-9_]/g, '_')}>\\S+)`;
      });
    
    return new RegExp(regexPattern, 'i');
  }

  // 从消息中提取自定义变量值
  extractVariableValues(keywordPattern, messageText) {
    const customVars = this.extractCustomVariables(keywordPattern);
    if (customVars.length === 0) {
      return {};
    }

    try {
      const regex = this.generateExtractionRegex(keywordPattern);
      const match = messageText.match(regex);
      
      if (match && match.groups) {
        const extractedVars = {};
        customVars.forEach(varName => {
          const cleanVarName = varName.replace(/[^a-zA-Z0-9_]/g, '_');
          if (match.groups[cleanVarName]) {
            extractedVars[varName] = match.groups[cleanVarName];
          }
        });
        return extractedVars;
      }
    } catch (error) {
      console.error('变量提取正则表达式错误:', error);
    }

    return {};
  }

  // 变量替换函数
  replaceVariables(text, event, commandResult = null, customVariables = {}) {
    // 处理撤回消息事件的特殊变量
    let recalledMessage = null;
    if (event.notice_type === 'group_recall' || event.notice_type === 'friend_recall') {
      recalledMessage = this.getRecalledMessage(event.message_id);
    }
    
    let result = text
      .replace(/{sender}/g, event.sender?.nickname || event.sender?.card || '未知用户')
      .replace(/{sender_id}/g, event.user_id?.toString() || '')
      .replace(/{user_id}/g, event.user_id?.toString() || '') // 用户ID（notice/request事件常用）
      .replace(/{message_id}/g, event.message_id?.toString() || '') // 消息ID（用于回复消息）
      .replace(/{text}/g, event.raw_message || '')
      .replace(/{group}/g, event.group_name || '')
      .replace(/{group_id}/g, event.group_id?.toString() || '')
      .replace(/{time}/g, new Date().toLocaleTimeString())
      .replace(/{date}/g, new Date().toLocaleDateString())
      .replace(/{bot}/g, this.loginInfo?.nickname || '机器人')
      .replace(/{bot_id}/g, this.loginInfo?.user_id?.toString() || '')
      .replace(/{at_sender}/g, `[CQ:at,qq=${event.user_id}]`) // @发送者
      .replace(/{at_all}/g, '[CQ:at,qq=all]') // @全体成员
      .replace(/{random}/g, Math.floor(Math.random() * 100 + 1).toString())
      .replace(/{result}/g, commandResult ? JSON.stringify(commandResult) : '暂无结果')
      // 新增的事件相关变量
      .replace(/{comment}/g, event.comment || '')
      .replace(/{flag}/g, event.flag || '')
      .replace(/{operator_id}/g, event.operator_id?.toString() || '')
      .replace(/{invitor_id}/g, event.invitor_id?.toString() || '')
      .replace(/{request_type}/g, event.request_type || '')
      .replace(/{notice_type}/g, event.notice_type || '')
      .replace(/{sub_type}/g, event.sub_type || '')
      .replace(/{post_type}/g, event.post_type || '')
      // 撤回消息专用变量
      .replace(/{recalled_content}/g, recalledMessage?.content || '(消息未缓存)')
      .replace(/{recalled_sender}/g, recalledMessage?.sender_nickname || '未知用户')
      .replace(/{recalled_sender_id}/g, recalledMessage?.sender_id?.toString() || event.user_id?.toString() || '')
      .replace(/{sub_type_desc}/g, this.getSubTypeDescription(event))
      // 提取变量占位符
      .replace(/{extract_flag}/g, this.extractFromMessage(event.raw_message, /\/\w+\s+(\w+)/, 1) || '')
      .replace(/{extract_reason}/g, this.extractFromMessage(event.raw_message, /\/\w+\s+\w+\s+(.+)/, 1) || '无理由')
      .replace(/{extract_user_id}/g, this.extractFromMessage(event.raw_message, /\/\w+\s+(\d+)/, 1) || '')
      .replace(/{extract_duration}/g, this.extractFromMessage(event.raw_message, /\/\w+\s+\d+\s+(\d+)/, 1) || '600')
      .replace(/{extract_notice_content}/g, this.extractFromMessage(event.raw_message, /\/发布公告\s+(.+)/, 1) || '')
      .replace(/{extract_message_id}/g, this.extractFromMessage(event.raw_message, /\/\w+\s+(\d+)/, 1) || '')
      .replace(/{extract_title}/g, this.extractFromMessage(event.raw_message, /\/设置头衔\s+\d+\s+(.+)/, 1) || '');
    
    // 替换自定义变量
    Object.entries(customVariables).forEach(([key, value]) => {
      const regex = new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g');
      result = result.replace(regex, value);
    });
    
    // 处理动态 @ 语法: {at:QQ号} 或 {at:变量名}
    result = result.replace(/\{at:(\w+)\}/g, (match, target) => {
      // 如果是纯数字，直接作为 QQ 号
      if (/^\d+$/.test(target)) {
        return `[CQ:at,qq=${target}]`;
      }
      // 如果是变量名，尝试从 event 或 customVariables 中获取
      const userId = customVariables[target] || event[target] || target;
      return `[CQ:at,qq=${userId}]`;
    });
    
    return result;
  }

  // 获取子类型描述
  getSubTypeDescription(event) {
    if (event.post_type === 'request' && event.request_type === 'group') {
      return event.sub_type === 'add' ? '申请加群' : '邀请入群';
    }
    if (event.post_type === 'notice' && event.notice_type === 'group_increase') {
      return event.sub_type === 'approve' ? '同意加群' : '邀请加群';
    }
    if (event.post_type === 'notice' && event.notice_type === 'group_decrease') {
      return event.sub_type === 'leave' ? '主动退群' : 
             event.sub_type === 'kick' ? '被踢出群' : '机器人被踢';
    }
    return event.sub_type || '未知';
  }

  // 从消息中提取特定内容
  extractFromMessage(message, regex, groupIndex = 1) {
    if (!message || typeof message !== 'string') return '';
    const match = message.match(regex);
    return match && match[groupIndex] ? match[groupIndex].trim() : '';
  }

  // 处理内置指令
  async handleBuiltinCommand(commandId, params) {
    switch (commandId) {
      case 'get_random_joke':
        const jokes = [
          // 经典程序员笑话
          '为什么程序员喜欢用黑色的屏幕？因为光明会让bug无所遁形！',
          '程序员的三大美德：懒惰、急躁和傲慢。',
          '为什么程序员总是搞混圣诞节和万圣节？因为 Oct 31 == Dec 25！',
          '程序员：世界上只有10种人，懂二进制的和不懂的。',
          'Bug就像黑洞，你越靠近它，时间过得越慢。',
          '为什么程序员不喜欢大自然？因为太多bug了！',
          '代码写得越多，头发掉得越多，这是守恒定律。',
          '程序员的浪漫：给你写个Hello World。',
          // 新增笑话
          '为什么程序员总是很冷静？因为他们经常处理异常（Exception）。',
          '程序员最讨厌的两件事：1.写文档 2.别人不写文档',
          '产品经理：这个需求很简单，改一下就好了。程序员：简单你来啊！',
          '为什么程序员不能养植物？因为忘记浇水，植物返回 null。',
          '女朋友发消息：在吗？程序员回复：返回值为 true',
          'Ctrl+C、Ctrl+V 是程序员的灵魂，学废的人叫复制粘贴，学会的人叫代码复用。',
          '为什么程序员喜欢喝咖啡？因为 Java 就是咖啡！',
          '代码能跑就别动，能用就别改，能忍就别删。',
          '世界上最遥远的距离，不是生与死，而是你的代码在我面前，我却看不懂。',
          '调试程序就像侦探小说，但你既是侦探，又是凶手，还是受害者。',
          '程序员：我没有bug！测试：你有了，只是你不知道而已。',
          '为什么程序员分不清万圣节和圣诞节？因为 Oct 31 = Dec 25（八进制31等于十进制25）'
        ];
        const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];
        return {
          retcode: 0,
          status: 'ok',
          data: { joke: randomJoke }
        };
        
      case 'roll_dice':
        const count = Math.min(params.count || 1, 10); // 限制最多10个骰子
        const sides = Math.min(params.sides || 6, 100); // 限制最多100面
        const results = [];
        for (let i = 0; i < count; i++) {
          results.push(Math.floor(Math.random() * sides) + 1);
        }
        const total = results.reduce((sum, val) => sum + val, 0);
        return {
          retcode: 0,
          status: 'ok',
          data: { 
            results: results,
            total: total,
            count: count,
            sides: sides,
            average: (total / count).toFixed(2)
          }
        };
        
      case 'flip_coin':
        const coinResult = Math.random() < 0.5 ? '正面' : '反面';
        return {
          retcode: 0,
          status: 'ok',
          data: { 
            result: coinResult,
            emoji: coinResult === '正面' ? '🌟' : '🌙'
          }
        };
        
      case 'translate_text':
        const translateSourceText = params.text || '';
        const translateTargetLang = params.target_lang || 'zh';
        
        try {
          if (!translateSourceText) {
            return {
              retcode: -1,
              status: 'failed',
              message: '翻译文本不能为空'
            };
          }
          
          // 调用腾讯云翻译API（异步）
          return translateText(translateSourceText, translateTargetLang, 'auto')
            .then(result => ({
              retcode: 0,
              status: 'ok',
              data: {
                sourceText: result.sourceText,
                targetText: result.targetText,
                sourceLang: result.sourceLang,
                targetLang: result.targetLang,
                translatedAt: new Date().toISOString()
              }
            }))
            .catch(error => ({
              retcode: -1,
              status: 'failed',
              message: '翻译失败: ' + error.message,
              data: {
                sourceText: translateSourceText,
                error: error.message
              }
            }));
        } catch (error) {
          return {
            retcode: -1,
            status: 'failed',
            message: '翻译出错: ' + error.message
          };
        }
        
      case 'start_math_verification':
        const verifyGroupId = params.group_id;
        const verifyUserId = params.user_id;
        const timeLimit = parseInt(params.time_limit) || 60; // 默认60秒
        const difficulty = params.difficulty || 'easy'; // easy/medium/hard
        
        try {
          if (!verifyGroupId || !verifyUserId) {
            return {
              retcode: -1,
              status: 'failed',
              message: '缺少必要参数：group_id 和 user_id'
            };
          }
          
          // 生成数学题目
          let num1, num2, operator, answer, question;
          
          switch (difficulty) {
            case 'easy':
              // 简单：10以内的加减法
              num1 = Math.floor(Math.random() * 10) + 1;
              num2 = Math.floor(Math.random() * 10) + 1;
              operator = Math.random() > 0.5 ? '+' : '-';
              if (operator === '-' && num1 < num2) {
                [num1, num2] = [num2, num1]; // 确保结果为正数
              }
              answer = operator === '+' ? num1 + num2 : num1 - num2;
              question = `${num1} ${operator} ${num2}`;
              break;
              
            case 'medium':
              // 中等：20以内的加减法或10以内的乘法
              if (Math.random() > 0.5) {
                num1 = Math.floor(Math.random() * 20) + 1;
                num2 = Math.floor(Math.random() * 20) + 1;
                operator = Math.random() > 0.5 ? '+' : '-';
                if (operator === '-' && num1 < num2) {
                  [num1, num2] = [num2, num1];
                }
                answer = operator === '+' ? num1 + num2 : num1 - num2;
              } else {
                num1 = Math.floor(Math.random() * 10) + 1;
                num2 = Math.floor(Math.random() * 10) + 1;
                operator = '×';
                answer = num1 * num2;
              }
              question = `${num1} ${operator} ${num2}`;
              break;
              
            case 'hard':
              // 困难：100以内的加减法或12以内的乘法
              const random = Math.random();
              if (random > 0.7) {
                // 乘法
                num1 = Math.floor(Math.random() * 12) + 1;
                num2 = Math.floor(Math.random() * 12) + 1;
                operator = '×';
                answer = num1 * num2;
              } else if (random > 0.35) {
                // 加法
                num1 = Math.floor(Math.random() * 50) + 1;
                num2 = Math.floor(Math.random() * 50) + 1;
                operator = '+';
                answer = num1 + num2;
              } else {
                // 减法
                num1 = Math.floor(Math.random() * 100) + 1;
                num2 = Math.floor(Math.random() * 100) + 1;
                if (num1 < num2) {
                  [num1, num2] = [num2, num1];
                }
                operator = '-';
                answer = num1 - num2;
              }
              question = `${num1} ${operator} ${num2}`;
              break;
              
            default:
              // 默认使用 easy 难度
              num1 = Math.floor(Math.random() * 10) + 1;
              num2 = Math.floor(Math.random() * 10) + 1;
              operator = Math.random() > 0.5 ? '+' : '-';
              if (operator === '-' && num1 < num2) {
                [num1, num2] = [num2, num1];
              }
              answer = operator === '+' ? num1 + num2 : num1 - num2;
              question = `${num1} ${operator} ${num2}`;
          }
          
          const verifyKey = `${verifyGroupId}_${verifyUserId}`;
          const startTime = Date.now();
          const expireTime = startTime + (timeLimit * 1000);
          
          // 存储验证信息
          this.verifications.set(verifyKey, {
            groupId: verifyGroupId,
            userId: verifyUserId,
            question,
            answer,
            startTime,
            expireTime,
            timeLimit,
            attempts: 0,
            maxAttempts: 3
          });
          
          console.log(`🎯 创建验证: 群${verifyGroupId} 用户${verifyUserId} 题目:${question}=${answer} 时限:${timeLimit}秒`);
          
          // 设置超时定时器
          const timer = setTimeout(() => {
            this.handleVerificationTimeout(verifyKey);
          }, timeLimit * 1000);
          
          this.verificationTimers.set(verifyKey, timer);
          
          return {
            retcode: 0,
            status: 'ok',
            data: {
              question,
              timeLimit,
              difficulty,
              expireTime: new Date(expireTime).toISOString()
            }
          };
          
        } catch (error) {
          console.error('❌ 创建验证失败:', error);
          return {
            retcode: -1,
            status: 'failed',
            message: '创建验证失败: ' + error.message
          };
        }
        
      case 'check_url_safely':
        const checkUrl = params.url || '';
        
        try {
          // 检查URL格式
          if (!checkUrl || typeof checkUrl !== 'string') {
            return {
              retcode: -1,
              status: 'failed',
              message: 'URL不能为空'
            };
          }
          
          console.log('🔍 URL安全检查 - 收到URL:', checkUrl);
          
          // 初始化检测结果
          let urlToCheck = checkUrl.trim();
          const urlLower = urlToCheck.toLowerCase();
          let riskScore = 0; // 风险评分 0-100
          const findings = {
            critical: [],  // 严重风险
            warning: [],   // 警告
            info: [],      // 信息提示
            safe: []       // 安全特征
          };
          
          // 连接测试信息
          const connectionInfo = {
            reachable: false,
            responseTime: null,
            statusCode: null,
            error: null
          };
          
          // 自动补全协议（如果没有协议）
          if (!urlLower.startsWith('http://') && 
              !urlLower.startsWith('https://') && 
              !urlLower.startsWith('ftp://') && 
              !urlLower.startsWith('ws://') &&
              !urlLower.startsWith('wss://')) {
            urlToCheck = 'https://' + urlToCheck;
            findings.info.push('ℹ️ 已自动添加HTTPS协议');
            console.log('🔧 自动补全协议:', urlToCheck);
          }
          
          // ==================== SSRF 防护：严格阻止危险地址 ====================
          let parsedUrl;
          try {
            parsedUrl = new URL(urlToCheck);
          } catch (e) {
            return {
              retcode: -1,
              status: 'failed',
              message: `URL格式不合法: ${e.message}`,
              data: { error: 'invalid_url' }
            };
          }
          
          const hostname = parsedUrl.hostname.toLowerCase();
          const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80');
          
          // 阻止本地地址
          const localhostVariants = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1'];
          if (localhostVariants.includes(hostname)) {
            console.warn(`🚨 SSRF攻击尝试被阻止: ${hostname}`);
            return {
              retcode: -1,
              status: 'blocked',
              message: '🚫 安全限制：不允许检查本地地址 (localhost/127.0.0.1)',
              data: { 
                error: 'ssrf_blocked',
                reason: 'localhost_blocked',
                url: checkUrl
              }
            };
          }
          
          // 阻止内网IP地址
          const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
          const ipMatch = hostname.match(ipv4Pattern);
          if (ipMatch) {
            const [, a, b, c, d] = ipMatch.map(Number);
            
            // 检查是否为内网IP段
            const isPrivateIP = (
              a === 10 ||  // 10.0.0.0/8
              (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12
              (a === 192 && b === 168) ||  // 192.168.0.0/16
              a === 127 ||  // 127.0.0.0/8 (回环)
              (a === 169 && b === 254) ||  // 169.254.0.0/16 (链路本地/云元数据!)
              a === 0 ||  // 0.0.0.0/8
              a >= 224  // 224.0.0.0/4 (组播) 和 240.0.0.0/4 (保留)
            );
            
            if (isPrivateIP) {
              console.warn(`🚨 SSRF攻击尝试被阻止: ${hostname} (内网IP)`);
              
              let reason = '内网地址';
              if (a === 169 && b === 254) {
                reason = '云服务元数据地址 (AWS/阿里云等)';
              } else if (a === 127) {
                reason = '回环地址';
              }
              
              return {
                retcode: -1,
                status: 'blocked',
                message: `🚫 安全限制：不允许检查${reason}`,
                data: { 
                  error: 'ssrf_blocked',
                  reason: 'private_ip_blocked',
                  ip: hostname,
                  details: reason
                }
              };
            }
          }
          
          // 阻止访问敏感端口
          const blockedPorts = [
            '22',    // SSH
            '23',    // Telnet
            '25',    // SMTP
            '3306',  // MySQL
            '5432',  // PostgreSQL
            '6379',  // Redis
            '27017', // MongoDB
            '9200',  // Elasticsearch
            '11211', // Memcached
            '1433',  // MS SQL
            '3389',  // RDP
            '5900',  // VNC
            '8080',  // 常见后台端口
            '8888',  // 常见后台端口
            '9090',  // 常见后台端口
            '3000',  // Node.js开发端口
            '5000',  // Flask开发端口
            '8000'   // Django开发端口
          ];
          
          if (blockedPorts.includes(port)) {
            console.warn(`🚨 SSRF攻击尝试被阻止: 端口 ${port}`);
            return {
              retcode: -1,
              status: 'blocked',
              message: `🚫 安全限制：不允许检查敏感端口 ${port}`,
              data: { 
                error: 'ssrf_blocked',
                reason: 'blocked_port',
                port: port
              }
            };
          }
          
          console.log('✅ SSRF检查通过，继续安全检测...');
          
          // ==================== 1. 协议安全检查 ====================
          const finalUrlLower = urlToCheck.toLowerCase();
          if (!finalUrlLower.startsWith('http://') && !finalUrlLower.startsWith('https://') && 
              !finalUrlLower.startsWith('ftp://') && !finalUrlLower.startsWith('ws://') &&
              !finalUrlLower.startsWith('wss://')) {
            findings.critical.push('🚨 使用不安全或未知协议');
            riskScore += 40;
          } else if (finalUrlLower.startsWith('https://')) {
            findings.safe.push('✅ 使用HTTPS加密连接');
          } else if (finalUrlLower.startsWith('http://')) {
            findings.warning.push('⚠️ 使用HTTP明文传输（数据可能被窃听）');
            riskScore += 15;
          } else if (finalUrlLower.startsWith('ftp://')) {
            findings.warning.push('⚠️ 使用FTP协议（缺乏安全机制）');
            riskScore += 20;
          }
          
          // ==================== 2. 域名合法性检查 ====================
          // parsedUrl 已在 SSRF 防护中创建
          console.log('✅ URL解析成功:', parsedUrl.hostname);
          
          const checkHostname = parsedUrl.hostname;
          
          // 检查是否为IP地址（复用前面的正则）
          const ipv6Pattern = /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;
          if (/^(\d{1,3}\.){3}\d{1,3}$/.test(checkHostname)) {
            findings.warning.push('⚠️ 使用IPv4地址访问（可疑，正规网站通常使用域名）');
            riskScore += 25;
            // 注意：内网IP已在SSRF防护中被阻止
          } else if (ipv6Pattern.test(checkHostname)) {
            findings.info.push('ℹ️ 使用IPv6地址');
            riskScore += 10;
          }
          
          // 域名长度检查（过长可能是钓鱼）
          if (checkHostname.length > 50) {
            findings.warning.push(`⚠️ 域名过长（${checkHostname.length}字符，可能是钓鱼网站）`);
            riskScore += 20;
          }
          
          // 检查多级子域名（超过3级可疑）
          const domainParts = checkHostname.split('.');
          if (domainParts.length > 4) {
            findings.warning.push(`⚠️ 多级子域名（${domainParts.length}级，可能用于混淆）`);
            riskScore += 15;
          }
          
          // 同形异义字符检测（国际化域名钓鱼）
          if (/[а-яА-Я]/.test(checkHostname) || /[α-ωΑ-Ω]/.test(checkHostname)) {
            findings.critical.push('🚨 包含西里尔/希腊字母（可能是IDN同形异义字钓鱼）');
            riskScore += 45;
          }
          
          // 检查可疑TLD
          const suspiciousTLDs = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.win', '.bid'];
          const tld = '.' + domainParts[domainParts.length - 1];
          if (suspiciousTLDs.includes(tld)) {
            findings.warning.push(`⚠️ 可疑顶级域名${tld}（常被滥用）`);
            riskScore += 20;
          }
          
          // 检查端口（敏感端口已在SSRF防护中被阻止）
          if (parsedUrl.port) {
            const unusualPorts = ['8443', '9443'];
            if (unusualPorts.includes(parsedUrl.port)) {
              findings.warning.push(`⚠️ 使用非标准端口${parsedUrl.port}`);
              riskScore += 10;
            }
          } else if (parsedUrl.protocol === 'https:') {
            findings.safe.push('✅ 使用标准HTTPS端口443');
          }
          
          // ==================== 3. 路径和参数检查 ====================
          // 检查危险文件扩展名
          const dangerousExts = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.ps1', '.msi', '.jar', '.apk'];
          const pathname = parsedUrl.pathname.toLowerCase();
          for (const ext of dangerousExts) {
            if (pathname.endsWith(ext)) {
              findings.critical.push(`🚨 可执行文件链接${ext}（高风险下载）`);
              riskScore += 50;
              break;
            }
          }
          
          // 检查URL编码混淆
          const urlEncodedCount = (checkUrl.match(/%[0-9a-f]{2}/gi) || []).length;
          if (urlEncodedCount > 5) {
            findings.warning.push(`⚠️ 大量URL编码（${urlEncodedCount}处，可能用于混淆）`);
            riskScore += 15;
          }
          
          // 检查@符号（钓鱼常用技巧）
          if (checkUrl.includes('@')) {
            findings.critical.push('🚨 URL包含@符号（钓鱼常用技巧，实际访问@后的域名）');
            riskScore += 45;
          }
          
          // 检查过长的查询参数
          if (parsedUrl.search && parsedUrl.search.length > 200) {
            findings.warning.push(`⚠️ 查询参数过长（${parsedUrl.search.length}字符）`);
            riskScore += 10;
          }
          
          // ==================== 4. 危险关键词检测 ====================
          const criticalKeywords = ['phishing', 'malware', 'ransomware', 'trojan', '钓鱼', '木马', '勒索'];
          const warningKeywords = ['crack', 'keygen', 'serial', 'patch', 'hack', 'free-download', 
                                    '破解', '注册机', '激活', '黑客', '免费下载'];
          
          for (const keyword of criticalKeywords) {
            if (urlLower.includes(keyword)) {
              findings.critical.push(`🚨 包含高危关键词: "${keyword}"`);
              riskScore += 35;
            }
          }
          
          for (const keyword of warningKeywords) {
            if (urlLower.includes(keyword)) {
              findings.warning.push(`⚠️ 包含可疑关键词: "${keyword}"`);
              riskScore += 15;
            }
          }
          
          // ==================== 5. 短链和重定向检测 ====================
          const shortLinkDomains = [
            'bit.ly', 't.cn', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 
            'buff.ly', 'adf.ly', 'short.link', 'suo.im', 'dwz.cn'
          ];
          
          for (const domain of shortLinkDomains) {
            if (urlLower.includes(domain)) {
              findings.warning.push(`⚠️ 短链服务${domain}（无法预知真实目标）`);
              riskScore += 20;
              break;
            }
          }
          
          // ==================== 6. 可信域名白名单 ====================
          const trustedDomains = [
            'github.com', 'google.com', 'microsoft.com', 'apple.com', 'amazon.com',
            'baidu.com', 'qq.com', 'taobao.com', 'jd.com', 'alipay.com', 'weixin.qq.com',
            'bilibili.com', 'zhihu.com', 'csdn.net', 'stackoverflow.com'
          ];
          
          const isTrusted = trustedDomains.some(td => 
            checkHostname === td || checkHostname.endsWith('.' + td)
          );
          
          if (isTrusted && parsedUrl.protocol === 'https:') {
            findings.safe.push('✅ 来自可信域名');
            riskScore = Math.max(0, riskScore - 30);
          }
          
          // ==================== 7. 计算最终风险等级 ====================
          riskScore = Math.min(100, Math.max(0, riskScore));
          let riskLevel, riskColor, isSafe;
          
          if (riskScore >= 70) {
            riskLevel = '极高';
            riskColor = 'critical';
            isSafe = false;
          } else if (riskScore >= 50) {
            riskLevel = '高';
            riskColor = 'danger';
            isSafe = false;
          } else if (riskScore >= 30) {
            riskLevel = '中';
            riskColor = 'warning';
            isSafe = false;
          } else if (riskScore >= 10) {
            riskLevel = '低';
            riskColor = 'info';
            isSafe = true;
          } else {
            riskLevel = '安全';
            riskColor = 'safe';
            isSafe = true;
          }
          
          // ==================== 8. 连接测试（仅HTTP/HTTPS）====================
          if (parsedUrl && (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:')) {
            try {
              const https = await import('https');
              const http = await import('http');
              const startTime = Date.now();
              const requestModule = parsedUrl.protocol === 'https:' ? https : http;
              
              await new Promise((resolve) => {
                const options = {
                  hostname: parsedUrl.hostname,
                  port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                  path: parsedUrl.pathname + parsedUrl.search,
                  method: 'HEAD',
                  timeout: 8000, // 增加到8秒
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*'
                  },
                  // 对于HTTPS，禁用证书验证（仅用于测试可达性）
                  rejectUnauthorized: false
                };
                
                const req = requestModule.request(options, (res) => {
                  connectionInfo.responseTime = Date.now() - startTime;
                  connectionInfo.statusCode = res.statusCode;
                  
                  // 2xx, 3xx 都算成功
                  if (res.statusCode >= 200 && res.statusCode < 400) {
                    connectionInfo.reachable = true;
                  } else if (res.statusCode >= 400 && res.statusCode < 500) {
                    // 4xx 客户端错误，但服务器是可达的
                    connectionInfo.reachable = true;
                    findings.info.push(`ℹ️ HTTP ${res.statusCode} - 客户端错误`);
                  } else if (res.statusCode >= 500) {
                    // 5xx 服务器错误，但服务器是可达的
                    connectionInfo.reachable = true;
                    findings.warning.push(`⚠️ HTTP ${res.statusCode} - 服务器错误`);
                  }
                  
                  resolve();
                });
                
                req.on('error', (err) => {
                  // 尝试使用GET方法重试（某些服务器不支持HEAD）
                  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
                    connectionInfo.error = err.code === 'ENOTFOUND' ? 'DNS解析失败' : 
                                         err.code === 'ECONNREFUSED' ? '连接被拒绝' : '连接超时';
                    connectionInfo.reachable = false;
                  } else {
                    // 其他错误，尝试用GET重试
                    const retryOptions = { ...options, method: 'GET' };
                    const retryReq = requestModule.request(retryOptions, (res) => {
                      connectionInfo.responseTime = Date.now() - startTime;
                      connectionInfo.statusCode = res.statusCode;
                      connectionInfo.reachable = res.statusCode < 500;
                      resolve();
                    });
                    
                    retryReq.on('error', () => {
                      connectionInfo.error = '无法连接';
                      resolve();
                    });
                    
                    retryReq.on('timeout', () => {
                      connectionInfo.error = '连接超时';
                      retryReq.destroy();
                      resolve();
                    });
                    
                    retryReq.end();
                    return;
                  }
                  resolve();
                });
                
                req.on('timeout', () => {
                  connectionInfo.error = '连接超时(>8s)';
                  req.destroy();
                  resolve();
                });
                
                req.end();
              });
            } catch (err) {
              connectionInfo.error = '连接测试异常';
            }
          }
          
          // ==================== 9. 安全建议 ====================
          const recommendations = [];
          if (riskScore >= 50) {
            recommendations.push('🛑 强烈建议不要访问此链接');
            recommendations.push('📢 如收到此链接，请向发送者核实真实性');
          } else if (riskScore >= 30) {
            recommendations.push('⚠️ 谨慎访问，建议先核实链接来源');
            recommendations.push('🔒 不要在该网站输入敏感信息');
          } else if (riskScore >= 10) {
            recommendations.push('ℹ️ 注意保护个人信息');
          } else {
            recommendations.push('✅ 链接看起来较为安全');
          }
          
          return {
            retcode: 0,
            status: 'ok',
            data: {
              url: urlToCheck, // 返回处理后的URL
              originalUrl: checkUrl, // 保留原始URL
              safe: isSafe,
              riskScore: riskScore,
              riskLevel: riskLevel,
              riskColor: riskColor,
              protocol: parsedUrl ? parsedUrl.protocol.replace(':', '').toUpperCase() : 'UNKNOWN',
              domain: parsedUrl ? parsedUrl.hostname : 'N/A',
              findings: findings,
              totalFindings: findings.critical.length + findings.warning.length + findings.info.length,
              recommendations: recommendations,
              connection: connectionInfo,
              checkedAt: new Date().toISOString()
            }
          };
        } catch (error) {
          return {
            retcode: -1,
            status: 'failed',
            message: 'URL安全检查异常: ' + error.message,
            data: { url: checkUrl, safe: false, riskScore: 100 }
          };
        }
        
      default:
        return {
          retcode: -1,
          status: 'failed',
          message: `未实现的内置指令: ${commandId}`
        };
    }
  }

  // 加载规则
  loadRules() {
    try {
      const rulesPath = path.join(__dirname, '../data', 'event-rules.json');
      if (fs.existsSync(rulesPath)) {
        const savedRules = fs.readFileSync(rulesPath, 'utf8');
        this.rules = JSON.parse(savedRules);
        logger.info('事件规则', `已加载 ${this.rules.length} 个`);
      } else {
        // 创建默认规则
        this.rules = this.getDefaultRules();
        this.saveRules();
        console.log('📋 已创建默认事件规则');
      }
    } catch (error) {
      console.error('加载事件规则失败:', error);
      this.rules = this.getDefaultRules();
    }
  }

  // 保存规则
  saveRules() {
    try {
      const dataDir = path.join(__dirname, '../data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const rulesPath = path.join(dataDir, 'event-rules.json');
      fs.writeFileSync(rulesPath, JSON.stringify(this.rules, null, 2));
      console.log('📋 事件规则已保存');
      
      // 通知前端规则已更新
      this.notifyRulesChanged();
    } catch (error) {
      console.error('保存事件规则失败:', error);
    }
  }

  // 通知前端规则变更
  notifyRulesChanged() {
    if (this.broadcastCallback) {
      this.broadcastCallback({
        type: 'rules_updated',
        data: {
          rules: this.rules,
          timestamp: new Date().toISOString(),
          message: '规则已更新'
        }
      });
      console.log('📡 已通知前端规则变更');
    }
  }

  // 手动重新加载规则（用于热重载）
  reloadRules() {
    console.log('🔄 手动重新加载规则...');
    this.loadRules();
    this.notifyRulesChanged();
    return this.rules;
  }

  // 获取默认规则
  getDefaultRules() {
    return [
      {
        id: 'default_hello',
        name: '问候回复',
        description: '当用户说你好时自动回复',
        enabled: true,
        eventType: 'message',
        environment: 'all',
        groupId: 'default',
        priority: 1,
        cooldown: 0,
        adminOnly: false,
        conditions: [
          {
            type: 'keyword',
            operator: 'contains',
            value: '你好'
          }
        ],
        actions: [
          {
            type: 'reply',
            params: {
              message: '你好！我是机器人助手，有什么可以帮助您的吗？',
              variables: false
            }
          }
        ],
        triggerCount: 0,
        lastTriggered: null
      },
      {
        id: 'default_time',
        name: '时间查询',
        description: '查询当前时间',
        enabled: true,
        eventType: 'message',
        environment: 'all',
        groupId: 'fun',
        priority: 1,
        cooldown: 0,
        adminOnly: false,
        conditions: [
          {
            type: 'keyword',
            operator: 'contains',
            value: '现在几点'
          }
        ],
        actions: [
          {
            type: 'reply',
            params: {
              message: '现在时间是：{time}',
              variables: true
            }
          }
        ],
        triggerCount: 0,
        lastTriggered: null
      }
    ];
  }

  // 缓存消息（用于撤回检测）
  cacheMessage(event) {
    if (event.post_type !== 'message' || !event.message_id) return;
    
    // 提取消息内容
    let messageContent = '';
    if (Array.isArray(event.message)) {
      messageContent = event.message
        .filter(seg => seg.type === 'text')
        .map(seg => seg.data?.text || '')
        .join('');
    } else {
      messageContent = event.raw_message || '';
    }
    
    // 存储消息信息
    this.messageCache.set(event.message_id, {
      content: messageContent,
      sender_id: event.user_id,
      sender_nickname: event.sender?.nickname || event.sender?.card || '未知用户',
      group_id: event.group_id || null,
      message_type: event.message_type,
      time: Date.now(),
      raw_message: event.raw_message
    });
    
    // 限制缓存大小
    if (this.messageCache.size > this.MESSAGE_CACHE_SIZE) {
      const keysToDelete = Array.from(this.messageCache.keys()).slice(0, 100);
      keysToDelete.forEach(key => this.messageCache.delete(key));
    }
  }
  
  // 清理过期的消息缓存
  cleanExpiredMessageCache() {
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [messageId, cachedMsg] of this.messageCache.entries()) {
      if (now - cachedMsg.time > this.MESSAGE_CACHE_TTL) {
        keysToDelete.push(messageId);
      }
    }
    
    keysToDelete.forEach(key => this.messageCache.delete(key));
    
    if (keysToDelete.length > 0) {
      console.log(`🧹 清理了 ${keysToDelete.length} 条过期消息缓存`);
    }
  }
  
  // 从缓存获取撤回的消息
  getRecalledMessage(messageId) {
    return this.messageCache.get(messageId) || null;
  }

  // 处理事件
  async handleEvent(event) {
    // 缓存消息（用于撤回检测）
    if (event.post_type === 'message') {
      this.cacheMessage(event);
    }
    
    // 生成事件唯一标识
    const eventKey = `${event.message_id || event.time}_${event.user_id}_${event.group_id || 'private'}_${event.post_type}`;
    
    // 提取消息内容用于日志
    let messageContent = '';
    if (event.post_type === 'message') {
      if (Array.isArray(event.message)) {
        messageContent = event.message
          .filter(seg => seg.type === 'text')
          .map(seg => seg.data?.text || '')
          .join('');
      } else {
        messageContent = event.raw_message || '';
      }
      
      // 🎯 过滤不需要处理的消息
      const trimmedContent = messageContent.trim();
      
      // 跳过空消息
      if (!trimmedContent) {
        return;
      }
      
      // 检查是否为纯图片/表情/其他非文本消息
      if (Array.isArray(event.message)) {
        const hasText = event.message.some(seg => seg.type === 'text' && seg.data?.text?.trim());
        if (!hasText) {
          // 没有文本内容，跳过处理（纯图片、表情等）
          return;
        }
      }
    } else {
      // 为非消息事件生成描述
      messageContent = this.generateEventDescription(event);
    }
    
    // 检查事件是否已处理过
    if (this.processedEvents.has(eventKey)) {
      return; // 静默跳过重复事件
    }
    
    // 添加到已处理记录
    this.processedEvents.add(eventKey);
    
    // 🎯 优先检查是否有进行中的验证（针对消息事件）
    if (event.post_type === 'message' && event.group_id) {
      const verifyKey = `${event.group_id}_${event.user_id}`;
      const verification = this.verifications.get(verifyKey);
      
      if (verification) {
        // 用户正在进行验证，检查答案
        const userAnswer = messageContent.trim();
        const result = this.checkVerificationAnswer(verifyKey, userAnswer);
        
        if (result) {
          // 验证完成（成功或失败），不再继续处理其他规则
          return;
        }
      }
    }
    
    // 🔄 收集统计数据
    if (event.post_type === 'message') {
      this.collectMessageStats(event, messageContent);
    } else {
      this.collectEventStats(event, messageContent);
    }
    
    // 清理过期的事件记录
    if (this.processedEvents.size > this.EVENT_CACHE_SIZE) {
      const eventsToKeep = Array.from(this.processedEvents).slice(-this.EVENT_CACHE_SIZE / 2);
      this.processedEvents.clear();
      eventsToKeep.forEach(key => this.processedEvents.add(key));
    }
    
    // 不需要每次都重新加载规则，只有在规则变更时才加载
    // this.loadRules(); // 移除频繁的文件加载
    
    let matchedRules = 0;
    
    // 按优先级排序规则（数字越小优先级越高）
    const sortedRules = [...this.rules].sort((a, b) => (a.priority || 999) - (b.priority || 999));
    
    for (const rule of sortedRules) {
      if (!rule.enabled) continue;
      
      // 检查事件类型匹配
      if (rule.eventType !== event.post_type) continue;
      
      // 检查适用环境匹配
      if (!this.checkEnvironment(rule.environment || 'all', event)) continue;
      
      // 检查管理员权限
      if (rule.adminOnly && !this.isAdmin(event.user_id)) {
        continue; // 静默跳过
      }
      
      // 检查冷却时间
      if (rule.cooldown > 0 && rule.lastTriggered) {
        const timeSinceLastTrigger = Date.now() - new Date(rule.lastTriggered).getTime();
        const cooldownMs = rule.cooldown * 1000;
        if (timeSinceLastTrigger < cooldownMs) {
          continue; // 静默跳过冷却中的规则
        }
      }
      
      // 检查条件匹配
      if (await this.checkConditions(rule.conditions, event)) {
        matchedRules++;
        
        // 只在有规则匹配时输出日志
        if (matchedRules === 1) {
          // 首次匹配时输出事件信息
          console.log(`📨 处理事件: ${event.post_type} - "${messageContent.substring(0, 50)}${messageContent.length > 50 ? '...' : ''}"`);
        }
        
        console.log(`✅ 规则匹配 [${matchedRules}]: ${rule.name}`);
        
        // 执行动作
        await this.executeActions(rule.actions, event);
        
        // 更新触发统计
        this.updateRuleStats(rule.id);
      }
    }
    
    // 如果有匹配规则，输出总结
    if (matchedRules > 0) {
      console.log(`📈 匹配 ${matchedRules} 条规则`);
      if (matchedRules > 1) {
        console.warn(`⚠️ 多个规则匹配同一事件`);
      }
    }
  }

  // 检查条件是否匹配
  async checkConditions(conditions, event) {
    for (const condition of conditions) {
      if (!(await this.checkSingleCondition(condition, event))) {
        return false;
      }
    }
    return true;
  }

  // 检查单个条件
  async checkSingleCondition(condition, event) {
    let testValue = '';
    
    // 移除条件检查日志，减少噪音
    
    switch (condition.type) {
      case 'keyword':
        // 从消息中提取文本
        if (Array.isArray(event.message)) {
          testValue = event.message
            .filter(seg => seg.type === 'text')
            .map(seg => seg.data?.text || '')
            .join('');
        } else {
          testValue = event.raw_message || '';
        }
        
        // 如果关键词包含变量，需要特殊处理
        const customVars = this.extractCustomVariables(condition.value);
        if (customVars.length > 0) {
          // 提取变量值并存储到event对象中供后续使用（静默）
          const extractedVars = this.extractVariableValues(condition.value, testValue);
          
          // 将提取的变量存储到event对象中
          if (!event._extractedVars) {
            event._extractedVars = {};
          }
          Object.assign(event._extractedVars, extractedVars);
          
          // 使用正则匹配来检查是否符合模式
          try {
            const regex = this.generateExtractionRegex(condition.value);
            return regex.test(testValue);
          } catch (error) {
            console.error('变量匹配错误:', error);
            return false;
          }
        }
        break;
        
      case 'user_id':
        testValue = event.user_id?.toString() || '';
        break;
        
      case 'group_id':
        testValue = event.group_id?.toString() || '';
        break;
        
      case 'message_type':
        testValue = event.message_type || '';
        break;

      // 新增的条件类型
      case 'request_type':
        testValue = event.request_type || '';
        break;

      case 'notice_type':
        testValue = event.notice_type || '';
        break;

      case 'sub_type':
        testValue = event.sub_type || '';
        break;

      case 'post_type':
        testValue = event.post_type || '';
        break;
        
      case 'at_bot':
        // 检查是否@了机器人
        console.log(`🤖 检查@机器人条件:`);
        console.log(`  - 机器人ID (self_id): ${event.self_id}`);
        console.log(`  - 登录信息中的ID: ${this.loginInfo?.user_id}`);
        console.log(`  - 消息类型: ${Array.isArray(event.message) ? 'array' : typeof event.message}`);
        
        if (Array.isArray(event.message)) {
          const atSegments = event.message.filter(seg => seg.type === 'at');
          console.log(`  - 找到 ${atSegments.length} 个@消息段:`, atSegments.map(seg => ({
            type: seg.type,
            qq: seg.data?.qq,
            name: seg.data?.name
          })));
          
          const hasAtBot = event.message.some(seg => 
            seg.type === 'at' && 
            (seg.data?.qq === event.self_id?.toString() || 
             seg.data?.qq === this.loginInfo?.user_id?.toString() || 
             seg.data?.qq === 'all')
          );
          testValue = hasAtBot ? 'true' : 'false';
          console.log(`  - @机器人检测结果: ${testValue}`);
        } else {
          console.log(`  - 消息格式不是数组，设置为false`);
          testValue = 'false';
        }
        break;
        
      case 'is_admin':
        testValue = this.isAdmin(event.user_id) ? 'true' : 'false';
        break;
        
      case 'message_length':
        let messageText = '';
        if (Array.isArray(event.message)) {
          messageText = event.message
            .filter(seg => seg.type === 'text')
            .map(seg => seg.data?.text || '')
            .join('');
        } else {
          messageText = event.raw_message || '';
        }
        testValue = messageText.length;
        break;
        
      case 'time_range':
        const currentHour = new Date().getHours();
        testValue = currentHour;
        break;
        
      default:
        return false;
    }
    
    const result = this.checkConditionMatch(testValue, condition.operator, condition.value, condition.value2);
    return result;
  }

  // 检查条件匹配
  checkConditionMatch(testValue, operator, conditionValue, conditionValue2) {
    // 移除条件匹配检查日志，减少噪音
    
    const result = (() => {
      switch (operator) {
        case 'equals':
          return testValue.toString() === conditionValue;
        
      case 'contains':
        return testValue.toString().includes(conditionValue);
        
      case 'starts_with':
        return testValue.toString().startsWith(conditionValue);
        
      case 'ends_with':
        return testValue.toString().endsWith(conditionValue);
        
      case 'regex':
        try {
          const regex = new RegExp(conditionValue, 'i');
          return regex.test(testValue.toString());
        } catch (error) {
          console.error('正则表达式错误:', error);
          return false;
        }
        
      case 'greater_than':
        const numValue1 = typeof testValue === 'number' ? testValue : parseFloat(testValue);
        const numCondition1 = parseFloat(conditionValue);
        return !isNaN(numValue1) && !isNaN(numCondition1) && numValue1 > numCondition1;
        
      case 'less_than':
        const numValue2 = typeof testValue === 'number' ? testValue : parseFloat(testValue);
        const numCondition2 = parseFloat(conditionValue);
        return !isNaN(numValue2) && !isNaN(numCondition2) && numValue2 < numCondition2;
        
      case 'between':
        if (!conditionValue2) return false;
        const numValue3 = typeof testValue === 'number' ? testValue : parseFloat(testValue);
        const numCondition3 = parseFloat(conditionValue);
        const numCondition4 = parseFloat(conditionValue2);
        return !isNaN(numValue3) && !isNaN(numCondition3) && !isNaN(numCondition4) && 
               numValue3 >= numCondition3 && numValue3 <= numCondition4;
        
        default:
          return false;
      }
    })();
    
    return result;
  }

  // 执行动作
  async executeActions(actions, event) {
    for (const action of actions) {
      try {
        await this.executeSingleAction(action, event);
      } catch (error) {
        console.error('执行动作失败:', action, error);
      }
    }
  }

  // 执行单个动作
  async executeSingleAction(action, event) {
    console.log(`🎬 执行动作: ${action.type}`);
    
    switch (action.type) {
      case 'reply':
        if (action.params.message && this.sendMessageCallback) {
          // 确定消息目标和类型（兼容 message, notice, request 事件）
          let chatId, messageType;
          
          if (event.group_id) {
            // 群聊事件（message/notice/request 都可能有 group_id）
            chatId = event.group_id.toString();
            messageType = 'group';
          } else if (event.user_id) {
            // 私聊事件
            chatId = event.user_id.toString();
            messageType = 'private';
          } else {
            console.error('⚠️ 无法确定消息目标，事件缺少 group_id 和 user_id');
            break;
          }
          
          const processedMessage = action.params.variables 
            ? this.replaceVariables(action.params.message, event, null, event._extractedVars || {})
            : action.params.message;
          
          // 构造消息选项，支持回复消息
          const messageOptions = {};
          if (action.params.replyToMessage !== false && event.message_id) {
            messageOptions.replyTo = event.message_id;
          }
          
          console.log(`🤖 执行自动回复 -> 目标: ${chatId}, 类型: ${messageType}, 消息: "${processedMessage}"`);
          console.log(`📝 使用的自定义变量:`, event._extractedVars || {});
          if (messageOptions.replyTo) {
            console.log(`💬 回复消息ID: ${messageOptions.replyTo}`);
          }
          
          await this.sendMessageCallback(chatId, processedMessage, messageType, messageOptions);
        } else {
          console.warn('⚠️ reply动作缺少必要参数或回调函数');
        }
        break;
        
      case 'send_private':
        if (action.params.message && action.params.target && this.sendMessageCallback) {
          const processedMessage = action.params.variables 
            ? this.replaceVariables(action.params.message, event, null, event._extractedVars || {})
            : action.params.message;
          
          // 构造消息选项
          const messageOptions = {};
          if (action.params.replyTo) {
            messageOptions.replyTo = action.params.replyTo;
          }
          
          console.log(`📤 发送私聊消息到 ${action.params.target}: ${processedMessage}`);
          if (messageOptions.replyTo) {
            console.log(`💬 回复消息ID: ${messageOptions.replyTo}`);
          }
          
          await this.sendMessageCallback(action.params.target, processedMessage, 'private', messageOptions);
        }
        break;
        
      case 'send_group':
        if (action.params.message && action.params.target && this.sendMessageCallback) {
          const processedMessage = action.params.variables 
            ? this.replaceVariables(action.params.message, event, null, event._extractedVars || {})
            : action.params.message;
          
          // 构造消息选项
          const messageOptions = {};
          if (action.params.replyTo) {
            messageOptions.replyTo = action.params.replyTo;
          }
          
          console.log(`📤 发送群消息到 ${action.params.target}: ${processedMessage}`);
          if (messageOptions.replyTo) {
            console.log(`💬 回复消息ID: ${messageOptions.replyTo}`);
          }
          
          await this.sendMessageCallback(action.params.target, processedMessage, 'group', messageOptions);
        }
        break;
        
      case 'log':
        if (this.addLogCallback) {
          this.addLogCallback({
            id: `auto_log_${Date.now()}`,
            timestamp: new Date().toISOString(),
            level: action.params.level || 'INFO',
            message: '自动化规则日志',
            details: action.params.message || '规则触发',
            source: 'event_rule'
          });
        }
        break;
        
      case 'delay':
        const delayTime = action.params.delay || 1000;
        console.log(`⏱️ 延迟 ${delayTime}ms`);
        await new Promise(resolve => setTimeout(resolve, delayTime));
        break;

      case 'execute_command':
        if (action.params.commandId && this.callApiCallback) {
          console.log(`⚡ 执行指令: ${action.params.commandId}`);
          
          // 增加API调用统计
          this.stats.totalApiCalls++;
          
          try {
            // 根据指令ID映射到实际的LLOneBot API
            let actualApiAction = null;
            let actualApiParams = {};
            
            // 解析指令参数（如果有的话）
            const commandArgs = action.params.commandArgs || [];
            
            // 替换指令参数中的变量（包括自定义变量）
            const processedArgs = commandArgs.map(arg => 
              this.replaceVariables(arg, event, null, event._extractedVars || {})
            );
            
            console.log(`🔧 原始参数:`, commandArgs);
            console.log(`🔧 处理后参数:`, processedArgs);
            console.log(`🔧 可用自定义变量:`, event._extractedVars || {});
            
            switch (action.params.commandId) {
              case 'get_user_info':
                actualApiAction = 'get_stranger_info';
                // 如果有参数则使用参数中的user_id，否则使用当前发送者
                const targetUserId = processedArgs.length > 0 ? 
                  parseInt(processedArgs[0]) : 
                  parseInt(event.user_id);
                actualApiParams = {
                  user_id: targetUserId
                };
                break;
                
              case 'send_like':
                actualApiAction = 'send_like';
                const likeUserId = processedArgs.length > 0 ? 
                  parseInt(processedArgs[0]) : 
                  parseInt(event.user_id);
                const likeTimes = processedArgs.length > 1 ? 
                  parseInt(processedArgs[1]) : 1;
                actualApiParams = {
                  user_id: likeUserId,
                  times: likeTimes
                };
                break;
                
              case 'delete_friend':
                actualApiAction = 'delete_friend';
                const deleteFriendId = processedArgs.length > 0 ? 
                  parseInt(processedArgs[0]) : 
                  parseInt(event.user_id);
                actualApiParams = {
                  user_id: deleteFriendId
                };
                break;
                
              case 'approve_friend_request':
                actualApiAction = 'set_friend_add_request';
                if (processedArgs.length < 2) {
                  throw new Error('处理好友申请需要提供请求ID和处理结果');
                }
                const friendRequestFlag = processedArgs[0];
                const approveText = processedArgs[1].toLowerCase();
                const approve = ['true', '1', '是', '同意', 'yes'].includes(approveText);
                const remark = processedArgs.length > 2 ? processedArgs[2] : '';
                actualApiParams = {
                  flag: friendRequestFlag,
                  approve: approve,
                  remark: remark
                };
                break;
                
              case 'set_avatar':
                actualApiAction = 'set_qq_avatar';
                if (processedArgs.length === 0) {
                  throw new Error('设置头像需要提供文件路径或URL');
                }
                const avatarFile = processedArgs[0];
                actualApiParams = {
                  file: avatarFile
                };
                break;
                
              case 'get_login_info':
                actualApiAction = 'get_login_info';
                actualApiParams = {};
                break;
                
              case 'get_friend_list':
                actualApiAction = 'get_friend_list';
                actualApiParams = {};
                break;
                
              case 'get_group_list':
                actualApiAction = 'get_group_list';
                actualApiParams = {};
                break;
                
              // 系统类指令
              case 'get_version_info':
                actualApiAction = 'get_version_info';
                actualApiParams = {};
                break;
                
              case 'get_status':
                actualApiAction = 'get_status';
                actualApiParams = {};
                break;
                
              case 'restart_plugin':
                actualApiAction = 'set_restart_plugin';
                actualApiParams = {};
                break;
                
              // 工具类指令 - 内置实现
              case 'check_url_safely':
                if (processedArgs.length === 0) {
                  throw new Error('安全检查需要提供URL');
                }
                // 这是内置实现，不需要调用API
                actualApiAction = null;
                actualApiParams = { url: processedArgs[0] };
                break;
                
              case 'translate_text':
                if (processedArgs.length < 1) {
                  throw new Error('翻译需要提供文本');
                }
                // 这是内置实现，不需要调用API
                actualApiAction = null;
                actualApiParams = {
                  text: processedArgs[0],
                  target_lang: processedArgs[1] || 'zh'
                };
                break;
                
              case 'start_math_verification':
                // 入群数学验证
                // 参数顺序：user_id, group_id, timeout, difficulty
                // 但 user_id 和 group_id 已经从 event 中获取，所以实际参数是：
                // processedArgs[0] = user_id (可选，用于覆盖 event.user_id)
                // processedArgs[1] = group_id (可选，用于覆盖 event.group_id)
                // processedArgs[2] = timeout
                // processedArgs[3] = difficulty
                
                const verifyUserId = processedArgs[0] ? parseInt(processedArgs[0]) : event.user_id;
                const verifyGroupId = processedArgs[1] ? parseInt(processedArgs[1]) : event.group_id;
                
                if (!verifyGroupId || !verifyUserId) {
                  throw new Error('验证功能缺少必要参数：group_id 和 user_id');
                }
                
                // 这是内置实现，不需要调用API
                actualApiAction = null;
                actualApiParams = {
                  group_id: verifyGroupId,
                  user_id: verifyUserId,
                  time_limit: parseInt(processedArgs[2]) || 60,
                  difficulty: processedArgs[3] || 'medium'
                };
                break;
                
              // 消息管理类指令
              case 'send_group_msg':
                if (processedArgs.length < 2) {
                  throw new Error('发送群消息需要提供群号和消息内容');
                }
                actualApiAction = 'send_group_msg';
                actualApiParams = {
                  group_id: parseInt(processedArgs[0]),
                  message: [
                    {
                      type: 'text',
                      data: { text: processedArgs.slice(1).join(' ') }
                    }
                  ]
                };
                break;
                
              // 撤回消息指令
              case 'delete_msg':
                if (processedArgs.length === 0) {
                  // 如果没有提供参数，尝试撤回当前消息
                  if (event.message_id) {
                    actualApiAction = 'delete_msg';
                    actualApiParams = {
                      message_id: event.message_id
                    };
                    console.log(`🗑️ 撤回当前消息: ${event.message_id}`);
                  } else {
                    throw new Error('撤回消息需要提供 message_id 或在消息事件中使用');
                  }
                } else {
                  // 使用提供的 message_id（支持变量）
                  actualApiAction = 'delete_msg';
                  actualApiParams = {
                    message_id: parseInt(processedArgs[0])
                  };
                  console.log(`🗑️ 撤回指定消息: ${processedArgs[0]}`);
                }
                break;
                
              case 'send_group_msg_reply':
                if (processedArgs.length < 3) {
                  throw new Error('发送群回复消息需要提供群号、消息ID和回复内容');
                }
                actualApiAction = 'send_group_msg';
                actualApiParams = {
                  group_id: parseInt(processedArgs[0]),
                  message: [
                    {
                      type: 'reply',
                      data: { id: parseInt(processedArgs[1]) }
                    },
                    {
                      type: 'text',
                      data: { text: processedArgs.slice(2).join(' ') }
                    }
                  ]
                };
                break;
                
              case 'send_private_msg':
                if (processedArgs.length < 2) {
                  throw new Error('发送私聊消息需要提供用户QQ号和消息内容');
                }
                actualApiAction = 'send_private_msg';
                actualApiParams = {
                  user_id: parseInt(processedArgs[0]),
                  message: [
                    {
                      type: 'text',
                      data: { text: processedArgs.slice(1).join(' ') }
                    }
                  ]
                };
                break;
                
              case 'delete_msg':
                if (processedArgs.length < 1) {
                  throw new Error('撤回消息需要提供消息ID');
                }
                actualApiAction = 'delete_msg';
                actualApiParams = {
                  message_id: parseInt(processedArgs[0])
                };
                break;
                
              // 娱乐类指令
              case 'get_random_joke':
                // 这是内置实现，不需要调用API
                actualApiAction = null;
                break;
                
              case 'roll_dice':
                const diceCount = processedArgs.length > 0 ? parseInt(processedArgs[0]) : 1;
                const diceSides = processedArgs.length > 1 ? parseInt(processedArgs[1]) : 6;
                // 这是内置实现，不需要调用API
                actualApiAction = null;
                actualApiParams = { count: diceCount, sides: diceSides };
                break;
                
              case 'flip_coin':
                // 这是内置实现，不需要调用API
                actualApiAction = null;
                break;
                
              // 管理类指令
              case 'ban_user':
                if (processedArgs.length < 2) {
                  throw new Error('禁言需要提供用户ID和时长');
                }
                const banTargetUserId = parseInt(processedArgs[0]);
                const banTargetDuration = parseInt(processedArgs[1]) * 60; // 转换为秒
                actualApiAction = 'set_group_ban';
                actualApiParams = {
                  group_id: parseInt(event.group_id),
                  user_id: banTargetUserId,
                  duration: banTargetDuration
                };
                break;
                
              case 'kick_user':
                if (processedArgs.length === 0) {
                  throw new Error('踢出用户需要提供用户ID');
                }
                const kickTargetUserId = parseInt(processedArgs[0]);
                actualApiAction = 'set_group_kick';
                actualApiParams = {
                  group_id: parseInt(event.group_id),
                  user_id: kickTargetUserId,
                  reject_add_request: false
                };
                break;
                
              case 'set_group_admin':
                if (processedArgs.length < 2) {
                  throw new Error('设置管理员需要提供用户ID和操作类型');
                }
                const adminUserId = parseInt(processedArgs[0]);
                const enableAdmin = ['true', '1', '是', '设置', 'enable'].includes(processedArgs[1].toLowerCase());
                actualApiAction = 'set_group_admin';
                actualApiParams = {
                  group_id: parseInt(event.group_id),
                  user_id: adminUserId,
                  enable: enableAdmin
                };
                break;
                
              // 群头衔管理
              case 'set_group_special_title':
                if (processedArgs.length < 2) {
                  throw new Error('设置群头衔需要提供用户ID和头衔内容');
                }
                const titleUserId = parseInt(processedArgs[0]);
                const specialTitle = processedArgs.length > 1 ? processedArgs[1] : '';
                actualApiAction = 'set_group_special_title';
                actualApiParams = {
                  group_id: parseInt(event.group_id),
                  user_id: titleUserId,
                  special_title: specialTitle
                };
                break;
                
              // 群精华消息管理
              case 'get_essence_msg_list':
                actualApiAction = 'get_essence_msg_list';
                const essenceGroupId = processedArgs.length > 0 ? 
                  parseInt(processedArgs[0]) : 
                  parseInt(event.group_id);
                actualApiParams = {
                  group_id: essenceGroupId
                };
                break;
                
              case 'delete_essence_msg':
                if (processedArgs.length === 0) {
                  throw new Error('删除精华消息需要提供消息ID');
                }
                const essenceMsgId = parseInt(processedArgs[0]);
                actualApiAction = 'delete_essence_msg';
                actualApiParams = {
                  message_id: essenceMsgId
                };
                break;
                
              // 群公告管理
              case 'send_group_notice':
                if (processedArgs.length === 0) {
                  throw new Error('发送群公告需要提供公告内容');
                }
                const noticeContent = processedArgs[0];
                const noticeImage = processedArgs.length > 1 ? processedArgs[1] : undefined;
                const noticeGroupId = processedArgs.length > 2 ? 
                  parseInt(processedArgs[2]) : 
                  parseInt(event.group_id);
                actualApiAction = '_send_group_notice';
                actualApiParams = {
                  group_id: noticeGroupId,
                  content: noticeContent
                };
                if (noticeImage) {
                  actualApiParams.image = noticeImage;
                }
                break;
                
              // 消息管理
              case 'delete_msg':
                if (processedArgs.length === 0) {
                  throw new Error('撤回消息需要提供消息ID');
                }
                const deleteMsgId = parseInt(processedArgs[0]);
                actualApiAction = 'delete_msg';
                actualApiParams = {
                  message_id: deleteMsgId
                };
                break;
                
              // 获取被禁言群员列表
              case 'get_group_shut_list':
                actualApiAction = 'get_group_shut_list';
                const shutListGroupId = processedArgs.length > 0 ? 
                  parseInt(processedArgs[0]) : 
                  parseInt(event.group_id);
                actualApiParams = {
                  group_id: shutListGroupId
                };
                break;

              // 新增的群管理API
              case 'set_group_add_request':
                if (processedArgs.length < 2) {
                  throw new Error('处理加群请求需要提供flag和处理结果');
                }
                actualApiAction = 'set_group_add_request';
                const groupRequestFlag = processedArgs[0];
                const approveRequest = ['true', '1', '是', '同意', 'yes'].includes(processedArgs[1].toLowerCase());
                const reason = processedArgs.length > 2 ? processedArgs[2] : '';
                actualApiParams = {
                  flag: groupRequestFlag,
                  approve: approveRequest,
                  reason: reason
                };
                break;

              case 'set_group_ban':
                if (processedArgs.length < 2) {
                  throw new Error('群禁言需要提供用户ID和禁言时长');
                }
                actualApiAction = 'set_group_ban';
                const groupBanUserId = parseInt(processedArgs[0]);
                const groupBanDuration = parseInt(processedArgs[1]); // 秒为单位
                const banGroupId = processedArgs.length > 2 ? 
                  parseInt(processedArgs[2]) : 
                  parseInt(event.group_id);
                actualApiParams = {
                  group_id: banGroupId,
                  user_id: groupBanUserId,
                  duration: groupBanDuration
                };
                break;

              case 'set_group_kick':
                if (processedArgs.length === 0) {
                  throw new Error('群踢人需要提供用户ID');
                }
                actualApiAction = 'set_group_kick';
                const groupKickUserId = parseInt(processedArgs[0]);
                const rejectAddRequest = processedArgs.length > 1 ? 
                  ['true', '1', '是', 'yes'].includes(processedArgs[1].toLowerCase()) : false;
                const kickGroupId = processedArgs.length > 2 ? 
                  parseInt(processedArgs[2]) : 
                  parseInt(event.group_id);
                actualApiParams = {
                  group_id: kickGroupId,
                  user_id: groupKickUserId,
                  reject_add_request: rejectAddRequest
                };
                break;
                
              default:
                throw new Error(`未知的指令ID: ${action.params.commandId}`);
            }
            
            console.log(`🔧 指令映射: ${action.params.commandId} -> ${actualApiAction}`, actualApiParams);
            
            let result;
            
            // 处理内置实现的指令
            if (actualApiAction === null) {
              result = await this.handleBuiltinCommand(action.params.commandId, actualApiParams);
            } else {
              // 调用LLOneBot API
              result = await this.callApiCallback(actualApiAction, actualApiParams);
            }
            
            console.log(`✅ API调用结果:`, result);
            
            // 处理结果并发送消息
            if (result && result.retcode === 0 && this.sendMessageCallback) {
              // 确定消息目标和类型（兼容 message, notice, request 事件）
              let chatId, messageType;
              
              if (event.group_id) {
                chatId = event.group_id.toString();
                messageType = 'group';
              } else if (event.user_id) {
                chatId = event.user_id.toString();
                messageType = 'private';
              } else {
                console.error('⚠️ 无法确定消息目标');
                break;
              }
              
              let responseMessage = '';
              
              // 检查是否使用自定义回复内容
              if (action.params.useCustomResponse && action.params.customResponseMessage) {
                // 使用用户自定义的回复内容
                responseMessage = action.params.variables 
                  ? this.replaceVariables(action.params.customResponseMessage, event, result.data, event._extractedVars || {})
                  : action.params.customResponseMessage;
              } else {
                // 使用默认的回复内容格式
                switch (action.params.commandId) {
                case 'get_user_info':
                  const userInfo = result.data;
                  responseMessage = `📱 用户信息：
🏷️ 昵称：${userInfo.nickname || '未知'}
🎂 年龄：${userInfo.age || '未知'}
👤 性别：${userInfo.sex === 'male' ? '男' : userInfo.sex === 'female' ? '女' : '未知'}
⭐ 等级：${userInfo.level || '未知'}
🆔 QQ号：${userInfo.user_id || actualApiParams.user_id}`;
                  break;
                  
                case 'send_like':
                  const likeResult = result.data;
                  responseMessage = `👍 点赞成功！
🎯 目标用户：${actualApiParams.user_id}
❤️ 点赞次数：${actualApiParams.times}`;
                  break;
                  
                case 'delete_friend':
                  responseMessage = `🗑️ 好友删除成功！
👤 已删除用户：${actualApiParams.user_id}`;
                  break;
                  
                case 'approve_friend_request':
                  const approveResult = actualApiParams.approve ? '✅ 已同意' : '❌ 已拒绝';
                  responseMessage = `📮 好友申请处理完成！
🆔 请求ID：${actualApiParams.flag}
✨ 处理结果：${approveResult}
📝 备注：${actualApiParams.remark || '无'}`;
                  break;
                  
                case 'set_avatar':
                  responseMessage = `🖼️ 头像设置成功！
📁 文件来源：${actualApiParams.file}`;
                  break;
                  
                case 'get_login_info':
                  const loginInfo = result.data;
                  responseMessage = `🤖 机器人登录信息：
🆔 QQ号：${loginInfo.user_id}
🏷️ 昵称：${loginInfo.nickname}`;
                  break;
                  
                case 'get_friend_list':
                  const friends = result.data;
                  responseMessage = `👥 好友列表 (共${friends.length}个好友)：
${friends.slice(0, 5).map(f => `📱 ${f.nickname || f.remark}(${f.user_id})`).join('\n')}
${friends.length > 5 ? '...(仅显示前5个)' : ''}`;
                  break;
                  
                case 'get_group_list':
                  const groups = result.data;
                  responseMessage = `👥 群组列表 (共${groups.length}个群)：
${groups.slice(0, 5).map(g => `🏠 ${g.group_name}(${g.group_id})`).join('\n')}
${groups.length > 5 ? '...(仅显示前5个)' : ''}`;
                  break;
                  
                // 系统类指令
                case 'get_version_info':
                  const versionInfo = result.data;
                  responseMessage = `🔧 系统版本信息：
📦 应用名称：${versionInfo.app_name || 'LLOneBot'}
🏷️ 版本号：${versionInfo.app_version || '未知'}
🌐 协议版本：${versionInfo.protocol_version || '未知'}`;
                  break;
                  
                case 'get_status':
                  const statusInfo = result.data;
                  responseMessage = `🔋 系统状态：
📊 在线状态：${statusInfo.online ? '✅ 在线' : '❌ 离线'}
💻 运行状态：${statusInfo.good ? '✅ 正常' : '⚠️ 异常'}`;
                  break;
                  
                case 'restart_plugin':
                  responseMessage = `🔄 插件重启成功！
⚡ 系统已重新加载所有组件`;
                  break;
                  
                // 工具类指令
                case 'check_url_safely':
                  const urlCheckResult = result.data;
                  const findings = urlCheckResult.findings || { critical: [], warning: [], info: [], safe: [] };
                  const connection = urlCheckResult.connection || {};
                  
                  // 风险等级emoji
                  const riskEmojis = {
                    '极高': '🚨',
                    '高': '⛔',
                    '中': '⚠️',
                    '低': 'ℹ️',
                    '安全': '✅'
                  };
                  const riskEmoji = riskEmojis[urlCheckResult.riskLevel] || '❓';
                  
                  // 构建响应消息
                  let msgParts = [];
                  
                  // 标题和基本信息
                  msgParts.push('🔒 URL安全检查报告');
                  msgParts.push('');
                  
                  // 显示原始URL和处理后的URL（如果不同）
                  if (urlCheckResult.originalUrl && urlCheckResult.originalUrl !== urlCheckResult.url) {
                    msgParts.push(`📋 原始输入：${urlCheckResult.originalUrl}`);
                    msgParts.push(`🔗 检查URL：${urlCheckResult.url}`);
                  } else {
                    msgParts.push(`🔗 检查URL：${urlCheckResult.url}`);
                  }
                  
                  msgParts.push(`🌐 域名：${urlCheckResult.domain || 'N/A'}`);
                  msgParts.push(`🔐 协议：${urlCheckResult.protocol || 'UNKNOWN'}`);
                  
                  // 连接信息
                  if (connection.reachable !== undefined) {
                    msgParts.push('');
                    msgParts.push('📡 连接测试：');
                    if (connection.reachable) {
                      msgParts.push(`  ✅ 可访问 (${connection.responseTime}ms)`);
                      msgParts.push(`  📊 状态码：${connection.statusCode}`);
                    } else if (connection.error) {
                      msgParts.push(`  ❌ 无法连接 - ${connection.error}`);
                    } else {
                      msgParts.push(`  ⚠️ 连接失败`);
                    }
                  }
                  
                  msgParts.push('');
                  
                  // 风险评估
                  msgParts.push(`${riskEmoji} 风险等级：${urlCheckResult.riskLevel} (${urlCheckResult.riskScore}/100)`);
                  msgParts.push(`${urlCheckResult.safe ? '✅' : '❌'} 安全状态：${urlCheckResult.safe ? '相对安全' : '存在风险'}`);
                  msgParts.push('');
                  
                  // 检测发现
                  if (findings.critical.length > 0) {
                    msgParts.push('🚨 严重风险：');
                    findings.critical.forEach(f => msgParts.push(`  ${f}`));
                    msgParts.push('');
                  }
                  
                  if (findings.warning.length > 0) {
                    msgParts.push('⚠️ 警告信息：');
                    findings.warning.forEach(f => msgParts.push(`  ${f}`));
                    msgParts.push('');
                  }
                  
                  if (findings.info.length > 0) {
                    msgParts.push('ℹ️ 提示信息：');
                    findings.info.forEach(f => msgParts.push(`  ${f}`));
                    msgParts.push('');
                  }
                  
                  if (findings.safe.length > 0) {
                    msgParts.push('✅ 安全特征：');
                    findings.safe.forEach(f => msgParts.push(`  ${f}`));
                    msgParts.push('');
                  }
                  
                  // 安全建议
                  if (urlCheckResult.recommendations && urlCheckResult.recommendations.length > 0) {
                    msgParts.push('💡 安全建议：');
                    urlCheckResult.recommendations.forEach(r => msgParts.push(`  ${r}`));
                  }
                  
                  responseMessage = msgParts.join('\n');
                  break;
                  
                case 'translate_text':
                  const translateResult = result.data;
                  const langNames = {
                    'zh': '中文', 'en': '英文', 'ja': '日文', 'ko': '韩文',
                    'es': '西班牙语', 'fr': '法语', 'de': '德语', 'ru': '俄语',
                    'auto': '自动检测'
                  };
                  const sourceLangName = langNames[translateResult.sourceLang] || translateResult.sourceLang;
                  const targetLangName = langNames[translateResult.targetLang] || translateResult.targetLang;
                  
                  responseMessage = `🌍 翻译结果：
📝 原文 (${sourceLangName})：${translateResult.sourceText}
🔄 译文 (${targetLangName})：${translateResult.targetText}
⏰ 翻译时间：${translateResult.translatedAt ? new Date(translateResult.translatedAt).toLocaleString('zh-CN') : '未知'}`;
                  break;
                  
                case 'start_math_verification':
                  const verifyResult = result.data;
                  const difficultyNames = {
                    'easy': '简单',
                    'medium': '中等',
                    'hard': '困难'
                  };
                  const difficultyText = difficultyNames[verifyResult.difficulty] || verifyResult.difficulty;
                  
                  responseMessage = `🎯 入群验证已开始！
📝 题目：${verifyResult.question} = ?
⏰ 时间限制：${verifyResult.timeLimit}秒
💪 难度：${difficultyText}
📢 请直接发送答案（数字）

💡 提示：
- 有3次答题机会
- 超时或答错3次将被移出群聊
- 计时已开始，请尽快作答！`;
                  break;
                  
                // 消息管理类指令
                case 'send_group_msg':
                case 'send_group_msg_reply':
                case 'send_private_msg':
                case 'delete_msg':
                  // 消息发送类指令不显示额外提示
                  responseMessage = '';
                  break;
                  
                // 娱乐类指令
                case 'get_random_joke':
                  const jokeData = result.data;
                  responseMessage = `😄 随机笑话：
${jokeData.joke}`;
                  break;
                  
                case 'roll_dice':
                  const diceData = result.data;
                  responseMessage = `🎲 掷骰子结果：
🎯 投掷：${diceData.count}个${diceData.sides}面骰子
🎪 结果：${diceData.results.join(', ')}
📊 总计：${diceData.total}`;
                  break;
                  
                case 'flip_coin':
                  const coinData = result.data;
                  responseMessage = `🪙 抛硬币结果：
${coinData.result === '正面' ? '🌟' : '🌙'} ${coinData.result}`;
                  break;
                  
                // 管理类指令
                case 'ban_user':
                  responseMessage = `🔇 禁言操作完成！
👤 目标用户：${actualApiParams.user_id}
⏰ 禁言时长：${actualApiParams.duration / 60}分钟`;
                  break;
                  
                case 'kick_user':
                  responseMessage = `👢 踢出操作完成！
👤 已踢出用户：${actualApiParams.user_id}`;
                  break;
                  
                case 'set_group_admin':
                  const adminAction = actualApiParams.enable ? '设置' : '取消';
                  responseMessage = `👑 ${adminAction}管理员完成！
👤 目标用户：${actualApiParams.user_id}
✨ 操作结果：${adminAction}群管理员权限`;
                  break;
                  
                // 新增的API响应处理
                case 'set_group_special_title':
                  const titleResult = actualApiParams.special_title ? '设置' : '移除';
                  responseMessage = `🏷️ 群头衔${titleResult}成功！
👤 目标用户：${actualApiParams.user_id}
🏆 专属头衔：${actualApiParams.special_title || '(已移除)'}`;
                  break;
                  
                case 'get_essence_msg_list':
                  const essenceList = result.data;
                  if (Array.isArray(essenceList) && essenceList.length > 0) {
                    responseMessage = `✨ 群精华消息列表 (共${essenceList.length}条)：
${essenceList.slice(0, 3).map((msg, i) => 
`📝 ${i+1}. 消息ID: ${msg.message_id || 'N/A'}
👤 发送者: ${msg.sender_name || '未知'}
⏰ 时间: ${msg.time ? new Date(msg.time * 1000).toLocaleString() : '未知'}`
).join('\n\n')}
${essenceList.length > 3 ? '...(仅显示前3条)' : ''}`;
                  } else {
                    responseMessage = `✨ 该群暂无精华消息`;
                  }
                  break;
                  
                case 'delete_essence_msg':
                  responseMessage = `🗑️ 精华消息删除成功！
📝 已删除消息ID：${actualApiParams.message_id}`;
                  break;
                  
                case 'send_group_notice':
                  responseMessage = `📢 群公告发送成功！
📝 公告内容：${actualApiParams.content}
🏠 目标群组：${actualApiParams.group_id}
${actualApiParams.image ? `🖼️ 包含图片：${actualApiParams.image}` : ''}`;
                  break;
                  
                case 'delete_msg':
                  responseMessage = `🗑️ 消息撤回成功！
📝 已撤回消息ID：${actualApiParams.message_id}`;
                  break;
                  
                case 'get_group_shut_list':
                  const shutList = result.data;
                  if (Array.isArray(shutList) && shutList.length > 0) {
                    responseMessage = `🔇 被禁言群员列表 (共${shutList.length}人)：
${shutList.slice(0, 5).map((member, i) => 
`${i+1}. ${member.nick || member.cardName || '未知昵称'}(${member.uin})
🔇 解禁时间: ${member.shutUpTime ? new Date(member.shutUpTime * 1000).toLocaleString() : '永久'}`
).join('\n')}
${shutList.length > 5 ? '...(仅显示前5个)' : ''}`;
                  } else {
                    responseMessage = `🔇 该群当前无被禁言成员`;
                  }
                  break;

                // 新增API的响应处理
                case 'set_group_add_request':
                  const requestResult = actualApiParams.approve ? '✅ 已同意' : '❌ 已拒绝';
                  responseMessage = `📮 加群请求处理完成！
🆔 请求标识：${actualApiParams.flag}
✨ 处理结果：${requestResult}
📝 拒绝理由：${actualApiParams.reason || '无'}`;
                  break;

                case 'set_group_ban':
                  const banAction = actualApiParams.duration === 0 ? '解除禁言' : '禁言';
                  responseMessage = `🔇 ${banAction}操作完成！
👤 目标用户：${actualApiParams.user_id}
🏠 群组：${actualApiParams.group_id}
${actualApiParams.duration > 0 ? `⏰ 禁言时长：${actualApiParams.duration}秒` : '✨ 已解除禁言'}`;
                  break;

                case 'set_group_kick':
                  responseMessage = `👢 踢出操作完成！
👤 已踢出用户：${actualApiParams.user_id}
🏠 群组：${actualApiParams.group_id}
🚫 拒绝再次申请：${actualApiParams.reject_add_request ? '是' : '否'}`;
                  break;
                  
                  default:
                    responseMessage = `✅ 指令 ${action.params.commandId} 执行成功`;
                }
              }
              
              // 构造消息选项，工具指令默认启用回复消息
              const messageOptions = {};
              if (event.message_id) {
                messageOptions.replyTo = event.message_id;
              }
              
              console.log(`📤 发送指令结果消息: ${responseMessage}`);
              await this.sendMessageCallback(chatId, responseMessage, messageType, messageOptions);
            }
            
          } catch (error) {
            console.error(`❌ 指令执行失败: ${action.params.commandId}`, error);
            
            // 增加错误统计
            this.stats.totalErrors++;
            
            // 发送错误消息
            if (this.sendMessageCallback) {
              // 确定消息目标和类型（兼容 message, notice, request 事件）
              let chatId, messageType;
              
              if (event.group_id) {
                chatId = event.group_id.toString();
                messageType = 'group';
              } else if (event.user_id) {
                chatId = event.user_id.toString();
                messageType = 'private';
              } else {
                console.error('⚠️ 无法确定消息目标');
                break;
              }
              
              // 构造消息选项，工具指令默认启用回复消息
              const messageOptions = {};
              if (event.message_id) {
                messageOptions.replyTo = event.message_id;
              }
              
              await this.sendMessageCallback(chatId, `指令执行失败: ${error.message}`, messageType, messageOptions);
            }
          }
        } else {
          console.warn('⚠️ execute_command动作缺少必要参数或回调函数');
        }
        break;
        
      default:
        console.warn('未知动作类型:', action.type);
    }
  }

  // 更新规则统计
  updateRuleStats(ruleId) {
    try {
      const rule = this.rules.find(r => r.id === ruleId);
      if (rule) {
        rule.triggerCount++;
        rule.lastTriggered = new Date();
        this.stats.totalRulesTriggered++; // 增加总的规则触发统计
        
        // 记录到系统统计模块（需要在文件顶部导入）
        if (typeof global.systemStatistics !== 'undefined') {
          global.systemStatistics.recordRuleTriggered();
        }
        
        this.saveRules();
        console.log(`📊 规则触发统计更新: ${rule.name}, 总触发次数: ${this.stats.totalRulesTriggered}`);
      }
    } catch (error) {
      console.error('更新规则统计失败:', error);
    }
  }

  // 获取规则列表
  getRules() {
    return this.rules;
  }

  // 添加规则
  addRule(rule) {
    rule.id = rule.id || `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    rule.triggerCount = 0;
    this.rules.push(rule);
    this.saveRules();
    return rule.id;
  }

  // 更新规则
  updateRule(ruleId, updatedRule) {
    const index = this.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.rules[index] = { ...this.rules[index], ...updatedRule };
      this.saveRules();
      return true;
    }
    return false;
  }

  // 删除规则
  deleteRule(ruleId) {
    const index = this.rules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.rules.splice(index, 1);
      this.saveRules();
      return true;
    }
    return false;
  }

  // 收集消息统计数据
  collectMessageStats(event, messageContent) {
    try {
      // 增加消息计数
      this.stats.dailyMessageCount++;
      
      // 记录消息历史（保留最近1000条）
      const messageRecord = {
        messageId: event.message_id,
        timestamp: event.time * 1000,
        userId: event.user_id?.toString(),
        groupId: event.group_id?.toString(),
        messageType: event.message_type,
        contentType: 'text', // 消息内容类型
        content: messageContent, // 完整内容，不截断
        senderName: event.sender?.nickname || event.sender?.card || '未知'
      };
      
      this.stats.messageHistory.unshift(messageRecord);
      if (this.stats.messageHistory.length > 1000) {
        this.stats.messageHistory = this.stats.messageHistory.slice(0, 1000);
      }
      
      logger.info('消息历史', `已保存 (总数: ${this.stats.messageHistory.length}) - ID: ${messageRecord.messageId}, 来自: ${messageRecord.senderName}, 内容: ${messageRecord.content.substring(0, 20)}...`);
      
      // 用户活跃度统计
      if (event.user_id) {
        const userId = event.user_id.toString();
        const userStat = this.stats.userActivity.get(userId) || {
          messageCount: 0,
          lastActive: 0,
          username: event.sender?.nickname || event.sender?.card || `用户${userId}`
        };
        
        userStat.messageCount++;
        userStat.lastActive = event.time * 1000;
        this.stats.userActivity.set(userId, userStat);
      }
      
      // 群组活跃度统计
      if (event.group_id && event.message_type === 'group') {
        const groupId = event.group_id.toString();
        const groupStat = this.stats.groupActivity.get(groupId) || {
          messageCount: 0,
          lastActive: 0,
          groupName: `群组${groupId}`
        };
        
        groupStat.messageCount++;
        groupStat.lastActive = event.time * 1000;
        this.stats.groupActivity.set(groupId, groupStat);
      }
      
      // 关键词统计
      if (messageContent) {
        const keywords = this.extractKeywords(messageContent);
        keywords.forEach(keyword => {
          const count = this.stats.keywordStats.get(keyword) || 0;
          this.stats.keywordStats.set(keyword, count + 1);
        });
      }
      
    } catch (error) {
      console.error('收集消息统计数据失败:', error);
    }
  }

  // 提取关键词
  extractKeywords(text) {
    if (!text || typeof text !== 'string') return [];
    
    // 简单的关键词提取（实际项目中可以使用更复杂的分词算法）
    const commonWords = ['你好', '谢谢', '请问', '帮助', '功能', '怎么', '什么', '为什么'];
    const keywords = [];
    
    commonWords.forEach(word => {
      if (text.includes(word)) {
        keywords.push(word);
      }
    });
    
    return keywords;
  }

  // 生成事件描述
  generateEventDescription(event) {
    switch (event.post_type) {
      case 'request':
        if (event.request_type === 'group') {
          const subType = event.sub_type === 'add' ? '申请加群' : '邀请入群';
          return `${subType}请求: ${event.comment || '无备注'}`;
        }
        break;
      case 'notice':
        if (event.notice_type === 'group_increase') {
          const subType = event.sub_type === 'approve' ? '同意加群' : '邀请加群';
          return `群成员增加: ${subType}`;
        }
        if (event.notice_type === 'group_decrease') {
          const subType = event.sub_type === 'leave' ? '主动退群' : 
                         event.sub_type === 'kick' ? '被踢出群' : '机器人被踢';
          return `群成员减少: ${subType}`;
        }
        break;
      default:
        return `${event.post_type}事件`;
    }
    return `未知事件: ${event.post_type}`;
  }

  // 收集事件统计数据（非消息事件）
  collectEventStats(event, eventDescription) {
    try {
      // 记录事件历史（保留最近1000条）
      const eventRecord = {
        timestamp: event.time * 1000,
        userId: event.user_id,
        groupId: event.group_id,
        eventType: event.post_type,
        subType: event.sub_type || event.notice_type || event.request_type,
        content: eventDescription.substring(0, 100),
        operatorId: event.operator_id || null
      };
      
      // 复用消息历史存储结构，但标记为事件类型
      this.stats.messageHistory.unshift({
        ...eventRecord,
        messageType: 'event',
        senderName: `事件`
      });
      
      if (this.stats.messageHistory.length > 1000) {
        this.stats.messageHistory = this.stats.messageHistory.slice(0, 1000);
      }
      
      // 群组活跃度统计（如果有群组ID）
      if (event.group_id) {
        const groupId = event.group_id.toString();
        const groupStat = this.stats.groupActivity.get(groupId) || {
          messageCount: 0,
          eventCount: 0,
          lastActive: 0,
          groupName: `群组${groupId}`
        };
        
        groupStat.eventCount = (groupStat.eventCount || 0) + 1;
        groupStat.lastActive = event.time * 1000;
        this.stats.groupActivity.set(groupId, groupStat);
      }
      
      console.log(`📊 事件统计已记录: ${eventDescription}`);
    } catch (error) {
      console.error('收集事件统计数据失败:', error);
    }
  }

  // 加载统计数据
  loadStats() {
    try {
      const statsPath = path.join(__dirname, '../data', 'monitor-stats.json');
      if (fs.existsSync(statsPath)) {
        const savedStats = fs.readFileSync(statsPath, 'utf8');
        const data = JSON.parse(savedStats);
        
        // 恢复Map对象
        if (data.userActivity) {
          this.stats.userActivity = new Map(Object.entries(data.userActivity));
        }
        if (data.groupActivity) {
          this.stats.groupActivity = new Map(Object.entries(data.groupActivity));
        }
        if (data.keywordStats) {
          this.stats.keywordStats = new Map(Object.entries(data.keywordStats));
        }
        
        // 恢复其他数据
        this.stats.dailyMessageCount = data.dailyMessageCount || 0;
        this.stats.totalRulesTriggered = data.totalRulesTriggered || 0;
        this.stats.totalApiCalls = data.totalApiCalls || 0;
        this.stats.totalErrors = data.totalErrors || 0;
        this.stats.messageHistory = data.messageHistory || [];
        
        logger.info('统计数据', `消息${this.stats.dailyMessageCount}, 用户${this.stats.userActivity.size}, 群组${this.stats.groupActivity.size}, 关键词${this.stats.keywordStats.size}, 历史${this.stats.messageHistory.length}`);
      } else {
        console.log('📊 未找到历史统计数据，使用默认值');
      }
    } catch (error) {
      console.error('加载统计数据失败:', error);
    }
  }

  // 保存统计数据
  saveStats() {
    try {
      const dataDir = path.join(__dirname, '../data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      // 将Map转换为普通对象以便JSON序列化
      const statsData = {
        dailyMessageCount: this.stats.dailyMessageCount,
        totalRulesTriggered: this.stats.totalRulesTriggered,
        totalApiCalls: this.stats.totalApiCalls,
        totalErrors: this.stats.totalErrors,
        messageHistory: this.stats.messageHistory,
        userActivity: Object.fromEntries(this.stats.userActivity),
        groupActivity: Object.fromEntries(this.stats.groupActivity),
        keywordStats: Object.fromEntries(this.stats.keywordStats),
        lastSaved: new Date().toISOString(),
        startTime: this.stats.startTime
      };
      
      const statsPath = path.join(dataDir, 'monitor-stats.json');
      fs.writeFileSync(statsPath, JSON.stringify(statsData, null, 2));
      console.log('📊 统计数据已保存');
    } catch (error) {
      console.error('保存统计数据失败:', error);
    }
  }

  // 获取统计数据
  getStats() {
    return {
      dailyMessageCount: this.stats.dailyMessageCount,
      totalRulesTriggered: this.stats.totalRulesTriggered,
      totalApiCalls: this.stats.totalApiCalls,
      totalErrors: this.stats.totalErrors,
      messageHistory: this.stats.messageHistory.slice(0, 50), // 只返回最近50条
      userActivity: Array.from(this.stats.userActivity.entries())
        .sort(([,a], [,b]) => b.messageCount - a.messageCount)
        .slice(0, 20), // 返回前20个活跃用户
      groupActivity: Array.from(this.stats.groupActivity.entries())
        .sort(([,a], [,b]) => b.messageCount - a.messageCount)
        .slice(0, 10), // 返回前10个活跃群组
      keywordStats: Array.from(this.stats.keywordStats.entries())
        .sort(([,a], [,b]) => b - a)
        .slice(0, 20), // 返回前20个热门关键词
      systemUptime: Math.floor((Date.now() - this.stats.startTime) / 1000)
    };
  }

  // 重置每日统计（每天0点调用）
  resetDailyStats() {
    this.stats.dailyMessageCount = 0;
    this.saveStats();
    console.log('📊 每日统计数据已重置');
  }
  // ==================== 入群验证系统方法 ====================
  
  /**
   * 检查验证答案
   * @param {string} verifyKey - 验证Key
   * @param {string} userAnswer - 用户答案
   * @returns {boolean} - 是否处理了验证
   */
  checkVerificationAnswer(verifyKey, userAnswer) {
    const verification = this.verifications.get(verifyKey);
    
    if (!verification) {
      return false;
    }
    
    // 增加尝试次数
    verification.attempts++;
    
    // 检查是否超时
    if (Date.now() > verification.expireTime) {
      this.handleVerificationFailed(verifyKey, 'timeout');
      return true;
    }
    
    // 检查答案是否正确
    const correctAnswer = verification.answer.toString();
    const answer = userAnswer.replace(/\s+/g, ''); // 去除空格
    
    console.log(`🔍 验证答案检查: 用户答案="${answer}" 正确答案="${correctAnswer}" 尝试次数=${verification.attempts}/${verification.maxAttempts}`);
    
    if (answer === correctAnswer) {
      // 答案正确
      this.handleVerificationSuccess(verifyKey);
      return true;
    } else {
      // 答案错误
      if (verification.attempts >= verification.maxAttempts) {
        // 超过最大尝试次数
        this.handleVerificationFailed(verifyKey, 'max_attempts');
      } else {
        // 还有机会，发送提示
        const remaining = verification.maxAttempts - verification.attempts;
        const timeRemaining = Math.ceil((verification.expireTime - Date.now()) / 1000);
        
        if (this.sendMessageCallback) {
          this.sendMessageCallback(
            verification.groupId.toString(),
            `❌ 答案错误！还有 ${remaining} 次机会\n⏰ 剩余时间：${timeRemaining}秒\n💡 题目：${verification.question} = ?`,
            'group'
          );
        }
      }
      return true;
    }
  }
  
  /**
   * 处理验证成功
   * @param {string} verifyKey - 验证Key
   */
  async handleVerificationSuccess(verifyKey) {
    const verification = this.verifications.get(verifyKey);
    
    if (!verification) {
      return;
    }
    
    // 清除定时器
    const timer = this.verificationTimers.get(verifyKey);
    if (timer) {
      clearTimeout(timer);
      this.verificationTimers.delete(verifyKey);
    }
    
    // 计算用时
    const timeUsed = Math.ceil((Date.now() - verification.startTime) / 1000);
    
    console.log(`✅ 验证成功: 群${verification.groupId} 用户${verification.userId} 用时${timeUsed}秒`);
    
    // 发送成功消息
    if (this.sendMessageCallback) {
      await this.sendMessageCallback(
        verification.groupId.toString(),
        `🎉 验证通过！\n✅ 答案正确：${verification.question} = ${verification.answer}\n⏱️ 用时：${timeUsed}秒\n🎊 欢迎加入本群！`,
        'group'
      );
    }
    
    // 移除验证记录
    this.verifications.delete(verifyKey);
  }
  
  /**
   * 处理验证失败
   * @param {string} verifyKey - 验证Key
   * @param {string} reason - 失败原因 (timeout/max_attempts)
   */
  async handleVerificationFailed(verifyKey, reason) {
    const verification = this.verifications.get(verifyKey);
    
    if (!verification) {
      return;
    }
    
    // 清除定时器
    const timer = this.verificationTimers.get(verifyKey);
    if (timer) {
      clearTimeout(timer);
      this.verificationTimers.delete(verifyKey);
    }
    
    const reasonText = reason === 'timeout' ? '验证超时' : '尝试次数过多';
    
    console.log(`❌ 验证失败: 群${verification.groupId} 用户${verification.userId} 原因:${reasonText}`);
    
    // 发送失败消息并踢出用户
    if (this.sendMessageCallback) {
      await this.sendMessageCallback(
        verification.groupId.toString(),
        `⚠️ 验证失败！\n❌ 原因：${reasonText}\n📝 正确答案：${verification.question} = ${verification.answer}\n👋 用户 ${verification.userId} 将被移出群聊`,
        'group'
      );
    }
    
    // 调用踢人API
    if (this.callApiCallback) {
      try {
        await this.callApiCallback('set_group_kick', {
          group_id: parseInt(verification.groupId),
          user_id: parseInt(verification.userId),
          reject_add_request: false
        });
        console.log(`👢 已踢出用户: ${verification.userId}`);
      } catch (error) {
        console.error(`❌ 踢出用户失败:`, error);
      }
    }
    
    // 移除验证记录
    this.verifications.delete(verifyKey);
  }
  
  /**
   * 处理验证超时
   * @param {string} verifyKey - 验证Key
   */
  handleVerificationTimeout(verifyKey) {
    console.log(`⏰ 验证超时触发: ${verifyKey}`);
    this.handleVerificationFailed(verifyKey, 'timeout');
  }
  
  /**
   * 取消验证
   * @param {number} groupId - 群ID
   * @param {number} userId - 用户ID
   * @returns {boolean} - 是否成功取消
   */
  cancelVerification(groupId, userId) {
    const verifyKey = `${groupId}_${userId}`;
    const verification = this.verifications.get(verifyKey);
    
    if (!verification) {
      return false;
    }
    
    // 清除定时器
    const timer = this.verificationTimers.get(verifyKey);
    if (timer) {
      clearTimeout(timer);
      this.verificationTimers.delete(verifyKey);
    }
    
    // 移除验证记录
    this.verifications.delete(verifyKey);
    
    console.log(`🚫 已取消验证: 群${groupId} 用户${userId}`);
    return true;
  }
}

export default EventResponseEngine;
