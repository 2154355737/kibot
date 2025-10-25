# QQ Bot 部署指南

## 📦 部署包内容

```
QQBot-v1.3.0/
├── server/          # 后端源码
├── web/            # 前端构建产物
├── tools/          # 工具脚本
├── nginx.conf      # Nginx 配置
├── README.md       # 项目说明
├── QUICK_START.md  # 快速开始
└── DEPLOY.md       # 本文件
```

## 🚀 部署方式

### 方式一：快速部署（开发/测试环境）

适合本地开发或测试环境快速启动。

#### 1. 部署后端

```bash
# 1. 上传 server 目录到服务器
scp -r server/ user@your-server:/path/to/qqbot/

# 2. SSH 到服务器
ssh user@your-server

# 3. 安装依赖
cd /path/to/qqbot/server
npm install --production

# 4. 初始化配置
npm start  # 首次启动会自动初始化

# 5. 使用 PM2 管理进程（推荐）
npm install -g pm2
pm2 start index.js --name qqbot-server
pm2 save
pm2 startup
```

#### 2. 部署前端

```bash
# 方式 A：使用简单 HTTP 服务器
cd /path/to/qqbot/web
npx serve -s . -p 3000

# 方式 B：使用 Nginx（见方式二）
```

---

### 方式二：生产环境部署（推荐）

适合生产环境，使用 Nginx 反向代理。

#### 1. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# CentOS/RHEL
sudo yum install nginx
```

#### 2. 部署文件

```bash
# 创建部署目录
sudo mkdir -p /var/www/qqbot

# 上传并解压文件
cd /var/www/qqbot
# 上传 web/ 和 server/ 目录

# 设置权限
sudo chown -R www-data:www-data /var/www/qqbot
```

#### 3. 配置 Nginx

```bash
# 复制配置文件
sudo cp nginx.conf /etc/nginx/sites-available/qqbot

# 修改配置（重要！）
sudo nano /etc/nginx/sites-available/qqbot
# 修改 server_name 为你的域名
# 修改 root 路径为实际路径

# 启用站点
sudo ln -s /etc/nginx/sites-available/qqbot /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

#### 4. 启动后端

```bash
cd /var/www/qqbot/server

# 安装依赖
npm install --production

# 初始化配置
npm start  # 按提示配置

# 使用 PM2 管理
npm install -g pm2
pm2 start index.js --name qqbot-server
pm2 save
pm2 startup
```

#### 5. 配置防火墙

```bash
# 开放 HTTP 和 HTTPS 端口
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

### 方式三：Docker 部署（未来支持）

Docker 部署配置将在后续版本提供。

---

## 🔧 配置说明

### 后端配置

配置文件位于 `server/config/`：

1. **security.json** - 认证密码
   ```bash
   cd server
   npm run init  # 初始化配置
   ```

2. **llonebot.json** - LLOneBot 连接
   ```json
   {
     "apiUrl": "http://localhost:3000",
     "wsUrl": "ws://localhost:3000",
     "accessToken": "your_token",
     "enabled": true
   }
   ```

### 前端配置

前端已经构建完成，无需额外配置。

如果需要修改后端地址，需要：
1. 获取前端源码
2. 修改 `.env.production`
3. 重新构建：`npm run build`

---

## 🔐 SSL/HTTPS 配置（推荐）

### 使用 Let's Encrypt 免费证书

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期测试
sudo certbot renew --dry-run
```

Certbot 会自动修改 Nginx 配置。

---

## 📊 监控和维护

### 查看后端状态

```bash
# PM2 状态
pm2 status
pm2 logs qqbot-server

# 查看日志
tail -f server/data/logs/kibot-*.log
```

### 重启服务

```bash
# 重启后端
pm2 restart qqbot-server

# 重载 Nginx
sudo systemctl reload nginx
```

### 备份数据

```bash
# 备份配置和数据
tar -czf qqbot-backup-$(date +%Y%m%d).tar.gz \
  server/config/ \
  server/data/
```

---

## ⚠️ 注意事项

### 安全建议

1. ✅ **修改默认端口**
   - 后端默认 8080，可在代码中修改
   
2. ✅ **使用强密码**
   - 初始化时设置强密码
   
3. ✅ **启用 HTTPS**
   - 生产环境必须使用 HTTPS
   
4. ✅ **配置防火墙**
   - 只开放必要端口（80, 443）
   - 后端端口不要对外开放
   
5. ✅ **定期更新**
   - 更新 Node.js
   - 更新依赖包：`npm update`

### 性能优化

1. **启用 Nginx 缓存**
   - 已在配置中启用静态资源缓存
   
2. **使用 CDN**
   - 可将静态资源托管到 CDN
   
3. **数据库优化**（如果使用）
   - 目前使用文件存储，无需特殊优化

---

## ❓ 常见问题

### Q1: 无法访问前端？

检查 Nginx 配置和权限：
```bash
sudo nginx -t
sudo systemctl status nginx
ls -la /var/www/qqbot/web
```

### Q2: 后端连接失败？

检查后端是否运行：
```bash
pm2 status
pm2 logs qqbot-server
```

### Q3: WebSocket 连接失败？

检查 Nginx WebSocket 配置：
```bash
sudo nginx -t
# 确保有 Upgrade 和 Connection 头
```

### Q4: 如何更新版本？

```bash
# 1. 备份数据
tar -czf backup.tar.gz server/config server/data

# 2. 停止服务
pm2 stop qqbot-server

# 3. 更新文件
# 上传新版本文件

# 4. 安装依赖
cd server && npm install --production

# 5. 启动服务
pm2 start qqbot-server
```

---

## 📞 获取帮助

- 📖 查看 README.md
- 🚀 查看 QUICK_START.md
- 🐛 提交 Issue

---

**部署完成后，访问你的域名开始使用！** 🎉
