/*
 * openlist-media —— OpenList 影视智能整理（纯前端）
 *
 * 通过 OpenList「自定义头部/自定义内容」注入页面，在浏览器内完成：
 *   扫描目录 → AI/本地解析文件名 → TMDB 元数据校准 → 生成 Emby 规范重命名方案
 *   → 人工预览确认 → 限速执行（mkdir/rename/move）→ 记录任务、支持撤销
 *
 * 数据形状约定（贯穿全部模块）：
 *   FileEntry  = { path, dir, name, size, ext, kind: video|subtitle|meta|other, relPath, depth }
 *   Parsed     = { type: movie|tv|extra|junk|unknown, title, originalTitle, year, season,
 *                  episode, episodeEnd, resolution, version, part, lang, confidence, from }
 *   Group      = { id, type, title, year, season?, tmdb: {id,title,originalTitle,year,posterPath,
 *                  overview, seasons:{[n]:{[ep]:name}}}|null, matchStatus, note }
 *   PlanItem   = { id, groupId, file: FileEntry, parsed: Parsed, dstDir, dstName,
 *                  action: move|rename|trash|none, include, status: ok|same|conflict|excluded,
 *                  reason, edited }
 *   Task       = { id, createdAt, root, status: ready|executing|done|partial|failed|undone,
 *                  stats, items, ops: [{t:mkdir|rename|move, ...}], log: [] }
 */

var OLM_VERSION = "0.1.0";

var OLM_KEYS = {
  settings: "olm.settings",
  tasks: "olm.tasks",
  tmdbCache: "olm.tmdb.cache"
};

var VIDEO_EXTS = {
  mkv: 1, mp4: 1, ts: 1, m2ts: 1, avi: 1, mov: 1, wmv: 1, flv: 1, webm: 1,
  mpg: 1, mpeg: 1, rmvb: 1, rm: 1, m4v: 1, vob: 1, iso: 1, strm: 1
};

var SUB_EXTS = { srt: 1, ass: 1, ssa: 1, sub: 1, sup: 1, vtt: 1, smi: 1 };

var META_EXTS = { nfo: 1, jpg: 1, jpeg: 1, png: 1, webp: 1, tbn: 1, xml: 1 };

var JUNK_EXTS = {
  txt: 1, url: 1, html: 1, htm: 1, apk: 1, exe: 1, torrent: 1, lnk: 1,
  db: 1, ini: 1, ds_store: 1, js: 1, bat: 1, docx: 1, doc: 1, pdf: 1
};

// 扫描时整目录跳过
var IGNORE_DIR_NAMES = {
  "@eadir": 1, "#recycle": 1, ".recycle": 1, "bdmv": 1, "video_ts": 1,
  "certificate": 1, "$recycle.bin": 1, "system volume information": 1,
  "extras": 1, ".actors": 1
};

var OLM_DEFAULT_SETTINGS = {
  general: {
    // 留空则自动从 localStorage 读取 OpenList 登录 token
    tokenOverride: "",
    // 留空则使用当前站点（同源注入场景）
    baseUrl: ""
  },
  ai: {
    enabled: true,
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat",
    temperature: 0.1,
    batchSize: 25,
    concurrency: 2,
    jsonMode: true,
    timeoutMs: 120000
  },
  tmdb: {
    enabled: true,
    apiKey: "",
    language: "zh-CN",
    baseUrl: "https://api.themoviedb.org",
    imageBaseUrl: "https://image.tmdb.org",
    showPosters: true,
    timeoutMs: 20000
  },
  naming: {
    includeTmdbId: true,
    tmdbTag: "[tmdbid={id}]",     // Emby 识别的 provider id 标记，写在文件夹名里
    includeResolution: true,       // 电影文件名附加 " - 2160p"
    includeVersion: true,          // 电影文件名附加 " - 导演剪辑" 等版本标记
    includeEpTitle: true,          // 剧集文件名附加 " - 集标题"（来自 TMDB）
    seasonFolder: "Season {season2}",
    normalizeSubLang: true         // 字幕语言标签规范化为 .chs/.cht/.eng 等
  },
  organize: {
    recursive: true,
    maxDepth: 8,
    maxFiles: 2000,
    minVideoMB: 50,                // 小于此体积且无季集信息的视频视为疑似垃圾/样片
    junkAction: "ignore",          // ignore | trash
    trashDirName: ".整理回收站",
    cleanEmptyDirs: false,         // 执行完成后调用 remove_empty_directory 清理空目录
    targetMode: "inplace",         // inplace: 在扫描目录内整理; custom: 移动到指定媒体库目录
    movieDir: "",
    tvDir: ""
  },
  exec: {
    intervalMs: 400,               // 每次写操作之间的间隔（网盘限流保护）
    retries: 2,
    useBatchRename: true
  },
  ui: {
    fabSide: "right"               // right | left
  }
};
