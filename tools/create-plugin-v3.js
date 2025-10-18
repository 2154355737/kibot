#!/usr/bin/env node

/**
 * KiBot 插件生成器 v3.0
 * 支持三种SDK：Simple、Enhanced、Original
 * 
 * @author KiBot Team
 * @version 3.0.0
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  title: (msg) => console.log(`\n${colors.bright}${colors.blue}${msg}${colors.reset}\n`)
};

class PluginGenerator {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async ask(question) {
    return new Promise((resolve) => {
      this.rl.question(`${colors.cyan}?${colors.reset} ${question}: `, resolve);
    });
  }

  async confirm(question) {
    const answer = await this.ask(`${question} (y/n)`);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  }

  async select(question, options) {
    console.log(`\n${colors.cyan}?${colors.reset} ${question}`);
    options.forEach((opt, index) => {
      console.log(`  ${colors.bright}${index + 1}.${colors.reset} ${opt.label} ${colors.reset}${opt.description ? `\n     ${colors.reset}${opt.description}` : ''}`);
    });
    
    const answer = await this.ask('请选择');
    const index = parseInt(answer) - 1;
    
    if (index >= 0 && index < options.length) {
      return options[index].value;
    }
    
    log.warn('无效选择，使用默认值');
    return options[0].value;
  }

  async generate() {
    log.title('🔌 KiBot 插件生成器 v3.0');
    
    // 收集插件信息
    const pluginInfo = await this.collectPluginInfo();
    
    // 验证信息
    this.validatePluginInfo(pluginInfo);
    
    // 确认信息
    await this.confirmInfo(pluginInfo);
    
    // 创建插件
    await this.createPlugin(pluginInfo);
    
    // 显示完成信息
    this.showCompletionInfo(pluginInfo);
    
    this.rl.close();
  }

  async collectPluginInfo() {
    const info = {};

    // 基本信息
    log.title('📋 基本信息');
    info.id = await this.ask('插件ID (英文小写，连字符分隔，如: my-plugin)');
    info.name = await this.ask('插件名称 (中文或英文)');
    info.author = await this.ask('作者名称');
    info.description = await this.ask('插件描述');
    info.version = '1.0.0';

    // 选择SDK类型
    log.title('🛠 选择开发模式');
    info.sdkType = await this.select('请选择SDK类型', [
      {
        value: 'simple',
        label: 'Simple SDK - 超简单模式',
        description: '零配置，一个文件搞定，适合初学者和简单插件'
      },
      {
        value: 'enhanced',
        label: 'Enhanced SDK - 增强模式',
        description: '完整功能，ORM数据模型，事件过滤，适合复杂插件'
      },
      {
        value: 'original',
        label: 'Original SDK - 经典模式',
        description: 'v2.0经典SDK，向后兼容，适合熟悉旧版的开发者'
      }
    ]);

    // 选择分类
    log.title('📁 插件分类');
    info.category = await this.select('请选择插件分类', [
      { value: 'utility', label: '工具类' },
      { value: 'entertainment', label: '娱乐类' },
      { value: 'admin', label: '管理类' },
      { value: 'integration', label: '集成类' },
      { value: 'game', label: '游戏类' },
      { value: 'social', label: '社交类' },
      { value: 'other', label: '其他' }
    ]);

    // 选择功能
    log.title('⚙️ 插件功能');
    info.hasCommands = await this.confirm('是否需要指令功能');
    info.hasEvents = await this.confirm('是否需要事件处理');
    info.hasTasks = await this.confirm('是否需要定时任务');
    info.hasStorage = await this.confirm('是否需要数据存储');
    info.hasCQCode = await this.confirm('是否需要CQ码处理（图片、@、表情等）');

    // 示例内容
    if (info.hasCommands || info.hasEvents) {
      info.includeExamples = await this.confirm('是否包含示例代码');
    } else {
      info.includeExamples = false;
    }

    return info;
  }

  validatePluginInfo(info) {
    // 验证ID格式
    if (!/^[a-z][a-z0-9-]*$/.test(info.id)) {
      throw new Error('插件ID必须以小写字母开头，只能包含小写字母、数字和连字符');
    }

    // 检查是否已存在
    const pluginPath = path.join(process.cwd(), 'server', 'plugins', info.id);
    if (fs.existsSync(pluginPath)) {
      throw new Error(`插件 "${info.id}" 已存在于 server/plugins/${info.id}`);
    }

    return true;
  }

  async confirmInfo(info) {
    log.title('📝 确认信息');
    console.log(`插件ID:     ${colors.bright}${info.id}${colors.reset}`);
    console.log(`插件名称:   ${colors.bright}${info.name}${colors.reset}`);
    console.log(`作者:       ${colors.bright}${info.author}${colors.reset}`);
    console.log(`描述:       ${colors.bright}${info.description}${colors.reset}`);
    console.log(`SDK类型:    ${colors.bright}${info.sdkType.toUpperCase()}${colors.reset}`);
    console.log(`分类:       ${colors.bright}${info.category}${colors.reset}`);
    console.log(`功能:       ${[
      info.hasCommands && '指令',
      info.hasEvents && '事件',
      info.hasTasks && '定时任务',
      info.hasStorage && '数据存储',
      info.hasCQCode && 'CQ码处理'
    ].filter(Boolean).join(', ') || '无'}`);
    console.log();

    const confirmed = await this.confirm('确认创建插件');
    if (!confirmed) {
      log.warn('已取消创建');
      process.exit(0);
    }
  }

  async createPlugin(info) {
    const pluginPath = path.join(process.cwd(), 'server', 'plugins', info.id);
    
    log.info('创建插件目录...');
    fs.mkdirSync(pluginPath, { recursive: true });
    
    log.info('生成插件文件...');
    
    // 生成 plugin.json
    this.generatePluginJson(pluginPath, info);
    
    // 根据SDK类型生成主文件
    switch (info.sdkType) {
      case 'simple':
        this.generateSimplePlugin(pluginPath, info);
        break;
      case 'enhanced':
        this.generateEnhancedPlugin(pluginPath, info);
        break;
      case 'original':
        this.generateOriginalPlugin(pluginPath, info);
        break;
    }
    
    // 生成 README
    this.generateReadme(pluginPath, info);
    
    log.success('插件创建完成！');
  }

  generatePluginJson(pluginPath, info) {
    const pluginJson = {
      id: info.id,
      name: info.name,
      version: info.version,
      author: info.author,
      description: info.description,
      category: info.category,
      main: 'index.js',
      dependencies: [],
      keywords: [],
      license: 'MIT',
      engines: {
        kibot: '>=3.0.0',
        node: '>=18.0.0'
      },
      permissions: [
        info.hasCommands && 'message.send',
        info.hasEvents && 'event.listen',
        info.hasStorage && 'storage.read',
        info.hasStorage && 'storage.write'
      ].filter(Boolean),
      config: {
        enabled: false,
        debug: false
      }
    };

    fs.writeFileSync(
      path.join(pluginPath, 'plugin.json'),
      JSON.stringify(pluginJson, null, 2)
    );
    log.success('生成 plugin.json');
  }

  generateSimplePlugin(pluginPath, info) {
    const code = `/**
 * ${info.name}
 * ${info.description}
 * 
 * @author ${info.author}
 * @version ${info.version}
 * @sdk Simple SDK v3.0
 */

