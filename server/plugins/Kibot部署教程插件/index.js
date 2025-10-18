/**
 * 教程Ai
 * AI教程处理群类的关于kibot的搭建教程和回答
 * 
 * @author Ki
 * @version 1.0.1
 * @sdk Enhanced SDK v3.0
 */

import { EnhancedPluginBase } from '../../core/plugin-system/plugin-sdk-enhanced.js';

export default class Jc extends EnhancedPluginBase {
  constructor(pluginInfo, context) {
    super(pluginInfo, context);
    
    // 教程数据库
    this.tutorials = null;
    
    // 统计数据
    this.stats = {
      totalQueries: 0,
      helpfulCount: 0
    };
  }

  async onLoad() {
    await super.onLoad();
    this.logger.info('教程Ai 正在加载...');
    
    // 初始化教程数据库
    this.initTutorials();
    
    // 加载统计数据
    this.loadStats();
    
    // 注册指令
    this.registerCommands();
    
    // 注册事件
    this.registerEvents();
    
    this.logger.info('教程Ai 加载完成');
  }
  
  /**
   * 初始化教程数据库
   */
  initTutorials() {
    // 创建教程数据模型
    this.tutorials = this.storage.model('Tutorial', {
      id: { type: Number, required: true },
      category: { type: String, required: true },
      question: { type: String, required: true },
      answer: { type: String, required: true },
      keywords: { type: Array, default: [] },
      viewCount: { type: Number, default: 0 },
      helpful: { type: Number, default: 0 }
    });
    
    // 初始化默认教程数据
    this.initDefaultTutorials();
  }
  
