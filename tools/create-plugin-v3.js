#!/usr/bin/env node

/**
 * KiBot 插件生成器 v3.1
 * 支持 Enhanced SDK (JavaScript) 和 Python SDK
 * 
 * @author KiBot Team
 * @version 3.1.0
 * 
 * 更新日志 v3.1：
 * - 移除已淘汰的 Simple SDK 和 Original SDK
 * - 优化为 Enhanced SDK (推荐) 和 Python SDK 两个选项
 * - 更新代码模板符合最新最佳实践
 * - 简化用户选择流程
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
    log.title('🔌 KiBot 插件生成器 v3.1');
    
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

    // 选择开发语言（SDK已统一，只需选语言）
    log.title('🌐 选择开发语言');
    info.language = await this.select('请选择开发语言', [
      {
        value: 'javascript',
        label: 'JavaScript (Enhanced SDK)',
        description: '推荐！完整功能，性能监控，ORM数据模型，事件过滤'
      },
      {
        value: 'python',
        label: 'Python',
        description: '独立进程运行，适合AI和数据处理，支持异步并发'
      }
    ]);

    // 设置SDK类型
    if (info.language === 'javascript') {
      info.sdkType = 'enhanced';
    } else {
      info.sdkType = 'python';
    }

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
    console.log(`开发语言:   ${colors.bright}${info.language === 'javascript' ? 'JavaScript (Enhanced SDK v3.1)' : 'Python SDK v3.1'}${colors.reset}`);
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
    
    // 根据语言生成主文件
    if (info.language === 'python') {
      this.generatePythonPlugin(pluginPath, info);
    } else {
      // JavaScript 统一使用 Enhanced SDK
      this.generateEnhancedPlugin(pluginPath, info);
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
      main: info.language === 'python' ? 'main.py' : 'index.js',
      dependencies: [],
      keywords: [],
      license: 'MIT',
      engines: {
        kibot: '>=3.1.0',
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

    // 如果是Python插件，添加language和runtime字段
    if (info.language === 'python') {
      pluginJson.language = 'python';
      pluginJson.runtime = {
        python: '>=3.8',
        main: 'main.py',
        requirements: 'requirements.txt'
      };
    }

    fs.writeFileSync(
      path.join(pluginPath, 'plugin.json'),
      JSON.stringify(pluginJson, null, 2)
    );
    log.success('生成 plugin.json');
  }


  generateEnhancedPlugin(pluginPath, info) {
    const code = `/**
 * ${info.name}
 * ${info.description}
 * 
 * @author ${info.author}
 * @version ${info.version}
 * @sdk Enhanced SDK v3.1
 */

import { EnhancedPluginBase } from '../../core/plugin-system/plugin-sdk-enhanced.js';

export default class ${this.toPascalCase(info.id)} extends EnhancedPluginBase {
  constructor(pluginInfo, context) {
    super(pluginInfo, context);
    ${info.hasStorage && info.includeExamples ? `
    // 定义数据模型（ORM风格）
    this.UserData = this.storage.model('UserData', {
      userId: { type: Number, required: true },
      username: { type: String, required: true },
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
    // 示例指令 - 自动包含性能监控和错误处理
    this.registerCommand('hello', async (event) => {
      ${info.hasCQCode ? `// 使用CQ码
      const message = \`\${this.CQ.at(event.user_id)} 你好！欢迎使用${info.name}！\`;` : `const message = '你好！欢迎使用${info.name}！';`}
      await this.replyToEvent(event, message);
    }, {
      description: '问候指令',
      category: 'utility'
    });
    ${info.hasCQCode ? `
    // CQ码处理示例 - 发送图片
    this.registerCommand('sendimg', async (event) => {
      const imageUrl = 'https://example.com/image.jpg';
      const message = \`看这张图片：\${this.CQ.image(imageUrl)}\`;
      await this.replyToEvent(event, message);
    }, {
      description: '发送图片示例',
      category: 'utility'
    });
    ` : ''}
    this.logger.info('已注册指令');
    ` : `
    // 在这里注册你的指令
    // this.registerCommand('mycommand', async (event) => {
    //   await this.replyToEvent(event, '回复内容');
    // }, {
    //   description: '指令描述',
    //   category: 'utility'
    // });
    `}
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


  generateReadme(pluginPath, info) {
    const sdkInfo = info.language === 'python' 
      ? {
          name: 'Python SDK v3.1',
          features: ['异步并发处理', '独立进程运行', 'IPC通信', '自动性能监控', '错误追踪']
        }
      : {
          name: 'Enhanced SDK v3.1',
          features: ['ORM数据模型', '事件过滤器', '并发控制', '自动性能监控', '错误追踪', '统计数据管理']
        };

    const readme = `# ${info.name}

