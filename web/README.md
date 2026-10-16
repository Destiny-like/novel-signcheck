# 签约前自查 · 网页版（Phase 1.5 MVP）

`signcheck-novel-zh` skill 的网页封装：打开即用，无需安装 skill。

## 形态

纯静态站（HTML + CSS + 原生 JS，无构建步骤），拖进 Vercel / Cloudflare Pages / Netlify 即可上线，**零服务器成本**。

## 功能

1. 目标平台选择（番茄 / 七猫 / 起点）+ 平台策略卡展示
2. 粘贴正文 → 本地 AI 味检测（`detector.js`，由 Python 版完整移植，逻辑一致）
3. 签约资格 checklist（手动勾选，硬性项未达标即判不通过）
4. BYOK：AI 深度复核（五维）——用户自备 Key，浏览器直调 OpenAI 兼容接口，Key 只存本机 localStorage

## 文件

```
signcheck-web/
├── index.html   # 页面结构
├── styles.css   # 样式
├── app.js       # UI 逻辑（ES module）
├── detector.js  # 检测核心（export analyze）
└── data.js      # 平台策略卡结构化数据（需与 skill 包 references/ 保持一致）
```

## 使用

**直接双击打开 `dist/签约前自查-单文件版.html` 即可**（单文件，CSS/JS 已内联，无需起 http server）。

## 开发

源码为多文件（`index.html` / `styles.css` / `app.js` / `detector.js` / `data.js`，ES module）。
ES module 在 `file://` 下会因 CORS 加载失败导致页面空白，因此发布单文件版：

```bash
cd signcheck-web && python3 build.py   # 生成 dist/签约前自查-单文件版.html
```

改完源码后记得重新跑 `build.py`。

## 数据同步约定

`data.js` 中的平台策略卡必须与 `../signcheck-skill/references/platform-*.md` 保持一致（policy_version / effective_date / 签约流程 / 红线）。更新任一处时同步另一处。
