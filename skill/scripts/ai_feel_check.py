#!/usr/bin/env python3
"""
AI 味 + 平台口径检测 v0.2（本地运行，零依赖）
供 signcheck-novel-zh SKILL.md Step 3 调用。

设计来源：
- 机械指标：吸收自 zh-novel-writing-toolkit/ai-detector-zh（MIT）：逗号÷句号比
  （台词层/叙述层分离）、句长标准差、分句长度（逗号÷句号的盲区补充）
- 可计算信号：A1 情绪直述 / A4 段尾升华 / B2 程度副词 / B3 比喻滥用 /
  B5 宏大意象 / C2 排比三连 / C3 对称句式 / C6 逗号碎句 / D5 重复铺陈 /
  E2 说明文腔 / F 中文 AI 高频词
- 分平台口径：番茄（签约前拒签"AI 粗制滥造"，最严）/ 七猫（人工编辑，开篇加权）/
  起点（AI 水文治理，查信息密度与灌水）

用法：
    python3 scripts/ai_feel_check.py <正文.txt> --platform fanqie|qimao|qidian [--json]
    不指定 --platform 时输出通用指标，不下平台结论。
"""

import json
import re
import sys
from collections import Counter

# ---------------- 平台口径配置 ----------------
PLATFORM_PROFILES = {
    "fanqie": {
        "label": "番茄小说",
        "policy": "签约前拒签'AI 粗制滥造'（行文机械/语言模板化/空洞水文）",
        # 阈值经 2026-10-17 标注集校准（tests/corpus，13 样本）：
        # human 密度 [0,0,0,4.27,4.69] / ai 密度 [29.96..107.01]
        "tell_warn": 6, "tell_fail": 10,
        "focus": ["行文机械", "语言模板化", "空洞水文"],
        "strict": True,
    },
    "qimao": {
        "label": "七猫小说",
        "policy": "人工编辑初审，开篇三章是生死线；AI 辅助写作建议人工审改",
        "tell_warn": 6, "tell_fail": 12,
        "focus": ["开篇 AI 味", "一眼模板化", "开场景描套路"],
        "opening_weight": True,
        "strict": False,
    },
    "qidian": {
        "label": "起点中文网",
        "policy": "2026 AI 水文治理（清理榜单、限定日更）；'文学本身不能是AI'",
        "tell_warn": 6, "tell_fail": 12,
        "focus": ["信息密度（水文）", "重复铺陈", "模板化灌水"],
        "shuiwen_check": True,
        "strict": False,
    },
}

# ---------------- 可计算信号 ----------------
PHRASE_SIGNALS = [
    ("A1 情绪直述",
     ["感到无比", "充满恐惧", "涌起一阵", "内心充满", "非常愤怒",
      "无比悲伤", "心头一暖", "心中一喜", "感到一阵"],
     "直接贴情绪标签，剥夺读者'读出来'的乐趣"),
    ("A4 段尾升华",
     ["命运的齿轮", "这只是一个开始", "终于明白", "而在远方",
      "一切都将改变", "新的征程", "属于他的时代"],
     "模型式安全收束，万能升华"),
    ("B2 程度副词",
     ["极其", "无比", "深深地", "浓浓的", "简直", "仿佛要", "异常", "格外"],
     "副词是省略细节的捷径"),
    ("B3 比喻滥用",
     ["仿佛", "宛如", "好似", "就像", "如同"],
     "比喻是调味料不是主菜；连用即滥用"),
    ("B5 宏大意象",
     ["宿命", "轮回", "苍穹", "洪流", "深渊", "尘埃", "光年", "宇宙", "纪元"],
     "与情节无关的宏大词，模型'显得深刻'的默认手段"),
    ("E2 说明文腔",
     ["值得注意的是", "综上所述", "不难看出", "由此可见",
      "换句话说", "总而言之"],
     "说明文/助手腔残留"),
    ("F 高频词",
     ["此外", "至关重要", "赋能", "闭环", "抓手", "彰显", "诠释",
      "交织", "勾勒", "蜕变", "救赎", "觉醒", "张力"],
     "中文 AI 高频词，扎堆出现才是信号"),
]

REGEX_SIGNALS = [
    ("C3 对称句式",
     [r"不是.{1,12}而是", r"与其说.{1,12}不如说", r"既是.{1,10}也是"],
     "否定的一半常是稻草人，只增重量不增信息"),
]


