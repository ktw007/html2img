# html2img 截图工具

`html2img` 是一个基于 Puppeteer 的小工具，可以批量渲染本地或远程 HTML 页面并生成整页 PNG 截图。项目内置配置文件、iframe 智能识别与 DOM 隐藏/删除能力，适合把导出的静态站点快速转换为文档或素材。

## 功能特点

- **一条命令批量截图**：支持传入目录，自动遍历其中所有 `.html/.htm` 文件，并输出到指定目录。
- **iframe 智能判定**：`followIframe=auto` 时会自动决定是否进入内嵌 iframe 进行截图，兼顾 Canva 等嵌套页面与普通静态页。
- **DOM 清理**：可在截图前隐藏或删除一批选择器，干掉翻译插件、广告等“牛皮癞”区域。
- **多格式配置**：支持 `.toml/.json/.env` 配置文件，默认使用可读性更好的 `screenshot.config.toml`。

## 环境要求

- Node.js ≥ 18（建议 20+）
- npm（用于安装依赖）
- 可选：Chrome/Chromium 若需自定义路径，可通过 Puppeteer 配置实现

## 快速开始

```bash
# 安装依赖
npm install

# 根据需要编辑 screenshot.config.toml
# 默认会扫描当前目录的 HTML 并输出到 ./screenshots

# 截图
npm run screenshot
```

## 重要配置项

`screenshot.config.toml` 中包含所有常用开关：

| 配置项 | 说明 |
| --- | --- |
| `input` / `output` | 输入目录或单个 HTML / URL 与输出目录（会自动创建） |
| `followIframe` | 支持 `true/false/auto`，默认 `auto` 自动判断是否跟随 iframe |
| `hideSelectors` | 截图前注入 CSS 隐藏的选择器列表 |
| `removeSelectors` | 截图前直接从 DOM 删除的选择器列表 |
| `wait` / `timeout` / `width` / `height` | 浏览器等待时间、导航超时与视口参数 |
| `noSandbox` | 在受限环境运行 Chromium 时可设为 `true` |

## 常用命令

```bash
# 覆盖配置文件路径
node capture-screenshot.js --config custom.toml

# 临时指定输入输出目录
node capture-screenshot.js --input exported-pages --output dist-shots

# 强制不跟随 iframe
node capture-screenshot.js --follow-iframe=false
```

## 目录结构

```
html2img/
├── capture-screenshot.js   # CLI 主入口
├── package.json            # npm 配置
├── screenshot.config.toml  # 默认配置
├── screenshots/            # 输出示例
├── *.html / *_files        # 示例页面
└── README.md / README.en.md
```

## 许可证

当前仓库仅作为内部工具示例，未附带开源许可证。如需对外分发，请先补充适当的 License。