import { createSimplePlugin, command, event, task } from '../../core/plugin-system/simple-sdk.js';

export default createSimplePlugin({
  name: '${info.name}',
  description: '${info.description}',
  version: '${info.version}',
  author: '${info.author}',
  
  ${info.hasCommands ? `// 指令定义
  commands: {
    ${info.includeExamples ? `
    // 示例指令1: 问候指令
    ...command('hello', {
      description: '发送问候',
      usage: '/hello [名字]',
      cooldown: 3000
    }, async function(ctx, args) {
      const name = args[0] || '朋友';
      return \`你好，\${name}！欢迎使用${info.name}！\`;
    }),
    
    // 示例指令2: 信息查询指令
    ...command('info', {
      description: '查看插件信息',
      usage: '/info'
    }, async function(ctx) {
      return \`📦 ${info.name}\\n版本: ${info.version}\\n作者: ${info.author}\\n描述: ${info.description}\`;
    }),
    ` : `
    // 在这里添加你的指令
    // ...command('mycommand', async function(ctx, args) {
    //   return '指令响应内容';
    // }),
    `}
  },
  ` : ''}
  ${info.hasEvents ? `// 事件处理
  events: {
    ${info.includeExamples ? `
    // 示例事件1: 统计消息数
    ...event('message', async function(evt) {
      const count = this.storage.increment('message_count');
      if (count % 100 === 0) {
        this.logger.info(\`已处理 \${count} 条消息\`);
      }
    }),
    
    // 示例事件2: 欢迎新好友
    ...event('friend_add', async function(evt) {
      setTimeout(async () => {
        await this.sendMessage(
          evt.user_id,
          '👋 感谢添加我为好友！试试 /hello 指令吧！',
          'private'
        );
      }, 2000);
    }),
    ` : `
    // 在这里添加你的事件处理
    // ...event('message', async function(evt) {
    //   // 处理事件
    // }),
    `}
  },
  ` : ''}
  ${info.hasTasks ? `// 定时任务
  tasks: {
    ${info.includeExamples ? `
    // 示例任务: 每小时统计
    ...task('hourly-stats', '0 0 * * * *', async function() {
      const count = this.storage.get('message_count', 0);
      this.logger.info(\`小时统计 - 消息数: \${count}\`);
    }),
    ` : `
    // 在这里添加你的定时任务
    // ...task('task-name', '0 0 * * * *', async function() {
    //   // 执行任务
    // }),
    `}
  },
  ` : ''}
  // 自定义方法
  methods: {
    // 在这里添加你的自定义方法
  },
  
  // 生命周期钩子
  onLoad: async function() {
    this.logger.info('${info.name} 加载完成');
  },
  
  onEnable: async function() {
    this.logger.info('${info.name} 已启用');
  }
});
`;

    fs.writeFileSync(path.join(pluginPath, 'index.js'), code);
    log.success('生成 index.js (Simple SDK)');
  }

  generateEnhancedPlugin(pluginPath, info) {
    const code = `/**
 * ${info.name}
 * ${info.description}
 * 
 * @author ${info.author}
 * @version ${info.version}
 * @sdk Enhanced SDK v3.0
 */

import { EnhancedPluginBase } from '../../core/plugin-system/plugin-sdk-enhanced.js';

export default class ${this.toPascalCase(info.id)} extends EnhancedPluginBase {
  constructor(pluginInfo, context) {
    super(pluginInfo, context);
    ${info.hasStorage && info.includeExamples ? `
    // 定义数据模型
    this.User = this.storage.model('User', {
      id: { type: Number, required: true },
      name: { type: String, required: true },
      points: { type: Number, default: 0 },
      lastActive: { type: Date, required: false }
    });
    ` : ''}
  }

  async onLoad() {
    await super.onLoad();
    this.logger.info('${info.name} 正在加载...');
    ${info.hasCommands ? `
    // 注册指令
    this.registerCommands();
    ` : ''}${info.hasEvents ? `
    // 注册事件
    this.registerEvents();
    ` : ''}${info.hasTasks ? `
    // 注册定时任务
    this.registerTasks();
    ` : ''}
    this.logger.info('${info.name} 加载完成');
  }
  ${info.hasCommands ? `
  registerCommands() {
    ${info.includeExamples ? `
    // 示例指令 - 包含错误处理
    this.registerCommand('hello', async (event) => {
      ${info.hasCQCode ? `// 使用CQ码
      const message = \`\${this.CQ.at(event.user_id)} 你好！欢迎使用${info.name}！\`;` : `const message = '你好！欢迎使用${info.name}！';`}
      await this.replyToEvent(event, message);
    });
    ${info.hasCQCode ? `
    // CQ码处理示例
    this.registerCommand('sendimg', async (event) => {
      const imageUrl = 'https://example.com/image.jpg';
      const message = \`看这张图片：\${this.CQ.image(imageUrl)}\`;
      await this.replyToEvent(event, message);
    });
    ` : ''}
    this.logger.info('已注册指令');
    ` : `
    // 在这里注册你的指令
    // this.registerCommand('mycommand', async (event) => {
    //   await this.replyToEvent(event, '回复内容');
    // });
    `}
  }
  
  /**
   * 注册单个指令（包含自动错误处理）
   */
  registerCommand(command, handler) {
    const cmd = command.startsWith('/') ? command.substring(1) : command;
    
    const wrappedHandler = async (event) => {
      try {
        await handler.call(this, event);
      } catch (error) {
        this.recordError('command', cmd, error);
        const errorMsg = \`⚠️ 执行指令 /\${cmd} 时出错：\${error.message}\`;
        await this.replyToEvent(event, errorMsg, false).catch(() => {});
      }
    };
    
    const commandInfo = {
      plugin: this.info.id,
      command: cmd,
      description: \`\${command} 指令\`,
      usage: \`/\${cmd}\`,
      type: 'custom',
      category: 'utility',
      executionCount: 0,
      registeredAt: Date.now(),
      handler: wrappedHandler
    };
    
    this.context.commandRegistry?.register(commandInfo);
    this.registeredCommands.set(cmd, commandInfo);
  }
  ` : ''}${info.hasEvents ? `
  registerEvents() {
    ${info.includeExamples ? `
    // 示例: 带过滤器的事件处理
    this.onEvent('message')
      .filter(event => event.message_type === 'group')
      .filter(event => event.raw_message && event.raw_message.includes('关键词'))
      .handle(async (event) => {
        try {
          await this.handleKeyword(event);
        } catch (error) {
          this.recordError('event', 'handleKeyword', error);
        }
      });
    ${info.hasCQCode ? `
    // CQ码处理示例: 检测图片消息
    this.onEvent('message')
      .filter(event => this.hasImage(event.raw_message))
      .handle(async (event) => {
        try {
          const images = this.extractImages(event.raw_message);
          this.logger.info(\`收到 \${images.length} 张图片\`);
          // 处理图片...
        } catch (error) {
          this.recordError('event', 'imageHandler', error);
        }
      });
    ` : ''}
    this.logger.info('已注册事件处理');
    ` : `
    // 在这里注册你的事件处理
    // this.onEvent('message')
    //   .filter(event => event.message_type === 'group')
    //   .handle(async (event) => {
    //     try {
    //       // 处理事件
    //     } catch (error) {
    //       this.recordError('event', 'eventName', error);
    //     }
    //   });
    `}
  }
  ${info.includeExamples ? `
  async handleKeyword(event) {
    // 处理包含关键词的消息
    this.logger.info('检测到关键词');
    ${info.hasCQCode ? `
    // 提取纯文本（去除CQ码）
    const text = this.extractText(event.raw_message);
    this.logger.info(\`消息内容: \${text}\`);
    ` : ''}
  }
  ` : ''}
  ` : ''}
  /**
   * 回复消息
   */
  async replyToEvent(event, message, throwError = true) {
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
      this.recordError('api', 'replyToEvent', error);
      
      if (throwError) {
        throw error;
      }
    }
  }${info.hasTasks ? `
  registerTasks() {
    ${info.includeExamples ? `
    // 示例定时任务
    this.schedule('daily-task', '0 0 0 * * *', async () => {
      this.logger.info('执行每日任务');
    });
    ` : `
    // 在这里注册你的定时任务
    `}
  }
  ` : ''}
  async onEnable() {
    await super.onEnable();
    this.logger.info('${info.name} 已启用');
  }

  async onDisable() {
    await super.onDisable();
    this.logger.info('${info.name} 已禁用');
  }

  async onUnload() {
    await super.onUnload();
    this.logger.info('${info.name} 已卸载');
  }
}
`;

    fs.writeFileSync(path.join(pluginPath, 'index.js'), code);
    log.success('生成 index.js (Enhanced SDK)');
  }

  generateOriginalPlugin(pluginPath, info) {
    const code = `/**
 * ${info.name}
 * ${info.description}
 * 
 * @author ${info.author}
 * @version ${info.version}
 * @sdk Original SDK v2.0
 */