def _clean_sents_for_c2(sents):
    """C2 前清洗：去掉对话引号/空白碎片（否则 '"\\n\\n' 会被当成共享二字词造成误判），
    丢弃 <2 字的碎片句。"""
    cleaned = []
    for s in sents:
        c = re.sub(r'[“”"「」『』\s]+', '', s)
        if len(c) >= 2:
            cleaned.append(c)
    return cleaned


def _has_parallel_marker(sents):
    """排比的结构标记：三句中有≥2句共享结构特征。
    真排比必有结构重复（共用虚词/相同领起/相同收尾）；纯等长短句（如对话"你来。/我去。"）不是排比。
    """
    if len(sents) < 3:
        return False
    tri = sents[:3]
    # 1) ≥2 句首两字相同（领起句式相同）
    heads = [s[:2] for s in tri if len(s) >= 2]
    if len(heads) >= 2 and len(set(heads)) < len(heads):
        return True
    # 2) ≥2 句尾字相同（收束句式相同）
    tails = [s[-1] for s in tri if s]
    if len(tails) >= 2 and len(set(tails)) < len(tails):
        return True
    # 3) 有二字词在≥2句中出现（含虚词——排比本就是结构的重复）
    bigrams = []
    for s in tri:
        bigrams.append({s[i:i + 2] for i in range(len(s) - 1)})
    seen = {}
    for ws in bigrams:
        for w in ws:
            seen[w] = seen.get(w, 0) + 1
    if any(v >= 2 for v in seen.values()):
        return True
    return False


def detect_parallel_triples(sentences):
    """C2 排比三连：连续 3 句短句、句长接近、且有结构平行标记"""
    hits = []
    lens = [len(s) for s in sentences]
    for i in range(len(sentences) - 2):
        win = lens[i:i + 3]
        if all(l <= 30 for l in win) and max(win) - min(win) <= 6:
            if _has_parallel_marker(sentences[i:i + 3]):
                hits.append(i)
    return hits


def detect_repetition(paragraphs, min_len=10):
    """D5 重复铺陈：跨段落的 10 字以上重复片段"""
    seen = {}
    dups = []
    for pi, p in enumerate(paragraphs):
        p = re.sub(r"\s+", "", p)
        for i in range(len(p) - min_len + 1):
            frag = p[i:i + min_len]
            if frag in seen and seen[frag] != pi:
                dups.append(frag)
            else:
                seen.setdefault(frag, pi)
    uniq = []
    for d in dict.fromkeys(dups):
        if not any(d in u and d != u for u in uniq):
            uniq.append(d)
    return uniq[:10]


SENT_END = re.compile(r"[。！？…]")
CLAUSE_SPLIT = re.compile(r"[，；、]")
DIALOGUE_RE = re.compile(r'[“"「『]([^“"」』]{1,200})[”"」』]')


def split_dialogue(text):
    """分离台词层与叙述层"""
    dialogues = DIALOGUE_RE.findall(text)
    narration = DIALOGUE_RE.sub("", text)
    return dialogues, narration


def punct_stats(t):
    commas = t.count("，") + t.count(",")
    periods = len(SENT_END.findall(t)) or 1
    return round(commas / periods, 2)


def sentence_stats(t):
    sents = [s for s in SENT_END.split(t) if s.strip()]
    lens = [len(s) for s in sents]
    if not lens:
        return {"n": 0, "avg": 0, "std": 0, "sents": []}
    mean = sum(lens) / len(lens)
    var = sum((x - mean) ** 2 for x in lens) / len(lens)
    return {"n": len(sents), "avg": round(mean, 1),
            "std": round(var ** 0.5, 1), "sents": sents}


def clause_stats(t):
    clauses = [c for c in CLAUSE_SPLIT.split(t) if c.strip()]
    lens = [len(c) for c in clauses]
    if not lens:
        return {"n": 0, "avg": 0}
    return {"n": len(clauses), "avg": round(sum(lens) / len(lens), 1)}


