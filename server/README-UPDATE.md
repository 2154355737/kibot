# KiBot 后端更新系统

## 📦 功能概述

KiBot 后端更新系统提供了一套完整的更新解决方案，支持：

- ✅ **命令行更新**: 使用 `npm run update` 一键更新
- ✅ **Web界面更新**: 在管理界面拖拽ZIP包上传更新
- ✅ **自动备份**: 更新前自动备份当前版本
- ✅ **数据保护**: 自动保护用户配置和数据
- ✅ **失败回滚**: 更新失败自动回滚到之前版本
- ✅ **实时进度**: Web界面实时显示更新进度

## 🚀 快速开始

### 方法一：命令行更新（推荐）

1. **将更新包放入指定目录**
   ```bash
   # 将 QQBot-vX.X.X.zip 放入 server/.updates/packages/ 目录
   # 或者直接指定ZIP文件路径
   ```

2. **运行更新命令**
   ```bash
   cd server
   npm run update
   # 或者指定文件: npm run update -- /path/to/QQBot-vX.X.X.zip
   ```

3. **等待更新完成**
   - 更新器会自动执行所有步骤
   - 完成后重启服务: `npm start`

### 方法二：Web界面更新

1. **访问更新页面**
   ```
   http://your-domain/system/update
   ```

2. **上传更新包**
   - 拖拽ZIP文件到上传区域
   - 或点击选择文件

3. **执行更新**
   - 查看版本信息确认
   - 点击"开始更新"按钮
   - 实时查看更新进度

4. **更新完成**
   - 后端会自动重启
   - 刷新页面使用新版本

## 📂 目录结构

```
server/
├── update-backend.js          # 更新器主程序
├── core/
│   └── updater-service.js     # 更新器API服务
├── .updates/                  # 更新器工作目录
│   ├── packages/             # 更新包存放
│   │   └── *.zip
│   ├── backups/              # 版本备份
│   │   └── server-backup-*/
│   ├── logs/                 # 更新日志
│   │   └── update-*.log
│   └── uploads/              # Web上传临时目录
└── package.json              # 包含 "update" 脚本
```

## 🔒 数据保护策略

### 会被更新的文件
- ✅ 后端核心代码 (`*.js`)
- ✅ 核心模块 (`core/`, `utils/`)
- ✅ 配置模板 (`config/*.template`)
- ✅ 数据模板 (`data/*.template`)
- ✅ package.json

### 受保护的文件（不会被覆盖）
- 🔒 **用户配置**: `config/security.json`, `config/llonebot.json`
- 🔒 **用户数据**: `data/*.json` (除模板外)
- 🔒 **日志文件**: `data/logs/`
- 🔒 **监控数据**: `data/monitoring/`
- 🔒 **插件配置**: `data/plugins/plugin-configs.json`
- 🔒 **插件数据**: `data/plugins/*/storage.json`
- 🔒 **用户插件**: `plugins/*`
- 🔒 **依赖包**: `node_modules/` (会重新安装)
- 🔒 **更新系统**: `.updates/`

## 📋 更新流程详解

```
1. 📦 读取更新包
   ├─ 查找最新ZIP文件
   └─ 或使用指定的ZIP路径

2. 📂 解压验证
   ├─ 解压到临时目录
   ├─ 验证目录结构
   └─ 读取版本信息

3. 💾 创建备份
   ├─ 备份当前完整版本
   ├─ 命名: server-backup-{版本}-{时间}
   └─ 自动清理旧备份（保留最近5个）

4. 🔒 保护用户数据
   ├─ 识别受保护的文件
   └─ 临时移动到安全位置

5. 🔄 更新文件
   ├─ 删除旧文件（除受保护的）
   ├─ 复制新版本文件
   └─ 恢复受保护的文件

6. 📦 安装依赖
   ├─ 运行 npm install
   └─ 安装新版本所需依赖

7. ✅ 验证更新
   ├─ 检查关键文件存在
   ├─ 验证版本号
   └─ 确认更新成功

8. 🧹 清理临时文件
   └─ 删除解压的临时目录

9. ✨ 完成
   ├─ 保存更新日志
   └─ 提示重启服务
```

## 🔄 回滚操作

### 自动回滚
更新失败时会自动回滚到之前的版本。

### 手动回滚

#### 方法一：使用备份列表（Web界面）
1. 访问更新页面
2. 在"备份管理"区域查看备份列表
3. 点击要恢复的备份旁的"恢复"按钮
4. 重启后端服务

