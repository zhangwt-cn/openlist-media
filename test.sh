#!/bin/sh
# 构建并运行单元测试（macOS 自带 JavaScriptCore，无需 node）
set -e
cd "$(dirname "$0")"
sh build.sh
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
if [ ! -x "$JSC" ]; then
  JSC=$(command -v jsc || true)
fi
if [ -z "$JSC" ]; then
  echo "未找到 jsc（JavaScriptCore shell）"; exit 1
fi
out=$("$JSC" dist/openlist-media.js tests/core.test.js 2>&1) || { echo "$out"; echo "== jsc 非零退出"; exit 1; }
echo "$out"
echo "$out" | grep -q "ALL TESTS PASSED" || { echo "== 测试失败（未见通过哨兵）"; exit 1; }