  /**
   * 初始化默认教程内容
   */
  initDefaultTutorials() {
    const defaultTutorials = [
      {
        id: 1,
        category: '环境准备',
        question: 'KiBot需要什么环境?',
        answer: `KiBot运行环境要求：
• Node.js >= 18.0.0
• 支持的QQ Bot框架：LLOneBot、NapCat等
• 操作系统：Windows、Linux、macOS均可
• 建议内存：≥512MB`,
        keywords: ['环境', '要求', '需要', 'nodejs', 'node', '配置']
      },
      {
        id: 2,
        category: '安装部署',
        question: '如何安装KiBot?',
        answer: `KiBot安装步骤：
1. 下载最新版本的KiBot压缩包
2. 解压到目标目录
3. 在server目录执行：npm install
4. 在web目录执行：npm install
5. 配置 server/config/llonebot.json（QQ Bot连接信息）
6. 配置 server/config/security.json（安全设置）
7. 启动server：node index.js
8. 启动web：npm run dev（开发）或 npm run build（生产）`,
        keywords: ['安装', '部署', '搭建', '配置', 'install', '启动']
      },
      {
        id: 3,
        category: '配置说明',
        question: 'llonebot.json怎么配置?',
        answer: `llonebot.json配置说明：
{
  "wsUrl": "ws://127.0.0.1:3001",  // QQ Bot的WebSocket地址
  "httpUrl": "http://127.0.0.1:3000",  // QQ Bot的HTTP地址
  "token": ""  // 访问令牌（可选）
}

注意：
• wsUrl是你的LLOneBot/NapCat的WebSocket监听地址
• httpUrl是对应的HTTP API地址
• 端口号需要与你的QQ Bot配置一致`,
        keywords: ['llonebot', '配置', 'ws', 'websocket', '连接']
      },
      {
        id: 4,
        category: '配置说明',
        question: 'security.json怎么配置?',
        answer: `security.json安全配置说明：
{
  "authKey": "your-secret-key",  // 认证密钥
  "adminUsers": [12345678],  // 管理员QQ号列表
  "allowedGroups": [],  // 允许的群组（空数组表示所有）
  "enableAuth": true  // 是否启用认证
}

建议：
• authKey请设置强密码
• adminUsers至少添加一个管理员
• 生产环境务必启用认证`,
        keywords: ['security', '安全', '认证', 'authkey', '管理员']
      },
      {
        id: 5,
        category: '使用教程',
        question: '如何创建事件规则?',
        answer: `创建事件规则步骤：
1. 登录Web管理界面
2. 进入"规则管理"页面
3. 点击"新增规则"按钮
4. 填写规则信息：
   - 规则名称：给规则起个名字
   - 触发条件：关键词、正则等
   - 回复内容：机器人的回复
5. 保存并启用规则

支持的触发方式：
• 完全匹配：消息完全相同
• 包含关键词：消息包含指定词
• 正则表达式：高级匹配
• @机器人：被@时触发`,
        keywords: ['规则', '事件', '创建', '添加', '设置', '关键词']
      },
      {
        id: 6,
        category: '使用教程',
        question: '如何使用插件?',
        answer: `插件使用教程：
1. 将插件文件夹放到 server/plugins/ 目录
2. 登录Web管理界面
3. 进入"插件管理"页面
4. 点击"扫描插件"
5. 找到新插件，点击"加载"
6. 启用插件即可使用

插件开发：
• 参考 tools/create-plugin-v3.js 创建插件
• 支持Enhanced SDK和Simple SDK
• 详见插件开发文档`,
        keywords: ['插件', 'plugin', '安装', '使用', '开发']
      },
      {
        id: 7,
        category: '常见问题',
        question: '连接不上QQ Bot怎么办?',
        answer: `连接问题排查：
1. 确认QQ Bot（LLOneBot/NapCat）已启动
2. 检查 llonebot.json 配置是否正确
3. 确认WebSocket端口是否正确
4. 查看server控制台的错误信息
5. 检查防火墙是否拦截

常见错误：
• "连接失败"：检查端口和地址
• "认证失败"：检查token配置
• "超时"：网络问题或Bot未启动`,
        keywords: ['连接', '失败', '错误', '问题', 'websocket', '不上']
      },
      {
        id: 8,
        category: '常见问题',
        question: 'Web界面打不开?',
        answer: `Web界面问题排查：
1. 确认server已正常启动
2. 检查端口是否被占用（默认3500）
3. 浏览器访问 http://localhost:3500
4. 检查防火墙设置
5. 查看控制台错误信息

开发模式：
• cd Web && npm run dev

生产模式：
• cd Web && npm run build
• 使用nginx代理dist目录`,
        keywords: ['web', '界面', '打不开', '访问', '页面', '前端']
      },
      {
        id: 9,
        category: '高级功能',
        question: '如何使用任务管理?',
        answer: `任务管理功能：
1. 登录Web管理界面
2. 进入"任务管理"页面
3. 可以查看、创建、执行任务

任务类型：
• 定时消息：定时发送消息
• 数据统计：统计分析
• 清理任务：清理过期数据
• 自定义任务：通过插件创建

支持Cron表达式定时`,
        keywords: ['任务', '定时', 'cron', '管理', '执行']
      },
      {
        id: 10,
        category: '高级功能',
        question: '如何查看日志?',
        answer: `日志查看方法：
1. Web界面查看：
   - 登录管理界面
   - 进入"系统日志"页面
   - 支持筛选和搜索

2. 文件查看：
   - 位置：server/data/logs/
   - 文件名：kibot-YYYY-MM-DD.log
   - 可用文本编辑器打开

日志级别：
• INFO：一般信息
• WARN：警告
• ERROR：错误
• DEBUG：调试信息`,
        keywords: ['日志', 'log', '查看', '记录', '错误']
      },
      {
        id: 11,
        category: 'LLOneBot安装',
        question: 'LLOneBot是什么？',
        answer: `LLOneBot介绍：
LLOneBot是一个QQ机器人框架，用于连接QQ和各种Bot应用。

特点：
• 支持最新版本QQ（原版QQ，不要安装插件）
• 提供OneBot 11和Satori协议
• 支持WebSocket和HTTP通信
• 跨平台支持（Windows、Linux）

官方文档：https://llonebot.com

注意事项：
• 必须使用64位NTQQ
• 不支持勾选多个账号登录
• 如装过5.0以下版本需卸载QQ并删除安装目录`,
        keywords: ['llonebot', 'llonebot是什么', '介绍', 'qq bot', '框架', 'onebot']
      },
      {
        id: 12,
        category: 'LLOneBot安装',
        question: 'Windows如何安装LLOneBot?',
        answer: `Windows安装LLOneBot（一键方案）：

前置要求：
• Windows 8.1或更高版本
• 已安装64位NTQQ

安装步骤：
1. 下载安装包
   - GitHub：https://github.com/LLOneBot/LLOneBot/releases
   - 下载 LLOneBot-win-x64-ffmpeg.zip（推荐带FFmpeg版本）
   - 微云下载：https://share.weiyun.com/dnOysKL8

2. 解压并运行
   - 解压zip文件
   - 双击 llonebot.exe 启动QQ
   - 登录QQ（不要勾选多账号）
   - 会自动生成data文件夹

3. 配置LLOneBot
   - 浏览器打开 http://localhost:3080
   - 或编辑 data/config_<qq号>.json

4. 配置KiBot连接
   - 修改 server/config/llonebot.json
   - wsUrl: ws://127.0.0.1:3001
   - httpUrl: http://127.0.0.1:3000

完成后启动KiBot即可连接！`,
        keywords: ['llonebot', 'windows', '安装', 'win', '一键安装', '下载']
      },
      {
        id: 13,
        category: 'LLOneBot安装',
        question: 'Linux如何安装LLOneBot?',
        answer: `Linux安装LLOneBot：

方法1：Docker一键安装（推荐）
curl -fsSL https://raw.githubusercontent.com/linyuchen/PMHQ/refs/heads/main/docker/install-llob.sh -o install-pmhq-llob.sh && chmod u+x ./install-pmhq-llob.sh && ./install-pmhq-llob.sh

如果GitHub连接不畅：
curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/linyuchen/PMHQ/refs/heads/main/docker/install-llob.sh -o install-pmhq-llob.sh && chmod u+x ./install-pmhq-llob.sh && ./install-pmhq-llob.sh

方法2：NixOS安装
见 https://github.com/llonebot/llonebot.nix

配置连接：
- 修改 server/config/llonebot.json
- 确保端口与LLOneBot配置一致
- 默认WS: 3001, HTTP: 3000

查看二维码：
- 进入容器日志查看二维码
- 或访问 http://localhost:3080 扫码登录`,
        keywords: ['llonebot', 'linux', '安装', 'docker', 'nixos', '容器']
      },
      {
        id: 14,
        category: 'LLOneBot安装',
        question: 'LLOneBot配置文件说明',
        answer: `LLOneBot配置文件详解：

文件位置：data/config_<qq号>.json

核心配置项：

1. WebUI配置
{
  "webui": {
    "enable": true,  // 启用WebUI
    "port": 3080     // WebUI端口
  }
}

2. OneBot 11协议（KiBot使用）
{
  "ob11": {
    "enable": true,
    "connect": [
      {
        "type": "ws",      // 正向WebSocket
        "enable": true,
        "port": 3001,      // WS端口
        "token": "",       // 访问令牌
        "heartInterval": 60000
      },
      {
        "type": "http",    // HTTP服务
        "enable": true,
        "port": 3000,      // HTTP端口
        "token": ""
      }
    ]
  }
}

3. 其他配置
- log: 启用日志
- autoDeleteFile: 自动删除文件
- onlyLocalhost: 只监听本地（公网需设token）
- ffmpeg: FFmpeg路径

修改后会自动重载，无需重启！

参考：https://llonebot.com/guide/getting-started`,
        keywords: ['llonebot', '配置', 'config', 'json', '配置文件', '端口', 'websocket', 'http']
      },
      {
        id: 15,
        category: 'LLOneBot安装',
        question: 'LLOneBot无头模式和自动登录',
        answer: `LLOneBot高级配置：

1. 启用无头模式
修改 pmhq_config.json：
{
  "headless": true
}

效果：
- 不显示QQ窗口
- 二维码在终端显示
- 也可访问 http://localhost:3080 扫码

2. 启用快速登录/自动登录
修改 pmhq_config.json：
{
  "quick_login_qq": 123456789  // 你的QQ号
}

效果：
- 如果手动登录过该QQ号
- 下次启动会自动登录
- 无需重复扫码

3. 查看登录状态
- WebUI: http://localhost:3080
- 容器日志：docker logs <容器名>
- 终端输出：查看二维码URL

适用场景：
• 服务器部署
• Docker容器
• 后台运行
• 自动化部署`,
        keywords: ['llonebot', '无头', 'headless', '自动登录', 'quick_login', '后台', '服务器']
      }
    ];
    
    // 检查是否已初始化
    const existing = this.tutorials.findAll();
    if (existing.length === 0) {
      this.logger.info('初始化默认教程数据...');
      defaultTutorials.forEach(tutorial => {
        try {
          this.tutorials.create(tutorial);
        } catch (e) {
          // 可能已存在，忽略
        }
      });
      this.logger.info(`已添加 ${defaultTutorials.length} 条教程（包含LLOneBot安装指南）`);
    }
  }
  
