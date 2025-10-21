# KiBot 官方网站

这是 KiBot QQ机器人管理系统的官方网站项目。

**官网地址**: https://kibot.knotting.asia  
**GitHub**: https://github.com/2154355737/kibot  
**作者**: ki (QQ: 2154355737)

## 技术栈

- **框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **样式**: Tailwind CSS 3 + shadcn/ui
- **路由**: React Router 6
- **图标**: Lucide React

## 开发

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173

### 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist` 目录。

### 预览生产构建

```bash
npm run preview
```

## 项目结构

```
gw/
├── src/
│   ├── components/         # 组件
│   │   ├── ui/            # UI基础组件
│   │   ├── navbar.tsx     # 导航栏
│   │   └── footer.tsx     # 页脚
│   ├── pages/             # 页面
│   │   ├── home.tsx       # 首页
│   │   ├── features.tsx   # 特性页
│   │   ├── docs.tsx       # 文档页
│   │   ├── download.tsx   # 下载页
│   │   └── about.tsx      # 关于页
│   ├── lib/               # 工具函数
│   ├── App.tsx            # 主应用
│   ├── main.tsx           # 入口文件
│   └── index.css          # 全局样式
├── public/                # 静态资源
├── index.html             # HTML模板
├── vite.config.ts         # Vite配置
├── tailwind.config.js     # Tailwind配置
└── tsconfig.json          # TypeScript配置
```

## 设计系统

网站采用与 KiBot 管理系统一致的设计风格：

- **主色调**: 蓝色 (HSL: 221.2 83.2% 53.3%)
- **字体**: 系统默认字体栈
- **圆角**: 0.5rem (可通过CSS变量调整)
- **响应式**: 移动端优先设计
- **主题**: 支持浅色/深色模式

## 页面说明

- **首页 (/)**: 产品介绍、核心特性展示、快速开始
- **特性 (/features)**: 详细的功能特性介绍
- **文档 (/docs)**: 文档导航和代码示例
- **下载 (/download)**: 版本下载和安装指南
- **关于 (/about)**: 项目故事、团队介绍、发展历程

## 许可证

MIT License - 详见 [LICENSE](../LICENSE)

