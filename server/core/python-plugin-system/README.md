# KiBot Python插件SDK

## 📦 简介

KiBot Python插件SDK让您可以使用Python语言开发QQ机器人插件，享受完整的Python生态支持。

## ✨ 特性

- 🐍 **纯Python开发** - 使用熟悉的Python语法
- 🔌 **完整功能** - 与JavaScript插件功能对等
- 🛡️ **进程隔离** - 插件崩溃不影响主服务器
- 📝 **类型提示** - 完整的类型注解支持
- 🔥 **简单易用** - 清晰的API设计

## 🚀 快速开始

### 创建插件

```bash
cd tools
node create-plugin-v3.js
# 选择 Python 语言
```

### 插件结构

```python
from plugin_base import PluginBase

class MyPlugin(PluginBase):
    async def on_enable(self):
        # 注册指令
        self.register_command('hello', self.handle_hello)
        
        # 注册事件
        self.register_event('message', self.handle_message)
    
    async def handle_hello(self, event, args):
        await self.send_message(
            event['user_id'],
            'Hello from Python!',
            event['message_type']
        )
```

## 📖 API文档

### 生命周期

```python
async def on_load(self):      # 插件加载
async def on_enable(self):    # 插件启用
async def on_disable(self):   # 插件禁用
async def on_unload(self):    # 插件卸载
```

### 注册功能

```python
# 注册指令
self.register_command('cmd', handler, description='...', usage='...')

# 注册事件
self.register_event('message', handler)

# 注册定时任务
await self.schedule('task', '0 0 * * * *', handler)
```

### 消息发送

```python
# 发送消息
await self.send_message(chat_id, message, msg_type)

# 发送私聊
await self.send_private_msg(user_id, message)

# 发送群消息
await self.send_group_msg(group_id, message)
```

### CQ码处理

```python
from cq_parser import CQBuilder, CQParser

# 构建CQ码
message = f"{CQBuilder.at(qq)} 你好！"
message += CQBuilder.image(url)

# 解析CQ码
segments = CQParser.parse(raw_message)
text = CQParser.extract_text(segments)
images = CQParser.extract_by_type(segments, 'image')
```

### 数据存储

```python
# 保存
await self.storage.set('key', value)

# 读取
value = await self.storage.get('key', default)

# 删除
await self.storage.delete('key')
```

### 日志

```python
self.logger.debug('调试信息')
self.logger.info('一般信息')
self.logger.warn('警告')
self.logger.error('错误')
```

## 🔍 环境检查

SDK自动检查：
- ✅ Python版本 (>=3.8)
- ✅ SDK模块可用性
- ✅ requirements.txt依赖

## 📝 示例插件

查看 `server/plugins/example-python-plugin/` 获取完整示例。

## 🐛 故障排查

### 导入警告

如果IDE显示导入警告，确保有 `pyrightconfig.json`：
```json
{
  "extraPaths": ["../../core/python-plugin-system"]
}
```

### 依赖缺失

```bash
pip install -r requirements.txt
```

### 进程启动失败

检查：
1. Python版本是否 >= 3.8
2. main.py是否有执行权限
3. SDK路径是否正确

## 📚 更多文档

- [Python插件架构设计](../../../文档/server/文档-server-Python插件架构设计.md)
- [Python插件开发指南](../../../文档/server/文档-server-Python插件开发指南.md)
- [插件开发指南](../../../文档/server/文档-server-插件开发指南.md)

---

**SDK版本**: v1.0.0  
**Python要求**: >= 3.8  
**作者**: KiBot Team

