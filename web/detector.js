/* AI 味 + 平台口径检测 v0.2（JS 移植版，纯本地运行）
 * 由 scripts/ai_feel_check.py v0.2 完整移植，逻辑保持一致。
 * 用法：import { analyze } from './detector.js'; analyze(text, 'fanqie'|'qimao'|'qidian')
 */

export const PLATFORM_PROFILES = {
  fanqie: {
    label: "番茄小说",
    policy: "签约前拒签'AI 粗制滥造'（行文机械/语言模板化/空洞水文）",
    // 阈值经 2026-10-17 标注集校准（13 样本）：
    // human 密度 [0,0,0,4.27,4.69] / ai 密度 [29.96..107.01]
    tell_warn: 6, tell_fail: 10,
    focus: ["行文机械", "语言模板化", "空洞水文"],
    strict: true,
  },
  qimao: {
    label: "七猫小说",
    policy: "2026-09-01《生成式AI服务管理办法》施行，要求标注AI辅助使用；人工编辑初审，开篇三章是生死线",
    tell_warn: 6, tell_fail: 12,
    focus: ["开篇 AI 味", "一眼模板化", "开场景描套路"],
    opening_weight: true,
    strict: false,
  },
  qidian: {
    label: "起点中文网",
    policy: "2026 AI 水文治理（清理榜单、限定日更）；'文学本身不能是AI'",
    tell_warn: 6, tell_fail: 12,
    focus: ["信息密度（水文）", "重复铺陈", "模板化灌水"],
    shuiwen_check: true,
    strict: false,
  },
};

const PHRASE_SIGNALS = [
  // [名称, 词表, 解释, 严重度]
  ["A1 情绪直述",
    ["感到无比", "充满恐惧", "涌起一阵", "内心充满", "非常愤怒",
     "无比悲伤", "心头一暖", "心中一喜", "感到一阵"],
    "直接贴情绪标签，剥夺读者'读出来'的乐趣", "high"],
  ["A4 段尾升华",
    ["命运的齿轮", "这只是一个开始", "终于明白", "而在远方",
     "一切都将改变", "新的征程", "属于他的时代"],
    "模型式安全收束，万能升华", "high"],
  ["B2 程度副词",
    ["极其", "无比", "深深地", "浓浓的", "简直", "仿佛要", "异常", "格外"],
    "副词是省略细节的捷径", "medium"],
  ["B3 比喻滥用",
    ["仿佛", "宛如", "好似", "就像", "如同"],
    "比喻是调味料不是主菜；连用即滥用", "medium"],
  ["B5 宏大意象",
    ["宿命", "轮回", "苍穹", "洪流", "深渊", "尘埃", "光年", "宇宙", "纪元"],
    "与情节无关的宏大词，模型'显得深刻'的默认手段", "medium"],
  ["E2 说明文腔",
    ["值得注意的是", "综上所述", "不难看出", "由此可见",
     "换句话说", "总而言之"],
    "说明文/助手腔残留", "medium"],
  ["F 高频词",
    ["此外", "至关重要", "赋能", "闭环", "抓手", "彰显", "诠释",
     "交织", "勾勒", "蜕变", "救赎", "觉醒", "张力"],
    "中文 AI 高频词，扎堆出现才是信号", "low"],
];

const REGEX_SIGNALS = [
  ["C3 对称句式",
    ["不是.{1,12}而是", "与其说.{1,12}不如说", "既是.{1,10}也是"],
    "否定的一半常是稻草人，只增重量不增信息", "high"],
];

function countOccurrences(text, word) {
  let count = 0, idx = 0;
  while ((idx = text.indexOf(word, idx)) !== -1) { count++; idx += word.length; }
  return count;
}

function _hasParallelMarker(sents) {
  // 排比的结构标记：三句中有≥2句共享结构特征。
  // 真排比必有结构重复（共用虚词/相同领起/相同收尾）；纯等长短句（如对话"你来。/我去。"）不是排比。
  if (sents.length < 3) return false;
  const tri = sents.slice(0, 3);
  // 1) ≥2 句首两字相同
  const heads = tri.filter(s => s.length >= 2).map(s => s.slice(0, 2));
  if (heads.length >= 2 && new Set(heads).size < heads.length) return true;
  // 2) ≥2 句尾字相同
  const tails = tri.filter(s => s).map(s => s.slice(-1));
  if (tails.length >= 2 && new Set(tails).size < tails.length) return true;
  // 3) 有二字词在≥2句中出现（含虚词——排比本就是结构的重复）
  const seen = {};
  for (const s of tri) {
    const ws = new Set();
    for (let i = 0; i < s.length - 1; i++) ws.add(s.slice(i, i + 2));
    for (const w of ws) seen[w] = (seen[w] || 0) + 1;
  }
  return Object.values(seen).some(v => v >= 2);
}

