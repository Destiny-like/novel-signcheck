#!/usr/bin/env python3
"""把 signcheck-web 打包成单文件 HTML（双击即开，不依赖 http server）。

原理：ES module 在 file:// 下会因 CORS 加载失败，导致页面动态内容全空白。
本脚本把 styles.css 内联为 <style>，把 data.js + detector.js + nodes/*.js + app.js
（去掉 import/export）合并内联为单个 <script>。
源码继续用多文件维护，发布时跑本脚本即可。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)


def strip_module_js(path: Path) -> str:
    src = path.read_text(encoding="utf-8")
    # 去掉 import 行（含 from "./nodes/xxx.js" 多行 import）
    src = re.sub(r"^import\s+[\s\S]*?;\s*$", "", src, flags=re.M)
    # export [async] function f -> [async] function f ；export const X -> const X
    src = re.sub(r"^export\s+(?=(?:async\s+)?(?:const|let|var|function|class))", "", src, flags=re.M)
    return src.strip()


def main() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")

    node_files = sorted((ROOT / "nodes").glob("*.js"))
    bundle = "\n\n".join(
        ['"use strict";', strip_module_js(ROOT / "data.js"),
         strip_module_js(ROOT / "detector.js")]
        + [strip_module_js(p) for p in node_files]
        + [strip_module_js(ROOT / "app.js")]
    )

    html = html.replace(
        '<link rel="stylesheet" href="styles.css">',
        "<style>\n" + css + "\n</style>",
    )
    html = re.sub(
        r'<script\s+type="module"\s+src="app\.js"></script>',
        lambda _: "<script>\n" + bundle + "\n</script>",
        html,
    )
    assert "app.js" not in html and "styles.css" not in html, "还有外部引用未内联！"

    out = DIST / "签约前自查-单文件版.html"
    out.write_text(html, encoding="utf-8")
    print(f"OK -> {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
