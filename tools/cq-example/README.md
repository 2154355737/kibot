# CQ码处理示例插件

演示如何使用KiBot Enhanced SDK v3.0处理CQ码消息段。

## 功能特性

### 1. CQ码解析
- 自动解析消息中的CQ码
- 提取图片、@、表情等消息段
- 获取纯文本内容

### 2. CQ码构建
- 发送图片消息
- @指定用户
- 发送表情
- 回复消息
- 混合消息

### 3. 事件监听
- 监听包含图片的消息
- 监听@机器人的消息
- 自动解析和统计消息段

## 可用指令

| 指令 | 说明 | 示例 |
|------|------|------|
| `/发图` | 发送一张图片 | `/发图` |
| `/at测试` | @你 | `/at测试` |
| `/表情` | 发送表情 | `/表情` |
| `/回复我` | 回复你的消息 | `/回复我` |
| `/混合` | 发送混合消息 | `/混合` |

## API使用示例

### 解析消息

```javascript
// 解析消息字符串
const segments = this.parseMessage(event.raw_message);

// 从事件中解析消息
const segments = this.parseEventMessage(event);
```

### 提取内容

```javascript
// 提取纯文本
const text = this.extractText(event.raw_message);

// 提取图片
const images = this.extractImages(event.raw_message);

// 提取@
const ats = this.extractAts(event.raw_message);
```

### 检查消息类型

```javascript
// 检查是否包含图片
if (this.hasImage(event.raw_message)) {
  // 处理图片消息
}

// 检查是否@了某人
if (this.isAtMe(event.raw_message, botQQ)) {
  // 被@了
}
```

### 构建CQ码消息

```javascript
// 使用CQBuilder
const message = `${this.CQ.at(user_id)} ${this.CQ.image(url)}`;

// 或直接使用
this.CQ.face(178);  // 表情
this.CQ.reply(message_id);  // 回复
this.CQ.text('文本');  // 文本
```

## 消息段类型

常见的CQ码类型：

- `text` - 纯文本
- `image` - 图片
- `at` - @某人
- `face` - 表情
- `reply` - 回复
- `record` - 语音
- `video` - 视频
- `poke` - 戳一戳
- `share` - 分享链接
- `music` - 音乐分享
- `location` - 位置分享
- `xml` - XML消息
- `json` - JSON消息

## 图片消息段示例

```javascript
{
  type: 'image',
  data: {
    file: 'C30C1DB7BB76BA6964E7590FFC60F996.png',
    url: 'https://multimedia.nt.qq.com.cn/download?...',
    subType: '0',
    file_size: '64165'
  }
}
```

## 使用建议

1. **解析优先**: 先解析消息段，再进行处理
2. **类型检查**: 使用`hasImage()`等方法检查消息类型
3. **提取文本**: 使用`extractText()`获取纯文本，去除CQ码干扰
4. **构建消息**: 使用`CQBuilder`构建标准CQ码消息
5. **错误处理**: 处理CQ码时注意异常情况

## 技术说明

- 基于OneBot 11标准
- 兼容LLOneBot、NapCat等框架
- 自动处理特殊字符编码
- 支持所有OneBot 11定义的消息段类型

## 相关文档

- [OneBot 11标准](https://github.com/botuniverse/onebot-11)
- [KiBot插件开发指南](../../../文档/server/文档-server-插件开发指南.md)
- [Enhanced SDK文档](../../core/plugin-system/plugin-sdk-enhanced.js)

