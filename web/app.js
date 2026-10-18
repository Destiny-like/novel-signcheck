import { analyze } from "./detector.js";
import { PLATFORMS, VERDICT_TEXT } from "./data.js";
import { renderPipeline, setNodeState, getNodeState, pipelineSummary } from "./nodes/pipeline.js";
import { renderRewriteTips } from "./nodes/rewrite-suggest.js";
import { policyWarnHtml, policyStatus } from "./nodes/policy.js";

const $ = (id) => document.getElementById(id);
let selectedPlatform = "fanqie";

const SEV_LABEL = { high: "高危", medium: "注意", low: "轻微" };
const SEV_ORDER = { high: 0, medium: 1, low: 2 };

/* ---------- 安全存储（iOS 附件预览等 file:// 沙盒下 localStorage 可能抛异常） ---------- */
const safeStorage = (() => {
  const mem = {};
  try {
    localStorage.setItem("__signcheck_probe", "1");
    localStorage.removeItem("__signcheck_probe");
    return {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => localStorage.setItem(k, v),
    };
  } catch (e) {
    return {
      get: (k) => (k in mem ? mem[k] : null),
      set: (k, v) => { mem[k] = String(v); },
    };
  }
})();

/* ---------- 主题 ---------- */
function initTheme() {
  const saved = safeStorage.get("signcheck_theme");
  if (saved) document.documentElement.dataset.theme = saved;
  $("themeToggle").onclick = () => {
    const cur = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = cur;
    safeStorage.set("signcheck_theme", cur);
  };
}

/* ---------- 平台选择 ---------- */
function renderPlatformCards() {
  const wrap = $("platformCards");
  wrap.innerHTML = "";
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const sevCls = p.ai_strictness.includes("最严") ? "s-high" : "s-mid";
    const card = document.createElement("button");
    card.className = "pcard" + (id === selectedPlatform ? " active" : "");
    card.innerHTML = `
      <div class="pcard-name">${p.name}</div>
      <div class="pcard-tag">${p.tagline}</div>
      <div class="pcard-ai">AI 审核 <span class="sev ${sevCls}">${p.ai_strictness}</span></div>
      <div class="pcard-ver">策略卡 ${p.policy_version}</div>`;
    card.onclick = () => {
      selectedPlatform = id;
      renderPlatformCards();
      renderPolicyCard();
      renderChecklist();
      setNodeState("platform", "done");
      refreshSummary();
    };
    wrap.appendChild(card);
  }
}

/* ---------- 管线总览 ---------- */
function refreshSummary() {
  const el = $("pipelineSummary");
  if (!el) return;
  const s = pipelineSummary();
  el.innerHTML = `<span class="${s.ok ? "ok" : "ng"}">${s.ok ? "✓" : "✗"} ${s.msg}</span>`;
}

/* ---------- 平台策略卡 ---------- */
function renderPolicyCard() {
  const p = PLATFORMS[selectedPlatform];
  $("policyCard").innerHTML = `
    <div class="pol-head"><h3>${p.name}</h3><span class="ver">策略卡 ${p.policy_version} · ${p.effective_date} 生效</span></div>
    ${p.source_note ? `<div class="pol-src">${p.source_note}</div>` : ""}
    ${policyWarnHtml(p)}
    <div class="ai-policy"><b>AI 政策：</b>${p.ai_policy}</div>
    <p class="kv"><b>关键指标</b>${p.key_metrics.join("、")}</p>
    <div class="cols">
      <div><h4>签约流程</h4><ol>${p.signing.map(s => `<li>${s}</li>`).join("")}</ol></div>
      <div><h4>收益结构</h4><ul>${p.welfare.map(s => `<li>${s}</li>`).join("")}</ul></div>
    </div>
    <p class="kv"><b>红线</b></p>
    <div class="chips">${p.redlines.map(r => `<span class="chip danger">${r}</span>`).join("")}</div>
    <p class="kv" style="margin-top:12px"><b>投稿材料包</b></p>
    <div class="chips">${p.materials.map(m => `<span class="chip">${m}</span>`).join("")}</div>`;
}

