# KiBot - QQ机器人管理系统

<div align="center">

![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)
![Backend](https://img.shields.io/badge/backend-v3.0.0-green.svg)
![Frontend](https://img.shields.io/badge/frontend-v1.4.5-orange.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

一个功能强大的QQ机器人管理系统，基于Node.js和React开发  
支持LLOneBot、NapCat等OneBot 11标准框架

[文档](./文档/) · [更新日志](./CHANGELOG.md) · [升级指南](./文档/v3.0.0-升级指南.md)

</div>

---

## ✨ 特性

### 🎯 核心功能
- ✅ **事件规则引擎** - 灵活的消息处理和自动回复
- ✅ **任务管理系统** - 支持定时任务和自动化
- ✅ **Web管理界面** - 美观易用的可视化管理
- ✅ **实时监控** - 系统状态和性能监控

### 🔌 插件系统 v3.0 (NEW!)
- ✅ **三种SDK模式** - Simple/Enhanced/Original，满足不同需求
- ✅ **热插拔** - 无需重启即可加载/卸载插件
- ✅ **可视化管理** - Web界面管理插件
- ✅ **插件生成器** - 快速创建插件模板

### 📦 CQ码支持 (NEW!)
- ✅ **完整解析** - 支持所有OneBot 11标准CQ码
- ✅ **便捷构建** - 简单API构建富媒体消息
- ✅ **自动处理** - 图片、@、表情等自动识别
- ✅ **示例插件** - 开箱即用的CQ码示例

### 🛡️ 安全增强
- ✅ **认证系统** - 安全的用户认证和授权
- ✅ **权限控制** - 细粒度的权限管理
- ✅ **错误记录** - 完善的错误日志和统计
- ✅ **数据加密** - 敏感信息加密存储

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18.0.0
- **QQ Bot框架**: LLOneBot / NapCat / 其他OneBot 11兼容框架
- **操作系统**: Windows / Linux / macOS

### 安装步骤

#### 1. 克隆项目
```bash
git clone https://github.com/yourusername/QQbot.git
cd QQbot
```

#### 2. 安装后端依赖
```bash
cd server
npm install
```

#### 3. 配置后端

**配置QQ Bot连接** (`server/config/llonebot.json`):
```json
{
  "wsUrl": "ws://127.0.0.1:3001",
  "httpUrl": "http://127.0.0.1:3000",
  "token": ""
}
```

**配置安全设置** (`server/config/security.json`):
```json
{
  "authKey": "your-secret-key",
  "adminUsers": [你的QQ号],
  "allowedGroups": [],
  "enableAuth": true
}
```

#### 4. 启动后端
```bash
node index.js
```

#### 5. 安装前端依赖
```bash
cd ../Web
npm install
```

#### 6. 启动前端

**开发模式**:
```bash
npm run dev
```

**生产模式**:
```bash
npm run build
# 使用nginx或其他web服务器代理dist目录
```

#### 7. 访问Web管理界面
打开浏览器访问: http://localhost:3500

---

## 📖 文档

### 快速入门
- 📘 [项目总览](./文档/文档-项目总览.md)
- 📘 [后端项目介绍](./文档/server/文档-server-后端项目介绍.md)
- 📘 [前端项目介绍](./文档/web/文档-web-前端项目介绍.md)

### 开发指南
- 📗 [插件开发指南](./文档/server/文档-server-插件开发指南.md)
- 📗 [插件系统v3.0升级总结](./文档/更新日志/更新日志-2025-10-18-插件系统v3.0升级总结.md)
- 📗 [CQ码处理和错误记录指南](./文档/server/文档-server-插件错误记录指南.md)
- 📗 [API接口文档](./文档/server/文档-server-API接口文档.md)

### 部署运维
- 📕 [部署运维指南](./文档/server/文档-server-部署运维指南.md)
- 📕 [v3.0.0升级指南](./文档/v3.0.0-升级指南.md)
- 📕 [发布指南](./文档/发布指南.md)

---

## 🔌 插件开发

### 使用插件生成器

```bash
cd tools
node create-plugin-v3.js
```

按照提示操作即可创建插件模板。

### 三种SDK模式

#### 1. Simple SDK - 最简单
```javascript
import { createSimplePlugin, command } from '../../core/plugin-system/simple-sdk.js';

export default createSimplePlugin({
  commands: {
    ...command('hello', async function(ctx) {
      return '你好！';
    })
  }
});
```

#### 2. Enhanced SDK - 功能完整
```javascript
import { EnhancedPluginBase } from '../../core/plugin-system/plugin-sdk-enhanced.js';

export default class MyPlugin extends EnhancedPluginBase {
  async onLoad() {
    // 注册指令
    this.registerCommand('hello', async (event) => {
      const message = `${this.CQ.at(event.user_id)} 你好！`;
      await this.replyToEvent(event, message);
    });
    
    // 监听事件
    this.onEvent('message')
      .filter(event => this.hasImage(event.raw_message))
      .handle(async (event) => {
        const images = this.extractImages(event.raw_message);
        console.log(`收到 ${images.length} 张图片`);
      });
  }
}
```

#### 3. Original SDK - 向后兼容
```javascript
import { PluginBase } from '../../core/plugin-system/plugin-sdk.js';

export default class MyPlugin extends PluginBase {
  async onLoad() {
    this.onCommand('hello', {}, this.handleHello.bind(this));
  }
}
```

### 示例插件

- **CQ码示例** (`server/plugins/cq-example/`) - CQ码处理、错误记录示例
- **教程AI** (`server/plugins/jc/`) - 智能教程问答系统

---

## 🎯 使用示例

### CQ码处理

```javascript
// 检测图片
if (this.hasImage(event.raw_message)) {
  const images = this.extractImages(event.raw_message);
  // 处理图片...
}

// 构建富媒体消息
const message = [
  this.CQ.at(user_id),
  ' 你好！',
  this.CQ.face(178),
  ' ',
  this.CQ.image('https://example.com/image.jpg')
].join('');
```

### 错误处理

```javascript
try {
  await riskyOperation();
} catch (error) {
  // 错误会自动记录到Web界面
  this.recordError('operation', 'riskyOperation', error);
}
```

### 数据存储

```javascript
// 创建数据模型
this.User = this.storage.model('User', {
  id: { type: Number, required: true },
  name: { type: String, required: true }
});

// 使用模型
const user = this.User.create({ id: 123, name: 'Ki' });
const users = this.User.findAll();
```

---

## 📊 项目结构

```
QQbot/
├── server/                 # 后端服务
│   ├── core/              # 核心模块
│   │   ├── event-engine.js
│   │   ├── task-manager.js
│   │   └── plugin-system/ # 插件系统v3.0
│   ├── plugins/           # 插件目录
│   ├── data/              # 数据存储
│   ├── config/            # 配置文件
│   └── utils/             # 工具函数
│       └── cq-parser.js   # CQ码解析器
├── Web/                   # 前端应用
│   ├── src/
│   │   ├── pages/         # 页面组件
│   │   ├── components/    # UI组件
│   │   ├── services/      # API服务
│   │   └── store/         # 状态管理
│   └── dist/              # 构建产物
├── tools/                 # 开发工具
│   └── create-plugin-v3.js # 插件生成器
└── 文档/                  # 项目文档
```

---

## 🔄 版本历史

### [3.0.0] - 2025-10-18 (当前版本)

**重大更新**:
- 🎉 插件系统v3.0重构
- 🎉 CQ码处理系统
- 🎉 错误记录增强
- 🎉 插件生成器v3

[查看完整更新日志](./CHANGELOG.md)

### 版本规范
- 后端版本: v3.0.0
- 前端版本: v1.4.5
- SDK版本: v3.0

---

## 🛠️ 技术栈

### 后端
- **运行时**: Node.js 18+
- **WebSocket**: ws
- **HTTP**: 原生 http/https
- **工具库**: axios, uuid, chalk

### 前端
- **框架**: React 18
- **构建工具**: Vite
- **UI库**: shadcn/ui
- **样式**: Tailwind CSS
- **状态管理**: Zustand
- **路由**: React Router
- **图表**: Recharts

---

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

### 贡献方式
1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

### 开发规范
- 遵循现有代码风格
- 添加必要的注释和文档
- 测试新功能
- 更新相关文档

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

### 相关项目
- [LLOneBot](https://github.com/LLOneBot/LLOneBot) - QQ Bot框架
- [NapCat](https://github.com/NapNeko/NapCat) - QQ Bot框架
- [OneBot](https://github.com/botuniverse/onebot) - 机器人应用接口标准

### 开源组件
- React - UI框架
- shadcn/ui - UI组件库
- Vite - 构建工具

---

## 📞 支持

### 获取帮助
- 📖 查看[文档](./文档/)
- 🐛 [提交Issue](https://github.com/yourusername/QQbot/issues)
- 💬 加入QQ群: (群号)

### 常见问题
- [升级指南](./文档/v3.0.0-升级指南.md)
- [插件开发指南](./文档/server/文档-server-插件开发指南.md)
- [API文档](./文档/server/文档-server-API接口文档.md)

---

## ⭐ Star History

如果这个项目对你有帮助，请给个 Star ⭐️

---

<div align="center">

**Made with ❤️ by KiBot Team**

[GitHub](https://github.com/yourusername/QQbot) · [文档](./文档/) · [更新日志](./CHANGELOG.md)

</div>

