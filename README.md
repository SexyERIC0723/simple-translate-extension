# 简译 - 英译中翻译插件

一款简洁高效的 Chrome 浏览器翻译扩展，专注于英文到中文的翻译体验。

## ✨ 功能特点

- 🌐 **整页翻译** - 一键翻译整个英文网页
- ✂️ **选中翻译** - 选中文本后右键快速翻译
- 🔄 **快捷切换** - `Alt+T` 快速切换原文/译文
- 📄 **PDF 翻译** - 内置 PDF 阅读器，支持学术论文翻译
- 🤖 **多引擎支持** - Google 翻译 + Ollama 本地模型
- ⚡ **智能缓存** - LRU 缓存策略，避免重复翻译

## 📦 安装方法

### 开发者模式安装

1. 下载或克隆本仓库
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择本项目文件夹

## 🚀 使用方法

### 翻译网页
1. 点击工具栏的「简译」图标
2. 点击「翻译此页面」按钮
3. 或使用快捷键 `Alt+T`

### 选中翻译
1. 在网页上选中要翻译的文本
2. 右键选择「翻译选中文本」

### PDF 翻译
1. 右键点击 PDF 链接
2. 选择「用简译打开 PDF」
3. 在 PDF 阅读器中点击「翻译当前页」

## ⚙️ 设置选项

访问扩展设置页面可配置：

- **自动翻译** - 自动翻译英文页面
- **翻译引擎** - 选择 Google 翻译或 Ollama 本地模型
- **域名黑名单** - 设置不自动翻译的网站

### 使用 Ollama 本地模型

1. 安装 [Ollama](https://ollama.ai)
2. 运行 `ollama pull qwen2.5:7b`
3. 在设置中选择「Ollama 本地模型」

## 📂 项目结构

```
简译/
├── manifest.json        # 扩展配置
├── background/          # 后台服务
├── content/             # 内容脚本
├── popup/               # 弹出窗口
├── options/             # 设置页面
├── pdf/                 # PDF 阅读器
├── lib/                 # 第三方库 (PDF.js)
└── icons/               # 扩展图标
```

## 🔧 技术栈

- Chrome Extension Manifest V3
- PDF.js
- Google Translate API (免费接口)
- Ollama (可选本地 AI)

## 📄 许可证

MIT License

## 🙏 致谢

- [PDF.js](https://mozilla.github.io/pdf.js/) - Mozilla PDF 渲染库
- [Ollama](https://ollama.ai) - 本地大语言模型运行框架