  /**
   * 加载统计数据
   */
  loadStats() {
    const saved = this.storage.get('stats');
    if (saved) {
      this.stats = saved;
    }
  }
  
  /**
   * 保存统计数据
   */
  saveStats() {
    this.storage.set('stats', this.stats);
  }
  
  /**
   * 注册指令
   */
  registerCommands() {
    // 帮助指令
    this.registerCommand('jc', this.handleJcCommand.bind(this), {
      description: '教程助手 - 查看KiBot搭建教程',
      usage: '/jc [关键词] 或 /jc help'
    });
    
    // 教程列表指令
    this.registerCommand('教程', this.handleTutorialCommand.bind(this), {
      description: '查看KiBot教程分类',
      usage: '/教程 [分类]'
    });
    
    // 搜索指令
    this.registerCommand('搜教程', this.handleSearchCommand.bind(this), {
      description: '搜索KiBot教程',
      usage: '/搜教程 <关键词>'
    });
    
    this.logger.info('已注册 3 个指令');
  }
  
  /**
   * 注册单个指令
   */
  registerCommand(command, handler, options = {}) {
    const wrappedHandler = async (event) => {
      try {
        await handler(event);
      } catch (error) {
        this.recordError('command', command, error);
        const errorMsg = `⚠️ 执行指令 /${command} 时出错：${error.message}`;
        await this.replyMessage(event, errorMsg).catch(() => {});
      }
    };
    
    const commandInfo = {
      plugin: this.info.id,
      command,
      description: options.description || `${command} 指令`,
      usage: options.usage || `/${command}`,
      type: 'custom',
      category: 'utility',
      executionCount: 0,
      registeredAt: Date.now(),
      handler: wrappedHandler
    };
    
    this.context.commandRegistry?.register(commandInfo);
    this.registeredCommands.set(command, commandInfo);
  }
  
