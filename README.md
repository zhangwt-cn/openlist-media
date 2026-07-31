# openlist-media — OpenList 影视智能整理（纯前端）

> 项目地址：<https://github.com/zhangwt-cn/openlist-media>

一段注入 OpenList「自定义头部/自定义内容」的纯前端脚本：在 OpenList 页面里直接对网盘中的影视文件做
**AI 解析 → TMDB 元数据校准 → Emby 规范重命名**，全程预览确认、限速执行、支持一键撤销。

无需额外部署任何服务 —— 浏览器内同源调用 OpenList 自身 API（`fs/list / rename / batch_rename / move / mkdir`），
天然支持 OpenList 挂载的所有存储（阿里云盘、115、夸克、百度、本地……）。

## 特性

- 🤖 **AI 文件名解析**：任意 OpenAI 兼容接口（DeepSeek / 通义 / Kimi / GPT / 中转网关），把
  `【XX影视 www.xx.com】凡人修仙传[第10集].Fan.Ren.Xiu.Xian.Zhuan.2020.S01E10.2160p.WEB-DL.mp4`
  解析成 `剧名/年份/季/集/分辨率/版本`；**未配 AI 也能用**（内置规则解析引擎兜底，去水印、中文数字集数、拼音文件名取父目录中文名等）
- 🎯 **TMDB 校准**：官方译名、年份、TMDB ID、集标题；低置信度可手动搜索重新匹配；支持自定义 API 镜像地址（大陆网络友好）
- 📁 **Emby 规范命名**：
  - 电影：`流浪地球2 (2023) [tmdbid=842675]/流浪地球2 (2023) - 2160p.mkv`
  - 剧集：`凡人修仙传 (2020) [tmdbid=100565]/Season 01/凡人修仙传 - S01E10 - 重返七玄门.mp4`
  - 字幕自动跟随视频命名并规范语言标签（`.chs/.cht/.eng`）
- ✅ **先预览后执行**：分组卡片（含海报）逐条展示 原路径 → 新路径，可勾选、可手改、冲突自动标红
- 🐢 **网盘友好**：写操作限速（默认 400ms 间隔）、失败重试、批量重命名接口降低请求数
- ↩️ **可撤销**：每次执行记录完整操作日志，一键逆序回放撤销；垃圾文件只移入回收站目录，**不调用删除接口**
- 🧪 176 条断言的单元测试覆盖解析/命名/冲突/执行/撤销核心逻辑

## 安装

任选其一（都在 OpenList **管理后台 → 设置 → 全局**）：

### 方式 A：直接引用本项目 CDN 地址（零构建零部署，推荐）

在「自定义头部」加入一行，保存后刷新前台即可：

```html
<script src="https://cdn.jsdelivr.net/gh/zhangwt-cn/openlist-media@v0.1.1/openlist-media.js" defer></script>
```

- 大陆网络 `cdn.jsdelivr.net` 不稳时换镜像域名（路径不变）：`fastly.jsdelivr.net` / `gcore.jsdelivr.net`
- 想「设置只填一次、升级自动生效」就用跟随最新版的地址（有最长 12 小时 CDN 缓存延迟）：

```html
<script src="https://cdn.jsdelivr.net/gh/zhangwt-cn/openlist-media@release/openlist-media.js" defer></script>
```

### 方式 B：内联粘贴 custom-content.html（内网 / 不想依赖外部 CDN）

`custom-content.html` 就是构建产物 `openlist-media.js` 外面包了一层 `<script>…</script>` 的**可直接粘贴版本**，
专供此方式使用——适合 OpenList 部署在内网、访客网络到不了公共 CDN、或不想引入任何外链的场景，功能与方式 A 完全一致。

把它的**全部内容**粘贴到「自定义内容」，保存后刷新。获取途径二选一：

