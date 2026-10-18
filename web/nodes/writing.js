/* 写作侧核心：项目数据模型 + SoloEnt.md 宪法 + prompt 组装 + BYOK 调用
* Phase 2b-1：设定驱动（W1）+ 长篇记忆（W2）+ 写审一体（W6）
*/

// ---------- 项目模型 ----------
export function createProject(title = "未命名作品") {
return {
version: 1,
title,
genre: "",
platform: "fanqie",
worldview: { era: "", power_system: "", factions: "", rules: ""},
characters: [],
outline: [],
memory: {
timeline: [],
foreshadows: [],
chapter_summaries: [],
last_chapter: 0,
},
chapters: {},
};
}

// ---------- SoloEnt.md 项目宪法 ----------
export function buildConstitution(p) {
const L = [];
L.push(`# ${p.title} · 项目宪法（SoloEnt.md）`);
L.push(`> AI 写作时必须遵守本文设定。前后矛盾时以本文为准。`);
L.push(``);
L.push(`## 世界观`);
L.push(`- 时代背景：${p.worldview.era || "（未填）"}`);
L.push(`- 力量体系：${p.worldview.power_system || "（未填）"}`);
L.push(`- 主要势力：${p.worldview.factions || "（未填）"}`);
L.push(`- 世界规则：${p.worldview.rules || "（未填）"}`);
L.push(``);
L.push(`## 人物（${p.characters.length}）`);
for (const c of p.characters) {
L.push(`### ${c.name}（${c.role || "？"}）`);
L.push(`- 性格：${c.traits || "？"}｜目标：${c.goal || "？"}`);
L.push(`- 当前状态：${c.status || "？"}｜成长线：${c.arc || "？"}`);
}
L.push(``);
L.push(`## 时间线（已写 ${p.memory.last_chapter} 章）`);
for (const t of p.memory.timeline) L.push(`- ${t}`);
if (!p.memory.timeline.length) L.push(`- （暂无）`);
L.push(``);
L.push(`## 伏笔追踪`);
for (const f of p.memory.foreshadows) {
L.push(`- [${f.id}] ${f.desc}｜埋于第${f.planted_ch}章｜${f.status === "已收"? `收于第${f.payoff_ch}章`: "**未收**"}`);
}
if (!p.memory.foreshadows.length) L.push(`- （暂无）`);
L.push(``);
L.push(`## 章节摘要`);
for (const s of p.memory.chapter_summaries) L.push(`- 第${s.n}章：${s.summary}`);
if (!p.memory.chapter_summaries.length) L.push(`- （暂无）`);
return L.join("\n");
}

// ---------- 写作 prompt ----------
export function buildChapterPrompt(p, chN) {
const ch = findChapter(p, chN);
const constitution = buildConstitution(p);
return `你是网文写手，正在写《${p.title}》（${p.genre || "长篇小说"}）第 ${chN} 章。


${constitution}


- 章节标题：${ch? ch.title: "（未定）"}
- 情节点：${ch? ch.beats: "（未定，请根据宪法和上一章自然推进）"}
- 视角人物：${ch && ch.pov? ch.pov: "主角"}
${ch && ch.plant && ch.plant.length? `- 本章要埋的伏笔：${ch.plant.join("、")}`: ""}
${ch && ch.payoff && ch.payoff.length? `- 本章要收的伏笔：${ch.payoff.join("、")}`: ""}


1. 1500–2500 字，直接输出正文，不要大纲不要解释
2. 人物言行必须符合宪法中的性格与当前状态，不得ooc
3. 不得引入宪法之外的新设定、新人物、新能力
4. 章末留一个钩子（悬念/冲突/反转三选一）
5. 语言要求：少用排比三连，少用"仿佛/就像"式比喻，避免AI腔`;
}

export function buildSummaryPrompt(p, chN, content) {
return `你是网文编辑。请把下面《${p.title}》第 ${chN} 章正文压缩成 80 字以内的一句话摘要，并列出本章新埋的伏笔（没有就写"无"）。

正文：
${content.slice(0, 6000)}

请严格按以下 JSON 输出（不要其他内容）：
{"summary": "一句话摘要", "new_foreshadows": ["伏笔1", "伏笔2"]}`;
}

// ---------- 工具 ----------
export function findChapter(p, n) {
for (const vol of p.outline)
for (const ch of vol.chapters || [])
if (ch.n === n) return ch;
return null;
}

export function nextChapterN(p) {
return p.memory.last_chapter + 1;
}

// ---------- BYOK 调用（凭证由主模块从 signcheck_byok 传入） ----------
export async function callLLM(prompt, creds = {}, opts = {}) {
const endpoint = (creds.endpoint || "https://api.deepseek.com/v1").replace(/\/$/, "");
const model = creds.model || "deepseek-chat";
const key = creds.key || "";
if (!key) throw new Error("未设置 API Key，请先在「过审→深度复核」里保存 Key（只存本机）");
const resp = await fetch(`${endpoint}/chat/completions`, {
method: "POST",
headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`},
body: JSON.stringify({
model,
messages: [{ role: "user", content: prompt}],
temperature: opts.temperature?? 0.8,
}),
});
if (!resp.ok) throw new Error(`模型接口 ${resp.status}`);
const data = await resp.json();
return data.choices[0].message.content;
}

// ---------- 本地存储（写作项目独立命名空间，localStorage 不可用时降级内存） ----------
const LS_KEY = "sc_projects_v1";
const memFallback = {};
function lsGet(k) {
try { return localStorage.getItem(k);}
catch { return k in memFallback? memFallback[k]: null;}
}
function lsSet(k, v) {
try { localStorage.setItem(k, v);}
catch { memFallback[k] = String(v);}
}
export function saveProject(p) {
const all = loadAllProjects();
all[p.title] = p;
lsSet(LS_KEY, JSON.stringify(all));
}
export function loadAllProjects() {
try { return JSON.parse(lsGet(LS_KEY) || "{}");}
catch { return {};}
}
export function deleteProject(title) {
const all = loadAllProjects();
delete all[title];
lsSet(LS_KEY, JSON.stringify(all));
}
