#!/bin/sh
# 发布：测试构建 → 提交源码(main) → 把产物做成孤儿 release 分支的提交并打 tag → 推送 → 刷新 jsDelivr
#   sh release.sh
# main 分支只有源码；构建产物只存在于 release 分支（openlist-media.js / custom-content.html 两个文件）。
# 发新版本前先修改 src/01-consts.js 里的 OLM_VERSION。
set -e
cd "$(dirname "$0")"

sh test.sh

VERSION=$(sed -n 's/.*OLM_VERSION = "\([^"]*\)".*/\1/p' src/01-consts.js | head -1)

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "尚未配置远程仓库。先在 GitHub 新建一个【公开】仓库（jsDelivr 只支持公开仓库），然后执行："
  echo "  git remote add origin git@github.com:<你的用户名>/openlist-media.git"
  echo "再重新运行 sh release.sh"
  exit 1
fi

# 1) 源码提交到 main
git add -A
if git diff --cached --quiet; then
  echo "源码无改动"
else
  git commit -m "v$VERSION"
fi

# 2) 产物做成 release 分支提交（git 底层命令，不切分支、不动工作区）
git fetch origin release:refs/remotes/origin/release 2>/dev/null || true
PARENT=$(git rev-parse -q --verify refs/heads/release 2>/dev/null || git rev-parse -q --verify refs/remotes/origin/release 2>/dev/null || true)

B1=$(git hash-object -w dist/custom-content.html)
B2=$(git hash-object -w dist/openlist-media.js)
TREE=$(printf '100644 blob %s\tcustom-content.html\n100644 blob %s\topenlist-media.js\n' "$B1" "$B2" | git mktree)

if [ -n "$PARENT" ] && [ "$(git rev-parse "$PARENT^{tree}")" = "$TREE" ]; then
  echo "产物与上次发布相同，release 分支不新增提交"
  COMMIT=$PARENT
elif [ -n "$PARENT" ]; then
  COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "release v$VERSION")
else
  COMMIT=$(git commit-tree "$TREE" -m "release v$VERSION")
fi
git update-ref refs/heads/release "$COMMIT"

if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  echo "标签 v$VERSION 已存在（发新版请先改 src/01-consts.js 的 OLM_VERSION）"
else
  git tag "v$VERSION" "$COMMIT"
fi

# 3) 推送
git push -u origin main release --tags

REPO=$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')

echo "刷新 jsDelivr 的 @release 缓存（分支引用有约 12 小时缓存）…"
curl -fsS 'https://purge.jsdelivr.net/gh/'"$REPO"'@release/openlist-media.js' >/dev/null 2>&1 || echo "（purge 请求失败，不影响 @v 版本地址）"

echo
echo "================ 外链地址（粘到 OpenList 管理后台 → 设置 → 全局 → 自定义头部）================"
echo
echo "固定版本（推荐，永久缓存、加载最快；升级时重跑本脚本后换新版本号）："
printf '%s\n' '  <script src="https://cdn.jsdelivr.net/gh/'"$REPO"'@v'"$VERSION"'/openlist-media.js" defer></script>'
echo
echo "大陆网络备选镜像（cdn 主域不稳时任选其一，路径不变）："
printf '%s\n' '  <script src="https://fastly.jsdelivr.net/gh/'"$REPO"'@v'"$VERSION"'/openlist-media.js" defer></script>'
printf '%s\n' '  <script src="https://gcore.jsdelivr.net/gh/'"$REPO"'@v'"$VERSION"'/openlist-media.js" defer></script>'
echo
echo "跟随最新发布（设置只填一次，以后发版自动生效；有最长 12 小时 CDN 缓存延迟）："
printf '%s\n' '  <script src="https://cdn.jsdelivr.net/gh/'"$REPO"'@release/openlist-media.js" defer></script>'
echo
echo "=========================================================================================="