import { PluginBase } from '../../core/plugin-system/plugin-sdk.js';

export default class ${this.toPascalCase(info.id)} extends PluginBase {
  constructor(pluginInfo, context) {
    super(pluginInfo, context);
  }

  async onLoad() {
    await super.onLoad();
    this.logger.info('${info.name} 正在加载...');
    ${info.hasCommands ? `
    // 注册指令
    this.registerCommands();
    ` : ''}${info.hasEvents ? `
    // 注册事件
    this.registerEvents();
    ` : ''}
    this.logger.info('${info.name} 加载完成');
  }
  ${info.hasCommands ? `
  registerCommands() {
    ${info.includeExamples ? `
    // 示例指令
    this.onCommand('hello', {
      description: '发送问候',
      usage: '/hello [名字]'
    }, this.handleHello.bind(this));
    ` : `
    // 在这里注册你的指令
    `}
  }
  ${info.includeExamples ? `
  async handleHello(context, args) {
    const name = args[0] || '朋友';
    const message = \`你好，\${name}！\`;
    
    const chatId = context.message_type === 'group' ? context.group_id : context.user_id;
    await this.sendMessage(chatId, message, context.message_type);
  }
  ` : ''}
  ` : ''}${info.hasEvents ? `
  registerEvents() {
    ${info.includeExamples ? `
    // 示例事件
    this.onEvent('message', this.handleMessage.bind(this));
    ` : `
    // 在这里注册你的事件
    `}
  }
  ${info.includeExamples ? `
  async handleMessage(event) {
    // 处理消息事件
  }
  ` : ''}
  ` : ''}
  async onEnable() {
    await super.onEnable();
    this.logger.info('${info.name} 已启用');
  }

  async onDisable() {
    await super.onDisable();
    this.logger.info('${info.name} 已禁用');
  }

  async onUnload() {
    await super.onUnload();
    this.logger.info('${info.name} 已卸载');
  }
}
`;

    fs.writeFileSync(path.join(pluginPath, 'index.js'), code);
    log.success('生成 index.js (Original SDK)');
  }

