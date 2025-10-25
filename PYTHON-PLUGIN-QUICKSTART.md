# Python插件快速开始指南

## 🎯 概述

KiBot现已支持使用Python语言开发插件！您可以利用Python丰富的生态（AI、数据处理等）来扩展机器人功能。

## ✅ 已完成的功能

### 核心架构
- ✅ Python插件SDK（完整API）
- ✅ Node.js适配器（进程管理和IPC）
- ✅ 插件管理器集成
- ✅ 示例插件（3个指令，2个事件）

### 开发工具
- ✅ 插件生成器支持Python
- ✅ 环境检查工具
- ✅ Pyright配置（消除导入警告）

### 文档
- ✅ 架构设计文档
- ✅ 开发指南
- ✅ API文档

## 🚀 快速测试

### 1. 启用示例插件

在Web管理界面：
1. 点击"扫描插件"
2. 找到"Python示例插件"
3. 点击"启用"

### 2. 测试指令

在QQ中发送：
```
/pyhello          # Python问候
/pyhello 张三     # 问候指定的人
/pystats          # 查看插件统计
/pyecho 测试消息  # 回显消息
```

### 3. 查看日志

终端会显示：
```
[Python启动] ✅ Python版本: 3.x.x
[Python启动] ✅ KiBot Python SDK 可用
[Python:example-python-plugin] ℹ️ 加载完成 (消息: 0, 问候: 0)
[Python:example-python-plugin] ℹ️ 已启用 (指令: 3, 事件: 2)
```

## 📝 创建自己的Python插件

### 使用生成器

```bash
cd tools
node create-plugin-v3.js
```

选择：
- **语言**: Python
- **功能**: 根据需要选择指令、事件、定时任务等
- **示例**: 建议包含示例代码

### 手动创建

#### 1. 创建目录结构
```
server/plugins/my-python-plugin/
├── plugin.json
├── main.py
├── requirements.txt
└── pyrightconfig.json
```

#### 2. plugin.json
```json
{
  "id": "my-python-plugin",
  "name": "我的Python插件",
  "version": "1.0.0",
  "language": "python",
  "runtime": {
    "python": ">=3.8",
    "main": "main.py"
  }
}
```

#### 3. main.py
```python
import sys
import os
sdk_path = os.path.join(os.path.dirname(__file__), '../../core/python-plugin-system')
sys.path.insert(0, sdk_path)

from startup_check import check_and_start
if not check_and_start("我的插件"):
    sys.exit(1)

from plugin_base import PluginBase

class MyPlugin(PluginBase):
    async def on_enable(self):
        await super().on_enable()
        self.register_command('test', self.handle_test)
        self.logger.info("插件已启用")
    
    async def handle_test(self, event, args):
        await self.send_message(
            event['user_id'],
            'Hello from Python!',
            event['message_type']
        )

# ... 主函数样板代码（参考example-python-plugin）
```

## 🔍 功能对比

| 功能 | JavaScript插件 | Python插件 | 说明 |
|------|---------------|------------|------|
| 指令处理 | ✅ | ✅ | API一致 |
| 事件监听 | ✅ | ✅ | API一致 |
| 定时任务 | ✅ | ✅ | 支持Cron |
| 数据存储 | ✅ | ✅ | 通过IPC |
| CQ码处理 | ✅ | ✅ | 完整支持 |
| 热重载 | ✅ | ⚠️ | 进程重启 |
| 性能 | 高 | 中 | IPC开销 |
| 生态 | npm | pip | Python更丰富 |

## 💡 使用建议

### 适合用Python的场景
- 🤖 AI对话（OpenAI、Transformers）
- 📊 数据分析（Pandas、NumPy）
- 🖼️ 图像处理（Pillow、OpenCV）
- 🔬 科学计算（SciPy）
- 🕷️ 网络爬虫（BeautifulSoup、Scrapy）

### 适合用JavaScript的场景
- 🚀 高性能需求
- 🔌 需要热重载
- 📦 轻量级工具
- 🎮 简单功能

## 🐛 已知问题

### 当前限制
- ⚠️ 每次重载需要重启进程
- ⚠️ IPC通信有轻微性能开销
- ⚠️ 大数据传输较慢（未来可用TCP优化）

### 解决方案
- 使用缓存减少API调用
- 批量处理减少IPC通信
- 异步操作提升效率

## 📈 下一步

### 近期计划
- [ ] 热重载优化
- [ ] 依赖自动安装
- [ ] 更多示例插件
- [ ] 性能基准测试

### 长期规划
- [ ] Python插件市场
- [ ] 可视化调试工具
- [ ] 性能分析工具
- [ ] TypeScript类型定义

## 📞 支持

遇到问题？
1. 查看文档：`文档/server/文档-server-Python插件开发指南.md`
2. 参考示例：`server/plugins/example-python-plugin/`
3. 查看日志：终端输出和错误信息

---

🎉 **开始您的Python插件开发之旅吧！**

