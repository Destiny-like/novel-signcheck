/* Phase 2a · S4 改写建议节点
 * 规则级改写建议：针对每个命中的 AI 腔信号类别，给出具体、可执行的改写方向。
 * 不替用户改写（保留人工痕迹），改完可一键复检（回炉 N2）。
 */

const TIPS = [
  {
    match: s => s.signal.startsWith("A1"),
    title: "情绪直述 → 用动作代替标签",
    tips: [
      "删掉「感到一阵」「内心充满」「不由得」这类情绪标签词",
      "用动作、神态、细节让读者自己读出情绪，不要直接报情绪名",
      "同一处情绪只写一次，删掉重复渲染的句子",
    ],
  },
  {
    match: s => s.signal.startsWith("A4"),
    title: "段尾升华 → 用具体收束",
    tips: [
      "删掉「命运的齿轮开始转动」「这只是一个开始」类万能升华句",
      "用具体动作或细节收束段落，把悬念留给情节本身",
      "升华句留到卷末/书末再用，全书不超过 3 次",
    ],
  },
  {
    match: s => s.signal.startsWith("B2"),
    title: "程度副词 → 换成事实",
    tips: [
      "删掉「非常」「极其」「十分」「格外」等程度副词",
      "换成具体数字、对比或事实（不说「非常快」，说「三息追上」）",
    ],
  },
  {
    match: s => s.signal.startsWith("B3"),
    title: "比喻滥用 → 只留最准的一个",
    tips: [
      "删掉为比喻而比喻的句子：比喻没有推进理解就删",
      "一个场景只留一个最准的比喻，其余全删",
    ],
  },
  {
    match: s => s.signal.startsWith("B5"),
    title: "宏大意象 → 收缩尺度",
    tips: [
      "把「天地」「苍穹」「命运」收缩到具体的人和物",
      "宏大词留给真正的转折点，日常章节禁用",
    ],
  },
  {
    match: s => s.signal.startsWith("C2"),
    title: "排比三连 → 打散句式",
    tips: [
      "打散连续三短句的等长排比，长短错开",
      "删掉纯粹为凑排比而存在的句子",
    ],
  },
  {
    match: s => s.signal.startsWith("C3"),
    title: "对称句式 → 换自然叙述",
    tips: [
      "打破「不是……而是……」「与其……不如……」的对称模板",
      "换成自然叙述语序，允许句子不对称",
    ],
  },
  {
    match: s => s.signal.startsWith("E2"),
    title: "说明文腔 → 故事化表达",
    tips: [
      "删掉「首先/其次/总而言之」和教科书式定义句",
      "设定交代融进情节和对话，不要整段说明书",
    ],
  },
];

/* D5 重复铺陈是独立字段，不在 signals 里 */
export function dupTip(count) {
  if (!count) return null;
  return {
    title: `重复铺陈（${count} 处）→ 一处讲清`,
    tips: [
      "合并重复交代同一设定的段落，一处讲清",
      "每写一段设定，回头检查「前面是不是说过」",
      "起点重点查水文：重复铺陈 ≥3 处直接判高风险",
    ],
  };
}

export function tipsForSignals(signals, repetitionCount) {
  const out = [];
  for (const s of signals) {
    const rule = TIPS.find(t => t.match(s));
    if (rule && !out.some(o => o.title === rule.title)) {
      out.push({ ...rule, hits: s.hits, severity: s.severity });
    }
  }
  const d = dupTip(repetitionCount);
  if (d) out.push({ ...d, hits: repetitionCount, severity: repetitionCount >= 3 ? "high" : "medium" });
  return out;
}

const SEV_TXT = { high: "高危", medium: "注意", low: "轻微" };

export function renderRewriteTips(signals, repetitionCount) {
  const tips = tipsForSignals(signals, repetitionCount);
  if (!tips.length) {
    return `<div class="empty-note">未命中 AI 腔信号，无需改写，直接去资格自查吧 ✓</div>`;
  }
  return `<div class="rw-list">${tips.map(t => `
    <div class="rw-card sev-${t.severity}">
      <div class="rw-head">
        <span class="sev-pill sev-${t.severity}">${SEV_TXT[t.severity] || ""}</span>
        <b>${t.title}</b>
        <span class="rw-hits">${t.hits} 处</span>
      </div>
      <ol>${t.tips.map(x => `<li>${x}</li>`).join("")}</ol>
    </div>`).join("")}</div>
  <p class="rw-note">按建议改完后，在上方正文框修改文本，点「修改后复检」回炉重测；也可以直接用 BYOK 让模型按这些方向改写（Key 只走你的模型账户）。</p>`;
}