/* ---------- 签约资格 checklist ---------- */
function renderChecklist() {
  const p = PLATFORMS[selectedPlatform];
  $("checklist").innerHTML =
    p.checklist.map((c, i) => `
      <label class="check-item" data-i="${i}">
        <input type="checkbox">
        <span class="badge ${c.blocking ? "blocking" : "advisory"}">${c.blocking ? "硬性" : "建议"}</span>
        <span>${c.text}</span>
      </label>`).join("") +
    `<button id="evalBtn" class="ghost">根据勾选出结论</button>
     <div id="checkVerdict" class="check-verdict"></div>`;
  document.querySelectorAll("#checklist .check-item input").forEach(box => {
    box.addEventListener("change", () => box.closest(".check-item").classList.toggle("done", box.checked));
  });
  $("evalBtn").onclick = () => {
    const boxes = [...document.querySelectorAll("#checklist input[type=checkbox]")];
    const missing = p.checklist.filter((c, i) => c.blocking && !boxes[i].checked);
    $("checkVerdict").innerHTML = !missing.length
      ? `<span class="ok">✓ 硬性项全部达标，可以进入投稿流程</span>`
      : `<span class="ng">✗ 还有 ${missing.length} 项硬性未达标：</span><ul>${missing.map(c => `<li>${c.text}</li>`).join("")}</ul>`;
    setNodeState("checklist", !missing.length ? "done" : "warn");
    refreshSummary();
  };
}

/* ---------- 检测报告 ---------- */
function metricClass(key, r) {
  if (key === "cp" && r.punct.narration_comma_period > 2.2) return "bad";
  if (key === "std" && r.sentence.std < 6 && r.sentence.n >= 6) return "warn";
  if (key === "clause" && r.clause.avg && r.clause.avg < 8 && r.clause.n >= 10) return "warn";
  if (key === "density") {
    const v = r.platform_verdict;
    if (v.verdict === "fail") return "bad";
    if (v.verdict === "review") return "warn";
  }
  if (key === "dup" && r.repetition.count >= 3) return "bad";
  if (key === "dup" && r.repetition.count > 0) return "warn";
  return "";
}