  generateReadme(pluginPath, info) {
    const sdkInfo = {
      simple: {
        name: 'Simple SDK',
        features: ['零配置', '自动错误处理', '一个文件搞定', '适合初学者']
      },
      enhanced: {
        name: 'Enhanced SDK',
        features: ['ORM数据模型', '事件过滤器', '并发控制', '适合复杂插件']
      },
      original: {
        name: 'Original SDK',
        features: ['经典API', '向后兼容', '稳定可靠', '熟悉的开发方式']
      }
    };

    const sdk = sdkInfo[info.sdkType];

    const readme = `# ${info.name}

${info.description}

## 📋 插件信息

- **ID**: \`${info.id}\`
- **版本**: ${info.version}
- **作者**: ${info.author}
- **分类**: ${info.category}
- **SDK**: ${sdk.name}

## ✨ 特性

${sdk.features.map(f => `- ${f}`).join('\n')}

## 🚀 功能

${[
  info.hasCommands && '- ✅ 指令处理',
  info.hasEvents && '- ✅ 事件监听',
  info.hasTasks && '- ✅ 定时任务',
  info.hasStorage && '- ✅ 数据存储',
  info.hasCQCode && '- ✅ CQ码处理（图片、@、表情等）'
].filter(Boolean).join('\n') || '- 暂无功能'}

## 📦 安装

1. 将插件复制到 \`server/plugins/${info.id}/\`
2. 在Web管理界面扫描插件
3. 启用插件
4. 开始使用

## 🔧 配置

编辑 \`plugin.json\` 的 \`config\` 部分来配置插件。

## 📖 使用方法

${info.hasCommands ? `
### 指令

${info.includeExamples ? `- \`/hello\` - 发送问候${info.hasCQCode ? '\n- `/sendimg` - 发送图片示例' : ''}` : '- 查看代码了解可用指令'}
` : ''}
${info.hasEvents ? `
### 事件

插件会自动监听并处理相关事件。
` : ''}
${info.hasCQCode ? `
### CQ码支持

插件支持处理QQ消息中的各种富媒体内容：

**解析消息：**
\`\`\`javascript
// 解析消息段
const segments = this.parseMessage(event.raw_message);

// 提取纯文本
const text = this.extractText(event.raw_message);

// 提取图片
const images = this.extractImages(event.raw_message);

// 检查是否包含@
if (this.hasAt(event.raw_message)) {
  // 处理@消息
}
\`\`\`

**构建CQ码：**
\`\`\`javascript
// @某人
this.CQ.at(user_id)

// 发送图片
this.CQ.image(url)

// 发送表情
this.CQ.face(id)

// 回复消息
this.CQ.reply(message_id)
\`\`\`

更多CQ码用法参见：[CQ码处理指南](../../文档/server/文档-server-插件错误记录指南.md)
` : ''}

## 🛠 开发

### 添加新功能

${info.sdkType === 'simple' ? `
在 \`commands\` 对象中添加新指令：

\`\`\`javascript
commands: {
  ...command('newcmd', async function(ctx, args) {
    return '新指令响应';
  })
}
\`\`\`
` : `
参考现有代码结构添加新的功能。
`}

### 调试

启用调试模式：在 \`plugin.json\` 中设置 \`"debug": true\`

## 📝 更新日志

### v${info.version} (${new Date().toISOString().split('T')[0]})
- 初始版本
- ${info.hasCommands ? '支持指令处理' : ''}
- ${info.hasEvents ? '支持事件监听' : ''}
- ${info.hasTasks ? '支持定时任务' : ''}

## 📄 许可证

MIT

## 👨‍💻 作者

${info.author}
`;