- 从仓库 [`release` 分支](https://github.com/zhangwt-cn/openlist-media/tree/release) 下载现成的
- 本地构建：`sh build.sh` 后取 `dist/custom-content.html`

> 内容约 170KB。SQLite（默认）部署没问题；若 OpenList 用 MySQL 且保存后不生效，多半是设置字段长度受限，请改用方式 A。
> 缺点是升级需要重新粘贴。

### 方式 C：Fork 自行托管（二次开发）

Fork 本仓库，改完代码 `git push` 即完成发布——内置 GitHub Actions 会自动
测试→构建→把产物发布到你自己仓库的孤儿 `release` 分支→按 `src/01-consts.js` 的 `OLM_VERSION` 打 tag→刷新 jsDelivr 缓存
（`main` 始终只有源码，`dist/` 不入库；`release.sh` 是 CI 不可用时的本地等价脚本）。
然后把方式 A 地址里的用户名换成你自己的即可。

也可以把构建出的 `openlist-media.js` 上传到 OpenList 挂载的目录，用 `/d/xxx/openlist-media.js` 直链在「自定义头部」引用
（若开启「签名所有」，`/d/` 直链会因缺签名而加载失败，需将该目录设为公开且关闭签名）。

安装后，**已登录用户**会在页面右下角看到 🎬 悬浮按钮（未登录访客看不到入口）。按钮可**直接拖动**到任意位置并自动记住；设置里切换「左下/右下」可复位。

## 快速开始

1. 点 🎬 打开面板 → **设置**：
   - **AI 解析**：填 OpenAI 兼容接口。DeepSeek 示例：`base_url = https://api.deepseek.com/v1`，`model = deepseek-chat`；OpenAI 官方：`base_url = https://api.openai.com/v1`（只填域名会自动补 `/v1`，填完整 `/chat/completions` 地址也行），`model = gpt-4o-mini` 等。填入 API Key，点「测试 AI」
   - **TMDB**：到 [themoviedb.org](https://www.themoviedb.org/settings/api) 免费申请 API Key（v3 key 或 v4 令牌都支持）。大陆网络直连不通时把「API 地址」换成你的反代/镜像。点「测试 TMDB」
   - 都不配也能用：走本地规则解析（识别率低一些，无集标题）
2. 回到**整理**页：目录默认取当前 OpenList 浏览路径，也可「浏览…」选择 → **扫描并生成整理方案**
3. 预览方案：按影片分组展示，逐条 原路径 → 新路径；不想动的取消勾选；识别错的点「🔎 重新匹配」手动搜 TMDB，或点 ✎ 手改目标路径
4. **执行**：按设置的间隔限速执行；完成后可在**记录**页随时**撤销**本次整理

## 设置说明（节选）

| 设置 | 说明 |
| --- | --- |
| 整理位置 | 默认「就地整理」（在扫描目录内建规范结构）；可切换为移动到指定电影库/剧集库目录。**跨网盘移动走服务器中转，大文件很慢，建议目标与源同盘** |
| 垃圾文件处理 | 广告 txt/url/html、样片等：默认忽略；可选移入 `.整理回收站`（不会删除任何文件） |
| 写操作间隔 | 网盘限流保护。115/夸克等风控严格的建议 ≥ 500ms |
| ID 标记格式 | Emby 用 `[tmdbid=xxx]`；Jellyfin 用户可改成 `[tmdbid-xxx]` |
| 疑似样片阈值 | 小于该体积且无季集信息的视频归入「花絮/样片」不参与整理 |
| Token 覆盖 | 脚本自动读取当前登录 token；特殊部署读不到时手动粘贴（管理后台 → 设置 → 其他 → 令牌） |

设置（含 API Key）保存在**当前浏览器 localStorage**，不会上传到任何地方；支持导出/导入迁移。

## 配合 Emby

- Emby 媒体库把「电影」「电视剧」分别指向整理后的目录；刮削语言选中文
- 文件夹名中的 `[tmdbid=xxx]` 会让 Emby **精确锁定条目**，基本杜绝刮削错片
- 建议关闭 Emby 的"实时监控"批量整理，整理完手动扫描一次

## 本地演示（不碰真实文件）

```sh
sh build.sh
python3 demo/mock-server.py     # 打开 http://127.0.0.1:8090
```

内置一批典型的杂乱文件（国漫多集、拼音剧集、广告文件、上下部电影、samples……），
可以完整体验 扫描 → 方案 → 执行 → 撤销。全部操作发生在演示进程内存里。

## 开发

```
src/            按序号拼接的源码分片（01 常量 … 15 启动）
build.sh        拼接为 dist/openlist-media.js（IIFE 单文件，零依赖；dist/ 不入 git）
test.sh         构建 + 运行单元测试（用 macOS 自带 JavaScriptCore，无需 node）
release.sh      本地手动发布（CI 的备用）：产物以 git 底层命令写入孤儿 release 分支并打 tag
.github/        push main 即自动发布的 workflow（ubuntu 上用 node 跑同一套测试）
tests/          核心逻辑测试（解析/命名/分组/冲突/执行/撤销）
demo/           OpenList 模拟服务器（python3 标准库）
```

浏览器控制台可通过 `window.__OLM__` 访问全部内部函数（如 `__OLM__.localParseFile("path/文件.mkv", {})`）调试解析效果。

## FAQ

- **看不到 🎬 按钮？** 只有已登录用户可见；确认已登录并刷新。仍不行则在设置里手动填 Token 覆盖（方式：先临时用方式 A 注入后进设置，或直接改 localStorage `olm.settings`）。
- **🎬 按钮挡住了 OpenList 自带的侧栏图标？** 直接把按钮拖走即可，位置自动记住；设置 → 悬浮按钮位置 切换左右可复位。
- **AI 报跨域/CORS 错误？** 浏览器直连要求 AI 服务允许 CORS。DeepSeek / OpenAI 等主流服务支持；个别自建网关需开启 CORS 允许来源。
- **用 gpt-5 / o 系列模型报 temperature 参数错误？** 已自动处理：脚本检测到会去掉该参数重试并记住，无需手动设置。
- **TMDB 连不上？** 大陆网络需反代/镜像，把「API 地址」「图片地址」换成镜像；或在能访问的网络环境使用。
- **115/夸克执行到一半报限流？** 调大「写操作间隔」（如 800–1500ms），失败的条目会在结果里列出，可重新扫描再执行剩余部分。
- **加密/密码目录？** 暂不支持带 meta 密码的目录（列目录会报错）。
- **长篇动漫绝对集数（第 300 集）？** 会按解析出的季集命名，但 TMDB 分季集标题可能对不上——这类目录建议人工核对方案后再执行。
- **原盘目录（BDMV/VIDEO_TS）？** 自动跳过，不参与整理。
- **撤销的边界？** 撤销 = 逆序回放操作日志（移回 + 改回名）。若撤销前你又手动动过这些文件，对应步骤会失败并列出明细；创建的空目录不会自动删（可用「清理空目录」选项）。
- **访客会受影响吗？** 脚本对所有访客注入（OpenList 自定义内容机制决定），但入口只对登录用户显示；你的 API Key 存在你自己浏览器的 localStorage 里，不会随脚本分发。

## 安全边界

- 只调用 `mkdir / rename / batch_rename / move / remove_empty_directory(可选)`，**从不调用删除文件接口**
- 所有写操作先经人工预览确认；执行有操作日志与撤销
- 冲突检测：方案内互撞、与目标位置现存文件相撞的条目会标红并默认不执行

---

MIT License · 与 OpenListTeam 无隶属关系 · v0.1.1