function renderResult(r) {
  const p = PLATFORMS[selectedPlatform];
  const v = r.platform_verdict;
  const vt = VERDICT_TEXT[v.verdict];
  const icon = v.verdict === "pass" ? "✓" : v.verdict === "review" ? "!" : "✗";
  const conf = r.confidence || { level: "high", note: "" };
  const confLabel = { high: "置信度高", medium: "置信度中等", low: "置信度低" }[conf.level];

  const sigs = [...r.signals].sort((a, b) =>
    (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || b.hits - a.hits);

  $("result").innerHTML = `
    <div class="verdict v-${v.verdict}">
      <div class="v-icon">${icon}</div>
      <div>
        <div class="v-label">${vt.label} · ${p.name}</div>
        <div class="v-hint">${vt.hint}</div>
        <div class="v-policy">审核口径：${v.policy}</div>
        ${conf.note ? `<div class="v-policy">⚠ ${confLabel}：${escapeHtml(conf.note)}</div>` : ""}
        <ul class="v-reasons">${v.reasons.map(x => `<li>${x}</li>`).join("")}</ul>
      </div>
    </div>

    <div class="sec-title">机械指标</div>
    <div class="metric-grid">
      <div class="metric"><div class="m-num">${r.chars}</div><div class="m-label">总字数</div></div>
      <div class="metric"><div class="m-num ${metricClass("cp", r)}">${r.punct.narration_comma_period}</div><div class="m-label">逗号÷句号<br>叙述层</div></div>
      <div class="metric"><div class="m-num ${metricClass("std", r)}">${r.sentence.std}</div><div class="m-label">句长标准差<br>越小越模板化</div></div>
      <div class="metric"><div class="m-num ${metricClass("clause", r)}">${r.clause.avg}</div><div class="m-label">分句平均长度<br>过短=碎句</div></div>
      <div class="metric"><div class="m-num ${metricClass("density", r)}">${r.signal_density_per_1k}</div><div class="m-label">AI 腔信号<br>/千字</div></div>
      <div class="metric"><div class="m-num ${metricClass("dup", r)}">${r.repetition.count}</div><div class="m-label">重复铺陈<br>处</div></div>
    </div>

    <div class="sec-title">AI 腔信号明细（${r.signals.length} 类）</div>
    ${sigs.length ? `<div class="sig-list">${sigs.map(s => `
      <div class="sig-row sev-${s.severity}">
        <span class="sev-pill sev-${s.severity}">${SEV_LABEL[s.severity]}</span>
        <div class="sig-body">
          <div class="sig-name">${s.signal}</div>
          <div class="sig-why">${s.why}</div>
          ${s.examples.length ? `<div class="sig-ex">${s.examples.slice(0, 4).map(e => `<code>${escapeHtml(e)}</code>`).join("")}</div>` : ""}
        </div>
        <div class="sig-stat"><b>${s.hits}</b>次 · ${s.density_per_1k}/千字</div>
      </div>`).join("")}</div>`
      : `<div class="empty-note">未命中 AI 腔信号</div>`}

    <div class="sec-title">风险项</div>
    ${r.risks.length ? `<ul class="risk-list">${r.risks.map(x => `<li>⚠ ${x}</li>`).join("")}</ul>`
      : `<div class="empty-note">无机械风险项</div>`}

    ${r.repetition.count ? `
      <div class="sec-title">重复铺陈示例（D5）</div>
      <ul class="dup-list">${r.repetition.examples.slice(0, 5).map(x => `<li><code>${escapeHtml(x)}</code></li>`).join("")}</ul>` : ""}

    <div class="focus-box"><b>${p.name}检测重点：</b>${v.focus.join("、")}</div>
    <p class="disclaimer">机械检测只做初筛；最终判定请结合 SKILL.md 五维人工复核（具体性 / 节奏 / 克制 / 信息密度 / 声音）。网文爽点套路、章末钩子是体裁约定，不是 AI 味。检测原理参考：词汇多样性、句长变异系数、困惑度、风格一致性等多维统计特征。</p>`;
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function runDetection() {
  const text = $("inputText").value;
  if (text.trim().length < 50) { alert("正文太短（<50 字），请粘贴至少前 3 章。"); return; }
  setNodeState("detect", "running");
  const r = analyze(text, selectedPlatform);
  if (r.error) { alert("文本为空"); setNodeState("detect", "pending"); return; }
  renderResult(r);
  // 节点状态：fail=需返工，review=预警，pass=通过
  const v = r.platform_verdict.verdict;
  setNodeState("detect", v === "fail" ? "blocked" : v === "review" ? "warn" : "done");
  // S4 改写建议节点
  $("rewriteBox").innerHTML = renderRewriteTips(r.signals, r.repetition.count);
  const hasTips = r.signals.length > 0 || r.repetition.count > 0;
  $("recheckBtn").disabled = false;
  setNodeState("rewrite", hasTips ? "warn" : "done");
  document.getElementById("step3b").scrollIntoView({ behavior: "smooth", block: "start" });
  refreshSummary();
}

$("detectBtn").onclick = runDetection;
$("recheckBtn").onclick = () => {
  // 回炉：用修改后的正文重跑检测
  runDetection();
};
$("inputText").addEventListener("input", (e) => {
  $("charCount").textContent = e.target.value.length + " 字";
});

/* ---------- BYOK：AI 深度复核 ---------- */
const LS_KEY = "signcheck_byok";
function loadBYOK() {
  try { return JSON.parse(safeStorage.get(LS_KEY) || "{}"); } catch { return {}; }
}
function initBYOK() {
  const saved = loadBYOK();
  if (saved.key) $("apiKey").value = saved.key;
  if (saved.endpoint) $("apiEndpoint").value = saved.endpoint;
  $("saveKeyBtn").onclick = () => {
    safeStorage.set(LS_KEY, JSON.stringify({
      key: $("apiKey").value.trim(),
      endpoint: $("apiEndpoint").value.trim() || "https://api.deepseek.com/v1",
    }));
    alert("Key 已保存在本机浏览器（localStorage），不会上传到任何服务器。");
  };
  $("deepBtn").onclick = deepReview;
}

const DEEP_PROMPT = (platformLabel, platformPolicy, text) => `你是网文平台的签约审核编辑，专职识别"精修 AI 文"——即经过精心提示词或人工润色、表面已无明显 AI 腔（无情绪直述、无程度副词堆砌、无高频词），但深层仍带机器写作指纹的投稿。

## 任务
对以下正文做五维"AI 嫌疑"评分。每维 0-10 分，分数越高越像 AI 写的。
只输出 JSON（不要 Markdown，不要寒暄），格式如下：
{"dimensions":[{"id":"D1","name":"叙事因果链","score":0,"evidence":["原文片段≤20字"],"reason":"一句话"},],"avg_score":0,"verdict":"pass","confidence":"高","counter":"一句话","summary":"两句话"}

## 五维定义（每维只看本维的事，不串维）
D1 叙事因果链：事件之间是真因果，还是"然后…然后…"的悬空推进？转折是否靠"忽然/就在这时/谁也没想到"硬拗？AI 的因果常是字面上通、细想经不起推敲的假因果。
D2 人物动机一致性：人物行为是否符合其已建立的性格与目标？是否出现"剧情需要式"变脸？配角是否各有各的语气，还是同一个腔调？
D3 细节的重量：细节是具体的、有质感的、删掉会影响理解的；还是"正确但无用"的好词堆砌——看似具体，删掉什么都不影响？AI 的细节常悬空：形容词很多，信息量很少。
D4 语言肌肉记忆：作者有没有个人的语言癖好——爱用的句式、节奏怪癖、表达指纹？AI 的文风是"平均脸"：正确、流畅，但没有任何个人癖好。
D5 信息密度与废笔：每千字是否推进了情节/人物/世界观？有没有"正确的废话"——读完不知道发生了什么，但字数涨了？

## 判分铁律
1. 网文体裁约定不是 AI 味：爽点套路、章末钩子、升级打怪、退婚流开局——都不扣分。
2. 文学性修辞不是 AI 味：排比、比喻是真人作者也会用的武器，只看"为修辞而修辞"的空转。
3. 每维打分必须配 evidence（原文片段，每条≤20字）+ reason；≥7 分必须 ≥2 条证据，没有证据不许打高分。
4. 必须写 counter（一句话反方检验）：它也可能是真人写的，因为……。写不出有说服力的 counter，confidence 降一档。
5. verdict 口径：avg≥7 且至少两维≥8 → fail；avg≥4 或任一维≥8 → review；其余 → pass。
6. 短文本（<3000字）confidence 封顶"中"。

## 目标平台
${platformLabel}：${platformPolicy}

## 正文（截取前 12000 字）
${text.slice(0, 12000)}`;

function parseDeepJSON(raw) {
  // 兼容模型套 markdown 代码围栏的情况
  const m = String(raw).match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = m ? m[1] : String(raw);
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型未返回 JSON");
  return JSON.parse(src.slice(start, end + 1));
}

function renderDeepReport(r) {
  const vColor = { pass: "var(--pass)", review: "var(--warn)", fail: "var(--fail)" }[r.verdict] || "var(--warn)";
  const vText = { pass: "通过：不像 AI 写的", review: "存疑：建议人工复核", fail: "高危：像 AI 写的" }[r.verdict] || r.verdict;
  const dims = (r.dimensions || []).map(d => {
    const cls = d.score >= 7 ? "bad" : d.score >= 4 ? "warn" : "";
    return `<div class="metric"><div class="m-num ${cls}">${d.score}<span style="font-size:12px">/10</span></div>
      <div class="m-label">${escapeHtml(d.id)} ${escapeHtml(d.name)}</div>
      <div class="m-desc">${escapeHtml(d.reason || "")}</div>
      ${(d.evidence || []).map(e => `<div class="ev-chip">“${escapeHtml(e)}”</div>`).join("")}
    </div>`;
  }).join("");
  return `<div class="sec-title">AI 深度复核（五维语义）</div>
    <div class="verdict-banner" style="border-left:4px solid ${vColor}">
      <strong style="color:${vColor}">${vText}</strong>
      <span style="color:var(--muted)">　均分 ${r.avg_score}/10 · 置信度 ${escapeHtml(r.confidence || "中")}</span>
      <div style="margin-top:6px">${escapeHtml(r.summary || "")}</div>
    </div>
    <div class="metric-grid deep-dims">${dims}</div>
    <div class="counter">反方检验：${escapeHtml(r.counter || "（模型未给出）")}</div>
    <p class="disclaimer">本次复核由你自备的 Key 发起，费用由你的模型账户承担；本站不存储正文与 Key。语义复核仍是启发式判断，结论仅供参考。</p>`;
}

async function deepReview() {
  const saved = loadBYOK();
  const key = $("apiKey").value.trim() || saved.key;
  const endpoint = ($("apiEndpoint").value.trim() || saved.endpoint || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const text = $("inputText").value.trim();
  if (!key) { alert("请先填写 API Key（Key 只存本机，不上传）。"); return; }
  if (text.length < 50) { alert("请先粘贴正文。"); return; }
  const btn = $("deepBtn");
  btn.disabled = true; btn.textContent = "复核中…";
  try {
    const resp = await fetch(endpoint + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({
        model: $("apiModel").value.trim() || "deepseek-chat",
        messages: [{ role: "user", content: DEEP_PROMPT(PLATFORMS[selectedPlatform].name, PLATFORMS[selectedPlatform].ai_policy, text) }],
        temperature: 0.3,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error?.message || ("HTTP " + resp.status));
    const raw = data.choices[0].message.content;
    try {
      const parsed = parseDeepJSON(raw);
      $("deepResult").innerHTML = renderDeepReport(parsed);
      setNodeState("deep", parsed.verdict === "fail" ? "blocked" : parsed.verdict === "review" ? "warn" : "done");
    } catch {
      $("deepResult").innerHTML = `<div class="sec-title">AI 深度复核（五维语义）</div><pre>${escapeHtml(raw)}</pre>
        <p class="disclaimer">模型未按 JSON 格式返回，已显示原文；本次复核由你自备的 Key 发起，本站不存储正文与 Key。</p>`;
    }
  } catch (e) {
    $("deepResult").innerHTML = `<div class="sec-title">AI 深度复核（五维）</div><p style="color:var(--fail)">调用失败：${escapeHtml(e.message)}</p>`;
    setNodeState("deep", "blocked");
  } finally {
    btn.disabled = false; btn.textContent = "AI 深度复核（五维）";
    refreshSummary();
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------- 侧边导航 ---------- */
function initStepNav() {
  const links = [...document.querySelectorAll("#stepNav a")];
  links.forEach(a => a.addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById(a.dataset.step).scrollIntoView({ behavior: "smooth" });
  }));
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) links.forEach(a => a.classList.toggle("active", a.dataset.step === en.target.id));
    });
  }, { rootMargin: "-30% 0px -60% 0px" });
  document.querySelectorAll("section.panel").forEach(s => obs.observe(s));
}

