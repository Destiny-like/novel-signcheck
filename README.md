# novel-signcheck · 网文签约前自查

投稿前，用平台的真实审核口径给稿子做一次"模拟考"。

市面上的 AI 写作工具都在解决"怎么写"，这个项目解决"**怎么过审签约**"：分平台 AI 味检测、内容合规红线扫描、分平台签约资格检查。支持番茄小说、七猫小说、起点中文网，三平台 AI 口径不同，分别检测。

## 两种形态

| | `skill/` | `web/` |
|---|---|---|
| 是什么 | Agent Skill（Anthropic Agent Skills 规范） | 网页版，开箱即用 |
| 怎么用 | 放进 `~/.agents/skills/`，对 AI 说"用签约前自查检查这篇稿子" | 双击 `web/dist/签约前自查-单文件版.html` |
| 检测 | `scripts/ai_feel_check.py`（本地，零依赖） | `detector.js`（Python 版完整移植，逻辑一致） |
| 深度复核 | 五维语义复核 prompt（`references/byok-judge-prompt.md`） | BYOK：自备 Key，浏览器直调 LLM，Key 只存本机 |

## 检测机制（v0.4，两层）

**机械层**：11 类可计算信号（A1/C2/D5/F 等）+ 分平台阈值 + 起点水文专项；**精修腔规则** C2 排比密度 ≥1.2/千字 → 弱信号推人工复核（AI 样本 [1.35, 5.35] vs 真人 [0.08, 1.08]）。

**语义层**（BYOK）：五维——叙事因果链 / 人物动机一致性 / 细节的重量 / 语言肌肉记忆 / 信息密度与废笔，专打"精修 AI"。

**诚实边界**：平台启发式风险评估，不是官方检测器；机械层防"糙 AI"不防"精 AI"，后者靠语义层 + 人工。不做检出承诺。

## 校准成绩（2026-10-17）

- 13 样本标注集：三平台准确率 100%
- 5 本真人书长文本：从无 fail
- 5 篇 AI 网文盲测：5/5 命中 review

详见 `skill/tests/calibration-report-2026-10-17.md`。

## 快速开始

```bash
# 机械检测（Python，零依赖）
python3 skill/scripts/ai_feel_check.py 你的正文.txt --platform fanqie|qimao|qidian

# 网页版：双击打开
web/dist/签约前自查-单文件版.html

# 改完网页源码后重新打包
cd web && python3 build.py
```

## 路线图

- v0.4：三平台自查 + 精修腔规则 + BYOK 五维复核（当前）
- v0.5：独立签约教程板块 + 知乎盐选策略卡
- v1.0：去味改写执行 skill → 完整 Agent 平台（扫榜/拆书/规则库自动更新）

## License

MIT