  /**
   * 注册事件监听
   */
  registerEvents() {
    // 监听群消息中的问题
    this.onEvent('message')
      .filter(event => event.message_type === 'group')
      .filter(event => {
        const isQuestion = this.isQuestionAboutKiBot(event.raw_message);
        if (isQuestion) {
          this.logger.info(`[群消息] 检测到KiBot相关问题: ${event.raw_message}`);
        }
        return isQuestion;
      })
      .handle(async (event) => {
        try {
          this.logger.debug(`[群消息] 开始处理问题`);
          await this.handleQuestion(event);
        } catch (error) {
          this.recordError('event', 'group_message', error);
        }
      });
    
    // 监听私聊消息
    this.onEvent('message')
      .filter(event => event.message_type === 'private')
      .filter(event => {
        const isQuestion = this.isQuestionAboutKiBot(event.raw_message);
        if (isQuestion) {
          this.logger.info(`[私聊] 检测到KiBot相关问题: ${event.raw_message}`);
        }
        return isQuestion;
      })
      .handle(async (event) => {
        try {
          this.logger.debug(`[私聊] 开始处理问题`);
          await this.handleQuestion(event);
        } catch (error) {
          this.recordError('event', 'private_message', error);
        }
      });
    
    this.logger.info('事件监听已注册（群消息 + 私聊消息）');
  }
  
  /**
   * 判断是否是关于KiBot的问题
   */
  isQuestionAboutKiBot(message) {
    const keywords = [
      'kibot', 'ki bot', '机器人',
      '怎么', '如何', '怎样', '教程', '搭建', '配置', '安装', '部署',
      'llonebot', 'napcat', 'onebot',
      'websocket', 'ws', 'http',
      '插件', '规则', '事件', '任务',
      '启动', '运行', '错误', '问题', '失败'
    ];
    
    const lowerMsg = message.toLowerCase();
    
    // 检查是否包含问号和关键词
    const hasQuestion = message.includes('?') || message.includes('？') || 
                       message.includes('怎么') || message.includes('如何') ||
                       message.includes('为什么') || message.includes('吗');
    
    const hasKeyword = keywords.some(keyword => lowerMsg.includes(keyword));
    
    return hasQuestion && hasKeyword;
  }
  
  /**
   * 处理jc指令
   */
  async handleJcCommand(event) {
    const message = event.raw_message || '';
    const args = message.split(/\s+/).slice(1); // 移除指令本身
    
    if (args.length === 0 || args[0] === 'help') {
      return this.sendHelpMessage(event);
    }
    
    // 搜索教程
    const keyword = args.join(' ');
    return this.searchAndReply(event, keyword);
  }
  