#### 方法二：命令行手动恢复
```bash
cd server/.updates/backups

# 查看备份列表
ls -l

# 手动恢复（替换为实际备份目录名）
cd ../..
rm -rf !(node_modules|.updates)
cp -r .updates/backups/server-backup-3.0.0-2025-10-21/* .

# 重启服务
npm start
```

## 📊 日志查看

### 更新日志
```bash
cd server/.updates/logs

# 查看最新日志
cat update-*.log | tail -100

# 实时查看（更新过程中）
tail -f update-*.log
```

### 日志内容
- `[INFO]` - 一般信息
- `[SUCCESS]` - 成功步骤
- `[WARNING]` - 警告信息
- `[ERROR]` - 错误信息

## ⚙️ API接口

### 获取更新状态
```http
GET /api/updater_status
```

### 上传更新包
```http
POST /api/updater_upload
Content-Type: multipart/form-data
```

### 执行更新
```http
POST /api/updater_perform
Content-Type: application/json

{
  "filepath": "/path/to/update.zip"
}
```

### 获取备份列表
```http
GET /api/updater_backups
```

### 恢复备份
```http
POST /api/updater_restore
Content-Type: application/json

{
  "backupName": "server-backup-3.0.0-2025-10-21"
}
```

## ⚠️ 注意事项

### 更新前准备
1. ⚠️ **备份重要数据**: 虽然系统会自动备份，但建议额外备份重要配置
2. ⚠️ **检查磁盘空间**: 确保有足够空间（至少2倍server目录大小）
3. ⚠️ **选择合适时机**: 建议在非高峰期进行更新
4. ⚠️ **通知用户**: 更新期间服务会短暂中断

### 更新包要求
1. ✅ 必须是官方发布的ZIP格式更新包
2. ✅ ZIP包内必须包含 `QQBot-vX.X.X/server/` 目录结构
3. ✅ `server/package.json` 必须存在且包含版本号

### 权限要求
1. ✅ 需要对 `server/` 目录有读写权限
2. ✅ Web更新需要管理员权限
3. ✅ 需要网络连接以下载npm依赖

### 依赖安装
- 更新器会自动运行 `npm install`
- 需要网络连接下载依赖
- 国内用户建议配置npm镜像源：
  ```bash
  npm config set registry https://registry.npmmirror.com
  ```

## 🐛 故障排查

### 问题：更新包解压失败
```
错误: 更新包格式错误：未找到 server 目录
```
**解决方案**: 
- 确保ZIP包是官方发布包
- 检查ZIP包内是否包含 `QQBot-vX.X.X/server/` 结构
- 重新下载更新包

### 问题：依赖安装失败
```
错误: 依赖安装失败: npm install 超时
```
**解决方案**:
1. 配置npm镜像源
   ```bash
   npm config set registry https://registry.npmmirror.com
   ```
2. 检查网络连接
3. 手动运行 `npm install`

### 问题：权限不足
```
错误: EACCES: permission denied
```
**解决方案**:
- Linux/Mac: 使用 `sudo` 运行或修改目录权限
- Windows: 以管理员身份运行命令提示符

### 问题：备份占用空间过大
**解决方案**:
1. 手动删除旧备份
   ```bash
   cd server/.updates/backups
   rm -rf server-backup-old-*
   ```
2. 修改 `update-backend.js` 中的 `MAX_BACKUPS` 值

### 问题：更新后无法启动
**解决方案**:
1. 查看更新日志
   ```bash
   cat server/.updates/logs/update-*.log
   ```
2. 从备份恢复
3. 检查配置文件是否正确
4. 查看启动日志排查错误

## 📝 更新历史

通过备份目录可以查看历史版本：

```bash
cd server/.updates/backups
ls -lt  # 按时间排序显示备份

# 备份命名格式
server-backup-{版本号}-{时间戳}
例如: server-backup-3.0.0-2025-10-21T08-30-00-000Z
```

## 🔐 安全性

- ✅ 更新前完整备份，可随时回滚
- ✅ 保护所有用户数据和配置
- ✅ 验证更新包完整性
- ✅ Web更新需要管理员认证
- ✅ 详细的操作日志记录
- ✅ 自动清理临时文件

## 🆘 获取帮助

- 📖 查看更新日志: `server/.updates/logs/`
- 📖 查看备份: `server/.updates/backups/`
- 🐛 提交 Issue: GitHub Issues
- 💬 查看项目文档

---

**祝更新顺利！** 🎉