${info.description}

## 📋 插件信息

- **ID**: \`${info.id}\`
- **版本**: ${info.version}
- **作者**: ${info.author}
- **分类**: ${info.category}
- **开发语言**: ${info.language === 'python' ? 'Python' : 'JavaScript'}
- **SDK**: ${sdkInfo.name}

## ✨ 特性

${sdkInfo.features.map(f => `- ${f}`).join('\n')}

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

${info.language === 'javascript' ? `
参考现有代码结构添加新的功能：

**添加指令：**
\`\`\`javascript
this.registerCommand('mycommand', async (event) => {
  await this.replyToEvent(event, '响应内容');
}, {
  description: '指令描述',
  category: 'utility'
});
\`\`\`

**添加事件处理：**
\`\`\`javascript
this.onEvent('message')
  .filter(event => event.message_type === 'group')
  .handle(async (event) => {
    // 处理事件
  });
\`\`\`
` : `
参考现有代码结构添加新的功能：

**添加指令：**
\`\`\`python
self.register_command('mycommand', self.handle_mycommand,
    description='指令描述',
    usage='/mycommand'
)
\`\`\`

**添加事件处理：**
\`\`\`python
self.register_event('message', self.handle_message)
\`\`\`
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
    const mainFile = info.language === 'python' ? 'main.py' : 'index.js';
    
    log.title('🎉 插件创建成功！');
    
    console.log(`${colors.bright}插件位置:${colors.reset}`);
    console.log(`  ${pluginPath}/`);
    console.log();
    
    console.log(`${colors.bright}下一步操作:${colors.reset}`);
    console.log(`  1. 编辑 ${colors.cyan}${pluginPath}/${mainFile}${colors.reset} 实现你的功能`);
    if (info.language === 'python') {
      console.log(`  2. 如需第三方库，编辑 ${colors.cyan}requirements.txt${colors.reset}`);
      console.log(`  3. 在 Web 管理界面扫描并启用插件`);
      console.log(`  4. 测试你的插件功能`);
    } else {
      console.log(`  2. 在 Web 管理界面扫描并启用插件`);
      console.log(`  3. 测试你的插件功能`);
    }
    console.log();
    
    if (info.language === 'python') {
      console.log(`${colors.bright}💡 Python SDK 提示:${colors.reset}`);
      console.log(`  - 独立进程运行，与Node.js通过IPC通信`);
      console.log(`  - 支持异步并发处理 (asyncio)`);
      console.log(`  - 使用 await self.storage.get/set() 进行数据存储`);
      console.log(`  - 所有API调用都是异步的`);
      console.log(`  - 错误会自动记录到Web管理界面`);
    } else {
      console.log(`${colors.bright}💡 Enhanced SDK v3.1 提示:${colors.reset}`);
      console.log(`  - 使用 this.storage.model() 创建ORM数据模型`);
      console.log(`  - 使用 this.onEvent().filter().handle() 链式处理事件`);
      console.log(`  - 使用 this.concurrent() 进行并发控制`);
      console.log(`  - 自动性能监控和统计数据管理`);
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

  generatePythonPlugin(pluginPath, info) {
    // 生成main.py
    const code = `#!/usr/bin/env python3
"""
${info.name}
${info.description}

@author ${info.author}
@version ${info.version}
@sdk Python SDK v3.1
"""

import sys
import os
import asyncio
import json

# 添加SDK路径
sdk_path = os.path.join(os.path.dirname(__file__), '../../core/python-plugin-system')
sys.path.insert(0, sdk_path)

# 启动环境检查
from startup_check import check_and_start
if not check_and_start("${info.name}", required_python="3.8"):
    sys.exit(1)

from plugin_base import PluginBase
${info.hasCQCode ? `from cq_parser import CQBuilder\n` : ''}