  /**
   * 处理教程指令
   */
  async handleTutorialCommand(event) {
    const message = event.raw_message || '';
    const args = message.split(/\s+/).slice(1);
    
    if (args.length === 0) {
      return this.sendCategoryList(event);
    }
    
    // 显示指定分类的教程
    const category = args[0];
    return this.sendCategoryTutorials(event, category);
  }
  
  /**
   * 处理搜索指令
   */
  async handleSearchCommand(event) {
    const message = event.raw_message || '';
    const args = message.split(/\s+/).slice(1);
    
    if (args.length === 0) {
      return this.replyMessage(event, '请提供搜索关键词，例如：/搜教程 安装');
    }
    
    const keyword = args.join(' ');
    return this.searchAndReply(event, keyword);
  }
  
  /**
   * 发送帮助信息
   */
  async sendHelpMessage(event) {
    const help = `━━━ KiBot 教程助手 ━━━

📚 可用指令：
/jc [关键词] - 搜索教程
/教程 - 查看分类
/教程 [分类] - 查看指定分类
/搜教程 <关键词> - 搜索教程

💡 智能问答：
直接在群里提问关于KiBot的问题
例如："kibot怎么安装？"

📊 统计信息：
总查询次数：${this.stats.totalQueries}
有帮助次数：${this.stats.helpfulCount}

━━━━━━━━━━━━━━━`;
    
    return this.replyMessage(event, help);
  }
  
