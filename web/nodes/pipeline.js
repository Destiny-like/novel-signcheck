/* Phase 2a：节点式过签管线
 * 借鉴 DeterminFlow"让概率性的 AI 运行在确定的流程中"——
 * 把单次检测升级为节点管线：每个节点有明确状态（待运行/运行中/通过/预警/需返工），
 * 可单独重跑；blocking 节点不通过，管线拒绝给出"可投稿"结论。
 *
 * 节点映射（v1 设计 S0–S6 的 Web 落点）：
 *   N0 平台选择   ← S0（平台定位）
 *   N1 策略确认   ← S0（读策略卡，过期预警）
 *   N2 机械检测   ← S3 质量门禁（机械层）
 *   N3 改写建议   ← S4 去味改写（规则级建议 + 复检回炉）
 *   N4 资格自查   ← S5 过审检查（checklist 硬门禁）
 *   N5 深度复核   ← S3 质量门禁（语义层，BYOK，可选）
 */

export const NODES = [
  { id: "platform",  title: "选择平台", section: "step1", optional: false },
  { id: "policy",    title: "策略确认", section: "step2", optional: false },
  { id: "detect",    title: "机械检测", section: "step3", optional: false },
  { id: "rewrite",   title: "改写建议", section: "step3b", optional: false },
  { id: "checklist", title: "资格自查", section: "step4", optional: false },
  { id: "deep",      title: "深度复核", section: "step5", optional: true },
];

// state: pending | running | done | warn | blocked
const states = {};
NODES.forEach(n => { states[n.id] = "pending"; });

const STATE_LABEL = {
  pending: "待运行", running: "运行中…", done: "通过",
  warn: "预警", blocked: "需返工",
};

export function getNodeState(id) { return states[id] || "pending"; }

export function setNodeState(id, state) {
  if (!(id in states)) return;
  states[id] = state;
  renderPipeline();
}

export function renderPipeline() {
  const wrap = document.getElementById("pipelineSteps");
  if (!wrap) return;
  wrap.innerHTML = NODES.map((n, i) => {
    const st = states[n.id];
    const link = i < NODES.length - 1 ? '<span class="pl-link"></span>' : "";
    return `<button class="pl-node st-${st}" data-node="${n.id}" data-section="${n.section}" title="${n.title}${n.optional ? "（可选）" : ""}">
        <span class="pl-dot">${st === "done" ? "✓" : st === "blocked" ? "!" : (i + 1)}</span>
        <span class="pl-title">${n.title}${n.optional ? "<em>可选</em>" : ""}</span>
        <span class="pl-state">${STATE_LABEL[st]}</span>
      </button>${link}`;
  }).join("");
  wrap.querySelectorAll(".pl-node").forEach(b => b.addEventListener("click", () => {
    const sec = document.getElementById(b.dataset.section);
    if (sec) sec.scrollIntoView({ behavior: "smooth" });
  }));
}

/* 管线总览：是否允许给出"可投稿"结论 */
export function pipelineSummary() {
  const required = NODES.filter(n => !n.optional);
  const blocked = required.filter(n => states[n.id] === "blocked");
  const pending = required.filter(n => states[n.id] === "pending" || states[n.id] === "running");
  if (blocked.length) return { ok: false, msg: `还有 ${blocked.length} 个节点需返工：${blocked.map(n => n.title).join("、")}` };
  if (pending.length) return { ok: false, msg: `还有 ${pending.length} 个节点未完成：${pending.map(n => n.title).join("、")}` };
  const warned = required.filter(n => states[n.id] === "warn");
  return { ok: true, msg: warned.length ? `全部完成，有 ${warned.length} 处预警（${warned.map(n => n.title).join("、")}），建议处理后再投稿` : "全部节点通过，可以进入投稿流程" };
}
