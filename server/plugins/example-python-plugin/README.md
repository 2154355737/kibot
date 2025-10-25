# Python示例插件

这是一个演示如何使用Python开发KiBot插件的示例项目。

## 📋 插件信息

- **语言**: Python 3.8+
- **SDK**: KiBot Python Plugin SDK v1.0
- **作者**: KiBot Team

## ✨ 功能特性

- ✅ 指令处理（/pyhello, /pystats, /pyecho）
- ✅ 事件监听（消息统计、新成员欢迎）
- ✅ 数据存储（持久化统计数据）
- ✅ CQ码支持（@消息、富媒体内容）
- ✅ 定时任务（可选）

## 🚀 快速开始

### 1. 安装依赖

```bash
# 确保已安装Python 3.8+
python --version

# 如果有依赖，安装它们
pip install -r requirements.txt
```

### 2. 启用插件

在KiBot Web管理界面中：
1. 扫描插件
2. 找到"Python示例插件"
3. 点击启用

### 3. 测试插件

发送以下指令测试：

- `/pyhello` - 接收Python插件的问候
- `/pyhello 张三` - 问候指定的人
- `/pystats` - 查看插件统计信息
- `/pyecho Hello World` - 回显消息

## 📖 指令说明

### `/pyhello [名字]`
发送问候消息。

**示例**:
- `/pyhello` - 问候"朋友"
- `/pyhello 小明` - 问候"小明"

### `/pystats`
查看插件统计信息，包括：
- 处理的消息数
- 问候次数
- 指令执行次数
- 事件处理次数

### `/pyecho <消息>`
回显你发送的消息，支持CQ码。

**示例**:
- `/pyecho Hello World`
- `/pyecho [CQ:face,id=178]`

## 🔧 代码结构

```python
class ExamplePythonPlugin(PluginBase):
    # 生命周期钩子
    async def on_load(self):      # 插件加载
    async def on_enable(self):    # 插件启用
    async def on_disable(self):   # 插件禁用
    async def on_unload(self):    # 插件卸载
    
    # 注册功能
    async def register_commands(self):  # 注册指令
    async def register_events(self):    # 注册事件
    async def register_tasks(self):     # 注册定时任务
    
    # 指令处理器
    async def handle_hello(self, event, args):
    async def handle_stats(self, event, args):
    async def handle_echo(self, event, args):
    
    # 事件处理器
    async def handle_message(self, event):
    async def handle_group_join(self, event):
    
    # 定时任务
    async def hourly_task(self):
```

## 📚 开发指南

### 添加新指令

```python
# 1. 在register_commands中注册
self.register_command('mycommand', self.handle_mycommand,
    description='我的指令',
    usage='/mycommand <参数>'
)

# 2. 实现处理器
async def handle_mycommand(self, event, args):
    # 处理指令逻辑
    await self.send_message(
        event['user_id'],
        '指令响应',
        event['message_type']
    )
```

### 添加事件监听

```python
# 1. 在register_events中注册
self.register_event('friend_add', self.handle_friend_add)

# 2. 实现处理器
async def handle_friend_add(self, event):
    user_id = event.get('user_id')
    # 处理事件逻辑
```

### 使用CQ码

```python
from cq_parser import CQBuilder, CQParser

# 构建CQ码
message = f"{CQBuilder.at(user_id)} 你好！"
message += CQBuilder.face(178)  # 表情
message += CQBuilder.image('https://example.com/image.jpg')

# 解析CQ码
segments = CQParser.parse(raw_message)
text = CQParser.extract_text(segments)
images = CQParser.extract_by_type(segments, 'image')
```

### 数据存储

```python
# 保存数据
await self.storage.set('key', 'value')

# 读取数据
value = await self.storage.get('key', default_value)

# 删除数据
await self.storage.delete('key')
```

### 定时任务

```python
# 注册定时任务（Cron表达式）
await self.schedule('task_name', '0 0 * * * *', self.my_task)

# 任务处理器
async def my_task(self):
    self.logger.info('定时任务执行')
```

## 🐛 调试

启用调试模式：在`plugin.json`中设置`"debug": true`

查看日志：Python插件的日志会输出到stderr，Node.js会捕获并显示。

## 📝 注意事项

1. **异步编程**: 所有处理器都应该是`async`函数
2. **错误处理**: SDK会自动捕获并记录错误
3. **资源清理**: 在`on_disable`和`on_unload`中清理资源
4. **数据保存**: 定期保存重要数据，不要只在卸载时保存

## 🔗 相关文档

- [Python插件架构设计](../../../文档/server/文档-server-Python插件架构设计.md)
- [Python插件开发指南](../../../文档/server/文档-server-Python插件开发指南.md)
- [插件SDK API文档](../../core/python-plugin-system/README.md)

## 📄 许可证

MIT

## 👨‍💻 作者

KiBot Team