  /**
   * 获取排序后的分类列表
   */
  getCategoriesList() {
    const allTutorials = this.tutorials.findAll();
    const categories = {};
    
    // 统计每个分类的教程数量
    allTutorials.forEach(tutorial => {
      if (!categories[tutorial.category]) {
        categories[tutorial.category] = 0;
      }
      categories[tutorial.category]++;
    });
    
    // 定义分类顺序
    const categoryOrder = [
      '环境准备',
      '安装部署',
      '配置说明',
      'LLOneBot安装',
      '使用教程',
      '常见问题',
      '高级功能'
    ];
    
    // 按照预定义顺序排序，未定义的分类放在最后
    const sortedCategories = Object.keys(categories).sort((a, b) => {
      const indexA = categoryOrder.indexOf(a);
      const indexB = categoryOrder.indexOf(b);
      
      if (indexA === -1 && indexB === -1) return a.localeCompare(b);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
    
    return sortedCategories.map(category => ({
      name: category,
      count: categories[category]
    }));
  }
  
  /**
   * 发送分类列表
   */
  async sendCategoryList(event) {
    const categoryList = this.getCategoriesList();
    
    let message = '━━━ KiBot 教程分类 ━━━\n\n';
    categoryList.forEach((category, index) => {
      message += `${index + 1}. 📁 ${category.name} (${category.count}篇)\n`;
    });
    message += '\n使用 /教程 [序号或分类名] 查看详情';
    message += '\n例如：/教程 1 或 /教程 环境准备';
    message += '\n━━━━━━━━━━━━━━━';
    
    return this.replyMessage(event, message);
  }
  
  /**
   * 发送指定分类的教程
   */
  async sendCategoryTutorials(event, category) {
    const allTutorials = this.tutorials.findAll();
    let tutorials = [];
    
    // 检查是否是数字序号
    const categoryIndex = parseInt(category);
    if (!isNaN(categoryIndex) && categoryIndex > 0) {
      // 使用统一的分类列表获取方法，确保顺序一致
      const categoryList = this.getCategoriesList();
      
      if (categoryIndex <= categoryList.length) {
        const targetCategory = categoryList[categoryIndex - 1].name;
        tutorials = allTutorials.filter(t => t.category === targetCategory);
      }
    } else {
      // 按分类名称搜索
      tutorials = allTutorials.filter(t => 
        t.category.includes(category) || category.includes(t.category)
      );
    }
    
    if (tutorials.length === 0) {
      return this.replyMessage(event, `未找到"${category}"分类的教程。使用 /教程 查看所有分类。`);
    }
    
    let message = `━━━ ${tutorials[0].category} ━━━\n\n`;
    tutorials.forEach((tutorial, index) => {
      message += `${index + 1}. ${tutorial.question}\n`;
    });
    message += '\n💡 使用 /搜教程 <关键词> 查看详细答案';
    message += '\n例如：/搜教程 安装';
    message += '\n━━━━━━━━━━━━━━━';
    
    return this.replyMessage(event, message);
  }
  
  /**
   * 搜索并回复
   */
  async searchAndReply(event, keyword) {
    this.stats.totalQueries++;
    this.saveStats();
    
    const results = this.searchTutorials(keyword);
    
    if (results.length === 0) {
      return this.replyMessage(event, 
        `未找到关于"${keyword}"的教程。\n\n` +
        `💡 提示：\n` +
        `• 使用 /教程 查看所有分类\n` +
        `• 尝试其他关键词搜索\n` +
        `• 直接提问，例如："kibot怎么安装？"`
      );
    }
    
    // 获取最佳匹配
    const bestMatch = results[0];
    bestMatch.viewCount++;
    this.tutorials.update(bestMatch.id, bestMatch);
    
    let message = `━━━ ${bestMatch.category} ━━━\n\n`;
    message += `❓ ${bestMatch.question}\n\n`;
    message += `💡 ${bestMatch.answer}\n\n`;
    
    if (results.length > 1) {
      message += `📚 还找到 ${results.length - 1} 条相关教程\n`;
      message += `使用 /教程 查看更多`;
    }
    
    message += `\n━━━━━━━━━━━━━━━`;
    
    return this.replyMessage(event, message);
  }
  
  /**
   * 处理问题
   */
  async handleQuestion(event) {
    const message = event.raw_message;
    
    // 提取关键词
    const keywords = this.extractKeywords(message);
    if (keywords.length === 0) {
      return;
    }
    
    // 搜索教程
    const results = this.searchTutorials(keywords.join(' '));
    
    if (results.length > 0) {
      this.stats.totalQueries++;
      
      const tutorial = results[0];
      tutorial.viewCount++;
      this.tutorials.update(tutorial.id, tutorial);
      
      let reply = `💡 关于您的问题，我找到了相关教程：\n\n`;
      reply += `${tutorial.answer}\n\n`;
      reply += `━━━━━━━━━━━━━━━\n`;
      reply += `使用 /jc help 查看更多帮助`;
      
      await this.replyMessage(event, reply);
      this.saveStats();
    }
  }
  
  /**
   * 提取关键词
   */
  extractKeywords(message) {
    const keywords = [];
    const allTutorials = this.tutorials.findAll();
    
    allTutorials.forEach(tutorial => {
      tutorial.keywords.forEach(keyword => {
        if (message.toLowerCase().includes(keyword.toLowerCase())) {
          keywords.push(keyword);
        }
      });
    });
    
    return [...new Set(keywords)]; // 去重
  }
  
  /**
   * 搜索教程
   */
  searchTutorials(keyword) {
    const lowerKeyword = keyword.toLowerCase();
    const allTutorials = this.tutorials.findAll();
    
    // 计算相关度
    const results = allTutorials.map(tutorial => {
      let score = 0;
      
      // 问题匹配
      if (tutorial.question.toLowerCase().includes(lowerKeyword)) {
        score += 10;
      }
      
      // 答案匹配
      if (tutorial.answer.toLowerCase().includes(lowerKeyword)) {
        score += 5;
      }
      
      // 关键词匹配
      tutorial.keywords.forEach(kw => {
        if (lowerKeyword.includes(kw.toLowerCase()) || 
            kw.toLowerCase().includes(lowerKeyword)) {
          score += 3;
        }
      });
      
      return { tutorial, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.tutorial);
    
    return results;
  }
  
  /**
   * 回复消息
   */
  async replyMessage(event, message) {
    try {
      if (event.message_type === 'group') {
        await this.callApi('send_group_msg', {
          group_id: event.group_id,
          message: message
        });
      } else {
        await this.callApi('send_private_msg', {
          user_id: event.user_id,
          message: message
        });
      }
    } catch (error) {
      this.logger.error('发送消息失败', error);
      this.recordError('api', 'replyMessage', error);
      throw error;
    }
  }
  
  async onEnable() {
    await super.onEnable();
    this.logger.info('教程Ai 已启用');
  }

  async onDisable() {
    await super.onDisable();
    this.saveStats();
    this.logger.info('教程Ai 已禁用');
  }

  async onUnload() {
    await super.onUnload();
    this.saveStats();
    this.logger.info('教程Ai 已卸载');
  }
}