class ${this.toPascalCase(info.id)}(PluginBase):
    """${info.name}"""
    
    def __init__(self, plugin_info, context_config):
        super().__init__(plugin_info, context_config)
        ${info.hasStorage && info.includeExamples ? `
        # 初始化数据（示例）
        self.message_count = 0
        ` : ''}
    
    async def on_load(self):
        """插件加载 - 插件首次加载时调用"""
        await super().on_load()
        self.logger.info("${info.name} 正在加载...")
        ${info.hasStorage && info.includeExamples ? `
        # 加载持久化数据
        self.message_count = await self.storage.get('message_count', 0)
        self.logger.info(f"已加载消息统计: {self.message_count}")
        ` : ''}
    
    async def on_enable(self):
        """插件启用 - 插件被启用时调用"""
        await super().on_enable()
        self.logger.info("${info.name} 已启用")
        ${info.hasCommands ? `
        # 注册指令
        await self.register_commands()
        ` : ''}${info.hasEvents ? `
        # 注册事件
        await self.register_events()
        ` : ''}${info.hasTasks ? `
        # 注册定时任务
        await self.register_tasks()
        ` : ''}
    ${info.hasCommands ? `
    async def register_commands(self):
        """注册指令 - 自动包含性能监控和错误追踪"""
        ${info.includeExamples ? `# 示例指令1: 问候指令
        self.register_command('hello', self.handle_hello,
            description='发送问候',
            usage='/hello [名字]'
        )
        ${info.hasCQCode ? `
        # 示例指令2: CQ码处理
        self.register_command('sendimg', self.handle_sendimg,
            description='发送图片示例',
            usage='/sendimg'
        )
        ` : ''}` : `# 在这里注册你的指令
        # self.register_command('mycommand', self.handle_mycommand,
        #     description='指令描述',
        #     usage='/mycommand'
        # )`}
        self.logger.info("已注册指令")
    ${info.includeExamples ? `
    async def handle_hello(self, event, args):
        """处理问候指令"""
        name = args[0] if args else '世界'
        ${info.hasCQCode ? `# 使用CQ码 @用户
        from cq_parser import CQBuilder
        cq = CQBuilder()
        message = f"{cq.at(event.get('user_id'))} 你好，{name}！这是来自${info.name}的问候！🐍"` : `message = f"你好，{name}！这是来自${info.name}的问候！🐍"`}
        
        msg_type = event.get('message_type', 'private')
        chat_id = event.get('group_id') if msg_type == 'group' else event.get('user_id')
        
        await self.send_message(chat_id, message, msg_type)
    ${info.hasCQCode ? `
    async def handle_sendimg(self, event, args):
        """处理发送图片指令"""
        from cq_parser import CQBuilder
        cq = CQBuilder()
        
        # 构建带图片的消息
        image_url = 'https://example.com/image.jpg'
        message = f"看这张图片：{cq.image(image_url)}"
        
        msg_type = event.get('message_type', 'private')
        chat_id = event.get('group_id') if msg_type == 'group' else event.get('user_id')
        
        await self.send_message(chat_id, message, msg_type)
    ` : ''}` : ''}
    ` : ''}    ${info.hasEvents ? `
    async def register_events(self):
        """注册事件 - 自动包含性能监控"""
        ${info.includeExamples ? `# 注册消息事件处理
        self.register_event('message', self.handle_message)` : `# 在这里注册你的事件处理
        # self.register_event('message', self.handle_message)`}
        self.logger.info("已注册事件")
    ${info.includeExamples ? `
    async def handle_message(self, event):
        """处理消息事件"""
        raw_message = event.get('raw_message', '')
        msg_type = event.get('message_type', '')
        
        self.logger.debug(f"收到{msg_type}消息: {raw_message}")
        ${info.hasStorage ? `
        # 统计消息数
        self.message_count += 1
        if self.message_count % 100 == 0:
            await self.storage.set('message_count', self.message_count)
            self.logger.info(f"已处理 {self.message_count} 条消息")
        ` : ''}
        ${info.hasCQCode ? `
        # CQ码处理示例：检测是否包含图片
        if '[CQ:image' in raw_message:
            self.logger.info("检测到图片消息")
            # 可以使用 cq_parser 解析图片URL等信息
        ` : ''}
    ` : ''}
    ` : ''}    ${info.hasTasks ? `
    async def register_tasks(self):
        """注册定时任务 - Cron表达式格式"""
        ${info.includeExamples ? `# 示例：每小时执行一次 (秒 分 时 日 月 周)
        await self.schedule('hourly_task', '0 0 * * * *', self.hourly_task)` : `# 在这里注册你的定时任务
        # await self.schedule('task_name', '0 0 * * * *', self.task_handler)`}
        self.logger.info("已注册定时任务")
    ${info.includeExamples ? `
    async def hourly_task(self):
        """每小时执行的任务"""
        self.logger.info("执行每小时统计任务")
        ${info.hasStorage ? `
        # 保存统计数据
        await self.storage.set('message_count', self.message_count)
        await self.storage.set('last_task_time', datetime.now().isoformat())
        ` : ''}
    ` : ''}
    ` : ''}
    async def on_disable(self):
        """插件禁用 - 插件被禁用时调用"""
        ${info.hasStorage && info.includeExamples ? `# 保存数据
        await self.storage.set('message_count', self.message_count)
        ` : ''}await super().on_disable()
        self.logger.info("${info.name} 已禁用")
    
    async def on_unload(self):
        """插件卸载 - 插件被卸载时调用"""
        ${info.hasStorage && info.includeExamples ? `# 最后一次保存数据
        await self.storage.set('message_count', self.message_count)
        ` : ''}await super().on_unload()
        self.logger.info("${info.name} 已卸载")


async def main():
    """主函数"""
    line = sys.stdin.readline()
    if not line:
        print("❌ 未收到初始化消息", file=sys.stderr)
        sys.exit(1)
    
    try:
        init_message = json.loads(line)
        
        if init_message.get('action') != 'load':
            print(f"❌ 期望load消息，收到: {init_message.get('action')}", file=sys.stderr)
            sys.exit(1)
        
        plugin_info = init_message['data']['pluginInfo']
        context_config = init_message['data']['context']
        
        plugin = ${this.toPascalCase(info.id)}(plugin_info, context_config)
        await plugin.ipc.start()
        
        # 注册处理器
        plugin.ipc.on_request('enable', lambda data: plugin.on_enable())
        plugin.ipc.on_request('disable', lambda data: plugin.on_disable())
        plugin.ipc.on_request('unload', lambda data: plugin.on_unload())
        
        # 注册事件分发
        ${info.hasEvents ? `plugin.ipc.on_event('message', lambda data: plugin.dispatch_event('message', data))` : '# 无事件处理'}
        
        # 注册指令分发
        async def dispatch_command_handler(data):
            await plugin.dispatch_command(data['command'], data['event'], data['args'])
        plugin.ipc.on_request('dispatchCommand', dispatch_command_handler)
        
        # 注册任务分发
        ${info.hasTasks ? `async def dispatch_task_handler(data):
            await plugin.dispatch_task(data['taskName'])
        plugin.ipc.on_request('dispatchTask', dispatch_task_handler)` : '# 无定时任务'}
        
        await plugin.on_load()
        await plugin.ipc.send_response(init_message['id'], {'success': True})
        
        while plugin.ipc.running:
            await asyncio.sleep(0.1)
            
    except Exception as error:
        print(f"❌ 插件初始化失败: {error}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("🛑 插件被中断", file=sys.stderr)
    except Exception as error:
        print(f"❌ 插件运行错误: {error}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
`;

    fs.writeFileSync(path.join(pluginPath, 'main.py'), code);
    log.success('生成 main.py (Python SDK)');
    
    // 生成requirements.txt
    const requirements = `# ${info.name} 依赖

# Python版本要求
# python>=3.8

# 如果需要其他包，可以在这里添加
# 例如:
# requests>=2.28.0
# aiohttp>=3.8.0
`;
    
    fs.writeFileSync(path.join(pluginPath, 'requirements.txt'), requirements);
    log.success('生成 requirements.txt');
    
    // 生成pyrightconfig.json（解决IDE导入警告）
    const pyrightConfig = {
      extraPaths: ["../../core/python-plugin-system"],
      pythonVersion: "3.8",
      pythonPlatform: "All",
      typeCheckingMode: "basic",
      reportMissingImports: "warning",
      reportMissingTypeStubs: false
    };
    
    fs.writeFileSync(
      path.join(pluginPath, 'pyrightconfig.json'),
      JSON.stringify(pyrightConfig, null, 2)
    );
    log.success('生成 pyrightconfig.json');
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

