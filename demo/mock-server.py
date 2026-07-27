#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地演示服务器：模拟一个带杂乱影视文件的 OpenList，用来预览 openlist-media 面板。

    python3 demo/mock-server.py          # http://127.0.0.1:8090
    python3 demo/mock-server.py 8091     # 换端口

打开浏览器访问后，点击右下角 🎬 按钮即可体验完整流程（扫描 → 解析 → 方案 → 执行 → 撤销）。
演示环境建议在「设置」里关闭 AI 与 TMDB（走本地规则解析，零依赖），或填入真实 Key 体验完整效果。
文件操作都发生在本进程内存里，不会碰任何真实文件。
"""
import json
import sys
import posixpath
from http.server import HTTPServer, BaseHTTPRequestHandler

GB = 1024 ** 3
MB = 1024 ** 2

# dir -> {name: {"size": int, "is_dir": bool}}
TREE = {}


def ensure_dir(path):
    if path in TREE:
        return
    TREE[path] = {}
    if path != "/":
        parent = posixpath.dirname(path) or "/"
        ensure_dir(parent)
        TREE[parent][posixpath.basename(path)] = {"size": 0, "is_dir": True}


def add_file(path, size):
    d = posixpath.dirname(path) or "/"
    ensure_dir(d)
    TREE[d][posixpath.basename(path)] = {"size": size, "is_dir": False}


ROOT = "/演示网盘/下载"
MSG = ROOT + "/【XX影视 www.ad-site.com】凡人修仙传 2020 4K"
for ep in (10, 11, 12):
    add_file(f"{MSG}/Fan.Ren.Xiu.Xian.Zhuan.2020.S01E{ep:02d}.2160p.WEB-DL.H265.AAC-DDHDTV.mp4", int(1.2 * GB))
add_file(MSG + "/凡人修仙传.S01E10.chs.srt", 60 * 1024)
add_file(MSG + "/最新电影 www.ad-site.com.txt", 1024)
add_file(ROOT + "/Interstellar.2014.IMAX.2160p.BluRay.x265.10bit.HDR-SWTYBLZ.mkv", 8 * GB)
add_file(ROOT + "/流浪地球2.The.Wandering.Earth.II.2023.2160p.WEB-DL.H265.DDP5.1-CHDWEB.mp4", 9 * GB)
for ep in (31, 32, 33):
    add_file(ROOT + f"/[GM-Team][国漫][斗破苍穹 年番][Fights Break Sphere][2022][{ep}][AVC][GB][1080P].mp4", 600 * MB)
for ep in (1, 2, 3):
    add_file(ROOT + f"/老友记 第一季/{ep:02d}.mp4", 500 * MB)
add_file(ROOT + "/赤壁(上).2008.BluRay.1080p.mkv", 4 * GB)
add_file(ROOT + "/sample.mkv", 30 * MB)
ensure_dir("/演示网盘/媒体库/电影")
ensure_dir("/演示网盘/媒体库/剧集")

PAGE = """<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>OpenList (演示) </title>
<style>
 body{margin:0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:#0b1220;color:#cbd5e1;min-height:100vh}
 .wrap{max-width:860px;margin:0 auto;padding:48px 20px}
 h1{font-size:20px;color:#fff} h1 span{color:#34d399}
 .card{background:#121a2a;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:18px 22px;margin-top:18px;line-height:2;font-size:14px}
 code{background:#1e293b;padding:2px 7px;border-radius:5px;font-size:12.5px;color:#7dd3fc}
 a{color:#34d399}
 .tree{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#94a3b8;line-height:1.9;white-space:pre}
</style></head>
<body>
<div class="wrap">
  <h1>📂 OpenList <span>演示环境</span> — openlist-media</h1>
  <div class="card">
    这是一个<b>内存模拟的 OpenList</b>（文件树见下）。已自动注入 <code>openlist-media.js</code> 并模拟登录。<br/>
    👉 点击右下角 <b>🎬 按钮</b>，目录填 <code>__ROOT__</code>，体验完整流程：扫描 → 解析 → 预览方案 → 执行 → 撤销。<br/>
    没配 AI/TMDB Key 时会自动走<b>本地规则解析</b>；也可以在「设置」里填入真实 Key 体验 AI + TMDB 效果（浏览器直连，注意网络）。
  </div>
  <div class="card tree">__TREE__</div>
</div>
<script>
  // 模拟 OpenList 登录 token（脚本据此判断"已登录"并挂载入口）
  localStorage.setItem("token", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkZW1vIjoxfQ.ZGVtb3NpZ25hdHVyZQ");
</script>
<script src="/openlist-media.js"></script>
</body></html>"""


def render_tree():
    lines = []

    def walk(d, indent):
        entries = sorted(TREE.get(d, {}).items(), key=lambda kv: (not kv[1]["is_dir"], kv[0]))
        for name, meta in entries:
            if meta["is_dir"]:
                lines.append(indent + "📁 " + name)
                walk(posixpath.join(d, name), indent + "   ")
            else:
                size = meta["size"]
                s = f"{size / GB:.1f}G" if size >= GB else (f"{size / MB:.0f}M" if size >= MB else f"{size}B")
                lines.append(indent + "   " + name + "  (" + s + ")")

    lines.append("/演示网盘")
    walk("/演示网盘", "  ")
    return "\n".join(lines)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json;charset=utf-8"):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _api(self, data=None, code=200, message="success"):
        self._send(200, json.dumps({"code": code, "message": message, "data": data}, ensure_ascii=False))

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def do_GET(self):
        if self.path == "/openlist-media.js":
            try:
                with open(posixpath.join(posixpath.dirname(__file__), "..", "dist", "openlist-media.js"), "rb") as f:
                    self._send(200, f.read(), "application/javascript;charset=utf-8")
            except OSError:
                self._send(404, "先运行 sh build.sh", "text/plain;charset=utf-8")
            return
        if self.path == "/api/me":
            self._api({"id": 1, "username": "demo", "role": 2})
            return
        page = PAGE.replace("__TREE__", render_tree()).replace("__ROOT__", ROOT)
        self._send(200, page, "text/html;charset=utf-8")

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except ValueError:
            self._api(None, 400, "bad json")
            return
        route = self.path

        if route == "/api/fs/list":
            path = (body.get("path") or "/").rstrip("/") or "/"
            if path not in TREE:
                self._api(None, 500, "object not found: " + path)
                return
            content = [
                {"name": n, "size": m["size"], "is_dir": m["is_dir"], "modified": "2026-01-01T00:00:00Z", "sign": "", "thumb": "", "type": 0}
                for n, m in sorted(TREE[path].items())
            ]
            self._api({"content": content, "total": len(content), "readme": "", "write": True, "provider": "demo"})
            return

        if route == "/api/fs/mkdir":
            ensure_dir((body.get("path") or "/").rstrip("/") or "/")
            self._api(None)
            return

        if route == "/api/fs/rename":
            path = body.get("path") or ""
            new = body.get("name") or ""
            d, name = posixpath.dirname(path) or "/", posixpath.basename(path)
            if d not in TREE or name not in TREE[d]:
                self._api(None, 500, "not found: " + path)
                return
            if new in TREE[d]:
                self._api(None, 500, "already exist: " + new)
                return
            TREE[d][new] = TREE[d].pop(name)
            if TREE[d][new]["is_dir"]:
                old_dir, new_dir = posixpath.join(d, name), posixpath.join(d, new)
                for key in [k for k in TREE if k == old_dir or k.startswith(old_dir + "/")]:
                    TREE[new_dir + key[len(old_dir):]] = TREE.pop(key)
            self._api(None)
            return

        if route == "/api/fs/batch_rename":
            src = (body.get("src_dir") or "/").rstrip("/") or "/"
            objs = body.get("rename_objects") or []
            if src not in TREE:
                self._api(None, 500, "dir not found")
                return
            for o in objs:
                if o["src_name"] not in TREE[src] or o["new_name"] in TREE[src]:
                    self._api(None, 500, "conflict/missing: " + o["src_name"])
                    return
            for o in objs:
                TREE[src][o["new_name"]] = TREE[src].pop(o["src_name"])
            self._api(None)
            return

        if route == "/api/fs/move":
            src = (body.get("src_dir") or "/").rstrip("/") or "/"
            dst = (body.get("dst_dir") or "/").rstrip("/") or "/"
            names = body.get("names") or []
            if src not in TREE or dst not in TREE:
                self._api(None, 500, "dir not found")
                return
            for n in names:
                if n not in TREE[src]:
                    self._api(None, 500, "not found: " + n)
                    return
                if n in TREE[dst]:
                    self._api(None, 500, "exist in dst: " + n)
                    return
            for n in names:
                TREE[dst][n] = TREE[src].pop(n)
            self._api(None)
            return

        if route == "/api/fs/remove_empty_directory":
            src = (body.get("src_dir") or "/").rstrip("/") or "/"
            changed = True
            while changed:
                changed = False
                for d in [k for k in list(TREE) if k.startswith(src + "/")]:
                    if d in TREE and not TREE[d]:
                        parent = posixpath.dirname(d) or "/"
                        TREE.pop(d)
                        TREE.get(parent, {}).pop(posixpath.basename(d), None)
                        changed = True
            self._api(None)
            return

        self._api(None, 404, "no such api: " + route)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    print(f"OpenList 演示环境: http://127.0.0.1:{port}  （Ctrl+C 退出）")
    print(f"演示目录: {ROOT}")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