function _cleanSentsForC2(sents) {
  // C2 前清洗：去掉对话引号/空白碎片（否则 '"\n\n' 会被当成共享二字词造成误判），丢弃 <2 字的碎片句
  const cleaned = [];
  for (const s of sents) {
    const c = s.replace(/[“”"「」『』\s]+/g, "");
    if (c.length >= 2) cleaned.push(c);
  }
  return cleaned;
}

function detectParallelTriples(sentences) {
  // C2 排比三连：连续 3 句短句、句长接近、且有结构平行标记
  const hits = [];
  const lens = sentences.map(s => s.length);
  for (let i = 0; i <= sentences.length - 3; i++) {
    const win = lens.slice(i, i + 3);
    if (win.every(l => l <= 30) && Math.max(...win) - Math.min(...win) <= 6) {
      if (_hasParallelMarker(sentences.slice(i, i + 3))) hits.push(i);
    }
  }
  return hits;
}

function detectRepetition(paragraphs, minLen = 10) {
  const seen = new Map();
  const dups = [];
  paragraphs.forEach((p, pi) => {
    const clean = p.replace(/\s+/g, "");
    for (let i = 0; i <= clean.length - minLen; i++) {
      const frag = clean.slice(i, i + minLen);
      if (seen.has(frag) && seen.get(frag) !== pi) dups.push(frag);
      else if (!seen.has(frag)) seen.set(frag, pi);
    }
  });
  const uniq = [];
  for (const d of new Set(dups)) {
    if (!uniq.some(u => u !== d && u.includes(d))) uniq.push(d);
  }
  return uniq.slice(0, 10);
}

const SENT_END = /[。！？…]/g;
const CLAUSE_SPLIT = /[，；、]/;
const DIALOGUE_RE = /[“"「『]([^“"」』]{1,200})[”"」』]/g;

function splitDialogue(text) {
  const dialogues = [...text.matchAll(DIALOGUE_RE)].map(m => m[1]);
  const narration = text.replace(DIALOGUE_RE, "");
  return { dialogues, narration };
}

function punctStats(t) {
  const commas = (t.match(/[，,]/g) || []).length;
  const periods = (t.match(SENT_END) || []).length || 1;
  return Math.round((commas / periods) * 100) / 100;
}

function sentenceStats(t) {
  const sents = t.split(/[。！？…]/).map(s => s.trim()).filter(Boolean);
  const lens = sents.map(s => s.length);
  if (!lens.length) return { n: 0, avg: 0, std: 0, sents: [] };
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  return { n: sents.length, avg: Math.round(mean * 10) / 10,
           std: Math.round(Math.sqrt(variance) * 10) / 10, sents };
}

function clauseStats(t) {
  const clauses = t.split(CLAUSE_SPLIT).map(c => c.trim()).filter(Boolean);
  if (!clauses.length) return { n: 0, avg: 0 };
  const avg = clauses.reduce((a, c) => a + c.length, 0) / clauses.length;
  return { n: clauses.length, avg: Math.round(avg * 10) / 10 };
}

export function analyze(text, platform = null) {
  text = text.trim();
  // v0.3: 统一换行符（\r\n→\n），避免 \r 被计入字数导致双实现不一致
  text = text.replace(/\r\n?/g, "\n");
  // v0.3: 清洗 txt 分隔线杂质（整行分隔符会被 D5 误判为重复铺陈）
  text = text.replace(/^[ \t]*[-=＊*·…─—―]{5,}[ \t]*\r?$/gm, "").trim();
  const chars = text.length;
  if (!chars) return { error: "empty text" };
  const per1k = chars / 1000;

  const { dialogues, narration } = splitDialogue(text);
  const full = sentenceStats(text);

  const result = {
    chars, platform,
    punct: {
      full_comma_period: punctStats(text),
      narration_comma_period: punctStats(narration),
      dialogue_chars_ratio:
        Math.round((dialogues.join("").length / chars) * 100) / 100,
    },
    sentence: { avg_len: full.avg, std: full.std, n: full.n },
    clause: clauseStats(narration),
  };

  const signals = [];
  let totalHits = 0;
  for (const [cat, words, why, sev] of PHRASE_SIGNALS) {
    const hits = words.map(w => [w, countOccurrences(text, w)]).filter(([, c]) => c > 0);
    if (hits.length) {
      const cnt = hits.reduce((a, [, c]) => a + c, 0);
      totalHits += cnt;
      signals.push({ signal: cat, hits: cnt, severity: sev,
        density_per_1k: Math.round((cnt / per1k) * 100) / 100,
        examples: hits.slice(0, 5).map(([w]) => w), why });
    }
  }
  for (const [cat, patterns, why, sev] of REGEX_SIGNALS) {
    const cnt = patterns.reduce(
      (a, p) => a + (text.match(new RegExp(p, "g")) || []).length, 0);
    if (cnt) {
      totalHits += cnt;
      signals.push({ signal: cat, hits: cnt, severity: sev,
        density_per_1k: Math.round((cnt / per1k) * 100) / 100,
        examples: [], why });
    }
  }
  const triples = detectParallelTriples(_cleanSentsForC2(full.sents));
  if (triples.length) {
    signals.push({ signal: "C2 排比三连（启发式）", hits: triples.length, severity: "high",
      density_per_1k: Math.round((triples.length / per1k) * 100) / 100,
      examples: [], why: "连续三短句等长，'听起来完整'的默认做法" });
    totalHits += triples.length;
  }

  result.signals = signals.sort((a, b) => b.hits - a.hits);
  result.signal_density_per_1k = Math.round((totalHits / per1k) * 100) / 100;

  // v0.3: 精修腔指标（针对"精 AI"，依据《烬天行》实测）
  const sig = p => signals.find(s => s.signal.startsWith(p));
  const _c2 = sig("C2"), _c3 = sig("C3"), _b3 = sig("B3"), _b5 = sig("B5");
  const c2Dens = _c2 ? _c2.density_per_1k : 0;
  // 精修腔规则只在高置信度档（≥800字）生效：短文本下"每千字密度"会被单次命中放大
  const _long = chars >= 800;
  const polishedC2 = _long && c2Dens >= 1.2;
  const polishedCombo = _long && c2Dens >= 1.0 && _c3 && (_b3 || _b5);

  const paragraphs = text.split("\n").map(p => p.trim()).filter(Boolean);
  const dups = detectRepetition(paragraphs);
  result.repetition = { count: dups.length, examples: dups };

  const risks = [];
  const cp = result.punct.narration_comma_period;
  if (cp > 2.2) risks.push(`逗号÷句号比偏高（叙述层 ${cp}），长句堆砌嫌疑`);
  if (full.std < 6 && full.n >= 6)
    risks.push(`句长标准差偏低（${full.std}），节奏单一、模板化嫌疑`);
  if (result.clause.avg && result.clause.avg < 8 && result.clause.n >= 10)
    risks.push(`分句平均长度过短（${result.clause.avg} 字），逗号碎句嫌疑`);
  if (dups.length) risks.push(`重复铺陈 ${dups.length} 处（D5），水文/记忆缺失嫌疑`);
  if (polishedC2) risks.push(`C2 排比密度 ${c2Dens}/千字 ≥1.2，'精修腔'弱信号`);
  if (polishedCombo) risks.push("精修腔组合（C2排比＋C3对称＋B3/B5修辞）命中，AI 润色嫌疑");
  result.risks = risks;

  if (platform && PLATFORM_PROFILES[platform]) {
    const prof = PLATFORM_PROFILES[platform];
    const dens = result.signal_density_per_1k;
    let verdict = "pass";
    const reasons = [];
    if (dens >= prof.tell_fail) {
      verdict = "fail";
      reasons.push(`AI 腔信号密度 ${dens}/千字 ≥ ${prof.tell_fail}（${prof.label}）`);
    } else if (dens >= prof.tell_warn) {
      verdict = "review";
      reasons.push(`AI 腔信号密度 ${dens}/千字，达预警线`);
    }
    if (result.repetition.count >= 3 && prof.shuiwen_check) {
      if (verdict !== "fail") verdict = "review";
      reasons.push(`重复铺陈 ${result.repetition.count} 处，起点水文治理高风险`);
    }
    const strong = signals.some(s => /^(A1|C2|C6)/.test(s.signal));
    // 强信号一票预警：只在密度已达预警线时触发，避免单个轻微排比句就 review
    if (prof.strict && strong && dens >= prof.tell_warn) {
      reasons.push("番茄强信号命中（A1/C2/C6），'AI 粗制滥造'拒签风险");
      if (verdict === "pass") verdict = "review";
    }
    // v0.3 精修腔：弱信号，只推 review、不推 fail，不单独定罪
    if (verdict === "pass" && (polishedC2 || polishedCombo)) {
      verdict = "review";
      reasons.push(`精修腔信号（C2排比密度${c2Dens}/千字${polishedCombo ? "＋修辞组合" : ""}），建议人工复核`);
    }
    result.platform_verdict = {
      platform: prof.label, policy: prof.policy, verdict,
      reasons: reasons.length ? reasons : ["机械指标未触发平台红线"],
      focus: prof.focus,
    };
  }

  // 置信度：样本过短时"每千字密度"会被放大，不下重结论
  let confidence, cap, note;
  if (chars < 200) {
    confidence = "low"; cap = "review";
    note = "样本过短（<200字），结论置信度低，仅供参考；建议用至少前3章重测";
  } else if (chars < 800) {
    confidence = "medium"; cap = null;
    note = "样本较短，结论置信度中等";
  } else {
    confidence = "high"; cap = null; note = "";
  }
  if (cap && platform && result.platform_verdict) {
    const order = { pass: 0, review: 1, fail: 2 };
    const pv = result.platform_verdict;
    if (order[pv.verdict] > order[cap]) {
      pv.verdict = cap;
      pv.reasons.push(note);
    }
  }
  result.confidence = { level: confidence, note };
  return result;
}