def analyze(text, platform=None):
    text = text.strip()
    # v0.3: 统一换行符（\r\n→\n），避免 \r 被计入字数导致 Python/JS 双实现不一致
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    # v0.3: 清洗 txt 分隔线杂质（整行分隔符会被 D5 误判为重复铺陈，见《斗破苍穹》实测）
    text = re.sub(r'(?m)^[ \t]*[-=＊*·…─—―]{5,}[ \t]*\r?$', '', text)
    text = text.strip()
    chars = len(text)
    if chars == 0:
        return {"error": "empty text"}
    per_1k = chars / 1000

    dialogues, narration = split_dialogue(text)
    full = sentence_stats(text)

    result = {
        "chars": chars,
        "platform": platform,
        "punct": {
            "full_comma_period": punct_stats(text),
            "narration_comma_period": punct_stats(narration),
            "dialogue_chars_ratio": round(sum(len(d) for d in dialogues) / chars, 2),
        },
        "sentence": {"avg_len": full["avg"], "std": full["std"], "n": full["n"]},
        "clause": clause_stats(narration),
    }

    signals = []
    total_hits = 0
    for cat, words, why in PHRASE_SIGNALS:
        hits = [(w, text.count(w)) for w in words if w in text]
        if hits:
            cnt = sum(c for _, c in hits)
            total_hits += cnt
            signals.append({
                "signal": cat, "hits": cnt,
                "density_per_1k": round(cnt / per_1k, 2),
                "examples": [w for w, _ in hits[:5]], "why": why,
            })
    for cat, patterns, why in REGEX_SIGNALS:
        cnt = sum(len(re.findall(p, text)) for p in patterns)
        if cnt:
            total_hits += cnt
            signals.append({
                "signal": cat, "hits": cnt,
                "density_per_1k": round(cnt / per_1k, 2),
                "examples": [], "why": why,
            })
    triples = detect_parallel_triples(_clean_sents_for_c2(full["sents"]))
    if triples:
        signals.append({
            "signal": "C2 排比三连（启发式）", "hits": len(triples),
            "density_per_1k": round(len(triples) / per_1k, 2),
            "examples": [], "why": "连续三短句等长，'听起来完整'的默认做法",
        })
        total_hits += len(triples)

    result["signals"] = sorted(signals, key=lambda s: -s["hits"])
    result["signal_density_per_1k"] = round(total_hits / per_1k, 2)

    # v0.3: 精修腔指标（针对"精 AI"：表面 AI 味被抹掉，仅剩排比/对称等修辞指纹）
    # 依据 2026-10-17《烬天行》（自声明 ChatGPT 生成）实测：C2 密度 1.98/千字
    # 为 5 本真书+AI 样本中最高（鲁迅 1.08，其余真书 ≤0.76）
    def _sig(prefix):
        return next((s for s in signals if s["signal"].startswith(prefix)), None)
    _c2, _c3, _b3, _b5 = _sig("C2"), _sig("C3"), _sig("B3"), _sig("B5")
    c2_dens = _c2["density_per_1k"] if _c2 else 0.0
    # 精修腔规则只在高置信度档（≥800字）生效：短文本下"每千字密度"会被单次命中放大
    # （如 213 字样本单次 C2 命中即 4.69/千字），与置信度分级哲学一致
    _long = chars >= 800
    polished_c2 = _long and c2_dens >= 1.2
    polished_combo = (_long and c2_dens >= 1.0 and _c3 is not None
                      and (_b3 is not None or _b5 is not None))

    paragraphs = [p for p in text.split("\n") if p.strip()]
    dups = detect_repetition(paragraphs)
    result["repetition"] = {"count": len(dups), "examples": dups}

    risks = []
    cp = result["punct"]["narration_comma_period"]
    if cp > 2.2:
        risks.append("逗号÷句号比偏高（叙述层 %.2f），长句堆砌嫌疑" % cp)
    if full["std"] < 6 and full["n"] >= 6:
        risks.append("句长标准差偏低（%.1f），节奏单一、模板化嫌疑" % full["std"])
    if result["clause"]["avg"] and result["clause"]["avg"] < 8 \
            and result["clause"]["n"] >= 10:
        risks.append("分句平均长度过短（%.1f 字），逗号碎句嫌疑"
                     % result["clause"]["avg"])
    if dups:
        risks.append("重复铺陈 %d 处（D5），水文/记忆缺失嫌疑" % len(dups))
    if polished_c2:
        risks.append("C2 排比密度 %.2f/千字 ≥1.2，'精修腔'弱信号" % c2_dens)
    if polished_combo:
        risks.append("精修腔组合（C2排比＋C3对称＋B3/B5修辞）命中，AI 润色嫌疑")
    result["risks"] = risks

    if platform and platform in PLATFORM_PROFILES:
        prof = PLATFORM_PROFILES[platform]
        dens = result["signal_density_per_1k"]
        verdict, reasons = "pass", []
        if dens >= prof["tell_fail"]:
            verdict = "fail"
            reasons.append("AI 腔信号密度 %.1f/千字 ≥ %d（%s）"
                           % (dens, prof["tell_fail"], prof["label"]))
        elif dens >= prof["tell_warn"]:
            verdict = "review"
            reasons.append("AI 腔信号密度 %.1f/千字，达预警线" % dens)
        if result["repetition"]["count"] >= 3 and prof.get("shuiwen_check"):
            if verdict != "fail":
                verdict = "review"
            reasons.append("重复铺陈 %d 处，起点水文治理高风险"
                           % result["repetition"]["count"])
        strong = any(s["signal"].startswith(("A1", "C2", "C6"))
                     for s in signals)
        # 强信号一票预警：只在密度已达预警线时触发，避免单个轻微排比句就 review
        # （校准集：human 样本单个 C2 命中密度 4.27/4.69，不应预警）
        if prof.get("strict") and strong and dens >= prof["tell_warn"]:
            reasons.append("番茄强信号命中（A1/C2/C6），'AI 粗制滥造'拒签风险")
            if verdict == "pass":
                verdict = "review"
        # v0.3 精修腔：弱信号，只推 review、不推 fail，不单独定罪
        if verdict == "pass" and (polished_c2 or polished_combo):
            verdict = "review"
            reasons.append("精修腔信号（C2排比密度%.2f/千字%s），建议人工复核"
                           % (c2_dens, "＋修辞组合" if polished_combo else ""))
        result["platform_verdict"] = {
            "platform": prof["label"],
            "policy": prof["policy"],
            "verdict": verdict,
            "reasons": reasons or ["机械指标未触发平台红线"],
            "focus": prof["focus"],
        }

    # 置信度：样本过短时"每千字密度"会被放大，不下重结论
    # （对齐 GitHub ai-detector-zh 原 skill"文本太短不下结论"的边界）
    chars = result["chars"]
    if chars < 200:
        confidence, cap = "low", "review"
        note = "样本过短（<200字），结论置信度低，仅供参考；建议用至少前3章重测"
    elif chars < 800:
        confidence, cap = "medium", None
        note = "样本较短，结论置信度中等"
    else:
        confidence, cap = "high", None
        note = ""
    if cap and platform and result.get("platform_verdict"):
        order = {"pass": 0, "review": 1, "fail": 2}
        pv = result["platform_verdict"]
        if order[pv["verdict"]] > order[cap]:
            pv["verdict"] = cap
            pv["reasons"].append(note)
    result["confidence"] = {"level": confidence, "note": note}
    return result