    fs.writeFileSync(path.join(pluginPath, 'README.md'), readme);
    log.success('生成 README.md');
  }

  showCompletionInfo(info) {
    const pluginPath = path.join('server', 'plugins', info.id);
    
    log.title('🎉 插件创建成功！');
    
    console.log(`${colors.bright}插件位置:${colors.reset}`);
    console.log(`  ${pluginPath}/`);
    console.log();
    
    console.log(`${colors.bright}下一步操作:${colors.reset}`);
    console.log(`  1. 编辑 ${colors.cyan}${pluginPath}/index.js${colors.reset} 实现你的功能`);
    console.log(`  2. 在 Web 管理界面扫描并启用插件`);
    console.log(`  3. 测试你的插件功能`);
    console.log();
    
    if (info.sdkType === 'simple') {
      console.log(`${colors.bright}💡 Simple SDK 提示:${colors.reset}`);
      console.log(`  - 代码自动错误处理`);
      console.log(`  - 返回字符串会自动发送消息`);
      console.log(`  - 非常适合快速开发`);
    } else if (info.sdkType === 'enhanced') {
      console.log(`${colors.bright}💡 Enhanced SDK 提示:${colors.reset}`);
      console.log(`  - 使用 this.storage.model() 创建数据模型`);
      console.log(`  - 使用 this.onEvent().filter().handle() 处理事件`);
      console.log(`  - 使用 this.concurrent() 进行并发处理`);
      console.log(`  - 错误会自动记录到Web管理界面`);
    }
    
    if (info.hasCQCode) {
      console.log();
      console.log(`${colors.bright}📦 CQ码功能:${colors.reset}`);
      console.log(`  - 解析消息: this.parseMessage(message)`);
      console.log(`  - 提取图片: this.extractImages(message)`);
      console.log(`  - 构建CQ码: this.CQ.at(qq), this.CQ.image(url)`);
      console.log(`  - 详见: server/utils/cq-parser.js`);
    }
    
    console.log();
    console.log(`${colors.bright}🛡️ 错误处理:${colors.reset}`);
    console.log(`  - 所有错误会自动记录到插件错误日志`);
    console.log(`  - 在Web界面可查看插件错误统计`);
    console.log(`  - 使用 this.recordError() 手动记录错误`);
    
    console.log();
    console.log(`${colors.green}${colors.bright}✨ 开始你的插件开发之旅吧！${colors.reset}`);
  }

  toPascalCase(str) {
    const cleaned = str.replace(/^[^a-zA-Z]+/, '');
    if (!cleaned) return 'MyPlugin';
    
    return cleaned
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }
}

// 主函数
async function main() {
  try {
    const generator = new PluginGenerator();
    await generator.generate();
  } catch (error) {
    log.error(`错误: ${error.message}`);
    process.exit(1);
  }
}

// 运行
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export default PluginGenerator;