/* ---------- init（每步独立容错，一步异常不连累其他） ---------- */
function safeInit(name, fn) {
  try { fn(); } catch (e) { console.error("[init] " + name + " failed:", e); }
}
function initPipeline() {
  renderPipeline();
  setNodeState("platform", "done");
  const st = policyStatus(PLATFORMS[selectedPlatform]);
  setNodeState("policy", st.level === "expired" ? "warn" : "done");
  refreshSummary();
}
safeInit("theme", initTheme);
safeInit("platformCards", renderPlatformCards);
safeInit("policyCard", renderPolicyCard);
safeInit("checklist", renderChecklist);
safeInit("byok", initBYOK);
safeInit("stepNav", initStepNav);
safeInit("pipeline", initPipeline);

/* ================= 写作工作台（Phase 2b-1） ================= */
import {
  createProject, buildConstitution, buildChapterPrompt, buildSummaryPrompt,
  findChapter, nextChapterN, callLLM,
  saveProject, loadAllProjects, deleteProject,
} from "./nodes/writing.js";

let curProj = null;
const getCreds = () => {
  const s = loadBYOK();
  return { key: s.key || "", endpoint: s.endpoint || "https://api.deepseek.com/v1", model: $("apiModel").value.trim() || "deepseek-chat" };
};

