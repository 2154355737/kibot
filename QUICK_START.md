# 🚀 快速启动指南

欢迎使用 KiBot 官方网站！按照以下步骤快速启动项目。

## 📋 前置要求

- Node.js >= 18.0.0
- npm 或 yarn 或 pnpm

检查版本：
```bash
node --version
npm --version
```

## 🎯 三步启动

### 1️⃣ 安装依赖

```bash
cd gw
npm install
```

如果使用 yarn：
```bash
yarn install
```

如果使用 pnpm：
```bash
pnpm install
```

### 2️⃣ 启动开发服务器

```bash
npm run dev
```

### 3️⃣ 打开浏览器

访问 http://localhost:5173

就这么简单！🎉

## 📦 构建生产版本

```bash
npm run build
```

构建产物在 `dist/` 目录。

## 👀 预览生产版本

```bash
npm run preview
```

## 🎨 开发技巧

### 热重载
修改代码后，浏览器会自动刷新，无需手动操作。

### 组件位置
- UI组件：`src/components/ui/`
- 页面组件：`src/pages/`
- 布局组件：`src/components/`

### 添加新页面
1. 在 `src/pages/` 创建 `your-page.tsx`
2. 在 `src/App.tsx` 添加路由
3. 在 `src/components/navbar.tsx` 添加导航链接

### 修改样式
- 全局样式：`src/index.css`
- 组件样式：使用 Tailwind CSS 类名
- 主题色：修改 `src/index.css` 中的 CSS 变量

## 🐛 常见问题

### 端口被占用
如果 5173 端口被占用，Vite 会自动使用下一个可用端口。

### 依赖安装失败
尝试：
```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### 样式不生效
确保 Tailwind CSS 已正确配置，检查 `tailwind.config.js`。

## 📚 下一步

- 查看 [README.md](./README.md) 了解项目详情
- 查看 [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) 了解项目结构
- 查看 [INSTALLATION.md](./INSTALLATION.md) 了解部署方法

## 💡 提示

- 使用 `Ctrl+C` 停止开发服务器
- 修改代码后会自动热重载
- 所有页面都是响应式的，可以在不同设备上测试

---

Happy Coding! 🎉

