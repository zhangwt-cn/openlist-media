#!/bin/sh
# 构建：把 src/*.js 按序拼接为单文件 IIFE
#   dist/openlist-media.js      —— 可外链引用（<script src=...>）
#   dist/custom-content.html    —— 可整段粘贴到 OpenList 设置→全局→自定义内容
set -e
cd "$(dirname "$0")"
VERSION=$(sed -n 's/.*OLM_VERSION = "\([^"]*\)".*/\1/p' src/01-consts.js | head -1)
OUT=dist/openlist-media.js
mkdir -p dist
{
  printf '/*! openlist-media v%s | OpenList 影视智能整理（纯前端脚本）| 安装: OpenList 管理后台→设置→全局→自定义头部/自定义内容 */\n' "$VERSION"
  printf '(function () {\n"use strict";\n'
  for f in src/[0-9]*.js; do
    printf '\n/* ==== %s ==== */\n' "$f"
    cat "$f"
  done
  printf '\n})();\n'
} > "$OUT"
{ printf '<script>\n'; cat "$OUT"; printf '</script>\n'; } > dist/custom-content.html
echo "built $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes, version $VERSION)"