def main():
    args = sys.argv[1:]
    if not args or "-h" in args or "--help" in args:
        print(__doc__)
        sys.exit(0)
    platform = None
    if "--platform" in args:
        idx = args.index("--platform")
        platform = args[idx + 1]
        args = [a for a in args if a not in ("--platform", platform)]
    path = args[0]
    with open(path, encoding="utf-8") as f:
        text = f.read()
    result = analyze(text, platform)
    if "--json" in args:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    print("字数：%d  句子数：%d" % (result["chars"], result["sentence"]["n"]))
    p = result["punct"]
    print("逗号÷句号比：全文 %s / 叙述层 %s（台词占比 %s）"
          % (p["full_comma_period"], p["narration_comma_period"],
             p["dialogue_chars_ratio"]))
    print("平均句长：%s 字，标准差：%s"
          % (result["sentence"]["avg_len"], result["sentence"]["std"]))
    print("分句平均长度：%s 字（%s 个分句）"
          % (result["clause"]["avg"], result["clause"]["n"]))
    print("AI 腔信号密度：%s/千字" % result["signal_density_per_1k"])
    for s in result["signals"][:8]:
        print("  - %s: %d 次（%s/千字）例：%s"
              % (s["signal"], s["hits"], s["density_per_1k"], s["examples"][:3]))
    if result["repetition"]["count"]:
        print("重复铺陈：%d 处，例：%s"
              % (result["repetition"]["count"],
                 result["repetition"]["examples"][:2]))
    print("风险：%s" % (result["risks"] or "无"))
    if "platform_verdict" in result:
        v = result["platform_verdict"]
        print("【%s】口径：%s" % (v["platform"], v["policy"]))
        print("平台结论：%s；理由：%s" % (v["verdict"], v["reasons"]))
        print("本平台检测重点：%s" % "、".join(v["focus"]))


if __name__ == "__main__":
    main()
