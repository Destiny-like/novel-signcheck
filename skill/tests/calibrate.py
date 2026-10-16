#!/usr/bin/env python3
"""检测准确率校准：对 corpus 跑三平台检测，输出混淆矩阵与阈值分析。"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus"
SCRIPT = ROOT.parent / "scripts" / "ai_feel_check.py"

# 文件名 -> 期望标签
LABELS = {
    "human_urban": "human", "human_xianxia": "human", "human_daily": "human",
    "human_suspense": "human", "human_comedy": "human",
    "ai_xianxia": "ai", "ai_ceo": "ai", "ai_parallel": "ai",
    "ai_explain": "ai", "ai_mixed": "ai",
    "rev_xianxia": "revised", "rev_ceo": "revised", "rev_parallel": "revised",
}
# 期望结论：human->pass, ai->fail, revised->review 或 pass（审改后应显著好于 AI）
EXPECTED = {"human": "pass", "ai": "fail", "revised": ("review", "pass")}


def run_one(path: Path, platform: str) -> dict:
    out = subprocess.run(
        [sys.executable, str(SCRIPT), str(path), "--platform", platform, "--json"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def main() -> None:
    platform = sys.argv[1] if len(sys.argv) > 1 else "fanqie"
    print(f"# 校准报告（平台：{platform}）\n")
    print("| 样本 | 标签 | 字数 | 结论 | 密度/千字 | 信号数 | 是否符合期望 |")
    print("|---|---|---|---|---|---|---|")
    stats = {"tp": 0, "fp": 0, "tn": 0, "fn": 0}
    details = []
    for name, label in LABELS.items():
        p = CORPUS / f"{name}.txt"
        r = run_one(p, platform)
        v = r["platform_verdict"]["verdict"]
        exp = EXPECTED[label]
        ok = (v in exp) if isinstance(exp, tuple) else (v == exp)
        # 混淆矩阵（以 ai=fail 为正类）
        if label == "ai":
            stats["tp" if v == "fail" else "fn"] += 1
        elif label == "human":
            stats["tn" if v == "pass" else "fp"] += 1
        mark = "✓" if ok else "✗"
        print(f"| {name} | {label} | {r['chars']} | {v} | {r['signal_density_per_1k']} | "
              f"{len(r['signals'])} | {mark} |")
        details.append((name, label, r))
    n = stats["tp"] + stats["tn"] + stats["fp"] + stats["fn"]
    acc = (stats["tp"] + stats["tn"]) / n if n else 0
    print(f"\n- 混淆矩阵（ai=fail 为正类）：TP={stats['tp']} FN={stats['fn']} / TN={stats['tn']} FP={stats['fp']}")
    print(f"- 准确率：{acc:.0%}（{stats['tp']+stats['tn']}/{n}，revised 样本不计入）")
    print("\n## 误判样本明细")
    for name, label, r in details:
        exp = EXPECTED[label]
        ok = (r["platform_verdict"]["verdict"] in exp) if isinstance(exp, tuple) else (r["platform_verdict"]["verdict"] == exp)
        if not ok:
            sigs = ", ".join(f"{s['signal']}×{s['hits']}" for s in r["signals"][:4])
            print(f"- **{name}**（{label}→{r['platform_verdict']['verdict']}，密度 {r['signal_density_per_1k']}）：{sigs or '无信号'}")
            print(f"  风险：{'; '.join(r['risks']) or '无'}")
    print("\n## 密度分布（调阈值用）")
    for label in ("human", "revised", "ai"):
        ds = sorted(d["signal_density_per_1k"] for n_, l_, d in details if l_ == label for n_, l_ in [(n_, l_)])
        vals = [r["signal_density_per_1k"] for name, lab, r in details if lab == label]
        print(f"- {label}: {sorted(vals)}")


if __name__ == "__main__":
    main()