/* ---------- 模式切换 ---------- */
function initModeSwitch() {
  const setMode = (m) => {
    document.body.dataset.mode = m;
    $("modeCheck").classList.toggle("active", m === "check");
    $("modeWrite").classList.toggle("active", m === "write");
    $("stepNav").hidden = m !== "check";
    $("writeNav").hidden = m !== "write";
    document.querySelectorAll("main > section.panel").forEach(s => {
      const isWrite = s.classList.contains("write-panel");
      s.hidden = (m === "check") ? isWrite : !isWrite;
    });
    if (m === "write") renderProjList();
  };
  document.body.dataset.mode = "check";
  $("modeCheck").onclick = () => setMode("check");
  $("modeWrite").onclick = () => setMode("write");
  document.querySelectorAll("#writeNav a").forEach(a => {
    a.onclick = (e) => {
      e.preventDefault();
      document.querySelectorAll("main > section.write-panel").forEach(s => s.hidden = true);
      $(a.dataset.step).hidden = false;
      if (a.dataset.step === "w-projects") renderProjList();
      if (a.dataset.step === "w-memory") renderMemory();
    };
  });
}

/* ---------- 作品管理 ---------- */
function renderProjList() {
  const all = loadAllProjects();
  const box = $("projList");
  const names = Object.keys(all);
  if (!names.length) { box.innerHTML = `<div class="empty-note">还没有作品，上面新建一本开始写</div>`; return; }
  box.innerHTML = names.map(n => {
    const p = all[n];
    return `<div class="proj-card">
      <div><div class="t">${esc(n)}</div>
      <div class="m">${esc(p.genre || "未设题材")} · 已写 ${p.memory.last_chapter} 章 · ${p.characters.length} 人物</div></div>
      <div>
        <button class="ghost sm" data-open="${esc(n)}">打开</button>
        <button class="ghost sm" data-del="${esc(n)}">删除</button>
      </div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openProject(b.dataset.open));
  box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    if (confirm(`删除《${b.dataset.del}》？本机数据将清空`)) { deleteProject(b.dataset.del); if (curProj?.title === b.dataset.del) curProj = null; renderProjList(); }
  });
}
function openProject(name) {
  curProj = loadAllProjects()[name];
  if (!curProj) return;
  fillSettingForm();
  renderOutline();
  $("writeChN").value = nextChapterN(curProj);
  alert(`已打开《${name}》`);
  document.querySelector('[data-step="w-setting"]').click();
}
function initProjects() {
  $("newProjBtn").onclick = () => {
    const t = $("newProjTitle").value.trim();
    if (!t) { alert("先填书名"); return; }
    const all = loadAllProjects();
    if (all[t]) { alert("同名作品已存在"); return; }
    const p = createProject(t);
    saveProject(p);
    $("newProjTitle").value = "";
    openProject(t);
  };
  $("exportProjBtn").onclick = () => {
    if (!curProj) { alert("先打开一个作品"); return; }
    const blob = new Blob([JSON.stringify(curProj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${curProj.title}.json`;
    a.click();
  };
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- 设定编辑器 ---------- */
function fillSettingForm() {
  if (!curProj) return;
  $("setTitle").value = curProj.title;
  $("setGenre").value = curProj.genre || "";
  $("setPlatform").value = curProj.platform || "fanqie";
  $("wvEra").value = curProj.worldview.era || "";
  $("wvPower").value = curProj.worldview.power_system || "";
  $("wvFactions").value = curProj.worldview.factions || "";
  $("wvRules").value = curProj.worldview.rules || "";
  renderCharList();
}
function renderCharList() {
  const box = $("charList");
  box.innerHTML = curProj.characters.map((c, i) => `
    <div class="char-card">
      <div class="form-grid">
        <label>姓名<input data-ci="${i}" data-k="name" value="${esc(c.name)}"></label>
        <label>定位<input data-ci="${i}" data-k="role" value="${esc(c.role)}" placeholder="主角/配角/反派"></label>
        <label>性格<input data-ci="${i}" data-k="traits" value="${esc(c.traits)}"></label>
        <label>目标<input data-ci="${i}" data-k="goal" value="${esc(c.goal)}"></label>
        <label>当前状态<input data-ci="${i}" data-k="status" value="${esc(c.status)}"></label>
        <label>成长线<input data-ci="${i}" data-k="arc" value="${esc(c.arc)}"></label>
      </div>
      <button class="ghost sm" data-delchar="${i}">删除</button>
    </div>`).join("");
  box.querySelectorAll("[data-ci]").forEach(inp => inp.onchange = () => {
    curProj.characters[+inp.dataset.ci][inp.dataset.k] = inp.value;
  });
  box.querySelectorAll("[data-delchar]").forEach(b => b.onclick = () => {
    curProj.characters.splice(+b.dataset.delchar, 1);
    saveProject(curProj); renderCharList();
  });
}
function initSetting() {
  $("addCharBtn").onclick = () => {
    if (!curProj) { alert("先新建/打开作品"); return; }
    curProj.characters.push({ name: "", role: "", traits: "", goal: "", status: "", arc: "" });
    renderCharList();
  };
  $("saveSettingBtn").onclick = () => {
    if (!curProj) { alert("先新建/打开作品"); return; }
    curProj.genre = $("setGenre").value.trim();
    curProj.platform = $("setPlatform").value;
    curProj.worldview = {
      era: $("wvEra").value.trim(), power_system: $("wvPower").value.trim(),
      factions: $("wvFactions").value.trim(), rules: $("wvRules").value.trim(),
    };
    saveProject(curProj);
    alert("设定已保存");
  };
}

/* ---------- 大纲编辑器 ---------- */
function renderOutline() {
  const box = $("outlineList");
  if (!curProj) { box.innerHTML = `<div class="empty-note">先新建/打开作品</div>`; return; }
  box.innerHTML = curProj.outline.map((vol, vi) => `
    <div class="vol-block">
      <h4>${esc(vol.volume || `第${vi + 1}卷`)} <button class="ghost sm" data-addch="${vi}">+ 加章</button></h4>
      ${(vol.chapters || []).map((ch, ci) => `
        <div class="ch-row">
          <input class="n" data-vi="${vi}" data-ci="${ci}" data-k="n" type="number" value="${ch.n}" title="章节号">
          <input class="tt" data-vi="${vi}" data-ci="${ci}" data-k="title" value="${esc(ch.title)}" placeholder="章节标题">
          <input class="bt" data-vi="${vi}" data-ci="${ci}" data-k="beats" value="${esc(ch.beats)}" placeholder="情节点（一句话）">
        </div>`).join("")}
    </div>`).join("");
  box.querySelectorAll("[data-addch]").forEach(b => b.onclick = () => {
    const vol = curProj.outline[+b.dataset.addch];
    const maxN = Math.max(0, ...curProj.outline.flatMap(v => (v.chapters || []).map(c => c.n || 0)));
    vol.chapters.push({ n: maxN + 1, title: "", beats: "", pov: "", plant: [], payoff: [] });
    saveProject(curProj); renderOutline();
  });
  box.querySelectorAll(".ch-row input").forEach(inp => inp.onchange = () => {
    const ch = curProj.outline[+inp.dataset.vi].chapters[+inp.dataset.ci];
    ch[inp.dataset.k] = inp.dataset.k === "n" ? +inp.value : inp.value;
    saveProject(curProj);
  });
}
function initOutline() {
  $("addVolBtn").onclick = () => {
    if (!curProj) { alert("先新建/打开作品"); return; }
    const name = $("newVolName").value.trim() || `第${curProj.outline.length + 1}卷`;
    curProj.outline.push({ volume: name, summary: "", chapters: [] });
    $("newVolName").value = "";
    saveProject(curProj); renderOutline();
  };
}

/* ---------- 写作区 ---------- */
function initWriting() {
  $("writeArea").oninput = () => $("writeCount").textContent = `${$("writeArea").value.length} 字`;
  $("loadChBtn").onclick = () => {
    if (!curProj) { alert("先新建/打开作品"); return; }
    const n = +$("writeChN").value;
    const ch = findChapter(curProj, n);
    const saved = curProj.chapters[n];
    $("chTask").innerHTML = ch
      ? `<b>第 ${n} 章 · ${esc(ch.title)}</b><br>情节点：${esc(ch.beats || "（未填）")}<br>视角：${esc(ch.pov || "主角")}`
      : `<b>第 ${n} 章</b>（大纲里没这章，将按宪法自由发挥）`;
    if (saved?.content) { $("writeArea").value = saved.content; $("writeCount").textContent = `${saved.content.length} 字`; }
  };
  $("genChBtn").onclick = async () => {
    if (!curProj) { alert("先新建/打开作品"); return; }
    const n = +$("writeChN").value;
    $("genChBtn").disabled = true;
    $("genChBtn").textContent = "生成中…";
    try {
      const text = await callLLM(buildChapterPrompt(curProj, n), getCreds(), { temperature: 0.8 });
      $("writeArea").value = text.trim();
      $("writeCount").textContent = `${$("writeArea").value.length} 字`;
    } catch (e) { alert("生成失败：" + e.message); }
    $("genChBtn").disabled = false;
    $("genChBtn").textContent = "AI 生成初稿";
  };
  $("saveChBtn").onclick = saveChapter;
}

async function saveChapter() {
  if (!curProj) { alert("先新建/打开作品"); return; }
  const n = +$("writeChN").value;
  const content = $("writeArea").value.trim();
  if (content.length < 100) { alert("正文太短，先写点内容"); return; }
  const ch = findChapter(curProj, n);
  curProj.chapters[n] = { title: ch?.title || "", content, signcheck: null };

  $("saveChBtn").disabled = true;
  $("saveChBtn").textContent = "记忆更新中…";
  try {
    // 1. 记忆更新（LLM 总结）
    const sumRaw = await callLLM(buildSummaryPrompt(curProj, n, content), getCreds(), { temperature: 0.3 });
    const m = sumRaw.match(/\{[\s\S]*\}/);
    if (m) {
      const sum = JSON.parse(m[0]);
      curProj.memory.chapter_summaries.push({ n, summary: sum.summary || "" });
      curProj.memory.timeline.push(`第${n}章：${sum.summary || ""}`);
      for (const f of (sum.new_foreshadows || []).filter(x => x && x !== "无")) {
        const id = "F" + (curProj.memory.foreshadows.length + 1);
        curProj.memory.foreshadows.push({ id, desc: f, planted_ch: n, payoff_ch: null, status: "未收" });
      }
    }
    curProj.memory.last_chapter = Math.max(curProj.memory.last_chapter, n);
    // 大纲里收伏笔
    if (ch?.payoff?.length) {
      for (const pf of ch.payoff) {
        const f = curProj.memory.foreshadows.find(x => x.status === "未收" && x.desc.includes(pf));
        if (f) { f.status = "已收"; f.payoff_ch = n; }
      }
    }
  } catch (e) { console.warn("记忆更新失败（不影响保存）:", e.message); }

  // 2. 写审一体：自动过审
  $("saveChBtn").textContent = "过审检测中…";
  let scHtml = "";
  try {
    const r = analyze(content, curProj.platform || "fanqie");
    const v = r.platform_verdict.verdict;
    const vLabel = { pass: "通过", review: "复核", fail: "高风险" }[v];
    curProj.chapters[n].signcheck = { verdict: v, density: r.signal_density_per_1k };
    scHtml = `<div class="ch-task">写审一体 · ${PLATFORMS[curProj.platform || "fanqie"].label}：
      <span class="verdict-${v}">${vLabel}</span>（AI 味密度 ${r.signal_density_per_1k}/千字）
      ${v !== "pass" ? `<br><span class="muted">${r.platform_verdict.reasons.join("；").slice(0, 120)}</span>` : ""}</div>`;
  } catch (e) { scHtml = `<div class="ch-task muted">过审检测跳过：${e.message}</div>`; }

  saveProject(curProj);
  $("writeSigncheck").innerHTML = scHtml;
  $("writeChN").value = n + 1;
  $("saveChBtn").disabled = false;
  $("saveChBtn").textContent = "保存本章（自动更新记忆+过审）";
  renderMemory();
  alert(`第 ${n} 章已保存：记忆已更新，过审已跑`);
}

/* ---------- 记忆面板 ---------- */
function renderMemory() {
  if (!curProj) return;
  $("memTimeline").innerHTML = curProj.memory.timeline.length
    ? curProj.memory.timeline.map(t => `<div class="ch-row">${esc(t)}</div>`).join("")
    : `<div class="empty-note">写完第一章后自动生成</div>`;
  $("memForeshadow").innerHTML = curProj.memory.foreshadows.length
    ? curProj.memory.foreshadows.map(f =>
        `<div class="ch-row">[${f.id}] ${esc(f.desc)}（第${f.planted_ch}章埋${f.status === "已收" ? `→第${f.payoff_ch}章收` : "→<b>未收</b>"})</div>`).join("")
    : `<div class="empty-note">暂无伏笔</div>`;
  $("constPreview").textContent = buildConstitution(curProj);
}
function initMemory() {
  $("copyConstBtn").onclick = async () => {
    if (!curProj) return;
    try { await navigator.clipboard.writeText(buildConstitution(curProj)); alert("已复制"); }
    catch { alert("复制失败，请手动选择复制"); }
  };
}

safeInit("modeSwitch", initModeSwitch);
safeInit("wProjects", initProjects);
safeInit("wSetting", initSetting);
safeInit("wOutline", initOutline);
safeInit("wWriting", initWriting);
safeInit("wMemory", initMemory);
