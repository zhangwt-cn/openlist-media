/*! openlist-media v0.1.4 | OpenList 影视智能整理（纯前端脚本）| 安装: OpenList 管理后台→设置→全局→自定义头部/自定义内容 */
(function () {
"use strict";

/* ==== src/01-consts.js ==== */
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

var OLM_VERSION = "0.1.4";

var OLM_KEYS = {
  settings: "olm.settings",
  tasks: "olm.tasks",
  tmdbCache: "olm.tmdb.cache",
  fabPos: "olm.fabpos"
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

/* ==== src/02-utils.js ==== */
/* ==== 通用工具 ==== */

// jsc 等环境没有 console
function olmLog() {
  try {
    if (typeof console !== "undefined" && console.log) {
      console.log.apply(console, ["[olm]"].concat([].slice.call(arguments)));
    } else if (typeof print === "function") {
      print("[olm] " + [].slice.call(arguments).join(" "));
    }
  } catch (e) { /* ignore */ }
}

function olmSleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

var _uidSeq = 0;
function olmUid(prefix) {
  _uidSeq += 1;
  return (prefix || "id") + "_" + Date.now().toString(36) + "_" + _uidSeq.toString(36) +
    "_" + Math.floor(Math.random() * 1e6).toString(36);
}

function olmNowIso() {
  return new Date().toISOString();
}

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtSize(bytes) {
  var n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  var units = ["KB", "MB", "GB", "TB"];
  var i = -1;
  do { n /= 1024; i += 1; } while (n >= 1024 && i < units.length - 1);
  return (n >= 100 ? Math.round(n) : n.toFixed(1)) + " " + units[i];
}

/* ---- 路径 ---- */

function pathJoin(dir, name) {
  var d = String(dir == null ? "" : dir);
  var n = String(name == null ? "" : name);
  if (!d || d === "/") return "/" + n.replace(/^\/+/, "");
  return d.replace(/\/+$/, "") + "/" + n.replace(/^\/+/, "");
}

function pathDir(p) {
  var s = String(p || "").replace(/\/+$/, "");
  var i = s.lastIndexOf("/");
  if (i <= 0) return "/";
  return s.slice(0, i);
}

function pathName(p) {
  var s = String(p || "").replace(/\/+$/, "");
  var i = s.lastIndexOf("/");
  return i === -1 ? s : s.slice(i + 1);
}

// 扩展名（小写、不带点）；无扩展名返回 ""
function pathExt(name) {
  var s = String(name || "");
  var i = s.lastIndexOf(".");
  if (i <= 0 || i === s.length - 1) return "";
  var ext = s.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,9}$/.test(ext) ? ext : "";
}

function pathStem(name) {
  var ext = pathExt(name);
  return ext ? String(name).slice(0, String(name).length - ext.length - 1) : String(name || "");
}

/* ---- 文件名清理 ---- */

// Windows/网盘非法字符处理：冒号转全角，其余剔除
function sanitizeFileName(s) {
  var out = String(s == null ? "" : s)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\/\\]/g, " ")
    .replace(/:/g, "：")
    .replace(/[*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .replace(/^\.+/, "");
  if (!out || out === "..") out = "_";
  return out;
}

// 模板拼接后清理悬空符号：空括号、重复/收尾的连接符
function cleanupName(s) {
  var out = String(s == null ? "" : s);
  var prev = null;
  while (prev !== out) {
    prev = out;
    out = out
      .replace(/\(\s*\)/g, " ")
      .replace(/\[\s*\]/g, " ")
      .replace(/【\s*】/g, " ")
      .replace(/(\s*-\s*){2,}/g, " - ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-–—_.,]+/, "")
      .replace(/[\s\-–—_,]+$/, "")
      .trim();
  }
  return out;
}

// 分组/比较用的标题归一化
function titleKey(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[\s\.\-_:：·・,，'"!！?？~～&＆+（）()\[\]【】《》<>丨|]/g, "")
    .trim();
}

/* ---- 中文数字 ---- */

var CN_DIGITS = { "零": 0, "〇": 0, "一": 1, "壹": 1, "二": 2, "两": 2, "贰": 2, "三": 3, "叁": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
var CN_UNITS = { "十": 10, "拾": 10, "百": 100, "佰": 100, "千": 1000 };

function cnNumToInt(s) {
  if (s == null) return null;
  var str = String(s).trim()
    .replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  var total = 0, cur = 0, any = false;
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (ch in CN_DIGITS) { cur = cur * 10 + CN_DIGITS[ch]; any = true; }
    else if (ch in CN_UNITS) { total += (cur || 1) * CN_UNITS[ch]; cur = 0; any = true; }
    else return null;
  }
  return any ? total + cur : null;
}

function pad2(n) {
  n = parseInt(n, 10) || 0;
  return (n < 10 && n >= 0 ? "0" : "") + n;
}

/* ---- 存储（jsc/无痕环境降级为内存） ---- */

var olmStorage = (function () {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      localStorage.setItem("olm.__probe", "1");
      localStorage.removeItem("olm.__probe");
      return localStorage;
    }
  } catch (e) { /* fallthrough */ }
  var mem = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; },
    get length() { return Object.keys(mem).length; },
    key: function (i) { return Object.keys(mem)[i] || null; }
  };
})();

function lsGetJSON(key, def) {
  try {
    var raw = olmStorage.getItem(key);
    if (raw == null || raw === "") return def;
    var v = JSON.parse(raw);
    return v == null ? def : v;
  } catch (e) { return def; }
}

function lsSetJSON(key, val) {
  try { olmStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { olmLog("storage full?", e && e.message); return false; }
}

/* ---- 对象工具 ---- */

function isPlainObj(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

// 用 base 的形状兜底 over 缺失的键（设置合并）
function deepMerge(base, over) {
  if (!isPlainObj(base)) return over === undefined ? base : over;
  var out = {};
  var k;
  for (k in base) {
    if (isPlainObj(base[k])) out[k] = deepMerge(base[k], isPlainObj(over) ? over[k] : undefined);
    else out[k] = isPlainObj(over) && over[k] !== undefined ? over[k] : base[k];
  }
  if (isPlainObj(over)) {
    for (k in over) if (!(k in out)) out[k] = over[k];
  }
  return out;
}

function deepClone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function classifyExt(ext) {
  if (VIDEO_EXTS[ext]) return "video";
  if (SUB_EXTS[ext]) return "subtitle";
  if (META_EXTS[ext]) return "meta";
  return "other";
}

/* ==== src/03-settings.js ==== */
/* ==== 设置 ==== */

var olmSettingsCache = null;

function olmGetSettings() {
  if (!olmSettingsCache) {
    olmSettingsCache = deepMerge(OLM_DEFAULT_SETTINGS, lsGetJSON(OLM_KEYS.settings, {}));
  }
  return olmSettingsCache;
}

function olmSaveSettings(s) {
  olmSettingsCache = deepMerge(OLM_DEFAULT_SETTINGS, s || {});
  lsSetJSON(OLM_KEYS.settings, olmSettingsCache);
  return olmSettingsCache;
}

function olmResetSettings() {
  olmSettingsCache = deepClone(OLM_DEFAULT_SETTINGS);
  lsSetJSON(OLM_KEYS.settings, olmSettingsCache);
  return olmSettingsCache;
}

function olmExportSettings() {
  var s = deepClone(olmGetSettings());
  return JSON.stringify(s, null, 2);
}

function olmImportSettings(text) {
  var v = JSON.parse(text);
  if (!isPlainObj(v)) throw new Error("不是有效的设置 JSON");
  return olmSaveSettings(v);
}

// OpenList 登录 token：设置覆盖 > localStorage["token"] > 扫描疑似 JWT
function findOpenListToken(settings) {
  var s = settings || olmGetSettings();
  var o = s.general && s.general.tokenOverride;
  if (o && String(o).trim()) return String(o).trim();
  try {
    var direct = olmStorage.getItem("token");
    if (direct) {
      direct = String(direct).trim().replace(/^"+|"+$/g, "");
      if (direct.length > 20) return direct;
    }
    for (var i = 0; i < olmStorage.length; i++) {
      var k = olmStorage.key(i);
      if (!k || k.indexOf("olm.") === 0) continue;
      var v = olmStorage.getItem(k);
      if (!v) continue;
      v = String(v).trim().replace(/^"+|"+$/g, "");
      if (/^ey[\w-]{10,}\.[\w-]+\.[\w-]+$/.test(v)) return v;
    }
  } catch (e) { /* ignore */ }
  return "";
}

function olmApiBase(settings) {
  var s = settings || olmGetSettings();
  var o = s.general && s.general.baseUrl;
  if (o && String(o).trim()) return String(o).trim().replace(/\/+$/, "");
  if (typeof location !== "undefined" && location.origin) return location.origin;
  return "";
}

/* ==== src/04-openlist.js ==== */
/* ==== OpenList API 客户端 ==== */

function OlmError(message, code) {
  this.name = "OlmError";
  this.message = String(message || "未知错误");
  this.code = code == null ? -1 : code;
  this.stack = (new Error(this.message)).stack;
}
OlmError.prototype = Object.create(Error.prototype);
OlmError.prototype.constructor = OlmError;

function OlmAuthError(message) {
  OlmError.call(this, message || "未登录或登录已过期", 401);
  this.name = "OlmAuthError";
}
OlmAuthError.prototype = Object.create(OlmError.prototype);
OlmAuthError.prototype.constructor = OlmAuthError;

/*
 * opts: {
 *   getBaseUrl: () => string,
 *   getToken:   () => string,
 *   fetchFn:    可注入（测试/mock）,
 *   timeoutMs
 * }
 */
function createOpenListClient(opts) {
  opts = opts || {};
  var fetchFn = opts.fetchFn ||
    (typeof fetch !== "undefined"
      ? fetch.bind(typeof window !== "undefined" ? window : globalThis)
      : null);
  var getToken = opts.getToken || function () { return findOpenListToken(); };
  var getBaseUrl = opts.getBaseUrl || function () { return olmApiBase(); };
  var timeoutMs = opts.timeoutMs || 60000;

  async function req(apiPath, body, o) {
    o = o || {};
    if (!fetchFn) throw new OlmError("当前环境没有 fetch");
    var url = String(getBaseUrl() || "").replace(/\/+$/, "") + apiPath;
    var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, o.timeoutMs || timeoutMs) : null;
    var resp;
    try {
      resp = await fetchFn(url, {
        method: o.method || "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Authorization": getToken() || ""
        },
        body: (o.method === "GET") ? undefined : JSON.stringify(body || {}),
        signal: ctl ? ctl.signal : undefined
      });
    } catch (e) {
      throw new OlmError("请求 OpenList 失败: " + ((e && e.message) || e), 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (resp.status === 401) throw new OlmAuthError();
    var data = null;
    try { data = await resp.json(); }
    catch (e) { throw new OlmError("OpenList 响应不是 JSON (HTTP " + resp.status + ")", resp.status); }
    if (!data || typeof data.code === "undefined") {
      throw new OlmError("OpenList 响应格式异常 (HTTP " + resp.status + ")", resp.status);
    }
    if (data.code === 401) throw new OlmAuthError(data.message);
    if (data.code !== 200) throw new OlmError(data.message || ("OpenList 错误码 " + data.code), data.code);
    return data.data;
  }

  return {
    req: req,

    // 连通性/登录测试
    me: function () {
      return req("/api/me", null, { method: "GET" });
    },

    list: function (path, o) {
      o = o || {};
      return req("/api/fs/list", {
        path: path,
        password: o.password || "",
        page: 1,
        per_page: 0,
        refresh: !!o.refresh
      });
    },

    // 返回 content 数组（目录为空时 OpenList 返回 null）
    listAll: async function (path, o) {
      var d = await this.list(path, o);
      return (d && d.content) || [];
    },

    getObj: function (path) {
      return req("/api/fs/get", { path: path, password: "", page: 1, per_page: 0, refresh: false });
    },

    // OpenList 的 mkdir 会递归创建父目录；已存在视为成功
    mkdir: async function (path) {
      try {
        return await req("/api/fs/mkdir", { path: path });
      } catch (e) {
        if (e instanceof OlmAuthError) throw e;
        if (/exist|已存在|存在同名/i.test((e && e.message) || "")) return null;
        throw e;
      }
    },

    rename: function (path, newName) {
      return req("/api/fs/rename", { path: path, name: newName, overwrite: false });
    },

    // pairs: [{src, dst}]
    batchRename: function (srcDir, pairs) {
      return req("/api/fs/batch_rename", {
        src_dir: srcDir,
        rename_objects: pairs.map(function (p) { return { src_name: p.src, new_name: p.dst }; })
      });
    },

    move: function (srcDir, dstDir, names) {
      return req("/api/fs/move", {
        src_dir: srcDir,
        dst_dir: dstDir,
        names: names,
        overwrite: false
      });
    },

    // 删除文件（仅垃圾文件「直接删除」模式使用，不可恢复）
    remove: function (dir, names) {
      return req("/api/fs/remove", { dir: dir, names: names });
    },

    removeEmptyDirectory: function (srcDir) {
      return req("/api/fs/remove_empty_directory", { src_dir: srcDir });
    }
  };
}

/* ==== src/05-localparse.js ==== */
/* ==== 本地文件名解析引擎（无 AI 兜底 / AI 结果校验） ==== */

var OLM_AD_TLDS = "com|net|org|cn|cc|tv|me|io|co|vip|xyz|top|club|la|life|live|site|online|store|fun|icu|pro|info|app|one|red|run|link|art|ltd|group|work|team|cloud|space|world|today|video|movie|film|fans|wang|xin|shop|host|press|website|win|buzz|cyou|best|lol|pw|tk|ml|ga|cf|gq";

var RE_OLM_URL = new RegExp(
  "(?:https?://)?(?:www\\.)?[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:" + OLM_AD_TLDS + ")(?:/[^\\s\\]】]*)?",
  "gi"
);

var RE_AD_PHRASE = /(高清剧集网发布|高清电影网发布|电影天堂|阳光电影|人人影视|首发于\S*|独家发布|更多资源|免费观看|在线观看|下载观看|收藏地址|最新地址|发布页\S*|公众号[:：]?\S*|微信[:：]?\S*|电报群\S*|防失联\S*|防迷路\S*|扫码\S*|禁转|请勿传播|仅供学习|24小时自助|云盘资源|网盘资源|夸克资源|阿里资源|极致画质|完整版观看)/g;

// 画质/来源/编码/音轨等发布信息（用于定位标题截断点并从标题中剔除）
var RE_SOURCE_TAG = /(?:^|[\s\-\[(])(BluRay|Blu-ray|BDRemux|BDRip|BDrip|BD|WEB-?DL|WEBRip|WEB|HDTV|HDRip|DVDRip|DVD|REMUX|UHD|HDR10\+?|HDR|SDR|DoVi|DoVI|DV|EDR|Dolby\s*Vision|杜比视界|杜比全景声|全景声|x264|x265|H\.?264|H\.?265|HEVC|AVC|AV1|VP9|AAC(?:2\.0|5\.1)?|DDP(?:2\.0|5\.1)?|DD\+?|AC3|EAC3|DTS(?:-HD)?(?:\.?MA)?|TrueHD|Atmos|FLAC|OPUS|MP3|2Audio|3Audio|多音轨|双音轨|60FPS|120FPS|高码率?|高帧率?|10bit|8bit|HQ|60帧|国语中字|国粤双语|国日双语|国语|粤语|国配|台配|中字|官中|简中|繁中|中英双字|中英|双语|双字|无字|内封|内嵌|外挂|软字幕|硬字幕|简繁字幕|中文字幕|特效字幕|港版|台版|日版|美版|收藏版|典藏版|蓝光原盘|蓝光|原盘|杜比|修复版|数码修复|4K修复|高清修复|REPACK|PROPER|iNTERNAL|LIMITED|CEE|GBR|JPN|USA|HK|VOSTFR|MULTi|DUAL)(?=$|[\s\-\]).])/gi;

var RE_VERSION_TAG = /(导演剪辑版?|加长版|未删减版?|无删减版?|终极版|重映版|重制版|剧场版|完整版|国际版|公映版|IMAX|Extended(?:\s*Cut)?|Director'?s\s*Cut|Final\s*Cut|Uncut|Unrated|Theatrical(?:\s*Cut)?|Remastered|Criterion|CC标准收藏?版?)/i;

var RE_JUNK_NAME = /(sample|^广告|最新电影|营业中|防失联|防丢失|防迷路|扫码|关注公众号|使用前必读|下载必看|重要说明|readme|使用说明|招募|招聘|优惠|推广|福利|社群|进群|加群|资源目录|目录\.txt)/i;

var RE_EXTRA_NAME = /(?:^|[\s\-\[(_.])(trailer|preview|menu|花絮|预告片?|彩蛋|幕后|访谈|采访|片场|删减片段|番外(?!篇)|特辑|特典映像|映像特典|NCOP\d*|NCED\d*|\bPV\d*\b|\bCM\d*\b|Making|Bonus|Featurette)(?=$|[\s\-\])._])/i;

var RE_SPECIAL_NAME = /(?:^|[\s\-\[(_.])(SP\d*|OVA\d*|OAD\d*|特别篇|特別篇|番外篇|总集篇|準备中|especial|Special)(?=$|[\s\-\])._])/i;

// 目录名无信息量（纯分类词），解析父目录时跳过
var RE_SKIP_DIR = /^(seasons?\s*\d*|s\d{1,2}|第\s*.{1,5}\s*[季部]|specials?|extras?|花絮|特典|正片|电影|电影合集|电视剧|剧集|动漫|动画|新番|纪录片|综艺|国漫|日漫|美剧|韩剧|日剧|港剧|英剧|泰剧|字幕|subs?|subtitles?|4k|1080p|720p|2160p|uhd|hdr|remux|bdrip|web-?dl|webrip|视频|videos?|movies?|films?|tv|series|合集|全集|完结|已完结|更新中|连载中?|待整理|下载|downloads?|新建文件夹|未分类|media|媒体库?)$/i;

var OLM_RES_CANON = {
  "4320": "4320p", "2160": "2160p", "4k": "2160p", "uhd": "2160p",
  "1440": "1440p", "2k": "1440p",
  "1080": "1080p", "fhd": "1080p",
  "720": "720p", "hd": "720p",
  "576": "576p", "480": "480p"
};

function olmCanonRes(s) {
  if (!s) return null;
  var k = String(s).toLowerCase().replace(/[pi]$/, "");
  return OLM_RES_CANON[k] || null;
}

function detectSubLang(stem) {
  var s = String(stem || "");
  var tail = s.split(/[\.\s\-\[\]（）()]+/).slice(-3).join(".").toLowerCase() + "." + s.toLowerCase();
  if (/(简繁|简体&繁体|chs&cht)/.test(tail)) return "chs";
  if (/(中英|双语|简英|chs&eng|chs_eng|zh-?en)/.test(tail)) return "chs";
  if (/(繁英|cht&eng|cht_eng)/.test(tail)) return "cht";
  if (/(?:^|[^a-z])(chs|sc|gb|zh-?hans)(?:[^a-z]|$)/.test(tail) || /(简体|简中|简日)/.test(tail)) return "chs";
  if (/(?:^|[^a-z])(cht|tc|big5|zh-?hant)(?:[^a-z]|$)/.test(tail) || /(繁體|繁体|繁中|繁日)/.test(tail)) return "cht";
  if (/(?:^|[^a-z])(chi|zho?|zh-?cn)(?:[^a-z]|$)/.test(tail) || /中文/.test(tail)) return "chs";
  if (/(?:^|[^a-z])(eng?)(?:[^a-z]|$)/.test(tail) || /(英文|英语)/.test(tail)) return "eng";
  if (/(?:^|[^a-z])(jpn?|ja)(?:[^a-z]|$)/.test(tail) || /(日文|日语)/.test(tail)) return "jpn";
  if (/(?:^|[^a-z])(kor?)(?:[^a-z]|$)/.test(tail) || /(韩文|韩语)/.test(tail)) return "kor";
  return null;
}

// 把 [xx] 段分类：集数/年份/分辨率/季/语言/标题候选/噪音
function olmClassifyBracket(inner) {
  var t = String(inner || "").trim();
  if (!t) return { kind: "noise" };
  var m;
  if ((m = t.match(/^S(\d{1,2})E(\d{1,4})(?:[-~]E?(\d{1,4}))?$/i))) {
    return { kind: "sxxeyy", season: +m[1], episode: +m[2], episodeEnd: m[3] ? +m[3] : null };
  }
  if (/^(4k|uhd|fhd|hd|2k)$/i.test(t) || /^\d{3,4}[pi]$/i.test(t)) {
    var r = olmCanonRes(t);
    if (r) return { kind: "res", res: r };
    return { kind: "noise" };
  }
  if (/^(19|20)\d{2}$/.test(t)) {
    var y = +t;
    if (y >= 1950 && y <= 2035) return { kind: "year", year: y };
  }
  if ((m = t.match(/^第?\s*([0-9一二三四五六七八九十百零两]+)\s*[集话話回期]$/))) {
    var ep = cnNumToInt(m[1]);
    if (ep != null) return { kind: "ep", episode: ep };
  }
  if ((m = t.match(/^(?:第\s*([0-9一二三四五六七八九十两]+)\s*季|S(?:eason)?\s*(\d{1,2}))$/i))) {
    var se = m[1] != null ? cnNumToInt(m[1]) : +m[2];
    if (se != null) return { kind: "season", season: se };
  }
  if ((m = t.match(/^(\d{1,4})(?:\.5)?(?:v\d{1,2})?(?:END|完)?$/i))) {
    var n = +m[1];
    if (n >= 1950 && n <= 2035) return { kind: "year", year: n };
    if (n >= 0 && n <= 1949) return { kind: "ep", episode: n };
    return { kind: "noise" };
  }
  if ((m = t.match(/^(\d{1,4})\s*[-~]\s*(\d{1,4})(?:END|完|Fin)?$/i))) {
    return { kind: "eprange", from: +m[1], to: +m[2] };
  }
  if (/^(GB|BIG5|JP|JPSC|JPTC|CHT|CHS|简|繁|简繁|简日|繁日|中日|简体|繁体|字幕|外挂|内封|内嵌)$/i.test(t)) {
    return { kind: "lang" };
  }
  if (/[一-鿿぀-ヿ가-힯]/.test(t) && t.length >= 2 &&
    !RE_AD_PHRASE.test(t) && !RE_OLM_URL.test(t) &&
    !/(字幕组|发布组|压制|搬运|翻译|听译|招募|工作室|论坛|社区|影视|剧集网|电影网|资源网|独家|首发|荐片|出品)/.test(t)) {
    RE_AD_PHRASE.lastIndex = 0; RE_OLM_URL.lastIndex = 0;
    return { kind: "title", title: t };
  }
  RE_AD_PHRASE.lastIndex = 0; RE_OLM_URL.lastIndex = 0;
  return { kind: "noise" };
}

// 从标题区里剔除已被解析走的结构化 token（处理 token 位于开头的情况）
function olmStripParsedTokens(s) {
  return String(s || "")
    .replace(/S\d{1,2}\s*E\d{1,4}(?:\s*[-~&]\s*E?\d{1,4})?/ig, " ")
    .replace(/(?:^|[^a-zA-Z0-9])EP?\d{1,4}(?:v\d{1,2})?(?=$|[^a-zA-Z0-9])/ig, " ")
    .replace(/第\s*[0-9一二三四五六七八九十百零两]+\s*[集话話回期]/g, " ")
    .replace(/第\s*[0-9一二三四五六七八九十两]+\s*[季部]/g, " ")
    .replace(/Season\s*\d{1,2}/ig, " ")
    .replace(/\d{1,2}(?:st|nd|rd|th)\s*Season/ig, " ")
    .replace(/(?:^|[^a-zA-Z0-9])(4320p|2160p|4k|uhd|1440p|1080p|1080i|720p|576p|480p)(?=$|[^a-zA-Z0-9])/ig, " ")
    .replace(/[全共]\s*[0-9一二三四五六七八九十百零两]+\s*[集话話期]/g, " ");
}

/*
 * 解析一段名字（文件 stem 或目录名）
 * 返回 { title, originalTitle, year, season, episode, episodeEnd, resolution,
 *        version, part, seriesHint, category, fallbackEp, hadCJK }
 */
function parseNameCore(rawName) {
  var out = {
    title: null, originalTitle: null, year: null, season: null,
    episode: null, episodeEnd: null, resolution: null, version: null,
    part: null, seriesHint: false, category: null, fallbackEp: null, hadCJK: false
  };
  var s = String(rawName == null ? "" : rawName)
    .replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .trim();
  if (!s) return out;

  // 垃圾/花絮/特别篇 检查（在原始串上）
  if (RE_JUNK_NAME.test(s)) out.category = "junk";
  RE_JUNK_NAME.lastIndex = 0;
  if (!out.category && RE_EXTRA_NAME.test(s)) out.category = "extra";
  RE_EXTRA_NAME.lastIndex = 0;
  if (RE_SPECIAL_NAME.test(s)) { out.category = out.category || "special"; }
  RE_SPECIAL_NAME.lastIndex = 0;

  // 1) 去 URL / 广告语
  s = s.replace(RE_OLM_URL, " ");
  RE_OLM_URL.lastIndex = 0;
  s = s.replace(RE_AD_PHRASE, " ");
  RE_AD_PHRASE.lastIndex = 0;

  // 2) 提取【】「」『』内容：广告→丢弃，其余作为标题候选
  var titleCands = [];
  s = s.replace(/[【「『]([^】」』]*)[】」』]/g, function (_, inner) {
    var c = olmClassifyBracket(inner);
    if (c.kind === "title") titleCands.push(c.title);
    return " ";
  });

  // 3) 提取并分类 [] 段
  var br = { ep: null, epEnd: null, year: null, res: null, season: null, eprange: null };
  s = s.replace(/\[([^\]]*)\]/g, function (_, inner) {
    var c = olmClassifyBracket(inner);
    if (c.kind === "title") { titleCands.push(c.title); return " "; }
    if (c.kind === "sxxeyy") { br.season = c.season; br.ep = c.episode; br.epEnd = c.episodeEnd; }
    else if (c.kind === "ep" && br.ep == null) br.ep = c.episode;
    else if (c.kind === "year" && br.year == null) br.year = c.year;
    else if (c.kind === "res" && br.res == null) br.res = c.res;
    else if (c.kind === "season" && br.season == null) br.season = c.season;
    else if (c.kind === "eprange" && !br.eprange) br.eprange = [c.from, c.to];
    return " ";
  });

  // 4) 分隔符归一：点/下划线转空格（保护 5.1 / 10.5 这类数字中的点）
  s = s.replace(/_/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/(\D)\./g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // AKA 归一
  s = s.replace(/\b[Aa]\s*[.\s]?\s*[Kk]\s*[.\s]?\s*[Aa]\b/g, " AKA ");

  var markers = [];   // 标题截断候选点
  var m;

  // 5) SxxEyy（含多集）
  var reSE = /S(\d{1,2})\s*E(\d{1,4})(?:\s*[-~&]\s*E?(\d{1,4})|E(\d{1,4}))?(?:\s*\.5)?/ig;
  if ((m = reSE.exec(s))) {
    out.season = +m[1];
    out.episode = +m[2];
    var end = m[3] != null ? +m[3] : (m[4] != null ? +m[4] : null);
    if (end != null && end > out.episode) out.episodeEnd = end;
    markers.push(m.index);
  }

  // 6) 独立 Exx / EPxx
  if (out.episode == null) {
    var reE = /(?:^|[^a-zA-Z0-9])EP?(\d{1,4})(?:\.5)?(?:v\d{1,2})?(?=$|[^a-zA-Z0-9])/ig;
    if ((m = reE.exec(s))) {
      out.episode = +m[1];
      markers.push(m.index === 0 ? 0 : m.index + 1);
    }
  }

  // 7) 第x集/话/回/期
  if (out.episode == null) {
    var reCn = /第\s*([0-9一二三四五六七八九十百零两]+)\s*[集话話回期]/g;
    if ((m = reCn.exec(s))) {
      var ep2 = cnNumToInt(m[1]);
      if (ep2 != null) { out.episode = ep2; markers.push(m.index); }
    }
  }

  // 8) 季
  var reSeason1 = /第\s*([0-9一二三四五六七八九十两]+)\s*[季部]/g;
  var reSeason2 = /(?:^|[^a-zA-Z0-9])S(?:eason)?\s*(\d{1,2})(?![0-9Ee])(?=$|[^a-zA-Z0-9])/g;
  var reSeason3 = /(\d{1,2})(?:st|nd|rd|th)\s*Season/ig;
  if (out.season == null && (m = reSeason1.exec(s))) {
    var se1 = cnNumToInt(m[1]);
    if (se1 != null) { out.season = se1; markers.push(m.index); out.seriesHint = true; }
  }
  if (out.season == null && (m = reSeason2.exec(s))) {
    out.season = +m[1];
    markers.push(m.index === 0 ? 0 : m.index + 1);
    out.seriesHint = true;
  }
  if (out.season == null && (m = reSeason3.exec(s))) {
    out.season = +m[1]; markers.push(m.index); out.seriesHint = true;
  }

  // 9) 年份：收集全部，取最后一个
  var years = [];
  var reYear = /(?:^|[^\d])((?:19|20)\d{2})(?!\d)/g;
  while ((m = reYear.exec(s))) {
    years.push({ y: +m[1], idx: m.index === 0 ? 0 : m.index + 1 });
  }
  if (years.length) {
    var chosen = years[years.length - 1];
    if (chosen.y >= 1900 && chosen.y <= 2035) {
      out.year = chosen.y;
      markers.push(chosen.idx);
    }
  }

  // 10) 分辨率
  var reRes = /(?:^|[^a-zA-Z0-9])(4320p|2160p|2160|4k|uhd|1440p|2k|1080p|1080i|1080|720p|720|576p|480p)(?=$|[^a-zA-Z0-9])/ig;
  if ((m = reRes.exec(s))) {
    out.resolution = olmCanonRes(m[1]);
    markers.push(m.index === 0 ? 0 : m.index + 1);
  }

  // 11) 来源/编码 tag（只用于截断）
  RE_SOURCE_TAG.lastIndex = 0;
  if ((m = RE_SOURCE_TAG.exec(s))) {
    markers.push(m.index);
  }
  RE_SOURCE_TAG.lastIndex = 0;

  // 12) 版本
  if ((m = s.match(RE_VERSION_TAG))) {
    out.version = m[1].trim();
    var vIdx = s.indexOf(m[1]);
    if (vIdx > 0) markers.push(vIdx);
  }

  // 13) part / CD / 上下部
  if ((m = /(?:^|[^a-zA-Z])(?:cd|disc|disk)\s*\.?\s*(\d{1,2})(?=$|[^0-9])/i.exec(s))) {
    out.part = +m[1];
    if (m.index > 0) markers.push(m.index + 1);
  }

  // 14) 全x集/完结 → 剧集提示
  var reAll = /[全共]\s*([0-9一二三四五六七八九十百零两]+)\s*[集话話期]|完结|大结局/g;
  if ((m = reAll.exec(s))) {
    out.seriesHint = true;
    markers.push(m.index);
  }

  // 15) 截断出标题区
  var cut = s.length;
  for (var i = 0; i < markers.length; i++) {
    if (markers[i] > 0 && markers[i] < cut) cut = markers[i];
  }
  while (cut > 0 && /[\s\(\[（［【《〈「『\-–—_.]/.test(s[cut - 1])) cut--;
  var titleRaw = olmStripParsedTokens(s.slice(0, cut)).trim();

  // part 的中文形式（上/中/下），出现在标题区末尾
  if (out.part == null && (m = titleRaw.match(/[（(]?([上中下])[）)]?[部篇]?$/))) {
    if (titleRaw.length > 1) {
      out.part = { "上": 1, "中": 2, "下": 3 }[m[1]];
      titleRaw = titleRaw.slice(0, titleRaw.length - m[0].length).trim();
    }
  }

  // 领头的序号（播放列表式 01. xxx）→ 备用集数
  if ((m = titleRaw.match(/^(\d{1,3})[\.、\s]+(?=\D)/))) {
    var n0 = +m[1];
    if (n0 >= 0 && n0 <= 300) {
      out.fallbackEp = n0;
      titleRaw = titleRaw.slice(m[0].length);
    }
  } else if (out.episode == null && /^\d{1,3}$/.test(titleRaw)) {
    var n1 = +titleRaw;
    if (n1 >= 0 && n1 <= 300) { out.fallbackEp = n1; titleRaw = ""; }
  }

  titleRaw = cleanupName(titleRaw);

  // AKA：中文名 AKA 英文名
  var akaParts = titleRaw.split(/\s+AKA\s+/i);
  if (akaParts.length >= 2) {
    var cjkPart = null, latinPart = null;
    for (var a = 0; a < akaParts.length; a++) {
      if (/[一-鿿]/.test(akaParts[a])) { if (!cjkPart) cjkPart = akaParts[a]; }
      else if (!latinPart) latinPart = akaParts[a];
    }
    titleRaw = cjkPart || akaParts[0];
    if (latinPart) out.originalTitle = cleanupName(latinPart);
  }

  // 中英混排拆分
  var title = titleRaw, original = out.originalTitle;
  if (!original) {
    var mm = titleRaw.match(/^(.*?[一-鿿぀-ヿ가-힯][^A-Za-z]*)[\s:：\-]+([A-Za-z][A-Za-z0-9'’!?&.,:\-\s]{2,})$/);
    if (mm) {
      title = mm[1];
      original = cleanupName(mm[2]);
    } else {
      mm = titleRaw.match(/^([A-Za-z][A-Za-z0-9'’!?&.,:\-\s]{2,})[\s:：\-]+(.*?[一-鿿぀-ヿ가-힯].*)$/);
      if (mm) {
        title = mm[2];
        original = cleanupName(mm[1]);
      }
    }
  }
  title = cleanupName(String(title || "")
    .replace(/[全共]\s*[0-9一二三四五六七八九十百零两]+\s*[集话話期]/g, " ")
    .replace(/(完结|大结局|已完结|更新中|连载中)/g, " "));

  if (!title && titleCands.length) {
    titleCands.sort(function (a, b) { return b.length - a.length; });
    title = cleanupName(titleCands[0]);
  }

  out.title = title || null;
  out.originalTitle = original || out.originalTitle || null;
  out.hadCJK = /[一-鿿぀-ヿ가-힯]/.test(out.title || "");

  // [] 提取的信息兜底
  if (out.episode == null && br.ep != null) out.episode = br.ep;
  if (out.episodeEnd == null && br.epEnd != null) out.episodeEnd = br.epEnd;
  if (out.season == null && br.season != null) out.season = br.season;
  if (out.year == null && br.year != null) out.year = br.year;
  if (!out.resolution && br.res) out.resolution = br.res;
  if (br.eprange) out.seriesHint = true;

  return out;
}

/*
 * 解析文件（含父目录上下文）
 * relPath: 相对扫描根的路径 "父目录/文件名.mkv"
 * info: { sizeMB, kind }
 */
function localParseFile(relPath, info) {
  info = info || {};
  var parts = String(relPath || "").split("/").filter(Boolean);
  var fileName = parts.length ? parts[parts.length - 1] : "";
  var parents = parts.slice(0, -1);
  var ext = pathExt(fileName);
  var kind = info.kind || classifyExt(ext);
  var stem = pathStem(fileName);

  var fp = parseNameCore(stem);
  var titleFromDir = false;

  // 从近到远解析父目录：纯分类目录跳过（但截获其中的季/年份信息）
  var dirParsed = null;
  var capturedSeason = null;
  for (var i = parents.length - 1; i >= 0; i--) {
    var dn = parents[i];
    var dnTrim = String(dn).trim();
    if (RE_SKIP_DIR.test(dnTrim)) {
      RE_SKIP_DIR.lastIndex = 0;
      var sm = dnTrim.match(/^s(?:easons?)?\s*(\d{1,2})$/i) ||
        dnTrim.match(/^第\s*([0-9一二三四五六七八九十两]+)\s*[季部]$/);
      if (sm && capturedSeason == null) {
        var seN = /^\d+$/.test(sm[1]) ? +sm[1] : cnNumToInt(sm[1]);
        if (seN != null) capturedSeason = seN;
      }
      if (/^specials?$/i.test(dnTrim) && capturedSeason == null) capturedSeason = 0;
      continue;
    }
    RE_SKIP_DIR.lastIndex = 0;
    dirParsed = parseNameCore(dnTrim);
    break;
  }

  var p = {
    type: "unknown",
    title: fp.title,
    originalTitle: fp.originalTitle,
    year: fp.year,
    season: fp.season,
    episode: fp.episode,
    episodeEnd: fp.episodeEnd,
    resolution: fp.resolution,
    version: fp.version,
    part: fp.part,
    lang: null,
    confidence: 0.3,
    from: "local"
  };
  var seriesHint = fp.seriesHint;
  var category = fp.category;

  var RE_DIR_TITLE_SUSPECT = /(下载|打包|合集|资源|网盘|分享|收藏|整理|待看|媒体|影视|电影|电视剧|剧集|连载|完结|更新)/;
  if (dirParsed) {
    if (!p.title && dirParsed.title) { p.title = dirParsed.title; p.originalTitle = p.originalTitle || dirParsed.originalTitle; titleFromDir = true; }
    else if (p.title && dirParsed.title && p.episode != null && p.title.length <= 2 && dirParsed.title.length > p.title.length) {
      // 文件名标题太短（多为误取），目录名更可信
      p.title = dirParsed.title; p.originalTitle = dirParsed.originalTitle || p.originalTitle; titleFromDir = true;
    } else if (p.title && dirParsed.title &&
      !/[一-鿿぀-ヿ가-힯]/.test(p.title) && /[一-鿿]/.test(dirParsed.title) &&
      !RE_DIR_TITLE_SUSPECT.test(dirParsed.title) &&
      (dirParsed.year == null || fp.year == null || dirParsed.year === fp.year)) {
      // 文件名是拼音/英文而目录有中文名 → 用中文名，拉丁名降为原名
      p.originalTitle = p.originalTitle || p.title;
      p.title = dirParsed.title;
      titleFromDir = true;
    }
    if (p.year == null && dirParsed.year != null) p.year = dirParsed.year;
    if (p.season == null && dirParsed.season != null) p.season = dirParsed.season;
    if (!p.resolution && dirParsed.resolution) p.resolution = dirParsed.resolution;
    if (dirParsed.seriesHint) seriesHint = true;
    if (!category && dirParsed.category === "junk") category = null; // 目录级广告词不传染文件
  }
  if (p.season == null && capturedSeason != null) p.season = capturedSeason;

  if (kind === "subtitle") p.lang = detectSubLang(stem);

  // 分类判定
  if (kind === "other" || kind === "meta") {
    if (JUNK_EXTS[ext] || category === "junk") p.type = "junk";
    else if (kind === "meta") p.type = "extra";
    else p.type = "junk";
  } else if (category === "junk") {
    p.type = "junk";
  } else if (category === "extra") {
    p.type = "extra";
  } else {
    if (p.episode == null && p.fallbackEp == null && fp.fallbackEp != null) p.fallbackEp = fp.fallbackEp;
    if (p.episode == null && fp.fallbackEp != null && (seriesHint || capturedSeason != null || (dirParsed && dirParsed.seriesHint))) {
      p.episode = fp.fallbackEp;
    }
    if (category === "special") {
      p.type = "tv";
      p.season = 0;
    } else if (p.episode != null) {
      p.type = "tv";
      if (p.season == null) p.season = 1;
    } else if (seriesHint || capturedSeason != null) {
      p.type = "tv";
      if (p.season == null) p.season = capturedSeason != null ? capturedSeason : 1;
    } else if (kind === "video" || kind === "subtitle") {
      p.type = p.title ? "movie" : "unknown";
    }
    // 疑似样片：体积太小且无季集信息
    if (kind === "video" && p.type === "movie" && info.sizeMB != null && info.sizeMB > 0 && info.sizeMB < (info.minVideoMB || 50)) {
      p.type = "extra";
    }
  }

  // 置信度
  var c = 0.3;
  if (fp.season != null && fp.episode != null) c += 0.35;
  else if (p.episode != null) c += 0.2;
  if (p.year != null) c += 0.15;
  if (p.title && (p.hadCJK || /[一-鿿]/.test(p.title) || p.title.split(/\s+/).length >= 2)) c += 0.2;
  if (titleFromDir) c -= 0.08;
  if (!p.title) c = 0.1;
  p.confidence = Math.max(0.05, Math.min(0.95, c));

  delete p.fallbackEp;
  return p;
}

/* ==== src/06-ai.js ==== */
/* ==== AI 解析（OpenAI 兼容接口） ==== */

var OLM_AI_SYSTEM_PROMPT = [
  "你是影视文件名解析引擎。输入是一个 JSON，files 数组的每项含 i(序号)、path(相对路径，含父目录)、size_mb。",
  "你必须输出严格的 JSON（不要 markdown 围栏、不要解释文字），格式：",
  '{"items":[{"i":0,"type":"tv","title":"凡人修仙传","original_title":"A Record of a Mortal\'s Journey to Immortality","year":2020,"season":1,"episode":10,"episode_end":null,"resolution":"2160p","version":null,"part":null,"lang":null,"confidence":0.95}]}',
  "字段规则：",
  "- type ∈ movie|tv|extra|junk|unknown：正片电影=movie；剧集/动漫/综艺单集=tv；预告/花絮/样片sample/NCOP/NCED/PV/菜单=extra；广告文件/网址快捷方式/说明文本/安装包/种子=junk；实在无法判断=unknown",
  "- title：官方中文名优先（没有中文名用原名）。必须去除：发布组、网站水印(如www.xxx.com、【XX影视】)、画质编码词(4K/1080p/HEVC/WEB-DL等)、'全xx集'、'完结'、广告语",
  "- original_title：英文/原语言名，未知则 null",
  "- 父目录名往往含剧名/季/年份信息，文件名只有集数时务必从父目录取剧名",
  "- '第十二集'→episode:12；'第二季'/'Ⅱ'/'2nd Season'/'S2'→season:2；剧集没标季默认 season:1；SP/OVA/特别篇/番外→season:0",
  "- 一个文件含多集(如 E01-E02)时填 episode_end，否则 null",
  "- year：上映/首播年份，剧集用第一季首播年。不确定就 null，禁止编造",
  "- resolution ∈ 2160p|1440p|1080p|720p|480p|null（4K→2160p）",
  "- version：导演剪辑/加长版/IMAX/未删减 等版本标记，无则 null",
  "- part：上下部/CD1/part2 之类分段号（上=1 下=2），无则 null",
  "- lang：仅字幕文件填 chs|cht|eng|jpn|kor|null（简体/简中/GB→chs，繁体/BIG5→cht，双语/简英→chs）",
  "- confidence：0~1 你的把握程度",
  "- items 必须与输入 files 一一对应，不得遗漏或增加，按 i 排列",
  "示例：",
  '输入 {"files":[{"i":0,"path":"凡人修仙传/【高清剧集网发布 www.DDHDTV.com】凡人修仙传[第10集][国语配音+中文字幕].Fan.Ren.Xiu.Xian.Zhuan.2020.S01E10.2160p.WEB-DL.H265.AAC-DDHDTV.mp4","size_mb":1200}]}',
  '输出 {"items":[{"i":0,"type":"tv","title":"凡人修仙传","original_title":"Fan Ren Xiu Xian Zhuan","year":2020,"season":1,"episode":10,"episode_end":null,"resolution":"2160p","version":null,"part":null,"lang":null,"confidence":0.97}]}',
  '输入 {"files":[{"i":0,"path":"Interstellar.2014.IMAX.2160p.BluRay.x265.10bit.HDR.mkv","size_mb":8000}]}',
  '输出 {"items":[{"i":0,"type":"movie","title":"星际穿越","original_title":"Interstellar","year":2014,"season":null,"episode":null,"episode_end":null,"resolution":"2160p","version":"IMAX","part":null,"lang":null,"confidence":0.98}]}'
].join("\n");

// 从可能带噪音的模型输出中抠出 JSON 对象
function extractJSONBlock(text) {
  if (text == null) throw new Error("AI 返回为空");
  var t = String(text).trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try { return JSON.parse(t); } catch (e) { /* 继续 */ }
  var start = t.indexOf("{");
  if (start === -1) throw new Error("AI 返回中没有 JSON");
  var depth = 0, inStr = false, escNext = false;
  for (var i = start; i < t.length; i++) {
    var ch = t[i];
    if (escNext) { escNext = false; continue; }
    if (ch === "\\") { escNext = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(t.slice(start, i + 1));
    }
  }
  throw new Error("AI 返回的 JSON 不完整");
}

var OLM_AI_TYPES = { movie: 1, tv: 1, extra: 1, junk: 1, unknown: 1 };
var OLM_SUB_LANGS = { chs: 1, cht: 1, eng: 1, jpn: 1, kor: 1 };

function olmToIntOrNull(v) {
  if (v == null || v === "") return null;
  var n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// 规范化 AI 输出的一条解析结果
function normalizeAiItem(raw) {
  if (!isPlainObj(raw)) return null;
  var type = String(raw.type || "").toLowerCase();
  if (!OLM_AI_TYPES[type]) type = "unknown";
  var title = raw.title == null ? null : cleanupName(String(raw.title).replace(/[《》]/g, ""));
  var lang = raw.lang == null ? null : String(raw.lang).toLowerCase();
  if (lang && !OLM_SUB_LANGS[lang]) lang = null;
  var conf = Number(raw.confidence);
  if (isNaN(conf)) conf = 0.75;
  return {
    type: type,
    title: title || null,
    originalTitle: raw.original_title == null ? null : cleanupName(String(raw.original_title)) || null,
    year: olmToIntOrNull(raw.year),
    season: olmToIntOrNull(raw.season),
    episode: olmToIntOrNull(raw.episode),
    episodeEnd: olmToIntOrNull(raw.episode_end),
    resolution: olmCanonRes(raw.resolution) || null,
    version: raw.version == null ? null : String(raw.version).trim() || null,
    part: olmToIntOrNull(raw.part),
    lang: lang,
    confidence: Math.max(0.05, Math.min(0.99, conf)),
    from: "ai"
  };
}

// AI 结果为主，本地解析兜底补缺
function mergeParsed(ai, local) {
  if (!ai) return local;
  var out = Object.assign({}, local || {}, {});
  var keys = ["title", "originalTitle", "year", "season", "episode", "episodeEnd", "resolution", "version", "part", "lang"];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    out[k] = (ai[k] != null && ai[k] !== "") ? ai[k] : (local ? local[k] : null);
  }
  out.type = ai.type !== "unknown" ? ai.type : ((local && local.type) || "unknown");
  if (out.type === "tv" && out.season == null) out.season = 1;
  out.confidence = ai.type !== "unknown" ? ai.confidence : Math.min(ai.confidence, (local && local.confidence) || 0.3);
  out.from = "ai";
  return out;
}

/*
 * 由 base_url 计算 chat/completions 端点，兼容各家填法：
 *   - 以 # 结尾：去掉 # 后原样使用（特殊网关的完整地址）
 *   - 已以 /chat/completions 结尾：原样使用
 *   - 路径中已含版本段（/v1、/v4、/v1beta…）：只补 /chat/completions
 *   - 其余（如只填 https://api.openai.com 或 one-api 根地址）：补 /v1/chat/completions
 */
function olmAiEndpoint(baseUrl) {
  var u = String(baseUrl == null ? "" : baseUrl).trim();
  if (!u) return "";
  if (u.charAt(u.length - 1) === "#") return u.slice(0, -1).trim();
  if (u.indexOf("://") === -1) u = "https://" + u;
  u = u.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(u)) return u;
  var path = u.replace(/^[a-z][a-z0-9+.\-]*:\/\/[^\/]*/i, "");
  if (/\/v\d+[a-z0-9]*(\/|$)/i.test(path)) return u + "/chat/completions";
  return u + "/v1/chat/completions";
}

/*
 * getCfg: () => settings.ai
 */
function createAiClient(getCfg, deps) {
  deps = deps || {};
  var fetchFn = deps.fetchFn ||
    (typeof fetch !== "undefined"
      ? fetch.bind(typeof window !== "undefined" ? window : globalThis)
      : null);
  var sleepFn = deps.sleepFn || olmSleep;
  // 探测到网关不支持的参数后记下来，本客户端后续请求不再携带（省一次重试）
  var compat = { noJsonMode: false, noTemperature: false };

  async function chat(messages, o) {
    o = o || {};
    var cfg = getCfg();
    if (!fetchFn) throw new Error("当前环境没有 fetch");
    if (!cfg.apiKey) throw new Error("未配置 AI API Key");
    var url = olmAiEndpoint(cfg.baseUrl);
    if (!url) throw new Error("未配置 AI 接口地址 (base_url)");
    var body = { model: cfg.model, messages: messages, stream: false };
    var useTemp = !compat.noTemperature;
    if (useTemp) body.temperature = cfg.temperature == null ? 0.1 : cfg.temperature;
    var useJson = (o.jsonMode !== undefined ? o.jsonMode : cfg.jsonMode) && !compat.noJsonMode;
    if (useJson) body.response_format = { type: "json_object" };

    var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, cfg.timeoutMs || 120000) : null;
    var resp, text;
    try {
      resp = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + cfg.apiKey
        },
        body: JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined
      });
      text = await resp.text();
    } catch (e) {
      throw new Error("AI 请求失败: " + ((e && e.message) || e));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!resp.ok) {
      if (resp.status === 400) {
        // 部分网关不支持 response_format，去掉后重试
        if (useJson && /response_format|json_object/i.test(text || "")) {
          compat.noJsonMode = true;
          return chat(messages, o);
        }
        // OpenAI gpt-5 / o 系列只接受默认温度，去掉 temperature 重试
        if (useTemp && /temperature/i.test(text || "")) {
          compat.noTemperature = true;
          return chat(messages, o);
        }
      }
      var msg = text || "";
      try { var j = JSON.parse(text); msg = (j.error && j.error.message) || j.message || text; } catch (e2) { /* keep */ }
      throw new Error("AI 接口 HTTP " + resp.status + ": " + String(msg).slice(0, 300));
    }
    var data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error("AI 响应不是 JSON"); }
    var content = data && data.choices && data.choices[0] &&
      (data.choices[0].message ? data.choices[0].message.content : data.choices[0].text);
    if (content == null) throw new Error("AI 响应缺少 content");
    return content;
  }

  // 单批解析；malformed 时带错误反馈重试一次
  async function parseBatchOnce(entries, retryNote) {
    var userPayload = JSON.stringify({
      files: entries.map(function (e) {
        return { i: e.i, path: e.path, size_mb: e.sizeMB == null ? null : Math.round(e.sizeMB) };
      })
    });
    var messages = [
      { role: "system", content: OLM_AI_SYSTEM_PROMPT },
      { role: "user", content: retryNote ? (retryNote + "\n" + userPayload) : userPayload }
    ];
    var content = await chat(messages);
    var parsed = extractJSONBlock(content);
    var items = parsed && parsed.items;
    if (!Array.isArray(items)) throw new Error("AI 输出缺少 items 数组");
    var byI = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!isPlainObj(it) || it.i == null) continue;
      var norm = normalizeAiItem(it);
      if (norm) byI[+it.i] = norm;
    }
    return byI;
  }

  /*
   * entries: [{i, path, sizeMB}]
   * 返回 { byI: {i: Parsed|undefined}, errors: [string] }
   */
  async function parseFiles(entries, o) {
    o = o || {};
    var cfg = getCfg();
    var batchSize = Math.max(1, cfg.batchSize || 25);
    var concurrency = Math.max(1, Math.min(4, cfg.concurrency || 2));
    var batches = [];
    for (var i = 0; i < entries.length; i += batchSize) {
      batches.push(entries.slice(i, i + batchSize));
    }
    var byI = {};
    var errors = [];
    var done = 0;
    var cursor = 0;

    async function worker() {
      while (cursor < batches.length) {
        if (o.isCancelled && o.isCancelled()) return;
        var idx = cursor++;
        var batch = batches[idx];
        try {
          var r;
          try {
            r = await parseBatchOnce(batch, null);
          } catch (e1) {
            await sleepFn(800);
            r = await parseBatchOnce(batch, "注意：上一次你的输出无法解析(" +
              String((e1 && e1.message) || e1).slice(0, 120) + ")，请严格输出纯 JSON。");
          }
          Object.assign(byI, r);
        } catch (e) {
          errors.push("第 " + (idx + 1) + " 批解析失败: " + ((e && e.message) || e));
        }
        done++;
        if (o.onProgress) o.onProgress(done, batches.length);
      }
    }

    var workers = [];
    for (var w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);
    return { byI: byI, errors: errors };
  }

  // 连接测试
  async function test() {
    var content = await chat([
      { role: "system", content: "你是连通性测试，直接输出 JSON。" },
      { role: "user", content: '输出 {"ok":true}' }
    ]);
    var j = extractJSONBlock(content);
    if (!j || j.ok !== true) throw new Error("AI 返回异常: " + String(content).slice(0, 80));
    return true;
  }

  return { chat: chat, parseFiles: parseFiles, test: test };
}

/* ==== src/07-tmdb.js ==== */
/* ==== TMDB 元数据匹配 ==== */

function olmTmdbYearOf(cand) {
  var d = cand.release_date || cand.first_air_date || "";
  var y = d ? parseInt(String(d).slice(0, 4), 10) : NaN;
  return isNaN(y) ? null : y;
}

function normalizeTmdbEntry(cand, mediaType) {
  return {
    id: cand.id,
    mediaType: mediaType,
    title: cleanupName(cand.title || cand.name || ""),
    originalTitle: cand.original_title || cand.original_name || null,
    year: olmTmdbYearOf(cand),
    posterPath: cand.poster_path || null,
    overview: cand.overview || "",
    popularity: cand.popularity || 0
  };
}

function scoreTmdbCandidate(cand, wantTitle, wantOriginal, wantYear) {
  var names = [cand.title, cand.original_title, cand.name, cand.original_name].filter(Boolean);
  var nk = titleKey(wantTitle || "");
  var ok = wantOriginal ? titleKey(wantOriginal) : "";
  var best = 0;
  for (var i = 0; i < names.length; i++) {
    var k = titleKey(names[i]);
    if (!k) continue;
    var sc = 0;
    if (nk && k === nk) sc = 3;
    else if (ok && k === ok) sc = 3;
    else if (nk && nk.length >= 2 && (k.indexOf(nk) !== -1 || nk.indexOf(k) !== -1)) sc = 2;
    else if (ok && ok.length >= 2 && (k.indexOf(ok) !== -1 || ok.indexOf(k) !== -1)) sc = 2;
    if (sc > best) best = sc;
  }
  var cy = olmTmdbYearOf(cand);
  if (wantYear && cy) {
    if (cy === wantYear) best += 2;
    else if (Math.abs(cy - wantYear) <= 1) best += 1;
    else best -= 0.5;
  }
  best += Math.min(1, (cand.popularity || 0) / 100);
  return best;
}

/*
 * getCfg: () => settings.tmdb
 */
function createTmdbClient(getCfg, deps) {
  deps = deps || {};
  var fetchFn = deps.fetchFn ||
    (typeof fetch !== "undefined"
      ? fetch.bind(typeof window !== "undefined" ? window : globalThis)
      : null);
  var sleepFn = deps.sleepFn || olmSleep;
  var cache = null;

  function cacheLoad() {
    if (!cache) cache = lsGetJSON(OLM_KEYS.tmdbCache, {});
    return cache;
  }
  function cacheGet(k) {
    var c = cacheLoad();
    var e = c[k];
    if (e && e.exp > Date.now()) return e.v;
    return undefined;
  }
  function cacheSet(k, v) {
    var c = cacheLoad();
    c[k] = { v: v, exp: Date.now() + 7 * 86400e3 };
    var keys = Object.keys(c);
    if (keys.length > 400) {
      keys.sort(function (a, b) { return c[a].exp - c[b].exp; });
      for (var i = 0; i < keys.length - 350; i++) delete c[keys[i]];
    }
    lsSetJSON(OLM_KEYS.tmdbCache, c);
  }

  async function api(pathname, params) {
    var cfg = getCfg();
    if (!fetchFn) throw new Error("当前环境没有 fetch");
    if (!cfg.apiKey) throw new Error("未配置 TMDB API Key");
    var useBearer = /^eyJ/.test(cfg.apiKey);
    var qs = [];
    params = params || {};
    if (params.language === undefined) params.language = cfg.language || "zh-CN";
    if (!useBearer) params.api_key = cfg.apiKey;
    for (var k in params) {
      if (params[k] == null || params[k] === "") continue;
      qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    }
    var url = String(cfg.baseUrl || "https://api.themoviedb.org").replace(/\/+$/, "") +
      "/3" + pathname + (qs.length ? "?" + qs.join("&") : "");

    for (var attempt = 0; ; attempt++) {
      var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, cfg.timeoutMs || 20000) : null;
      var resp;
      try {
        resp = await fetchFn(url, {
          method: "GET",
          headers: useBearer ? { "Authorization": "Bearer " + cfg.apiKey } : {},
          signal: ctl ? ctl.signal : undefined
        });
      } catch (e) {
        if (timer) clearTimeout(timer);
        throw new Error("TMDB 请求失败（网络不通或需代理/镜像）: " + ((e && e.message) || e));
      }
      if (timer) clearTimeout(timer);
      if (resp.status === 429 && attempt < 3) {
        await sleepFn(1200 * (attempt + 1));
        continue;
      }
      if (resp.status === 401) throw new Error("TMDB API Key 无效 (401)");
      if (!resp.ok) throw new Error("TMDB HTTP " + resp.status);
      try { return await resp.json(); }
      catch (e) { throw new Error("TMDB 响应不是 JSON"); }
    }
  }

  async function searchMovie(query, year) {
    var cfg = getCfg();
    var key = "m:" + (cfg.language || "") + ":" + query + ":" + (year || "");
    var hit = cacheGet(key);
    if (hit !== undefined) return hit;
    var d = await api("/search/movie", { query: query, year: year || null, include_adult: "false" });
    var r = (d && d.results) || [];
    cacheSet(key, r.slice(0, 8));
    return r;
  }

  async function searchTv(query, year) {
    var cfg = getCfg();
    var key = "t:" + (cfg.language || "") + ":" + query + ":" + (year || "");
    var hit = cacheGet(key);
    if (hit !== undefined) return hit;
    var d = await api("/search/tv", { query: query, first_air_date_year: year || null, include_adult: "false" });
    var r = (d && d.results) || [];
    cacheSet(key, r.slice(0, 8));
    return r;
  }

  // 返回 { 集数: 集标题 }；TMDB 占位标题（"第 x 集"/"Episode x"）视为空
  async function seasonEpisodes(tvId, seasonNum) {
    var cfg = getCfg();
    var key = "s:" + (cfg.language || "") + ":" + tvId + ":" + seasonNum;
    var hit = cacheGet(key);
    if (hit !== undefined) return hit;
    var map = {};
    try {
      var d = await api("/tv/" + tvId + "/season/" + seasonNum, {});
      var eps = (d && d.episodes) || [];
      for (var i = 0; i < eps.length; i++) {
        var name = String(eps[i].name || "").trim();
        if (!name) continue;
        if (/^第\s*\d+\s*[集话]$/.test(name)) continue;
        if (/^Episode\s*\d+$/i.test(name)) continue;
        map[eps[i].episode_number] = name;
      }
    } catch (e) {
      olmLog("season fetch fail", tvId, seasonNum, (e && e.message) || e);
    }
    cacheSet(key, map);
    return map;
  }

  async function detail(mediaType, id) {
    var d = await api("/" + (mediaType === "tv" ? "tv" : "movie") + "/" + id, {});
    return normalizeTmdbEntry(d, mediaType);
  }

  /*
   * group: {type: movie|tv, title, originalTitle, year}
   * 返回 {matched: entry|null, score, candidates: [entry]}
   */
  async function matchGroup(group) {
    var isTv = group.type === "tv";
    var searchFn = isTv ? searchTv : searchMovie;
    var tried = [];
    var queries = [];
    if (group.title) queries.push({ q: group.title, y: group.year || null });
    if (group.title && group.year) queries.push({ q: group.title, y: null });
    if (group.originalTitle) queries.push({ q: group.originalTitle, y: group.year || null });
    if (group.originalTitle && group.year) queries.push({ q: group.originalTitle, y: null });

    var best = null, bestScore = -1, bestList = [];
    for (var i = 0; i < queries.length; i++) {
      var results;
      try {
        results = await searchFn(queries[i].q, queries[i].y);
      } catch (e) {
        throw e;
      }
      tried.push(queries[i]);
      if (!results.length) continue;
      for (var j = 0; j < results.length; j++) {
        var sc = scoreTmdbCandidate(results[j], group.title, group.originalTitle, group.year);
        if (sc > bestScore) { bestScore = sc; best = results[j]; }
      }
      if (!bestList.length) bestList = results;
      if (bestScore >= 4) break;   // 已经足够好，不再尝试后续查询
    }

    var accepted = best && (bestScore >= 2.5 || (bestList.length === 1 && bestScore >= 1.5));
    return {
      matched: accepted ? normalizeTmdbEntry(best, isTv ? "tv" : "movie") : null,
      score: bestScore,
      candidates: bestList.slice(0, 6).map(function (c) {
        return normalizeTmdbEntry(c, isTv ? "tv" : "movie");
      })
    };
  }

  async function test() {
    var d = await api("/configuration", {});
    if (!d || !d.images) throw new Error("TMDB 响应异常");
    return true;
  }

  return {
    searchMovie: searchMovie,
    searchTv: searchTv,
    seasonEpisodes: seasonEpisodes,
    matchGroup: matchGroup,
    detail: detail,
    test: test
  };
}

/* ==== src/08-namer.js ==== */
/* ==== Emby 命名器 ==== */

function olmCleanTitle(s) {
  return sanitizeFileName(cleanupName(String(s == null ? "" : s).replace(/[《》]/g, "")));
}

// 组的展示名（TMDB 优先）
function olmGroupDisplay(group) {
  var t = (group.tmdb && group.tmdb.title) || group.title || "未识别";
  var y = (group.tmdb && group.tmdb.year) || group.year;
  return t + (y ? " (" + y + ")" : "");
}

/*
 * 判断目录名是否就是该组影视自己的文件夹（如 "百花杀（2026）"、"凡人修仙传 (2020) [tmdbid=x]"）：
 * 去掉 provider 标记与结尾年份后，剩余部分须与组的中文名/原名一致，且年份不冲突。
 * 用于用户直接选中剧集/电影文件夹整理时，避免在其中再嵌套一层「剧名 (年份)」目录。
 */
function olmDirIsMediaFolder(dirName, group) {
  var s = String(dirName == null ? "" : dirName).trim();
  if (!s || !group) return false;
  s = s.replace(/[\[{【]\s*(tmdb|imdb|tvdb)[^\]}】]*[\]}】]/gi, " ");
  var year = null;
  var m = s.match(/^(.*?)[\s.\-_]*[（(\[]?((19|20)\d{2})[）)\]]?[\s.\-_]*$/);
  if (m && m[1]) { year = parseInt(m[2], 10); s = m[1]; }
  var key = titleKey(s);
  if (!key) return false;
  var tmdb = group.tmdb || null;
  var gy = (tmdb && tmdb.year) || group.year || null;
  if (year != null && gy != null && year !== gy) return false;
  var names = [tmdb && tmdb.title, tmdb && tmdb.originalTitle, group.title, group.originalTitle];
  for (var i = 0; i < names.length; i++) {
    if (names[i] && titleKey(names[i]) === key) return true;
  }
  return false;
}

/*
 * 计算一个视频文件的目标（不含根目录、不含扩展名）
 * 返回 { folderRel: "剧名 (2020) [tmdbid=x]/Season 01", innerRel: "Season 01"（电影为 ""），
 *        fileBase: "剧名 - S01E01 - 集标题" } 或 null
 * innerRel = 去掉「剧名 (年份)」层后的相对目录，供目标根本身就是影视文件夹时使用
 */
function olmBuildMediaName(group, parsed, naming) {
  var tmdb = group.tmdb || null;
  var title = olmCleanTitle((tmdb && tmdb.title) || parsed.title || group.title);
  if (!title || title === "_") return null;
  var idTag = "";
  if (naming.includeTmdbId && tmdb && tmdb.id != null) {
    idTag = String(naming.tmdbTag || "[tmdbid={id}]").replace("{id}", tmdb.id);
  }

  if (group.type === "movie") {
    var my = (tmdb && tmdb.year) || parsed.year || group.year;
    var folder = cleanupName(title + (my ? " (" + my + ")" : "") + (idTag ? " " + idTag : ""));
    var base = title + (my ? " (" + my + ")" : "");
    if (naming.includeVersion && parsed.version) base += " - " + sanitizeFileName(parsed.version);
    if (parsed.part != null) base += " - part" + parsed.part;
    if (naming.includeResolution && parsed.resolution) base += " - " + parsed.resolution;
    return { folderRel: sanitizeFileName(folder), innerRel: "", fileBase: cleanupName(base) };
  }

  if (group.type === "tv") {
    var season = parsed.season == null ? 1 : parsed.season;
    var ty = (tmdb && tmdb.year) || group.year || parsed.year;
    var showFolder = sanitizeFileName(cleanupName(title + (ty ? " (" + ty + ")" : "") + (idTag ? " " + idTag : "")));
    var seasonDir = sanitizeFileName(
      String(naming.seasonFolder || "Season {season2}")
        .replace("{season2}", pad2(season))
        .replace("{season}", String(season))
    );
    if (parsed.episode == null) return null;
    var epSeg = "S" + pad2(season) + "E" + pad2(parsed.episode);
    if (parsed.episodeEnd != null && parsed.episodeEnd > parsed.episode) {
      epSeg += "-E" + pad2(parsed.episodeEnd);
    }
    var epTitle = "";
    if (naming.includeEpTitle && tmdb && tmdb.seasons &&
      tmdb.seasons[season] && tmdb.seasons[season][parsed.episode]) {
      epTitle = sanitizeFileName(String(tmdb.seasons[season][parsed.episode]).slice(0, 60));
    }
    var epBase = title + " - " + epSeg + (epTitle ? " - " + epTitle : "");
    return {
      folderRel: showFolder + "/" + seasonDir,
      innerRel: seasonDir,
      fileBase: cleanupName(epBase)
    };
  }

  return null;
}

/* ==== src/09-pipeline.js ==== */
/* ==== 整理流水线：扫描 → 解析 → 分组 → TMDB 匹配 → 生成方案 ==== */

function olmComputeStats(items) {
  var st = { total: items.length, included: 0, move: 0, rename: 0, trash: 0, del: 0, same: 0, conflict: 0, excluded: 0, done: 0, failed: 0 };
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (it.include) {
      st.included++;
      if (it.action === "move") st.move++;
      else if (it.action === "rename") st.rename++;
      else if (it.action === "trash") st.trash++;
      else if (it.action === "delete") st.del++;
    }
    if (it.status === "same") st.same++;
    if (it.status === "conflict") st.conflict++;
    if (it.status === "excluded") st.excluded++;
    if (it.status === "done") st.done++;
    if (it.status === "failed") st.failed++;
  }
  return st;
}

/*
 * deps: { ol, ai, tmdb, getSettings, onProgress, isCancelled }
 */
function createPipeline(deps) {
  deps = deps || {};
  var ol = deps.ol;
  var getSettings = deps.getSettings || olmGetSettings;
  var onProgress = deps.onProgress || function () {};
  var isCancelled = deps.isCancelled || function () { return false; };

  function checkCancel() {
    if (isCancelled()) {
      var e = new Error("已取消");
      e.cancelled = true;
      throw e;
    }
  }

  /* ---- 扫描 ---- */
  async function scan(root, o) {
    o = o || {};
    var s = getSettings();
    var org = s.organize;
    var maxDepth = o.maxDepth != null ? o.maxDepth : (org.recursive ? org.maxDepth : 1);
    var maxFiles = o.maxFiles != null ? o.maxFiles : org.maxFiles;
    var files = [];
    var dirs = {};          // dir → [names]（用于冲突检测）
    var queue = [{ path: root, depth: 1 }];
    var truncated = false;

    while (queue.length) {
      checkCancel();
      var cur = queue.shift();
      var entries;
      entries = await ol.listAll(cur.path, { refresh: !!o.refresh && cur.path === root, password: o.password || "" });
      dirs[cur.path] = entries.map(function (e) { return e.name; });
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.is_dir) {
          var low = String(e.name).toLowerCase();
          if (IGNORE_DIR_NAMES[low]) continue;
          if (e.name === org.trashDirName) continue;
          if (/^[.@#$]/.test(e.name)) continue;
          if (cur.depth < maxDepth) queue.push({ path: pathJoin(cur.path, e.name), depth: cur.depth + 1 });
          continue;
        }
        if (files.length >= maxFiles) { truncated = true; continue; }
        var ext = pathExt(e.name);
        var fpath = pathJoin(cur.path, e.name);
        files.push({
          path: fpath,
          dir: cur.path,
          name: e.name,
          size: e.size || 0,
          sizeMB: (e.size || 0) / 1048576,
          ext: ext,
          kind: classifyExt(ext),
          relPath: fpath.slice(root.length).replace(/^\/+/, ""),
          depth: cur.depth
        });
      }
      onProgress({ phase: "scan", done: files.length, total: -1, note: cur.path });
    }
    return { root: root, files: files, dirs: dirs, truncated: truncated };
  }

  /* ---- 目标根目录 ----
   * targetDir: 本次整理的目标目录覆盖（UI 手选，优先级最高）；回收站仍在扫描目录内 */
  function resolveRoots(root, targetDir) {
    var org = getSettings().organize;
    var movieRoot = root, tvRoot = root;
    var t = targetDir == null ? "" : String(targetDir).trim().replace(/\/+$/, "");
    if (t) {
      movieRoot = tvRoot = t;
    } else if (org.targetMode === "custom") {
      if (org.movieDir && org.movieDir.trim()) movieRoot = org.movieDir.trim().replace(/\/+$/, "");
      if (org.tvDir && org.tvDir.trim()) tvRoot = org.tvDir.trim().replace(/\/+$/, "");
    }
    return {
      movieRoot: movieRoot,
      tvRoot: tvRoot,
      trashDir: pathJoin(root, org.trashDirName || ".整理回收站")
    };
  }

  /* ---- 解析（本地 + AI 合并） ---- */
  async function parseAll(files, root) {
    var s = getSettings();
    var minVideoMB = s.organize.minVideoMB;
    // 把扫描根的目录名也纳入解析上下文：用户常直接选中剧集文件夹整理，
    // 此时 relPath 只剩 "01.mp4"，剧名/季/年份全在根目录名里
    var segs = String(root || "").split("/").filter(Boolean);
    var ctx = segs.slice(-2).join("/");
    function ctxPath(relPath) { return ctx ? ctx + "/" + relPath : relPath; }
    var parsedList = files.map(function (f) {
      return localParseFile(ctxPath(f.relPath), { sizeMB: f.sizeMB, kind: f.kind, minVideoMB: minVideoMB });
    });
    var aiErrors = [];
    if (s.ai.enabled && s.ai.apiKey && deps.ai) {
      // 只把媒体类文件交给 AI，省 token；junk/meta 扩展名本地即可判定
      var entries = [];
      for (var i = 0; i < files.length; i++) {
        if (files[i].kind === "video" || files[i].kind === "subtitle") {
          entries.push({ i: i, path: ctxPath(files[i].relPath), sizeMB: files[i].sizeMB });
        }
      }
      if (entries.length) {
        var r = await deps.ai.parseFiles(entries, {
          onProgress: function (done, total) { onProgress({ phase: "ai", done: done, total: total }); },
          isCancelled: isCancelled
        });
        aiErrors = r.errors || [];
        for (var j = 0; j < files.length; j++) {
          if (r.byI[j]) {
            parsedList[j] = mergeParsed(r.byI[j], parsedList[j]);
            // AI 拿不到体积规则：过小的"电影"仍视为样片
            if (parsedList[j].type === "movie" && files[j].kind === "video" &&
              files[j].sizeMB > 0 && files[j].sizeMB < minVideoMB && parsedList[j].episode == null) {
              parsedList[j].type = "extra";
            }
          }
        }
      }
    }
    checkCancel();
    return { parsedList: parsedList, aiErrors: aiErrors };
  }

  /* ---- 分组 ---- */
  function groupKeyOf(p) {
    if (p.type === "movie") return "movie|" + titleKey(p.title) + "|" + (p.year || "");
    if (p.type === "tv") return "tv|" + titleKey(p.title);
    return p.type; // junk / extra / unknown
  }

  function buildGroups(files, parsedList) {
    var groupsByKey = {};
    var items = [];
    for (var i = 0; i < files.length; i++) {
      var p = parsedList[i];
      var key = groupKeyOf(p);
      var g = groupsByKey[key];
      if (!g) {
        g = groupsByKey[key] = {
          id: olmUid("g"),
          key: key,
          type: (p.type === "movie" || p.type === "tv") ? p.type : p.type,
          title: null,
          originalTitle: null,
          year: null,
          tmdb: null,
          matchStatus: "pending",   // pending | matched | unmatched | manual | skipped | na
          note: "",
          candidates: [],
          itemIds: [],
          _titleVotes: {},
          _yearVotes: {}
        };
      }
      var item = {
        id: olmUid("i"),
        groupId: g.id,
        file: files[i],
        parsed: p,
        dstDir: null,
        dstName: null,
        action: "none",
        include: false,
        status: "pending",
        reason: "",
        edited: false
      };
      items.push(item);
      g.itemIds.push(item.id);
      if (p.title) g._titleVotes[p.title] = (g._titleVotes[p.title] || 0) + 1;
      if (!g.originalTitle && p.originalTitle) g.originalTitle = p.originalTitle;
      if (p.year != null) g._yearVotes[p.year] = (g._yearVotes[p.year] || 0) + 1;
    }

    // 电影组合并：同名无年份组并入有年份组
    var keys = Object.keys(groupsByKey);
    for (var k = 0; k < keys.length; k++) {
      var key2 = keys[k];
      var m = key2.match(/^movie\|(.+)\|$/);
      if (!m) continue;
      var target = null;
      for (var k2 = 0; k2 < keys.length; k2++) {
        if (keys[k2] !== key2 && keys[k2].indexOf("movie|" + m[1] + "|") === 0 && groupsByKey[keys[k2]]) {
          target = groupsByKey[keys[k2]];
          break;
        }
      }
      if (target) {
        var src = groupsByKey[key2];
        for (var t = 0; t < items.length; t++) {
          if (items[t].groupId === src.id) items[t].groupId = target.id;
        }
        target.itemIds = target.itemIds.concat(src.itemIds);
        for (var tv in src._titleVotes) target._titleVotes[tv] = (target._titleVotes[tv] || 0) + src._titleVotes[tv];
        delete groupsByKey[key2];
      }
    }

    var groups = [];
    for (var gk in groupsByKey) {
      var gg = groupsByKey[gk];
      // 众数标题/年份
      var bestT = null, bestC = -1;
      for (var tt in gg._titleVotes) {
        var w = gg._titleVotes[tt] * 10 + tt.length;
        if (w > bestC) { bestC = w; bestT = tt; }
      }
      gg.title = bestT;
      var bestY = null, bestYC = -1;
      for (var yy in gg._yearVotes) {
        if (gg._yearVotes[yy] > bestYC) { bestYC = gg._yearVotes[yy]; bestY = parseInt(yy, 10); }
      }
      gg.year = bestY;
      delete gg._titleVotes;
      delete gg._yearVotes;
      groups.push(gg);
    }
    return { groups: groups, items: items };
  }

  /* ---- TMDB 匹配 ---- */
  async function matchGroups(groups, items) {
    var s = getSettings();
    var mediaGroups = groups.filter(function (g) { return g.type === "movie" || g.type === "tv"; });
    var useTmdb = s.tmdb.enabled && s.tmdb.apiKey && deps.tmdb;
    for (var i = 0; i < mediaGroups.length; i++) {
      checkCancel();
      var g = mediaGroups[i];
      if (!useTmdb) {
        g.matchStatus = "skipped";
        continue;
      }
      try {
        var r = await deps.tmdb.matchGroup({
          type: g.type, title: g.title, originalTitle: g.originalTitle, year: g.year
        });
        g.candidates = r.candidates || [];
        if (r.matched) {
          g.tmdb = r.matched;
          g.matchStatus = "matched";
          if (!g.year && g.tmdb.year) g.year = g.tmdb.year;
        } else {
          g.matchStatus = "unmatched";
          g.note = "TMDB 未找到可靠匹配";
        }
      } catch (e) {
        g.matchStatus = "unmatched";
        g.note = "TMDB 查询失败: " + ((e && e.message) || e);
      }
      if (g.tmdb && g.type === "tv") {
        await fetchSeasonsFor(g, items);
      }
      onProgress({ phase: "match", done: i + 1, total: mediaGroups.length, note: g.title || "" });
    }
    var rest = groups.filter(function (g) { return g.type !== "movie" && g.type !== "tv"; });
    for (var j = 0; j < rest.length; j++) rest[j].matchStatus = "na";
  }

  async function fetchSeasonsFor(group, items) {
    var s = getSettings();
    if (!s.naming.includeEpTitle || !deps.tmdb || !group.tmdb) return;
    var seasons = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.groupId !== group.id) continue;
      if (it.parsed.episode == null) continue;
      var se = it.parsed.season == null ? 1 : it.parsed.season;
      seasons[se] = true;
    }
    group.tmdb.seasons = group.tmdb.seasons || {};
    var list = Object.keys(seasons);
    for (var j = 0; j < list.length; j++) {
      checkCancel();
      var n = parseInt(list[j], 10);
      if (group.tmdb.seasons[n]) continue;
      group.tmdb.seasons[n] = await deps.tmdb.seasonEpisodes(group.tmdb.id, n);
    }
  }

  /* ---- 生成目标与冲突检测 ---- */
  function buildTargetsFor(task, groupsById) {
    var s = getSettings();
    var roots = resolveRoots(task.root, task.targetDir);
    var junkAction = s.organize.junkAction;

    // 先给视频定目标
    var videoByKey = {};   // type|titleKey|season|episode|part → item
    var i, it, g, p;
    for (i = 0; i < task.items.length; i++) {
      it = task.items[i];
      if (it.edited) continue;             // 用户手改过的不动
      p = it.parsed;
      g = groupsById[it.groupId];
      it.dstDir = null; it.dstName = null; it.action = "none"; it.include = false; it.reason = "";

      if (p.type === "junk") {
        if (junkAction === "trash") {
          it.dstDir = roots.trashDir;
          it.dstName = it.file.name;
          it.action = "trash";
          it.include = !it.userExcluded;
          it.status = it.userExcluded ? "excluded" : "ok";
          it.reason = it.userExcluded ? "手动排除" : "垃圾文件 → 回收站";
        } else if (junkAction === "delete") {
          it.action = "delete";
          it.include = !it.userExcluded;
          it.status = it.userExcluded ? "excluded" : "ok";
          it.reason = it.userExcluded ? "手动排除" : "垃圾文件 → 删除（不可恢复）";
        } else {
          it.status = "excluded";
          it.reason = "垃圾文件（忽略）";
        }
        continue;
      }
      if (p.type === "extra" || p.type === "unknown") {
        it.status = "excluded";
        it.reason = p.type === "extra" ? "花絮/样片等附加内容" : "无法识别";
        continue;
      }
      if (it.file.kind === "subtitle") continue; // 字幕稍后配对

      var built = olmBuildMediaName(g, p, s.naming);
      if (!built) {
        it.status = "excluded";
        var t0 = olmCleanTitle((g.tmdb && g.tmdb.title) || p.title || g.title);
        it.reason = (!t0 || t0 === "_") ? "缺少标题信息（未识别出片名/剧名）"
          : (p.type === "tv" ? "缺少集数信息" : "缺少标题信息");
        continue;
      }
      var base = g.type === "movie" ? roots.movieRoot : roots.tvRoot;
      // 目标根本身就是这部影视的文件夹（直接整理剧集/电影文件夹）→ 不再嵌套「剧名 (年份)」层
      var rel = olmDirIsMediaFolder(pathName(base), g) ? built.innerRel : built.folderRel;
      it.dstDir = rel ? base + "/" + rel : base;
      it.dstName = it.file.ext ? built.fileBase + "." + it.file.ext : built.fileBase;
      if (it.file.kind === "video" && p.type === "tv") {
        var vk = "tv|" + titleKey((g.tmdb && g.tmdb.title) || g.title) + "|" + (p.season == null ? 1 : p.season) + "|" + p.episode + "|" + (p.part || "");
        if (!videoByKey[vk]) videoByKey[vk] = it;
      } else if (it.file.kind === "video" && p.type === "movie") {
        var mk = "movie|" + titleKey((g.tmdb && g.tmdb.title) || g.title) + "|" + (p.part || "");
        if (!videoByKey[mk]) videoByKey[mk] = it;
      }
    }

    // 字幕配对
    for (i = 0; i < task.items.length; i++) {
      it = task.items[i];
      if (it.edited || it.file.kind !== "subtitle") continue;
      p = it.parsed;
      if (p.type !== "tv" && p.type !== "movie") continue;
      g = groupsById[it.groupId];
      var lk = p.type === "tv"
        ? "tv|" + titleKey((g.tmdb && g.tmdb.title) || g.title) + "|" + (p.season == null ? 1 : p.season) + "|" + p.episode + "|" + (p.part || "")
        : "movie|" + titleKey((g.tmdb && g.tmdb.title) || g.title) + "|" + (p.part || "");
      var host = videoByKey[lk];
      var lang = p.lang ? "." + p.lang : "";
      if (host && host.dstDir) {
        it.dstDir = host.dstDir;
        it.dstName = pathStem(host.dstName) + lang + "." + it.file.ext;
      } else {
        var built2 = olmBuildMediaName(g, p, s.naming);
        if (built2) {
          var base2 = g.type === "movie" ? roots.movieRoot : roots.tvRoot;
          var rel2 = olmDirIsMediaFolder(pathName(base2), g) ? built2.innerRel : built2.folderRel;
          it.dstDir = rel2 ? base2 + "/" + rel2 : base2;
          it.dstName = built2.fileBase + lang + "." + it.file.ext;
        } else {
          it.status = "excluded";
          it.reason = "找不到对应视频，且自身信息不足";
          continue;
        }
      }
    }

    // 动作与 same 判定
    for (i = 0; i < task.items.length; i++) {
      it = task.items[i];
      if (it.status === "excluded" || it.action === "trash" || it.action === "delete") continue;
      if (!it.dstDir || !it.dstName) continue;
      if (it.dstDir === it.file.dir && it.dstName === it.file.name) {
        it.action = "none";
        it.include = false;
        it.status = "same";
        it.reason = "已符合规范";
      } else {
        it.action = it.dstDir === it.file.dir ? "rename" : "move";
        if (it.userExcluded) {
          it.include = false;
          it.status = "excluded";
          it.reason = "手动排除";
        } else {
          it.include = true;
          it.status = "ok";
        }
      }
    }
  }

  async function detectConflicts(task) {
    var dirs = task._dirs || {};
    var bySrc = {};
    var i, it;
    for (i = 0; i < task.items.length; i++) bySrc[task.items[i].file.path] = task.items[i];

    // 目标目录不在扫描范围内 → 拉一次列表
    var need = {};
    for (i = 0; i < task.items.length; i++) {
      it = task.items[i];
      if (it.include && it.dstDir && dirs[it.dstDir] === undefined) need[it.dstDir] = true;
    }
    var needList = Object.keys(need);
    for (i = 0; i < needList.length; i++) {
      try {
        var entries = await ol.listAll(needList[i]);
        dirs[needList[i]] = entries.map(function (e) { return e.name; });
      } catch (e) {
        dirs[needList[i]] = null;   // null = 确认不存在（执行时需要 mkdir）
      }
    }
    task._dirs = dirs;

    // 计划内冲突：两个文件指向同一目标
    var byTarget = {};
    for (i = 0; i < task.items.length; i++) {
      it = task.items[i];
      if (!it.include || !it.dstDir) continue;
      var tp = pathJoin(it.dstDir, it.dstName);
      (byTarget[tp] = byTarget[tp] || []).push(it);
    }
    for (var tp2 in byTarget) {
      if (byTarget[tp2].length > 1) {
        for (var j = 0; j < byTarget[tp2].length; j++) {
          var c = byTarget[tp2][j];
          c.include = false;
          c.status = "conflict";
          c.reason = "多个文件指向同一目标：" + tp2;
        }
      }
    }

    // 与现存文件冲突（占位文件自身也会被移走的除外）
    for (i = 0; i < task.items.length; i++) {
      it = task.items[i];
      if (!it.include || !it.dstDir) continue;
      var names = dirs[it.dstDir];
      if (!names || names.indexOf(it.dstName) === -1) continue;
      var occupantPath = pathJoin(it.dstDir, it.dstName);
      if (occupantPath === it.file.path) continue;
      var occ = bySrc[occupantPath];
      var occMovesAway = occ && occ.include &&
        pathJoin(occ.dstDir, occ.dstName) !== occupantPath;
      if (!occMovesAway) {
        it.include = false;
        it.status = "conflict";
        it.reason = "目标位置已存在同名文件：" + occupantPath;
      }
    }
  }

  /* ---- 主流程 ---- */
  async function organize(root, o) {
    o = o || {};
    var scanRes = await scan(root, o);
    checkCancel();
    if (!scanRes.files.length) {
      var e = new Error("目录下没有找到文件");
      e.empty = true;
      throw e;
    }
    var pr = await parseAll(scanRes.files, scanRes.root);
    var gb = buildGroups(scanRes.files, pr.parsedList);
    await matchGroups(gb.groups, gb.items);
    checkCancel();

    var task = {
      id: olmUid("task"),
      createdAt: olmNowIso(),
      root: root,
      targetDir: (o.targetDir == null ? "" : String(o.targetDir).trim().replace(/\/+$/, "")) || null,
      status: "ready",
      groups: gb.groups,
      items: gb.items,
      ops: [],
      log: [],
      aiErrors: pr.aiErrors,
      truncated: scanRes.truncated,
      _dirs: scanRes.dirs
    };
    var groupsById = {};
    for (var i = 0; i < task.groups.length; i++) groupsById[task.groups[i].id] = task.groups[i];
    onProgress({ phase: "plan", done: 0, total: 1 });
    buildTargetsFor(task, groupsById);
    await detectConflicts(task);
    task.stats = olmComputeStats(task.items);
    onProgress({ phase: "plan", done: 1, total: 1 });
    return task;
  }

  // 手动重匹配某组（rematch: tmdb entry 或 null=取消匹配）
  async function rematchGroup(task, group, entry) {
    if (entry) {
      group.tmdb = deepClone(entry);
      group.matchStatus = "manual";
      if (group.type === "tv") {
        group.tmdb.seasons = {};
        await fetchSeasonsFor(group, task.items);
      }
      if (!group.year && entry.year) group.year = entry.year;
    } else {
      group.tmdb = null;
      group.matchStatus = "unmatched";
    }
    var groupsById = {};
    for (var i = 0; i < task.groups.length; i++) groupsById[task.groups[i].id] = task.groups[i];
    // 只重建该组的目标，但冲突要全局重查
    for (var j = 0; j < task.items.length; j++) {
      var it = task.items[j];
      if (it.groupId !== group.id || it.edited) continue;
      if (it.status === "conflict" || it.status === "ok" || it.status === "same" || it.status === "excluded" || it.status === "pending") {
        it.status = "pending";
      }
    }
    buildTargetsForGroup(task, group, groupsById);
    await refreshPlan(task);
  }

  function buildTargetsForGroup(task, group, groupsById) {
    // 复用整体逻辑：把非本组 item 标记为 edited 跳过太粗暴，改为整体重建（未 edited 的都会重算，结果一致）
    buildTargetsFor(task, groupsById);
  }

  // 用户改了 include/手改路径后重算冲突与统计
  async function refreshPlan(task) {
    // 清掉旧 conflict 状态（未手改的）
    for (var i = 0; i < task.items.length; i++) {
      var it = task.items[i];
      if (it.status === "conflict" && it.dstDir && it.dstName) {
        if (it.userExcluded) {
          it.status = "excluded";
          it.include = false;
          it.reason = "手动排除";
        } else {
          it.status = "ok";
          it.include = true;
          it.reason = "";
        }
      }
    }
    await detectConflicts(task);
    task.stats = olmComputeStats(task.items);
    return task;
  }

  return {
    scan: scan,
    organize: organize,
    resolveRoots: resolveRoots,
    rematchGroup: rematchGroup,
    refreshPlan: refreshPlan,
    _internals: {
      parseAll: parseAll,
      buildGroups: buildGroups,
      buildTargetsFor: buildTargetsFor,
      detectConflicts: detectConflicts
    }
  };
}

/* ==== src/10-executor.js ==== */
/* ==== 执行器：mkdir → 重命名（链/环安全）→ 移动（占位感知）；全程限速 + 重试 + 操作日志 ==== */

/*
 * 同目录内重命名排序：
 * - 目标名被其他待重命名文件占用时先等待其让位
 * - 出现环（A→B, B→A）时用临时名打断
 * 输入 [{id, src, dst}]，输出 [{id, src, dst, temp?}]（可能比输入多，因为环需要两步）
 */
function olmOrderRenames(renames) {
  var result = [];
  var pending = renames.map(function (r) { return { id: r.id, src: r.src, dst: r.dst }; });
  var current = {};   // 当前占用中的名字
  var i;
  for (i = 0; i < pending.length; i++) current[pending[i].src] = true;
  var guard = pending.length * 3 + 10;
  var tempSeq = 0;
  while (pending.length && guard-- > 0) {
    var idx = -1;
    for (i = 0; i < pending.length; i++) {
      var r = pending[i];
      if (r.dst === r.src || !current[r.dst]) { idx = i; break; }
    }
    if (idx === -1) {
      // 环：把第一个先改成临时名
      var head = pending[0];
      var tmp = head.dst + ".olmtmp" + (tempSeq++);
      result.push({ id: head.id, src: head.src, dst: tmp, temp: true });
      delete current[head.src];
      current[tmp] = true;
      head.src = tmp;
      continue;
    }
    var picked = pending.splice(idx, 1)[0];
    if (picked.src !== picked.dst) {
      result.push({ id: picked.id, src: picked.src, dst: picked.dst });
      delete current[picked.src];
      current[picked.dst] = true;
    }
  }
  return result;
}

/*
 * deps: { ol, getSettings, onProgress, isCancelled, sleepFn }
 */
function createExecutor(deps) {
  deps = deps || {};
  var ol = deps.ol;
  var getSettings = deps.getSettings || olmGetSettings;
  var onProgress = deps.onProgress || function () {};
  var isCancelled = deps.isCancelled || function () { return false; };
  var sleepFn = deps.sleepFn || olmSleep;

  function isRetryable(e) {
    if (e instanceof OlmAuthError) return false;
    var msg = String((e && e.message) || e);
    if (/exist|已存在|存在同名|not found|不存在/i.test(msg)) return false;
    var code = e && e.code;
    return code === 0 || code === 429 || (code >= 500 && code <= 599) ||
      /timeout|abort|network|fetch|load failed/i.test(msg);
  }

  var opSeq = 0;
  async function writeOp(fn, label) {
    var s = getSettings();
    var interval = Math.max(0, s.exec.intervalMs || 0);
    var retries = Math.max(0, s.exec.retries || 0);
    if (opSeq++ > 0 && interval) await sleepFn(interval);
    for (var attempt = 0; ; attempt++) {
      if (isCancelled()) {
        var ce = new Error("已取消");
        ce.cancelled = true;
        throw ce;
      }
      try {
        return await fn();
      } catch (e) {
        if (e && e.cancelled) throw e;
        if (e instanceof OlmAuthError) throw e;
        if (attempt >= retries || !isRetryable(e)) throw e;
        await sleepFn(Math.min(8000, (interval || 300) * Math.pow(2, attempt + 1)));
        olmLog("retry", label, (e && e.message) || e);
      }
    }
  }

  function taskLog(task, msg) {
    task.log.push(olmNowIso().slice(11, 19) + " " + msg);
    if (task.log.length > 500) task.log.splice(0, task.log.length - 400);
  }

  async function execute(task) {
    var s = getSettings();
    var items = task.items.filter(function (it) {
      return it.include && it.status === "ok" &&
        ((it.dstDir && it.dstName) || it.action === "delete");
    });
    if (!items.length) throw new Error("没有可执行的条目");
    task.status = "executing";
    task.startedAt = olmNowIso();
    opSeq = 0;

    var known = task._dirs || {};
    var i, it;

    // 每个 item 的当前位置状态
    var st = {};
    for (i = 0; i < items.length; i++) {
      it = items[i];
      st[it.id] = { item: it, curDir: it.file.dir, curName: it.file.name, done: false, failed: false };
    }

    /* A. 建目录 */
    var needDirs = {};
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (it.dstDir && it.dstDir !== it.file.dir && !known[it.dstDir]) needDirs[it.dstDir] = true;
    }
    var dirList = Object.keys(needDirs).sort(function (a, b) { return a.length - b.length; });
    var totalSteps = dirList.length + items.length;
    var doneSteps = 0;

    for (i = 0; i < dirList.length; i++) {
      var dp = dirList[i];
      try {
        await writeOp(function () { return ol.mkdir(dp); }, "mkdir " + dp);
        task.ops.push({ t: "mkdir", path: dp });
        known[dp] = known[dp] || [];
        taskLog(task, "mkdir " + dp);
      } catch (e) {
        if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
        // 目录建不出来 → 其下所有 item 直接失败
        for (var k = 0; k < items.length; k++) {
          if (items[k].dstDir === dp) {
            st[items[k].id].failed = true;
            items[k].status = "failed";
            items[k].reason = "创建目录失败: " + ((e && e.message) || e);
          }
        }
        taskLog(task, "mkdir 失败 " + dp + ": " + ((e && e.message) || e));
      }
      doneSteps++;
      onProgress({ phase: "exec", done: doneSteps, total: totalSteps, note: "建目录" });
    }

    /* B. 同目录改名（移动前先改成最终名） */
    var renamesByDir = {};
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (st[it.id].failed || it.action === "delete") continue;
      var finalName = it.dstName;
      if (it.action === "trash") {
        // 回收站重名 → 加时间戳后缀
        var trashNames = (known[it.dstDir] || []).slice();
        for (var t2 = 0; t2 < items.length; t2++) {
          if (items[t2] !== it && items[t2].action === "trash" && items[t2].dstDir === it.dstDir) {
            trashNames.push(items[t2].dstName);
          }
        }
        if (trashNames.indexOf(finalName) !== -1) {
          var stem = pathStem(finalName), ext0 = pathExt(finalName);
          finalName = stem + "." + Date.now().toString(36) + (ext0 ? "." + ext0 : "");
          it.dstName = finalName;
        }
      }
      if (finalName !== it.file.name) {
        (renamesByDir[it.file.dir] = renamesByDir[it.file.dir] || []).push({
          id: it.id, src: it.file.name, dst: finalName
        });
      }
    }

    for (var dir in renamesByDir) {
      var ordered = olmOrderRenames(renamesByDir[dir]);
      var srcSet = {};
      renamesByDir[dir].forEach(function (r) { srcSet[r.src] = 1; });
      var hasChain = ordered.length !== renamesByDir[dir].length ||
        renamesByDir[dir].some(function (r) { return r.dst !== r.src && srcSet[r.dst]; });
      var useBatch = s.exec.useBatchRename && !hasChain && ordered.length > 1;
      if (useBatch) {
        var chunks = [];
        for (i = 0; i < ordered.length; i += 30) chunks.push(ordered.slice(i, i + 30));
        for (var c = 0; c < chunks.length; c++) {
          var chunk = chunks[c];
          try {
            await writeOp(function () { return ol.batchRename(dir, chunk); }, "batch_rename " + dir);
            for (i = 0; i < chunk.length; i++) applyRenameOk(task, st, dir, chunk[i]);
            doneSteps += countNonTemp(chunk);
          } catch (e) {
            if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
            // 整批失败 → 逐个来，定位失败者
            for (i = 0; i < chunk.length; i++) {
              await renameOne(task, st, dir, chunk[i]);
              doneSteps++;
            }
          }
          onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "重命名" });
        }
      } else {
        for (i = 0; i < ordered.length; i++) {
          await renameOne(task, st, dir, ordered[i]);
          if (!ordered[i].temp) doneSteps++;
          onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "重命名" });
        }
      }
    }

    // 纯改名的 item 已就位
    for (i = 0; i < items.length; i++) {
      it = items[i];
      var stt = st[it.id];
      if (stt.failed || it.action === "move" || it.action === "trash") continue;
      if (stt.curName === it.dstName && stt.curDir === it.dstDir) {
        stt.done = true;
        it.status = "done";
      }
    }

    /* C. 移动（多轮：等目标位被让出后再进入） */
    var movesPending = [];
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (st[it.id].failed || st[it.id].done) continue;
      if (it.action !== "move" && it.action !== "trash") continue;
      if (st[it.id].curName !== it.dstName) {
        st[it.id].failed = true;
        it.status = "failed";
        it.reason = it.reason || "移动前的重命名未完成";
        continue;
      }
      movesPending.push(st[it.id]);
    }

    // 占用表：其他 pending item 的当前位置
    function occupiedBy(path) {
      for (var x = 0; x < movesPending.length; x++) {
        var ms = movesPending[x];
        if (!ms.done && !ms.failed && pathJoin(ms.curDir, ms.curName) === path) return ms;
      }
      return null;
    }

    var guard = movesPending.length * 3 + 5;
    while (guard-- > 0) {
      var ready = [];
      var waiting = [];
      for (i = 0; i < movesPending.length; i++) {
        var ms = movesPending[i];
        if (ms.done || ms.failed) continue;
        var targetPath = pathJoin(ms.item.dstDir, ms.item.dstName);
        var occ = occupiedBy(targetPath);
        if (occ && occ !== ms) waiting.push(ms);
        else ready.push(ms);
      }
      if (!ready.length && !waiting.length) break;
      if (!ready.length && waiting.length) {
        // 跨目录环：把第一个等待者在原目录改成临时名
        var w = waiting[0];
        var tmpName = w.curName + ".olmtmp" + Math.floor(Math.random() * 1e4);
        try {
          await writeOp(function () { return ol.rename(pathJoin(w.curDir, w.curName), tmpName); }, "temp rename");
          task.ops.push({ t: "rename", dir: w.curDir, from: w.curName, to: tmpName });
          taskLog(task, "临时改名 " + w.curName + " → " + tmpName);
          w.curName = tmpName;
          // 目标名与最终名不同了，移动后需要再改回；标记
          w.needFinalRename = true;
        } catch (e) {
          if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
          w.failed = true;
          w.item.status = "failed";
          w.item.reason = "打断移动环失败: " + ((e && e.message) || e);
        }
        continue;
      }

      // 按 (srcDir → dstDir) 分组批量移动
      var byPair = {};
      for (i = 0; i < ready.length; i++) {
        var pr = ready[i];
        var pk = pr.curDir + "\n" + pr.item.dstDir;
        (byPair[pk] = byPair[pk] || []).push(pr);
      }
      for (var pk2 in byPair) {
        var grp = byPair[pk2];
        var srcDir = grp[0].curDir, dstDir = grp[0].item.dstDir;
        for (var off = 0; off < grp.length; off += 15) {
          var part = grp.slice(off, off + 15);
          var names = part.map(function (x) { return x.curName; });
          try {
            await writeOp(function () { return ol.move(srcDir, dstDir, names); }, "move → " + dstDir);
            for (i = 0; i < part.length; i++) applyMoveOk(task, part[i], srcDir, dstDir);
            doneSteps += part.length;
          } catch (e) {
            if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
            // 整批失败 → 逐个
            for (i = 0; i < part.length; i++) {
              var one = part[i];
              try {
                await writeOp(function () { return ol.move(srcDir, dstDir, [one.curName]); }, "move1 → " + dstDir);
                applyMoveOk(task, one, srcDir, dstDir);
              } catch (e2) {
                if (e2 instanceof OlmAuthError || (e2 && e2.cancelled)) { finish(task, e2); throw e2; }
                one.failed = true;
                one.item.status = "failed";
                one.item.reason = "移动失败: " + ((e2 && e2.message) || e2);
                taskLog(task, "移动失败 " + one.curName + ": " + ((e2 && e2.message) || e2));
              }
              doneSteps++;
            }
          }
          onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "移动" });
        }
      }

      // 临时名的收尾：移动完成后改回最终名
      for (i = 0; i < movesPending.length; i++) {
        var fs = movesPending[i];
        if (fs.done && fs.needFinalRename && fs.curName !== fs.item.dstName) {
          try {
            await writeOp(function () {
              return ol.rename(pathJoin(fs.curDir, fs.curName), fs.item.dstName);
            }, "final rename");
            task.ops.push({ t: "rename", dir: fs.curDir, from: fs.curName, to: fs.item.dstName });
            fs.curName = fs.item.dstName;
            fs.needFinalRename = false;
            fs.item.status = "done";
          } catch (e) {
            if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
            fs.item.status = "failed";
            fs.item.reason = "移动后改回最终名失败: " + ((e && e.message) || e);
            fs.failed = true;
            fs.done = false;
          }
        }
      }
    }

    // 没轮到执行的（链条断裂等）
    for (i = 0; i < movesPending.length; i++) {
      if (!movesPending[i].done && !movesPending[i].failed) {
        movesPending[i].item.status = "failed";
        movesPending[i].item.reason = movesPending[i].item.reason || "未能完成（目标位置始终被占用）";
      }
    }

    /* D. 删除垃圾文件（junkAction=delete；不可撤销，放最后执行） */
    for (i = 0; i < items.length; i++) {
      it = items[i];
      var sd = st[it.id];
      if (it.action !== "delete" || sd.failed || sd.done) continue;
      var delDir = it.file.dir, delName = it.file.name;
      try {
        await writeOp(function () { return ol.remove(delDir, [delName]); }, "remove " + delName);
        task.ops.push({ t: "remove", dir: delDir, name: delName });
        sd.done = true;
        it.status = "done";
        taskLog(task, "删除 " + delName);
      } catch (e) {
        if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
        sd.failed = true;
        it.status = "failed";
        it.reason = "删除失败: " + ((e && e.message) || e);
        taskLog(task, "删除失败 " + delName + ": " + ((e && e.message) || e));
      }
      doneSteps++;
      onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "删除垃圾文件" });
    }

    /* 收尾 */
    finish(task, null);

    if (s.organize.cleanEmptyDirs && task.status !== "failed") {
      try {
        await writeOp(function () { return ol.removeEmptyDirectory(task.root); }, "clean empty dirs");
        taskLog(task, "已清理空目录");
      } catch (e) {
        taskLog(task, "清理空目录失败: " + ((e && e.message) || e));
      }
    }
    return task;
  }

  function countNonTemp(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (!list[i].temp) n++;
    return n;
  }

  function applyRenameOk(task, st, dir, r) {
    task.ops.push({ t: "rename", dir: dir, from: r.src, to: r.dst });
    var stt = st[r.id];
    if (stt) stt.curName = r.dst;
    taskLog(task, "改名 " + r.src + " → " + r.dst);
  }

  async function renameOne(task, st, dir, r) {
    try {
      await writeOp(function () { return ol.rename(pathJoin(dir, r.src), r.dst); }, "rename " + r.src);
      applyRenameOk(task, st, dir, r);
      return true;
    } catch (e) {
      if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
      var stt = st[r.id];
      if (stt) {
        stt.failed = true;
        stt.item.status = "failed";
        stt.item.reason = "重命名失败: " + ((e && e.message) || e);
      }
      taskLog(task, "改名失败 " + r.src + ": " + ((e && e.message) || e));
      return false;
    }
  }

  function applyMoveOk(task, ms, srcDir, dstDir) {
    task.ops.push({ t: "move", src: srcDir, dst: dstDir, name: ms.curName });
    ms.curDir = dstDir;
    if (!ms.needFinalRename) {
      ms.done = true;
      ms.item.status = "done";
    } else {
      ms.done = true; // 位置到了，名字待收尾
    }
    taskLog(task, "移动 " + ms.curName + " → " + dstDir);
  }

  function finish(task, err) {
    task.finishedAt = olmNowIso();
    var st2 = olmComputeStats(task.items);
    task.stats = st2;
    if (err && err.cancelled) task.status = "partial";
    else if (err instanceof OlmAuthError) task.status = "failed";
    else if (st2.failed > 0 && st2.done > 0) task.status = "partial";
    else if (st2.failed > 0 && st2.done === 0) task.status = "failed";
    else task.status = "done";
    if (err) taskLog(task, "中止: " + ((err && err.message) || err));
  }

  /*
   * 撤销：逆序回放操作日志
   * rec: {ops: [...]}（任务对象或历史记录均可）
   */
  async function undo(rec) {
    opSeq = 0;
    var ops = (rec.ops || []).slice().reverse();
    var done = 0, failed = 0, skippedDeletes = 0, errors = [];
    for (var i = 0; i < ops.length; i++) {
      if (isCancelled()) break;
      var op = ops[i];
      try {
        if (op.t === "move") {
          await writeOp(function () { return ol.move(op.dst, op.src, [op.name]); }, "undo move");
          done++;
        } else if (op.t === "rename") {
          await writeOp(function () { return ol.rename(pathJoin(op.dir, op.to), op.from); }, "undo rename");
          done++;
        } else if (op.t === "remove") {
          skippedDeletes++;   // 删除不可恢复，跳过
        }
        // mkdir 不回滚（留空目录无害，可用清理空目录功能处理）
      } catch (e) {
        if (e instanceof OlmAuthError) throw e;
        failed++;
        errors.push((op.t === "move" ? "移回 " + op.name : "改回 " + op.to) + " 失败: " + ((e && e.message) || e));
      }
      onProgress({ phase: "undo", done: i + 1, total: ops.length });
    }
    rec.status = failed ? "undo_partial" : "undone";
    rec.undoneAt = olmNowIso();
    return { done: done, failed: failed, errors: errors, skippedDeletes: skippedDeletes };
  }

  return { execute: execute, undo: undo };
}

/* ==== src/11-store.js ==== */
/* ==== 任务记录持久化（localStorage） ==== */

function taskToRecord(task) {
  return {
    id: task.id,
    createdAt: task.createdAt,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    undoneAt: task.undoneAt || null,
    root: task.root,
    status: task.status,
    stats: task.stats || null,
    groups: (task.groups || [])
      .filter(function (g) { return g.type === "movie" || g.type === "tv"; })
      .map(function (g) {
        return {
          type: g.type,
          display: olmGroupDisplay(g),
          tmdbId: g.tmdb ? g.tmdb.id : null,
          matchStatus: g.matchStatus,
          count: (g.itemIds || []).length
        };
      }),
    items: (task.items || []).map(function (it) {
      return {
        src: it.file.path,
        dst: it.dstDir && it.dstName ? pathJoin(it.dstDir, it.dstName) : null,
        action: it.action,
        include: it.include,
        status: it.status,
        reason: it.reason || ""
      };
    }),
    ops: task.ops || [],
    log: task.log || []
  };
}

function listTaskRecords() {
  return lsGetJSON(OLM_KEYS.tasks, []);
}

function getTaskRecord(id) {
  var list = listTaskRecords();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function saveTaskRecord(rec) {
  var list = listTaskRecords();
  list = list.filter(function (r) { return r.id !== rec.id; });
  list.unshift(rec);
  while (list.length > 20) list.pop();
  // 存储超限时丢弃最老的记录重试
  while (!lsSetJSON(OLM_KEYS.tasks, list) && list.length > 1) list.pop();
  return rec;
}

function updateTaskRecord(rec) {
  return saveTaskRecord(rec);
}

function deleteTaskRecord(id) {
  var list = listTaskRecords().filter(function (r) { return r.id !== id; });
  lsSetJSON(OLM_KEYS.tasks, list);
}

/* ==== src/12-ui-core.js ==== */
/* ==== UI 核心：Shadow DOM 面板骨架 / 样式 / 模态 / 事件分发 ==== */

var OLM_CSS = [
  ":host { all: initial; }",
  "* { box-sizing: border-box; margin: 0; padding: 0; }",
  ".olm-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; font-size: 14px; color: #e5e7eb; }",
  "",
  "/* 悬浮按钮（可拖动；right 默认留出 OpenList 右侧工具栏的位置） */",
  ".olm-fab { position: fixed; bottom: 96px; z-index: 2147483000; width: 48px; height: 48px; border-radius: 50%; border: none; cursor: pointer; background: linear-gradient(135deg, #059669, #0d9488); color: #fff; font-size: 22px; line-height: 1; box-shadow: 0 4px 14px rgba(0,0,0,.35); transition: transform .15s ease; display: flex; align-items: center; justify-content: center; touch-action: none; user-select: none; -webkit-user-select: none; }",
  ".olm-fab:hover { transform: scale(1.08); }",
  ".olm-fab.right { right: 76px; } .olm-fab.left { left: 20px; }",
  "",
  "/* 遮罩与面板 */",
  ".olm-overlay { position: fixed; inset: 0; z-index: 2147483001; background: rgba(2,6,16,.62); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 2vh 1vw; }",
  ".olm-panel { width: min(1180px, 97vw); height: 94vh; background: #0d1420; border: 1px solid rgba(255,255,255,.09); border-radius: 14px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 70px rgba(0,0,0,.55); }",
  ".olm-head { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,.08); background: #0f1727; flex: none; }",
  ".olm-head .t { font-size: 16px; font-weight: 700; letter-spacing: .5px; }",
  ".olm-head .t em { color: #34d399; font-style: normal; }",
  ".olm-head .v { color: #64748b; font-size: 11px; }",
  ".olm-tabs { display: flex; gap: 4px; margin-left: 14px; }",
  ".olm-tab { padding: 7px 16px; border-radius: 8px; cursor: pointer; color: #94a3b8; border: none; background: transparent; font-size: 13.5px; }",
  ".olm-tab:hover { color: #e5e7eb; background: rgba(255,255,255,.05); }",
  ".olm-tab.on { color: #052e22; background: #34d399; font-weight: 600; }",
  ".olm-close { margin-left: auto; border: none; background: transparent; color: #94a3b8; font-size: 20px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }",
  ".olm-close:hover { color: #f87171; background: rgba(248,113,113,.1); }",
  ".olm-body { flex: 1; overflow-y: auto; padding: 18px; }",
  ".olm-body::-webkit-scrollbar { width: 9px; } .olm-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 5px; }",
  "",
  "/* 通用控件 */",
  ".olm-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: #1a2334; color: #e5e7eb; cursor: pointer; font-size: 13.5px; transition: all .12s; }",
  ".olm-btn:hover { border-color: rgba(255,255,255,.3); background: #222d42; }",
  ".olm-btn:disabled { opacity: .45; cursor: not-allowed; }",
  ".olm-btn.pri { background: #059669; border-color: #059669; color: #fff; font-weight: 600; }",
  ".olm-btn.pri:hover { background: #10b981; }",
  ".olm-btn.warn { background: #b45309; border-color: #b45309; color: #fff; }",
  ".olm-btn.warn:hover { background: #d97706; }",
  ".olm-btn.danger { background: transparent; border-color: #7f1d1d; color: #f87171; }",
  ".olm-btn.danger:hover { background: rgba(248,113,113,.1); }",
  ".olm-btn.sm { padding: 4px 10px; font-size: 12.5px; border-radius: 6px; }",
  ".olm-input, .olm-select { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: #0a101c; color: #e5e7eb; font-size: 13.5px; outline: none; }",
  ".olm-input:focus, .olm-select:focus { border-color: #34d399; }",
  ".olm-input.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }",
  ".olm-row { display: flex; gap: 10px; align-items: center; }",
  ".olm-field { margin-bottom: 12px; }",
  ".olm-field > label { display: block; color: #94a3b8; font-size: 12.5px; margin-bottom: 5px; }",
  ".olm-hint { color: #64748b; font-size: 12px; margin-top: 4px; line-height: 1.5; }",
  ".olm-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; color: #cbd5e1; font-size: 13px; user-select: none; }",
  ".olm-switch input { appearance: none; width: 36px; height: 20px; border-radius: 10px; background: #334155; position: relative; cursor: pointer; transition: background .15s; flex: none; }",
  ".olm-switch input:checked { background: #059669; }",
  ".olm-switch input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; }",
  ".olm-switch input:checked::after { left: 18px; }",
  "",
  "/* 卡片与徽标 */",
  ".olm-card { background: #121a2a; border: 1px solid rgba(255,255,255,.07); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }",
  ".olm-chip { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; line-height: 1.5; white-space: nowrap; }",
  ".olm-chip.green { background: rgba(52,211,153,.14); color: #34d399; }",
  ".olm-chip.blue { background: rgba(56,189,248,.14); color: #38bdf8; }",
  ".olm-chip.red { background: rgba(248,113,113,.15); color: #f87171; }",
  ".olm-chip.yellow { background: rgba(251,191,36,.14); color: #fbbf24; }",
  ".olm-chip.gray { background: rgba(148,163,184,.14); color: #94a3b8; }",
  ".olm-chip.purple { background: rgba(192,132,252,.15); color: #c084fc; }",
  "",
  "/* 方案表格 */",
  ".olm-items { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }",
  ".olm-items th { text-align: left; color: #64748b; font-size: 11.5px; font-weight: 500; padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,.07); }",
  ".olm-items td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.045); font-size: 12.5px; vertical-align: top; word-break: break-all; }",
  ".olm-items tr:last-child td { border-bottom: none; }",
  ".olm-items .path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: #cbd5e1; line-height: 1.45; }",
  ".olm-items .path.new { color: #6ee7b7; }",
  ".olm-items .path.dim { color: #64748b; }",
  ".olm-items input[type=checkbox] { width: 15px; height: 15px; accent-color: #059669; cursor: pointer; }",
  ".olm-iconbtn { border: none; background: transparent; color: #64748b; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 5px; }",
  ".olm-iconbtn:hover { color: #e5e7eb; background: rgba(255,255,255,.08); }",
  "",
  "/* 组卡片头 */",
  ".olm-ghead { display: flex; gap: 12px; align-items: flex-start; }",
  ".olm-poster { width: 46px; height: 69px; border-radius: 6px; object-fit: cover; background: #1e293b; flex: none; }",
  ".olm-ghead .info { flex: 1; min-width: 0; }",
  ".olm-ghead .name { font-size: 15px; font-weight: 700; margin-bottom: 5px; }",
  ".olm-ghead .meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }",
  ".olm-ghead .olm-overview { color: #64748b; font-size: 12px; margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
  "",
  "/* 进度 */",
  ".olm-steps { max-width: 520px; margin: 60px auto; }",
  ".olm-step { display: flex; align-items: center; gap: 12px; padding: 12px 4px; color: #94a3b8; font-size: 14px; }",
  ".olm-step .ic { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #1e293b; font-size: 13px; flex: none; }",
  ".olm-step.on { color: #e5e7eb; } .olm-step.on .ic { background: rgba(52,211,153,.18); color: #34d399; }",
  ".olm-step.ok { color: #64748b; } .olm-step.ok .ic { background: rgba(52,211,153,.12); color: #34d399; }",
  ".olm-bar { height: 8px; border-radius: 5px; background: #1e293b; overflow: hidden; margin: 14px 0; }",
  ".olm-bar > i { display: block; height: 100%; background: linear-gradient(90deg, #059669, #34d399); transition: width .25s; }",
  ".olm-spin { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(52,211,153,.3); border-top-color: #34d399; border-radius: 50%; animation: olmspin .8s linear infinite; }",
  "@keyframes olmspin { to { transform: rotate(360deg); } }",
  "",
  "/* 模态 */",
  ".olm-modal-mask { position: absolute; inset: 0; background: rgba(2,6,16,.6); display: flex; align-items: center; justify-content: center; z-index: 10; }",
  ".olm-modal { width: min(640px, 92%); max-height: 84%; overflow-y: auto; background: #131c2e; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 18px 20px; box-shadow: 0 18px 50px rgba(0,0,0,.5); }",
  ".olm-modal h3 { font-size: 15px; margin-bottom: 14px; }",
  ".olm-modal .acts { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }",
  "",
  "/* toast */",
  ".olm-toast { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); background: #1e293b; border: 1px solid rgba(255,255,255,.15); color: #e5e7eb; padding: 9px 18px; border-radius: 9px; font-size: 13px; z-index: 20; box-shadow: 0 8px 24px rgba(0,0,0,.4); max-width: 80%; }",
  ".olm-toast.err { border-color: rgba(248,113,113,.5); color: #fca5a5; }",
  ".olm-toast.ok { border-color: rgba(52,211,153,.5); color: #6ee7b7; }",
  "",
  "/* 记录列表 */",
  ".olm-rec { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid rgba(255,255,255,.07); border-radius: 10px; margin-bottom: 10px; cursor: pointer; background: #121a2a; }",
  ".olm-rec:hover { border-color: rgba(52,211,153,.4); }",
  ".olm-rec .path { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; color: #cbd5e1; }",
  ".olm-rec .time { color: #64748b; font-size: 12px; }",
  "",
  "/* 设置 */",
  ".olm-sec { margin-bottom: 22px; }",
  ".olm-sec > h3 { font-size: 14px; color: #34d399; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,.07); }",
  ".olm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }",
  "@media (max-width: 720px) { .olm-grid2 { grid-template-columns: 1fr; } .olm-panel { height: 97vh; } }",
  "",
  "/* 目录选择器 */",
  ".olm-dirlist { max-height: 300px; overflow-y: auto; border: 1px solid rgba(255,255,255,.09); border-radius: 8px; margin: 10px 0; }",
  ".olm-diritem { padding: 8px 12px; cursor: pointer; font-size: 13px; display: flex; gap: 8px; align-items: center; border-bottom: 1px solid rgba(255,255,255,.04); }",
  ".olm-diritem:hover { background: rgba(52,211,153,.08); }",
  "",
  ".olm-empty { text-align: center; color: #64748b; padding: 60px 0; font-size: 13.5px; line-height: 2; }",
  ".olm-banner { padding: 10px 14px; border-radius: 9px; font-size: 12.5px; line-height: 1.6; margin-bottom: 14px; }",
  ".olm-banner.warn { background: rgba(251,191,36,.08); border: 1px solid rgba(251,191,36,.25); color: #fcd34d; }",
  ".olm-banner.info { background: rgba(56,189,248,.07); border: 1px solid rgba(56,189,248,.22); color: #7dd3fc; }",
  ".olm-banner.err { background: rgba(248,113,113,.08); border: 1px solid rgba(248,113,113,.3); color: #fca5a5; }",
  "details.olm-fold > summary { cursor: pointer; color: #94a3b8; font-size: 13px; padding: 6px 0; user-select: none; }",
  ".olm-log { background: #0a101c; border-radius: 8px; padding: 10px 12px; font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; color: #94a3b8; max-height: 220px; overflow-y: auto; line-height: 1.7; white-space: pre-wrap; word-break: break-all; }"
].join("\n");

var olmUI = {
  host: null,
  root: null,          // shadowRoot
  open: false,
  tab: "organize",
  actions: {},         // data-act → fn(el, ev)
  tabs: {},            // tab → {render}
  state: {}
};

function olmEl(sel) {
  return olmUI.root ? olmUI.root.querySelector(sel) : null;
}

function olmEls(sel) {
  return olmUI.root ? [].slice.call(olmUI.root.querySelectorAll(sel)) : [];
}

function olmToast(msg, type, ms) {
  var panel = olmEl(".olm-panel");
  if (!panel) return;
  var old = olmEl(".olm-toast");
  if (old) old.remove();
  var d = document.createElement("div");
  d.className = "olm-toast" + (type ? " " + type : "");
  d.textContent = msg;
  panel.appendChild(d);
  setTimeout(function () { if (d.parentNode) d.remove(); }, ms || 2600);
}

// 打开模态；返回关闭函数。html 内的 data-act 走统一分发
function olmModal(html) {
  var panel = olmEl(".olm-panel");
  if (!panel) return function () {};
  var mask = document.createElement("div");
  mask.className = "olm-modal-mask";
  mask.innerHTML = '<div class="olm-modal">' + html + "</div>";
  panel.appendChild(mask);
  mask.addEventListener("click", function (e) {
    if (e.target === mask) mask.remove();
  });
  return function () { if (mask.parentNode) mask.remove(); };
}

function olmConfirm(opts) {
  return new Promise(function (resolve) {
    var close = olmModal(
      "<h3>" + escHtml(opts.title || "确认") + "</h3>" +
      '<div style="color:#cbd5e1;font-size:13.5px;line-height:1.8">' + (opts.html || escHtml(opts.text || "")) + "</div>" +
      '<div class="acts">' +
      '<button class="olm-btn" data-olm-cancel>取消</button>' +
      '<button class="olm-btn ' + (opts.danger ? "warn" : "pri") + '" data-olm-ok>' + escHtml(opts.okText || "确认") + "</button>" +
      "</div>"
    );
    var mask = olmEl(".olm-modal-mask:last-child");
    if (!mask) { resolve(false); return; }
    mask.querySelector("[data-olm-cancel]").addEventListener("click", function () { close(); resolve(false); });
    mask.querySelector("[data-olm-ok]").addEventListener("click", function () { close(); resolve(true); });
  });
}

function olmSetPath(obj, path, value) {
  var parts = path.split(".");
  var cur = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!isPlainObj(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function olmGetPath(obj, path) {
  var parts = path.split(".");
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function olmCurrentDirFromLocation() {
  try {
    var p = decodeURIComponent(location.pathname || "/");
    p = p.replace(/\/+$/, "");
    return p || "/";
  } catch (e) { return "/"; }
}

function olmRenderTab() {
  var body = olmEl(".olm-body");
  if (!body) return;
  var t = olmUI.tabs[olmUI.tab];
  body.innerHTML = t ? t.render() : "";
  if (t && t.after) t.after(body);
  olmEls(".olm-tab").forEach(function (el) {
    el.classList.toggle("on", el.getAttribute("data-tab") === olmUI.tab);
  });
}

function olmOpenPanel(tab) {
  olmUI.open = true;
  if (tab) olmUI.tab = tab;
  var ov = olmEl(".olm-overlay");
  if (ov) ov.style.display = "flex";
  olmRenderTab();
}

function olmClosePanel() {
  olmUI.open = false;
  var ov = olmEl(".olm-overlay");
  if (ov) ov.style.display = "none";
}

/* ---- 悬浮按钮：拖动摆放并记住位置 ----
 * 位置存 OLM_KEYS.fabPos = { xp, yp }，为按钮左上角在可移动范围内的比例(0~1)，
 * 换分辨率/窗口大小时按比例还原并夹在视口内。 */

function olmApplyFabPos(fab) {
  var pos = lsGetJSON(OLM_KEYS.fabPos, null);
  if (!isPlainObj(pos) || pos.xp == null || pos.yp == null) return false;
  var w = fab.offsetWidth || 48, h = fab.offsetHeight || 48;
  var maxX = Math.max(0, window.innerWidth - w), maxY = Math.max(0, window.innerHeight - h);
  fab.style.left = Math.round(Math.min(Math.max(pos.xp, 0), 1) * maxX) + "px";
  fab.style.top = Math.round(Math.min(Math.max(pos.yp, 0), 1) * maxY) + "px";
  fab.style.right = "auto";
  fab.style.bottom = "auto";
  return true;
}

function olmSaveFabPos(fab) {
  var r = fab.getBoundingClientRect();
  var maxX = Math.max(1, window.innerWidth - r.width), maxY = Math.max(1, window.innerHeight - r.height);
  lsSetJSON(OLM_KEYS.fabPos, {
    xp: Math.min(Math.max(r.left / maxX, 0), 1),
    yp: Math.min(Math.max(r.top / maxY, 0), 1)
  });
}

// 清除拖动位置并回到 side 对应的默认位置（设置页切换左右时调用）
function olmResetFabPos(side) {
  try { olmStorage.removeItem(OLM_KEYS.fabPos); } catch (e) { /* ignore */ }
  var fab = olmEl(".olm-fab");
  if (!fab) return;
  fab.classList.toggle("left", side === "left");
  fab.classList.toggle("right", side !== "left");
  fab.style.left = fab.style.top = fab.style.right = fab.style.bottom = "";
}

function olmMakeFabDraggable(fab) {
  var drag = null;
  fab.addEventListener("pointerdown", function (e) {
    if (e.button != null && e.button !== 0) return;
    var r = fab.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, on: false };
    if (fab.setPointerCapture) {
      try { fab.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  });
  fab.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.on && dx * dx + dy * dy < 36) return; // 移动超过 6px 才算拖动，避免误吞点击
    drag.on = true;
    var w = fab.offsetWidth || 48, h = fab.offsetHeight || 48;
    fab.style.left = Math.min(Math.max(drag.ox + dx, 4), window.innerWidth - w - 4) + "px";
    fab.style.top = Math.min(Math.max(drag.oy + dy, 4), window.innerHeight - h - 4) + "px";
    fab.style.right = "auto";
    fab.style.bottom = "auto";
  });
  function done(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var moved = drag.on;
    drag = null;
    if (!moved) return;
    fab.__olmDragged = true; // 吃掉拖动结束触发的 click
    setTimeout(function () { fab.__olmDragged = false; }, 120);
    olmSaveFabPos(fab);
  }
  fab.addEventListener("pointerup", done);
  fab.addEventListener("pointercancel", done);
  window.addEventListener("resize", function () { olmApplyFabPos(fab); });
}

function olmMountUI() {
  if (olmUI.host) return;
  var host = document.createElement("div");
  host.id = "olm-host";
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  olmUI.host = host;
  olmUI.root = root;

  var side = (olmGetSettings().ui.fabSide === "left") ? "left" : "right";
  var wrap = document.createElement("div");
  wrap.className = "olm-root";
  wrap.innerHTML =
    "<style>" + OLM_CSS + "</style>" +
    '<button class="olm-fab ' + side + '" title="影视智能整理">🎬</button>' +
    '<div class="olm-overlay" style="display:none">' +
    '<div class="olm-panel">' +
    '<div class="olm-head">' +
    '<div class="t">🎬 影视<em>整理</em></div>' +
    '<div class="v">v' + OLM_VERSION + "</div>" +
    '<div class="olm-tabs">' +
    '<button class="olm-tab" data-tab="organize">整理</button>' +
    '<button class="olm-tab" data-tab="tasks">记录</button>' +
    '<button class="olm-tab" data-tab="settings">设置</button>' +
    "</div>" +
    '<button class="olm-close" title="关闭">✕</button>' +
    "</div>" +
    '<div class="olm-body"></div>' +
    "</div></div>";
  root.appendChild(wrap);

  var fab = root.querySelector(".olm-fab");
  fab.addEventListener("click", function () {
    if (fab.__olmDragged) { fab.__olmDragged = false; return; }
    if (olmUI.open) olmClosePanel();
    else {
      // 每次打开时刷新默认路径为当前浏览目录
      if (olmUI.state.organize && olmUI.state.organize.step === "idle") {
        olmUI.state.organize.path = olmCurrentDirFromLocation();
      }
      olmOpenPanel();
    }
  });
  olmApplyFabPos(fab);
  olmMakeFabDraggable(fab);
  root.querySelector(".olm-close").addEventListener("click", olmClosePanel);
  root.querySelector(".olm-overlay").addEventListener("click", function (e) {
    if (e.target === root.querySelector(".olm-overlay")) {
      // 点遮罩不关面板（防误触丢方案），只有关闭按钮才关
    }
  });
  olmEls(".olm-tab").forEach(function (el) {
    el.addEventListener("click", function () {
      olmUI.tab = el.getAttribute("data-tab");
      olmRenderTab();
    });
  });

  // 统一事件分发
  root.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (olmUI.actions[act]) olmUI.actions[act](el, e);
  });
  root.addEventListener("change", function (e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var act = el.getAttribute("data-chg");
    if (act && olmUI.actions[act]) olmUI.actions[act](el, e);
  });
}

/* ==== src/13-ui-organize.js ==== */
/* ==== UI：整理页 ==== */

olmUI.state.organize = {
  step: "idle",        // idle | running | plan | executing | result
  path: "/",
  progress: null,
  task: null,
  record: null,
  error: null,
  cancelFlag: null,
  _pipeline: null,
  _executor: null
};

var _olmRenderLast = 0, _olmRenderTimer = null;
function olmProgressRender() {
  var now = Date.now();
  if (now - _olmRenderLast > 150) {
    _olmRenderLast = now;
    olmRenderTab();
  } else if (!_olmRenderTimer) {
    _olmRenderTimer = setTimeout(function () {
      _olmRenderTimer = null;
      _olmRenderLast = Date.now();
      olmRenderTab();
    }, 160);
  }
}

function olmMakeClients(cancelFlag) {
  var ol = createOpenListClient({});
  var ai = createAiClient(function () { return olmGetSettings().ai; });
  var tmdb = createTmdbClient(function () { return olmGetSettings().tmdb; });
  var deps = {
    ol: ol, ai: ai, tmdb: tmdb,
    getSettings: olmGetSettings,
    isCancelled: function () { return cancelFlag && cancelFlag.cancelled; },
    onProgress: function (p) {
      olmUI.state.organize.progress = p;
      olmProgressRender();
    }
  };
  return {
    ol: ol, ai: ai, tmdb: tmdb,
    pipeline: createPipeline(deps),
    executor: createExecutor(deps)
  };
}

function olmRelToRoot(root, dir, name) {
  var full = pathJoin(dir, name);
  if (root !== "/" && full.indexOf(root + "/") === 0) return full.slice(root.length + 1);
  if (full.indexOf("/") === 0 && root === "/") return full.slice(1);
  return full;
}

function olmPosterUrl(posterPath, w) {
  var cfg = olmGetSettings().tmdb;
  if (!posterPath || !cfg.showPosters) return null;
  return String(cfg.imageBaseUrl || "https://image.tmdb.org").replace(/\/+$/, "") +
    "/t/p/w" + (w || 92) + posterPath;
}

function olmStatusChip(it) {
  if (it.status === "ok") {
    if (it.action === "delete") return `<span class="olm-chip red">删除</span>`;
    var label = it.action === "trash" ? "→回收站" : (it.action === "rename" ? "改名" : "移动");
    return `<span class="olm-chip green">${label}</span>`;
  }
  if (it.status === "same") return `<span class="olm-chip gray">已规范</span>`;
  if (it.status === "conflict") return `<span class="olm-chip red">冲突</span>`;
  if (it.status === "excluded") return `<span class="olm-chip gray">跳过</span>`;
  if (it.status === "done") return `<span class="olm-chip green">✓ 完成</span>`;
  if (it.status === "failed") return `<span class="olm-chip red">失败</span>`;
  return `<span class="olm-chip gray">${escHtml(it.status)}</span>`;
}

function olmGroupChips(g) {
  var chips = [];
  var typeMap = { movie: ["电影", "blue"], tv: ["剧集", "purple"], junk: ["垃圾文件", "red"], extra: ["花絮/样片", "yellow"], unknown: ["未识别", "gray"] };
  var tm = typeMap[g.type] || [g.type, "gray"];
  chips.push(`<span class="olm-chip ${tm[1]}">${tm[0]}</span>`);
  if (g.type === "movie" || g.type === "tv") {
    if (g.matchStatus === "matched" || g.matchStatus === "manual") {
      var url = "https://www.themoviedb.org/" + g.tmdb.mediaType + "/" + g.tmdb.id;
      chips.push(`<span class="olm-chip green">TMDB ✓ <a href="${url}" target="_blank" rel="noreferrer" style="color:inherit">${g.tmdb.id}</a>${g.matchStatus === "manual" ? " (手动)" : ""}</span>`);
    } else if (g.matchStatus === "unmatched") {
      chips.push(`<span class="olm-chip yellow">TMDB 未匹配</span>`);
    } else if (g.matchStatus === "skipped") {
      chips.push(`<span class="olm-chip gray">TMDB 未启用</span>`);
    }
  }
  return chips.join(" ");
}

function olmRenderOrganize() {
  var st = olmUI.state.organize;
  var s = olmGetSettings();
  if (st.step === "running") return olmRenderRunning(st);
  if (st.step === "plan") return olmRenderPlan(st);
  if (st.step === "executing") return olmRenderExecuting(st);
  if (st.step === "result") return olmRenderResult(st);

  // idle
  var warns = "";
  if (!findOpenListToken()) {
    warns += `<div class="olm-banner err">⚠ 未检测到 OpenList 登录 token。请先登录 OpenList，或到「设置」手动填写 token。</div>`;
  }
  if (!s.ai.enabled || !s.ai.apiKey) {
    warns += `<div class="olm-banner info">ℹ 未配置 AI 接口，将使用内置规则解析文件名（对复杂命名识别率较低）。到「设置 → AI 解析」配置后效果更佳。</div>`;
  }
  if (!s.tmdb.enabled || !s.tmdb.apiKey) {
    warns += `<div class="olm-banner info">ℹ 未配置 TMDB，无法校准官方译名/年份/集标题。到「设置 → TMDB」配置（免费申请 API Key）。</div>`;
  }
  if (st.error) {
    warns += `<div class="olm-banner err">✕ ${escHtml(st.error)}</div>`;
  }
  var modeDesc = s.organize.targetMode === "custom"
    ? `整理到指定媒体库目录（电影 → <b>${escHtml(s.organize.movieDir || "(未设置，用原目录)")}</b>，剧集 → <b>${escHtml(s.organize.tvDir || "(未设置，用原目录)")}</b>）`
    : "在所选目录内就地整理";
  var junkDesc = { trash: "移入回收站", delete: "直接删除（执行前确认）" }[s.organize.junkAction] || "忽略";

  return `
  ${warns}
  <div class="olm-card">
    <div class="olm-field">
      <label>要整理的目录（OpenList 路径）</label>
      <div class="olm-row">
        <input class="olm-input mono" id="olm-path" value="${escHtml(st.path)}" placeholder="/网盘/电影下载" />
        <button class="olm-btn" data-act="pickDir" style="flex:none">浏览…</button>
        <button class="olm-btn" data-act="useCurrentDir" style="flex:none" title="使用当前 OpenList 页面所在目录">当前目录</button>
      </div>
    </div>
    <div class="olm-field">
      <label>整理到目录（可选；留空 = ${s.organize.targetMode === "custom" ? "设置的媒体库目录" : "就地整理"}）</label>
      <div class="olm-row">
        <input class="olm-input mono" id="olm-target" value="${escHtml(st.targetDir || "")}" placeholder="本次整理的输出目录，如 /网盘/媒体库/剧集" />
        <button class="olm-btn" data-act="pickTargetDir" style="flex:none">浏览…</button>
      </div>
      <div class="olm-hint">电影/剧集的规范目录会建到这里（垃圾回收站仍在扫描目录内）。整理单个剧集文件夹时，选它的上级目录即可避免套娃。</div>
    </div>
    <div class="olm-row" style="flex-wrap:wrap;gap:16px;margin-top:4px">
      <label class="olm-switch"><input type="checkbox" data-chg="quickRecursive" ${s.organize.recursive ? "checked" : ""}/> 递归子目录（深度 ${s.organize.maxDepth}）</label>
      <label class="olm-switch"><input type="checkbox" data-chg="quickRefresh" ${st.refresh ? "checked" : ""}/> 强制刷新目录缓存</label>
      <span class="olm-hint" style="margin:0">垃圾文件：${junkDesc}　|　${modeDesc}</span>
    </div>
    <div style="margin-top:16px">
      <button class="olm-btn pri" data-act="startOrganize">🔍 扫描并生成整理方案</button>
    </div>
  </div>
  <div class="olm-card" style="color:#94a3b8;font-size:12.5px;line-height:2">
    <b style="color:#cbd5e1">流程</b>：扫描目录 → AI/规则解析文件名 → TMDB 匹配官方元数据 → 生成 Emby 规范命名方案 → <b style="color:#fbbf24">人工确认</b> → 限速执行 → 可一键撤销<br/>
    <b style="color:#cbd5e1">命名产物</b>：电影 <code>片名 (年份) [tmdbid=xxx]/片名 (年份) - 2160p.mkv</code>　剧集 <code>剧名 (年份) [tmdbid=xxx]/Season 01/剧名 - S01E01 - 集标题.mkv</code><br/>
    <b style="color:#cbd5e1">安全</b>：只做 新建目录/重命名/移动，不调用删除接口；垃圾文件最多移入回收站目录；每次执行都有操作日志，支持撤销。
  </div>`;
}

function olmRenderRunning(st) {
  var p = st.progress || { phase: "scan" };
  var phases = [
    ["scan", "扫描目录", p.phase === "scan" ? (p.done + " 个文件") : ""],
    ["ai", "AI 解析文件名", p.phase === "ai" ? (p.done + "/" + p.total + " 批") : ""],
    ["match", "TMDB 元数据匹配", p.phase === "match" ? (p.done + "/" + p.total + " 组") : ""],
    ["plan", "生成整理方案", ""]
  ];
  var order = { scan: 0, ai: 1, match: 2, plan: 3 };
  var curIdx = order[p.phase] != null ? order[p.phase] : 0;
  var rows = phases.map(function (ph, i) {
    var cls = i < curIdx ? "ok" : (i === curIdx ? "on" : "");
    var ic = i < curIdx ? "✓" : (i === curIdx ? `<span class="olm-spin"></span>` : (i + 1));
    return `<div class="olm-step ${cls}"><span class="ic">${ic}</span><span>${ph[1]}</span><span style="margin-left:auto;color:#64748b;font-size:12px">${escHtml(ph[2] || "")}</span></div>`;
  }).join("");
  return `
  <div class="olm-steps">
    <div style="text-align:center;color:#cbd5e1;margin-bottom:20px;font-size:15px">正在分析 <span class="path" style="color:#34d399">${escHtml(st.path)}</span></div>
    ${rows}
    <div style="color:#475569;font-size:11.5px;margin-top:6px;min-height:16px;text-align:center">${escHtml((p.note || "").slice(-60))}</div>
    <div style="text-align:center;margin-top:24px"><button class="olm-btn danger" data-act="cancelRun">取消</button></div>
  </div>`;
}

function olmItemRow(task, it) {
  var src = olmRelToRoot(task.root, it.file.dir, it.file.name);
  var dst = it.dstDir && it.dstName ? olmRelToRoot(task.root, it.dstDir, it.dstName) : "";
  var canCheck = it.status === "ok" || it.status === "conflict" ||
    (it.status === "excluded" && (!!(it.dstDir && it.dstName) || it.action === "delete"));
  var right;
  if (dst && it.status !== "same") {
    right = `<div class="path new">${escHtml(dst)}</div>` +
      (it.reason && it.status !== "ok" ? `<div class="olm-hint">${escHtml(it.reason)}</div>` : "");
  } else {
    right = `<div class="olm-hint" style="margin:0">${escHtml(it.reason || "—")}</div>`;
  }
  return `<tr>
    <td style="width:30px"><input type="checkbox" data-chg="toggleItem" data-id="${it.id}" ${it.include ? "checked" : ""} ${canCheck ? "" : "disabled"}/></td>
    <td style="width:44%"><div class="path ${it.status === "same" ? "dim" : ""}">${escHtml(src)}</div></td>
    <td style="width:20px;color:#475569">→</td>
    <td>${right}</td>
    <td style="width:76px">${olmStatusChip(it)}</td>
    <td style="width:34px">${it.status !== "done" ? `<button class="olm-iconbtn" data-act="editItem" data-id="${it.id}" title="手动编辑目标路径">✎</button>` : ""}</td>
  </tr>`;
}

function olmRenderPlan(st) {
  var task = st.task;
  var stats = task.stats || olmComputeStats(task.items);
  var byGroup = {};
  task.items.forEach(function (it) { (byGroup[it.groupId] = byGroup[it.groupId] || []).push(it); });

  var mediaGroups = task.groups.filter(function (g) { return (g.type === "movie" || g.type === "tv") && (byGroup[g.id] || []).length; });
  var otherGroups = task.groups.filter(function (g) { return g.type !== "movie" && g.type !== "tv" && (byGroup[g.id] || []).length; });
  mediaGroups.sort(function (a, b) { return (a.type + (a.title || "")).localeCompare(b.type + (b.title || ""), "zh"); });

  var banners = "";
  if (task.truncated) banners += `<div class="olm-banner warn">⚠ 文件数超过上限（设置中的「单次最大文件数」），本次只处理了前 ${task.items.length} 个。</div>`;
  if (task.aiErrors && task.aiErrors.length) banners += `<div class="olm-banner warn">⚠ 部分 AI 解析失败（已回退本地规则）：${escHtml(task.aiErrors[0])}${task.aiErrors.length > 1 ? " 等 " + task.aiErrors.length + " 条" : ""}</div>`;
  var unmatched = mediaGroups.filter(function (g) { return g.matchStatus === "unmatched"; });
  if (unmatched.length) banners += `<div class="olm-banner info">ℹ ${unmatched.length} 个媒体未匹配到 TMDB，命名将使用解析出的标题。可点各组「重新匹配」手动搜索。</div>`;

  var groupsHtml = mediaGroups.map(function (g) {
    var items = byGroup[g.id] || [];
    items.sort(function (a, b) {
      var ka = (a.parsed.season || 0) * 10000 + (a.parsed.episode || 0);
      var kb = (b.parsed.season || 0) * 10000 + (b.parsed.episode || 0);
      return ka - kb || a.file.path.localeCompare(b.file.path);
    });
    var poster = g.tmdb ? olmPosterUrl(g.tmdb.posterPath, 92) : null;
    var inc = items.filter(function (x) { return x.include; }).length;
    var allOn = inc > 0 && items.every(function (x) { return x.include || (x.status !== "ok" && x.status !== "excluded"); });
    var aiN = items.filter(function (x) { return x.parsed && x.parsed.from === "ai"; }).length;
    var parseChip = aiN === items.length ? "AI 解析" : (aiN > 0 ? `AI 解析 ${aiN}/${items.length}` : "规则解析");
    return `<div class="olm-card">
      <div class="olm-ghead">
        ${poster ? `<img class="olm-poster" src="${poster}" loading="lazy" onerror="this.style.display='none'"/>` : ""}
        <div class="info">
          <div class="name">${escHtml(olmGroupDisplay(g))}</div>
          <div class="meta">${olmGroupChips(g)}
            <span class="olm-chip gray">${items.length} 个文件</span>
            <span class="olm-chip gray" title="文件名解析来源">${parseChip}</span>
            <span style="flex:1"></span>
            <label class="olm-switch" style="font-size:12px"><input type="checkbox" data-chg="toggleGroup" data-gid="${g.id}" ${allOn ? "checked" : ""}/> 全选</label>
            <button class="olm-btn sm" data-act="rematchOpen" data-gid="${g.id}">🔎 重新匹配</button>
          </div>
          ${g.tmdb && g.tmdb.overview ? `<div class="olm-overview">${escHtml(g.tmdb.overview)}</div>` : ""}
          ${g.note ? `<div class="olm-hint">${escHtml(g.note)}</div>` : ""}
        </div>
      </div>
      <table class="olm-items"><thead><tr><th></th><th>原路径</th><th></th><th>新路径</th><th>动作</th><th></th></tr></thead>
      <tbody>${items.map(function (it) { return olmItemRow(task, it); }).join("")}</tbody></table>
    </div>`;
  }).join("");

  var otherHtml = otherGroups.map(function (g) {
    var items = byGroup[g.id] || [];
    var label = { junk: "垃圾文件", extra: "花絮 / 样片 / 附加内容", unknown: "未识别文件" }[g.type] || g.type;
    return `<details class="olm-fold olm-card" style="padding:10px 16px">
      <summary>${label}（${items.length}）　${olmGroupChips(g)}</summary>
      <table class="olm-items"><tbody>${items.map(function (it) { return olmItemRow(task, it); }).join("")}</tbody></table>
    </details>`;
  }).join("");

  return `
  ${banners}
  <div class="olm-row" style="margin-bottom:14px;flex-wrap:wrap">
    <span class="olm-chip blue">共 ${stats.total} 项</span>
    <span class="olm-chip green">将执行 ${stats.included}（移动 ${stats.move} / 改名 ${stats.rename}${stats.trash ? " / 回收 " + stats.trash : ""}${stats.del ? " / 删除 " + stats.del : ""}）</span>
    ${stats.del ? `<span class="olm-chip red">⚠ 删除 ${stats.del} 项不可恢复</span>` : ""}
    ${stats.same ? `<span class="olm-chip gray">已规范 ${stats.same}</span>` : ""}
    ${stats.conflict ? `<span class="olm-chip red">冲突 ${stats.conflict}</span>` : ""}
    ${stats.excluded ? `<span class="olm-chip gray">跳过 ${stats.excluded}</span>` : ""}
    <span style="flex:1"></span>
    <button class="olm-btn" data-act="backToIdle">← 返回</button>
    <button class="olm-btn pri" data-act="executePlan" ${stats.included ? "" : "disabled"}>🚀 执行 ${stats.included} 项</button>
  </div>
  <div class="olm-hint" style="margin:-6px 0 12px">目录：<span style="color:#94a3b8">${escHtml(task.root)}</span>${task.targetDir ? `　整理到：<span style="color:#34d399">${escHtml(task.targetDir)}</span>` : ""}　勾选=执行；✎ 可手动改目标路径；冲突项需修改或放弃其一。</div>
  ${groupsHtml || `<div class="olm-empty">没有识别到电影/剧集</div>`}
  ${otherHtml}`;
}

function olmRenderExecuting(st) {
  var p = st.progress || {};
  var total = p.total || 1, done = p.done || 0;
  var pct = Math.min(100, Math.round(done / total * 100));
  var logs = (st.task && st.task.log || []).slice(-14).join("\n");
  return `
  <div class="olm-steps" style="max-width:640px">
    <div style="text-align:center;color:#cbd5e1;font-size:15px;margin-bottom:8px">正在执行整理方案…</div>
    <div style="text-align:center;color:#64748b;font-size:12px">请勿关闭浏览器标签页</div>
    <div class="olm-bar"><i style="width:${pct}%"></i></div>
    <div style="display:flex;justify-content:space-between;color:#94a3b8;font-size:12.5px">
      <span>${escHtml(p.note || "")}</span><span>${done} / ${total}</span>
    </div>
    <div class="olm-log" style="margin-top:14px">${escHtml(logs)}</div>
    <div style="text-align:center;margin-top:20px"><button class="olm-btn danger" data-act="cancelRun">停止（已完成的可撤销）</button></div>
  </div>`;
}

function olmRenderResult(st) {
  var task = st.task;
  var stats = task.stats || {};
  var failed = task.items.filter(function (it) { return it.status === "failed"; });
  var cls = task.status === "done" ? "info" : (task.status === "failed" ? "err" : "warn");
  var label = { done: "✓ 整理完成", partial: "⚠ 部分完成", failed: "✕ 执行失败" }[task.status] || task.status;
  return `
  <div class="olm-banner ${cls}" style="font-size:14px">${label}　—　成功 ${stats.done || 0} 项${stats.failed ? "，失败 " + stats.failed + " 项" : ""}</div>
  ${failed.length ? `<div class="olm-card"><b style="font-size:13px;color:#f87171">失败明细</b>
    <table class="olm-items"><tbody>${failed.map(function (it) {
      return `<tr><td style="width:46%"><div class="path">${escHtml(olmRelToRoot(task.root, it.file.dir, it.file.name))}</div></td><td><div class="olm-hint" style="margin:0">${escHtml(it.reason)}</div></td></tr>`;
    }).join("")}</tbody></table></div>` : ""}
  <details class="olm-fold olm-card" style="padding:10px 16px"><summary>操作日志（${(task.log || []).length}）</summary>
    <div class="olm-log">${escHtml((task.log || []).join("\n"))}</div>
  </details>
  <div class="olm-row" style="margin-top:16px">
    <button class="olm-btn warn" data-act="undoResult">↩ 撤销本次全部操作</button>
    <span style="flex:1"></span>
    <button class="olm-btn" data-act="gotoTasks">查看记录</button>
    <button class="olm-btn pri" data-act="backToIdle">完成</button>
  </div>`;
}

olmUI.tabs.organize = { render: olmRenderOrganize };

/* ---- 动作 ---- */

olmUI.actions.useCurrentDir = function () {
  olmUI.state.organize.path = olmCurrentDirFromLocation();
  olmRenderTab();
};

olmUI.actions.quickRecursive = function (el) {
  var s = olmGetSettings();
  s.organize.recursive = !!el.checked;
  olmSaveSettings(s);
};

olmUI.actions.quickRefresh = function (el) {
  olmUI.state.organize.refresh = !!el.checked;
};

// 把表单输入同步进状态（打开目录选择器/开始整理前调用，避免重绘丢输入）
function olmSyncOrganizeInputs() {
  var st = olmUI.state.organize;
  var p = olmEl("#olm-path");
  if (p && p.value.trim()) st.path = p.value.trim();
  var t = olmEl("#olm-target");
  if (t) st.targetDir = t.value.trim();
}

olmUI.actions.startOrganize = function () {
  var st = olmUI.state.organize;
  olmSyncOrganizeInputs();
  var path = (st.path || "/").replace(/\/+$/, "") || "/";
  if (path[0] !== "/") { olmToast("路径需以 / 开头", "err"); return; }
  var target = (st.targetDir || "").replace(/\/+$/, "");
  if (target && target[0] !== "/") { olmToast("整理目标目录需以 / 开头", "err"); return; }
  st.path = path;
  st.error = null;
  st.cancelFlag = { cancelled: false };
  st.progress = { phase: "scan", done: 0, total: -1 };
  var clients = olmMakeClients(st.cancelFlag);
  st._pipeline = clients.pipeline;
  st._executor = clients.executor;
  st.step = "running";
  olmRenderTab();
  clients.pipeline.organize(path, { refresh: st.refresh, targetDir: target })
    .then(function (task) {
      st.task = task;
      st.step = "plan";
      olmRenderTab();
    })
    .catch(function (e) {
      st.step = "idle";
      if (e && e.cancelled) st.error = null;
      else if (e instanceof OlmAuthError) st.error = "OpenList 登录已失效，请重新登录后重试";
      else st.error = (e && e.message) || String(e);
      olmRenderTab();
    });
};

olmUI.actions.cancelRun = function () {
  var st = olmUI.state.organize;
  if (st.cancelFlag) st.cancelFlag.cancelled = true;
  olmToast("正在停止…");
};

olmUI.actions.backToIdle = function () {
  var st = olmUI.state.organize;
  st.step = "idle";
  st.task = null;
  st.progress = null;
  st.error = null;
  olmRenderTab();
};

olmUI.actions.gotoTasks = function () {
  olmUI.tab = "tasks";
  olmRenderTab();
};

function olmFindItem(id) {
  var task = olmUI.state.organize.task;
  if (!task) return null;
  for (var i = 0; i < task.items.length; i++) if (task.items[i].id === id) return task.items[i];
  return null;
}

function olmRefreshPlanAndRender() {
  var st = olmUI.state.organize;
  st._pipeline.refreshPlan(st.task).then(function () {
    olmRenderTab();
  }).catch(function (e) {
    olmToast("刷新方案失败: " + ((e && e.message) || e), "err");
    olmRenderTab();
  });
}

olmUI.actions.toggleItem = function (el) {
  var it = olmFindItem(el.getAttribute("data-id"));
  if (!it) return;
  it.userExcluded = !el.checked;
  it.include = el.checked;
  if (!el.checked) { it.status = it.status === "conflict" ? "conflict" : "excluded"; if (it.status === "excluded") it.reason = "手动排除"; }
  else if (it.dstDir && it.dstName) { it.status = "ok"; it.reason = ""; }
  else if (it.action === "delete") { it.status = "ok"; it.reason = "垃圾文件 → 删除（不可恢复）"; }
  olmRefreshPlanAndRender();
};

olmUI.actions.toggleGroup = function (el) {
  var gid = el.getAttribute("data-gid");
  var task = olmUI.state.organize.task;
  if (!task) return;
  var on = !!el.checked;
  task.items.forEach(function (it) {
    if (it.groupId !== gid) return;
    if (it.status === "same" || it.status === "done" || it.status === "failed") return;
    it.userExcluded = !on;
    it.include = on && (!!(it.dstDir && it.dstName) || it.action === "delete");
    if (!on) { it.status = "excluded"; it.reason = "手动排除"; }
    else if (it.dstDir && it.dstName) { it.status = "ok"; it.reason = ""; }
    else if (it.action === "delete") { it.status = "ok"; it.reason = "垃圾文件 → 删除（不可恢复）"; }
  });
  olmRefreshPlanAndRender();
};

olmUI.actions.editItem = function (el) {
  var it = olmFindItem(el.getAttribute("data-id"));
  if (!it) return;
  var cur = it.dstDir && it.dstName ? pathJoin(it.dstDir, it.dstName) : pathJoin(it.file.dir, it.file.name);
  var close = olmModal(`
    <h3>编辑目标路径</h3>
    <div class="olm-field"><label>原路径</label><div class="path" style="font-size:12px;color:#94a3b8">${escHtml(it.file.path)}</div></div>
    <div class="olm-field"><label>目标完整路径（含文件名）</label>
      <input class="olm-input mono" id="olm-edit-dst" value="${escHtml(cur)}"/>
      <div class="olm-hint">扩展名请保持不变；跨目录会自动建目录。</div>
    </div>
    <div class="acts">
      ${it.edited ? `<button class="olm-btn" data-olm-auto>恢复自动命名</button>` : ""}
      <button class="olm-btn" data-olm-cancel>取消</button>
      <button class="olm-btn pri" data-olm-save>保存</button>
    </div>`);
  var mask = olmEl(".olm-modal-mask:last-child");
  if (!mask) return;
  mask.querySelector("[data-olm-cancel]").addEventListener("click", close);
  var autoBtn = mask.querySelector("[data-olm-auto]");
  if (autoBtn) autoBtn.addEventListener("click", function () {
    it.edited = false;
    it.userExcluded = false;
    close();
    // 整体重建（未手改项都会按规则重算）
    var st = olmUI.state.organize;
    var groupsById = {};
    st.task.groups.forEach(function (g) { groupsById[g.id] = g; });
    st._pipeline._internals.buildTargetsFor(st.task, groupsById);
    olmRefreshPlanAndRender();
  });
  mask.querySelector("[data-olm-save]").addEventListener("click", function () {
    var v = mask.querySelector("#olm-edit-dst").value.trim();
    if (v[0] !== "/" || v.length < 2) { olmToast("请输入以 / 开头的完整路径", "err"); return; }
    var dir = pathDir(v), name = pathName(v);
    if (!name) { olmToast("缺少文件名", "err"); return; }
    it.dstDir = dir;
    it.dstName = name;
    it.edited = true;
    it.userExcluded = false;
    it.include = true;
    it.action = dir === it.file.dir ? (name === it.file.name ? "none" : "rename") : "move";
    if (it.action === "none") { it.include = false; it.status = "same"; it.reason = "与原路径一致"; }
    else { it.status = "ok"; it.reason = "手动指定"; }
    close();
    olmRefreshPlanAndRender();
  });
};

/* 重新匹配 */
olmUI.actions.rematchOpen = function (el) {
  var gid = el.getAttribute("data-gid");
  var st = olmUI.state.organize;
  var group = null;
  st.task.groups.forEach(function (g) { if (g.id === gid) group = g; });
  if (!group) return;
  var s = olmGetSettings();
  if (!s.tmdb.enabled || !s.tmdb.apiKey) { olmToast("请先在设置中配置 TMDB API Key", "err"); return; }

  function candHtml(list) {
    if (!list || !list.length) return `<div class="olm-empty" style="padding:24px 0">无结果</div>`;
    return list.map(function (c, i) {
      var poster = olmPosterUrl(c.posterPath, 92);
      return `<div class="olm-diritem" data-olm-pick="${i}" style="align-items:flex-start">
        ${poster ? `<img class="olm-poster" style="width:34px;height:51px" src="${poster}" onerror="this.style.display='none'"/>` : `<div class="olm-poster" style="width:34px;height:51px"></div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px"><b>${escHtml(c.title)}</b> <span style="color:#64748b">(${c.year || "?"})</span> <span class="olm-chip gray">${c.mediaType === "tv" ? "剧集" : "电影"}</span> <span class="olm-chip gray">id ${c.id}</span></div>
          <div style="color:#64748b;font-size:11.5px;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml(c.overview || "")}</div>
        </div>
      </div>`;
    }).join("");
  }

  var candidates = (group.candidates || []).slice();
  var close = olmModal(`
    <h3>重新匹配「${escHtml(group.title || "")}」</h3>
    <div class="olm-row">
      <select class="olm-select" id="olm-rm-type" style="width:90px;flex:none">
        <option value="movie" ${group.type === "movie" ? "selected" : ""}>电影</option>
        <option value="tv" ${group.type === "tv" ? "selected" : ""}>剧集</option>
      </select>
      <input class="olm-input" id="olm-rm-q" value="${escHtml(group.title || "")}" placeholder="搜索名称"/>
      <input class="olm-input" id="olm-rm-y" style="width:80px;flex:none" value="${group.year || ""}" placeholder="年份"/>
      <button class="olm-btn" data-olm-search style="flex:none">搜索</button>
    </div>
    <div class="olm-dirlist" id="olm-rm-list" style="max-height:340px">${candHtml(candidates)}</div>
    <div class="acts">
      <button class="olm-btn danger" data-olm-clear>清除匹配</button>
      <button class="olm-btn" data-olm-cancel>关闭</button>
    </div>`);
  var mask = olmEl(".olm-modal-mask:last-child");
  if (!mask) return;
  mask.querySelector("[data-olm-cancel]").addEventListener("click", close);

  function bindPicks() {
    [].slice.call(mask.querySelectorAll("[data-olm-pick]")).forEach(function (row) {
      row.addEventListener("click", function () {
        var idx = +row.getAttribute("data-olm-pick");
        var entry = candidates[idx];
        if (!entry) return;
        row.style.opacity = ".5";
        // 类型切换：组类型跟随所选条目
        group.type = entry.mediaType;
        st._pipeline.rematchGroup(st.task, group, entry).then(function () {
          close();
          olmToast("已重新匹配: " + entry.title, "ok");
          olmRenderTab();
        }).catch(function (e) {
          olmToast("匹配失败: " + ((e && e.message) || e), "err");
        });
      });
    });
  }
  bindPicks();

  mask.querySelector("[data-olm-clear]").addEventListener("click", function () {
    st._pipeline.rematchGroup(st.task, group, null).then(function () {
      close();
      olmToast("已清除 TMDB 匹配");
      olmRenderTab();
    });
  });

  mask.querySelector("[data-olm-search]").addEventListener("click", function () {
    var q = mask.querySelector("#olm-rm-q").value.trim();
    var y = parseInt(mask.querySelector("#olm-rm-y").value, 10) || null;
    var ty = mask.querySelector("#olm-rm-type").value;
    if (!q) return;
    var listEl = mask.querySelector("#olm-rm-list");
    listEl.innerHTML = `<div class="olm-empty" style="padding:24px 0"><span class="olm-spin"></span></div>`;
    var tmdb = createTmdbClient(function () { return olmGetSettings().tmdb; });
    (ty === "tv" ? tmdb.searchTv(q, y) : tmdb.searchMovie(q, y)).then(function (results) {
      candidates = results.map(function (c) { return normalizeTmdbEntry(c, ty); });
      listEl.innerHTML = candHtml(candidates);
      bindPicks();
    }).catch(function (e) {
      listEl.innerHTML = `<div class="olm-empty" style="padding:24px 0">${escHtml((e && e.message) || String(e))}</div>`;
    });
  });
};

/* 执行与撤销 */
olmUI.actions.executePlan = function () {
  var st = olmUI.state.organize;
  var task = st.task;
  var stats = task.stats || olmComputeStats(task.items);
  var s = olmGetSettings();
  olmConfirm({
    title: "确认执行整理",
    html: `将执行 <b style="color:#34d399">${stats.included}</b> 项操作（移动 ${stats.move} / 改名 ${stats.rename}${stats.trash ? " / 回收 " + stats.trash : ""}${stats.del ? " / 删除 " + stats.del : ""}）。<br/>` +
      (stats.del ? `<b style="color:#f87171">⚠ 其中 ${stats.del} 个垃圾文件将被永久删除，删除无法撤销！</b><br/>` : "") +
      `操作间隔 ${s.exec.intervalMs}ms（网盘限流保护，可在设置调整）。<br/>` +
      `所有操作会记录日志，完成后可整体撤销${stats.del ? "（删除除外）" : ""}。确定执行？`,
    okText: "开始执行",
    danger: !!stats.del
  }).then(function (ok) {
    if (!ok) return;
    st.cancelFlag = { cancelled: false };
    var clients = olmMakeClients(st.cancelFlag);
    st._executor = clients.executor;
    st.step = "executing";
    st.progress = { phase: "exec", done: 0, total: stats.included };
    olmRenderTab();
    clients.executor.execute(task)
      .then(afterExec)
      .catch(function (e) {
        if (e instanceof OlmAuthError) {
          task.status = "failed";
          olmToast("OpenList 登录失效，执行中止", "err", 4000);
        } else if (e && e.cancelled) {
          olmToast("已停止", "err");
        } else {
          olmToast("执行出错: " + ((e && e.message) || e), "err", 4000);
        }
        afterExec();
      });
    function afterExec() {
      task.stats = olmComputeStats(task.items);
      try {
        st.record = saveTaskRecord(taskToRecord(task));
      } catch (e) { olmLog("save record fail", e); }
      st.step = "result";
      olmRenderTab();
    }
  });
};

olmUI.actions.undoResult = function () {
  var st = olmUI.state.organize;
  var rec = st.record || (st.task && taskToRecord(st.task));
  if (!rec || !(rec.ops || []).length) { olmToast("没有可撤销的操作", "err"); return; }
  olmUndoRecord(rec, function () {
    st.step = "idle";
    st.task = null;
    olmRenderTab();
  });
};

// 供整理页/记录页共用
function olmUndoRecord(rec, done) {
  var delOps = (rec.ops || []).filter(function (o) { return o.t === "remove"; }).length;
  olmConfirm({
    title: "撤销整理",
    html: `将按操作日志逆序回放 <b>${(rec.ops || []).length}</b> 步（移动的移回、改名的改回；创建的目录保留）。` +
      (delOps ? `<br/><b style="color:#f87171">已删除的 ${delOps} 个文件无法恢复，将跳过。</b>` : "") +
      `确定撤销？`,
    okText: "撤销",
    danger: true
  }).then(function (ok) {
    if (!ok) return;
    var flag = { cancelled: false };
    var clients = olmMakeClients(flag);
    olmToast("正在撤销…", null, 60000);
    clients.executor.undo(rec)
      .then(function (r) {
        updateTaskRecord(rec);
        olmToast("撤销完成：成功 " + r.done + (r.failed ? "，失败 " + r.failed : "") +
          (r.skippedDeletes ? "（删除的 " + r.skippedDeletes + " 项无法恢复）" : ""), r.failed ? "err" : "ok", 4000);
        if (done) done(r);
      })
      .catch(function (e) {
        updateTaskRecord(rec);
        olmToast("撤销中止: " + ((e && e.message) || e), "err", 4000);
        if (done) done(null);
      });
  });
}

/* 目录选择器（通用）：onChoose(dir) 收到选定目录 */
function olmPickDirModal(start, onChoose) {
  var cur = start || "/";
  var ol = createOpenListClient({});
  var close = olmModal(`
    <h3>选择目录</h3>
    <div class="olm-row">
      <button class="olm-btn sm" data-olm-up style="flex:none">↑ 上级</button>
      <div class="path" id="olm-dp-cur" style="font-size:12.5px;color:#34d399;word-break:break-all">${escHtml(cur)}</div>
    </div>
    <div class="olm-dirlist" id="olm-dp-list"><div class="olm-empty" style="padding:20px 0"><span class="olm-spin"></span></div></div>
    <div class="acts">
      <button class="olm-btn" data-olm-cancel>取消</button>
      <button class="olm-btn pri" data-olm-choose>选用当前目录</button>
    </div>`);
  var mask = olmEl(".olm-modal-mask:last-child");
  if (!mask) return;

  function load(p) {
    cur = p || "/";
    mask.querySelector("#olm-dp-cur").textContent = cur;
    var listEl = mask.querySelector("#olm-dp-list");
    listEl.innerHTML = `<div class="olm-empty" style="padding:20px 0"><span class="olm-spin"></span></div>`;
    ol.listAll(cur).then(function (entries) {
      var dirs = entries.filter(function (e) { return e.is_dir; });
      listEl.innerHTML = dirs.length
        ? dirs.map(function (d) { return `<div class="olm-diritem" data-olm-dir="${escHtml(d.name)}">📁 ${escHtml(d.name)}</div>`; }).join("")
        : `<div class="olm-empty" style="padding:20px 0">（无子目录）</div>`;
      [].slice.call(listEl.querySelectorAll("[data-olm-dir]")).forEach(function (row) {
        row.addEventListener("click", function () {
          load(pathJoin(cur, row.getAttribute("data-olm-dir")));
        });
      });
    }).catch(function (e) {
      listEl.innerHTML = `<div class="olm-empty" style="padding:20px 0">${escHtml((e && e.message) || String(e))}</div>`;
    });
  }
  mask.querySelector("[data-olm-up]").addEventListener("click", function () { load(pathDir(cur)); });
  mask.querySelector("[data-olm-cancel]").addEventListener("click", close);
  mask.querySelector("[data-olm-choose]").addEventListener("click", function () {
    close();
    onChoose(cur);
  });
  load(cur);
}

olmUI.actions.pickDir = function () {
  var st = olmUI.state.organize;
  olmSyncOrganizeInputs();
  olmPickDirModal(st.path || "/", function (dir) {
    st.path = dir;
    olmRenderTab();
  });
};

olmUI.actions.pickTargetDir = function () {
  var st = olmUI.state.organize;
  olmSyncOrganizeInputs();
  olmPickDirModal(st.targetDir || pathDir(st.path || "/"), function (dir) {
    st.targetDir = dir;
    olmRenderTab();
  });
};

/* ==== src/14-ui-tasks-settings.js ==== */
/* ==== UI：记录页 & 设置页 ==== */

olmUI.state.tasks = { sel: null };

function olmRecStatusChip(status) {
  var map = {
    done: ["完成", "green"],
    partial: ["部分完成", "yellow"],
    failed: ["失败", "red"],
    undone: ["已撤销", "gray"],
    undo_partial: ["撤销未全成", "yellow"],
    executing: ["执行中", "blue"]
  };
  var m = map[status] || [status, "gray"];
  return `<span class="olm-chip ${m[1]}">${m[0]}</span>`;
}

function olmFmtTime(iso) {
  return String(iso || "").slice(0, 19).replace("T", " ");
}

function olmRenderTasks() {
  var st = olmUI.state.tasks;
  var list = listTaskRecords();
  if (st.sel) {
    var rec = getTaskRecord(st.sel);
    if (!rec) { st.sel = null; return olmRenderTasks(); }
    var items = rec.items.filter(function (it) { return it.status === "done" || it.status === "failed" || it.include; });
    return `
    <div class="olm-row" style="margin-bottom:14px">
      <button class="olm-btn" data-act="recBack">← 返回列表</button>
      <span style="flex:1"></span>
      ${(rec.ops || []).length && rec.status !== "undone" ? `<button class="olm-btn warn" data-act="recUndo" data-id="${rec.id}">↩ 撤销本次整理</button>` : ""}
      <button class="olm-btn danger" data-act="recDelete" data-id="${rec.id}">删除记录</button>
    </div>
    <div class="olm-card">
      <div class="olm-row" style="flex-wrap:wrap">
        ${olmRecStatusChip(rec.status)}
        <span class="path" style="font-size:13px">${escHtml(rec.root)}</span>
        <span class="time" style="color:#64748b;font-size:12px">${olmFmtTime(rec.createdAt)}</span>
      </div>
      <div class="olm-row" style="margin-top:8px;flex-wrap:wrap">
        ${rec.stats ? `<span class="olm-chip green">成功 ${rec.stats.done || 0}</span>${rec.stats.failed ? `<span class="olm-chip red">失败 ${rec.stats.failed}</span>` : ""}<span class="olm-chip gray">操作 ${(rec.ops || []).length} 步</span>` : ""}
        ${(rec.groups || []).map(function (g) { return `<span class="olm-chip ${g.type === "tv" ? "purple" : "blue"}">${escHtml(g.display)}</span>`; }).join("")}
      </div>
    </div>
    <div class="olm-card">
      <table class="olm-items"><thead><tr><th>原路径</th><th></th><th>目标路径</th><th style="width:70px">状态</th></tr></thead><tbody>
      ${items.map(function (it) {
        return `<tr>
          <td style="width:42%"><div class="path">${escHtml(it.src)}</div></td>
          <td style="width:20px;color:#475569">→</td>
          <td><div class="path new">${escHtml(it.dst || "—")}</div>${it.reason && it.status === "failed" ? `<div class="olm-hint">${escHtml(it.reason)}</div>` : ""}</td>
          <td>${olmStatusChip(it)}</td>
        </tr>`;
      }).join("")}
      </tbody></table>
    </div>
    <details class="olm-fold olm-card" style="padding:10px 16px"><summary>操作日志（${(rec.log || []).length}）</summary>
      <div class="olm-log">${escHtml((rec.log || []).join("\n"))}</div>
    </details>`;
  }

  if (!list.length) {
    return `<div class="olm-empty">还没有整理记录<br/><span style="font-size:12px">在「整理」页执行一次方案后，这里会保留操作日志并支持撤销</span></div>`;
  }
  return list.map(function (rec) {
    return `<div class="olm-rec" data-act="recOpen" data-id="${rec.id}">
      ${olmRecStatusChip(rec.status)}
      <div style="flex:1;min-width:0">
        <div class="path">${escHtml(rec.root)}</div>
        <div class="time">${olmFmtTime(rec.createdAt)}　成功 ${rec.stats ? rec.stats.done || 0 : "?"} / 失败 ${rec.stats ? rec.stats.failed || 0 : "?"} / 操作 ${(rec.ops || []).length} 步</div>
      </div>
      <span style="color:#475569">›</span>
    </div>`;
  }).join("");
}

olmUI.tabs.tasks = { render: olmRenderTasks };

olmUI.actions.recOpen = function (el) {
  olmUI.state.tasks.sel = el.getAttribute("data-id");
  olmRenderTab();
};
olmUI.actions.recBack = function () {
  olmUI.state.tasks.sel = null;
  olmRenderTab();
};
olmUI.actions.recDelete = function (el) {
  var id = el.getAttribute("data-id");
  olmConfirm({ title: "删除记录", text: "删除后将无法撤销这次整理（文件不受影响）。确定删除？", danger: true, okText: "删除" })
    .then(function (ok) {
      if (!ok) return;
      deleteTaskRecord(id);
      olmUI.state.tasks.sel = null;
      olmRenderTab();
    });
};
olmUI.actions.recUndo = function (el) {
  var rec = getTaskRecord(el.getAttribute("data-id"));
  if (!rec) return;
  olmUndoRecord(rec, function () { olmRenderTab(); });
};

/* ---- 设置页 ---- */

olmUI.state.settings = { draft: null };

function olmField(draft, label, path, opts) {
  opts = opts || {};
  var v = olmGetPath(draft, path);
  if (opts.type === "bool") {
    return `<label class="olm-switch" style="margin-bottom:12px"><input type="checkbox" data-chg="setField" data-path="${path}" data-type="bool" ${v ? "checked" : ""}/> ${escHtml(label)}</label>` +
      (opts.hint ? `<div class="olm-hint" style="margin:-8px 0 10px 44px">${opts.hint}</div>` : "");
  }
  if (opts.type === "select") {
    return `<div class="olm-field"><label>${escHtml(label)}</label>
      <select class="olm-select" data-chg="setField" data-path="${path}" data-type="str">
        ${opts.options.map(function (o) { return `<option value="${escHtml(o[0])}" ${String(v) === o[0] ? "selected" : ""}>${escHtml(o[1])}</option>`; }).join("")}
      </select>${opts.hint ? `<div class="olm-hint">${opts.hint}</div>` : ""}</div>`;
  }
  var t = opts.type === "num" ? "number" : (opts.password ? "password" : "text");
  return `<div class="olm-field"><label>${escHtml(label)}</label>
    <input class="olm-input ${opts.mono ? "mono" : ""}" type="${t}" data-chg="setField" data-path="${path}" data-type="${opts.type === "num" ? "num" : "str"}" value="${escHtml(v == null ? "" : v)}" placeholder="${escHtml(opts.placeholder || "")}"/>
    ${opts.hint ? `<div class="olm-hint">${opts.hint}</div>` : ""}</div>`;
}

function olmNamingPreview(draft) {
  var n = draft.naming;
  var mg = { type: "movie", title: "流浪地球2", year: 2023, tmdb: { id: 842675, mediaType: "movie", title: "流浪地球2", year: 2023 } };
  var mp = { type: "movie", title: "流浪地球2", year: 2023, resolution: "2160p", version: null, part: null };
  var m = olmBuildMediaName(mg, mp, n);
  var tg = { type: "tv", title: "凡人修仙传", year: 2020, tmdb: { id: 100565, mediaType: "tv", title: "凡人修仙传", year: 2020, seasons: { 1: { 10: "重返七玄门" } } } };
  var tp = { type: "tv", title: "凡人修仙传", year: 2020, season: 1, episode: 10 };
  var t = olmBuildMediaName(tg, tp, n);
  return `<div class="olm-log" style="max-height:none">` +
    (m ? escHtml("电影库/" + m.folderRel + "/" + m.fileBase + ".mkv") : "") + "\n" +
    (t ? escHtml("剧集库/" + t.folderRel + "/" + t.fileBase + ".mkv") : "") +
    `</div>`;
}

function olmRenderSettings() {
  var st = olmUI.state.settings;
  if (!st.draft) st.draft = deepClone(olmGetSettings());
  var d = st.draft;
  return `
  <div class="olm-sec">
    <h3>OpenList 连接</h3>
    <div class="olm-grid2">
      ${olmField(d, "OpenList 地址（留空 = 当前站点）", "general.baseUrl", { placeholder: (typeof location !== "undefined" ? location.origin : ""), mono: true })}
      ${olmField(d, "Token 覆盖（留空 = 自动读取当前登录）", "general.tokenOverride", { password: true, hint: "自动读取失败时，可在 OpenList 管理后台 → 设置 → 其他 → 令牌 复制粘贴" })}
    </div>
    <button class="olm-btn sm" data-act="testOl">测试连接</button>
  </div>

  <div class="olm-sec">
    <h3>AI 解析（OpenAI 兼容接口）</h3>
    ${olmField(d, "启用 AI 解析", "ai.enabled", { type: "bool", hint: "关闭后使用内置规则解析（免费但识别率较低）" })}
    <div class="olm-grid2">
      ${olmField(d, "接口地址 (base_url)", "ai.baseUrl", { mono: true, placeholder: "https://api.deepseek.com/v1", hint: "OpenAI: https://api.openai.com/v1　DeepSeek: https://api.deepseek.com/v1　通义: https://dashscope.aliyuncs.com/compatible-mode/v1　Kimi: https://api.moonshot.cn/v1。只填域名会自动补 /v1，也可直接填完整 /chat/completions 地址" })}
      ${olmField(d, "API Key", "ai.apiKey", { password: true })}
      ${olmField(d, "模型", "ai.model", { placeholder: "deepseek-chat / gpt-4o-mini" })}
      ${olmField(d, "每批文件数", "ai.batchSize", { type: "num", hint: "一次请求解析的文件数，25 左右较稳" })}
      ${olmField(d, "并发请求数", "ai.concurrency", { type: "num" })}
    </div>
    ${olmField(d, "JSON 模式 (response_format)", "ai.jsonMode", { type: "bool", hint: "多数服务支持；报错时会自动降级去掉" })}
    <button class="olm-btn sm" data-act="testAi">测试 AI</button>
  </div>

  <div class="olm-sec">
    <h3>TMDB 元数据</h3>
    ${olmField(d, "启用 TMDB 校准", "tmdb.enabled", { type: "bool" })}
    <div class="olm-grid2">
      ${olmField(d, "API Key（v3 key 或 v4 读访问令牌）", "tmdb.apiKey", { password: true, hint: "免费申请：themoviedb.org → 设置 → API" })}
      ${olmField(d, "元数据语言", "tmdb.language", { type: "select", options: [["zh-CN", "简体中文 zh-CN"], ["zh-TW", "繁体中文 zh-TW"], ["en-US", "English en-US"], ["ja-JP", "日本語 ja-JP"]] })}
      ${olmField(d, "API 地址（可填反代镜像）", "tmdb.baseUrl", { mono: true, placeholder: "https://api.themoviedb.org", hint: "大陆网络直连不通时，填你的反代或镜像地址" })}
      ${olmField(d, "图片地址", "tmdb.imageBaseUrl", { mono: true, placeholder: "https://image.tmdb.org" })}
    </div>
    ${olmField(d, "显示海报缩略图", "tmdb.showPosters", { type: "bool" })}
    <button class="olm-btn sm" data-act="testTmdb">测试 TMDB</button>
  </div>

  <div class="olm-sec">
    <h3>命名规则（Emby 规范）</h3>
    <div class="olm-grid2">
      <div>
        ${olmField(d, "文件夹附加 TMDB ID 标记", "naming.includeTmdbId", { type: "bool", hint: "Emby 可 100% 精确识别，强烈建议开启" })}
        ${olmField(d, "ID 标记格式", "naming.tmdbTag", { mono: true, hint: "Emby 用 [tmdbid=xxx]，Jellyfin 用 [tmdbid-xxx]" })}
        ${olmField(d, "季目录格式", "naming.seasonFolder", { mono: true, hint: "{season2}=补零两位，{season}=原数字" })}
      </div>
      <div>
        ${olmField(d, "电影文件名附加分辨率", "naming.includeResolution", { type: "bool" })}
        ${olmField(d, "附加版本标记（导演剪辑/IMAX）", "naming.includeVersion", { type: "bool" })}
        ${olmField(d, "剧集文件名附加集标题", "naming.includeEpTitle", { type: "bool" })}
        ${olmField(d, "字幕语言标签规范化 (.chs/.cht/.eng)", "naming.normalizeSubLang", { type: "bool" })}
      </div>
    </div>
    <div class="olm-field"><label>命名预览</label>${olmNamingPreview(d)}</div>
  </div>

  <div class="olm-sec">
    <h3>整理行为</h3>
    <div class="olm-grid2">
      <div>
        ${olmField(d, "递归扫描子目录", "organize.recursive", { type: "bool" })}
        ${olmField(d, "最大递归深度", "organize.maxDepth", { type: "num" })}
        ${olmField(d, "单次最大文件数", "organize.maxFiles", { type: "num" })}
        ${olmField(d, "疑似样片阈值 (MB)", "organize.minVideoMB", { type: "num", hint: "小于此体积且无季集信息的视频归入「花絮/样片」" })}
      </div>
      <div>
        ${olmField(d, "垃圾文件处理", "organize.junkAction", { type: "select", options: [["ignore", "忽略（不动它们）"], ["trash", "移入回收站目录"], ["delete", "直接删除（执行前确认，不可恢复）"]], hint: "「直接删除」会在方案中标红并在执行确认框中二次提示" })}
        ${olmField(d, "回收站目录名", "organize.trashDirName", { mono: true })}
        ${olmField(d, "执行完成后清理空目录", "organize.cleanEmptyDirs", { type: "bool", hint: "调用 OpenList 的 remove_empty_directory 清理扫描目录下的空目录" })}
      </div>
    </div>
    ${olmField(d, "整理位置", "organize.targetMode", { type: "select", options: [["inplace", "就地整理（在扫描目录内建立规范结构）"], ["custom", "移动到指定媒体库目录"]], hint: "跨存储/网盘移动会走服务器中转，大文件很慢，建议目标目录与源在同一网盘内" })}
    ${d.organize.targetMode === "custom" ? `<div class="olm-grid2">
      ${olmField(d, "电影库目录", "organize.movieDir", { mono: true, placeholder: "/网盘/媒体库/电影" })}
      ${olmField(d, "剧集库目录", "organize.tvDir", { mono: true, placeholder: "/网盘/媒体库/剧集" })}
    </div>` : ""}
  </div>

  <div class="olm-sec">
    <h3>执行参数</h3>
    <div class="olm-grid2">
      <div>
        ${olmField(d, "写操作间隔 (ms)", "exec.intervalMs", { type: "num", hint: "网盘限流保护；115/夸克等建议 ≥ 500ms" })}
        ${olmField(d, "失败重试次数", "exec.retries", { type: "num" })}
      </div>
      <div>
        ${olmField(d, "使用批量重命名接口", "exec.useBatchRename", { type: "bool", hint: "减少请求次数；个别驱动不支持时可关闭" })}
        ${olmField(d, "悬浮按钮位置", "ui.fabSide", { type: "select", options: [["right", "右下"], ["left", "左下"]], hint: "按钮支持直接拖动摆放（自动记住位置）；此处切换会立即复位到默认位置" })}
      </div>
    </div>
  </div>

  <div class="olm-row" style="margin-top:8px;padding-bottom:8px">
    <button class="olm-btn pri" data-act="saveSettings">💾 保存设置</button>
    <button class="olm-btn" data-act="resetSettings">重置默认</button>
    <span style="flex:1"></span>
    <button class="olm-btn" data-act="exportSettings">导出</button>
    <button class="olm-btn" data-act="importSettings">导入</button>
  </div>
  <div class="olm-hint">设置保存在当前浏览器 localStorage 中（含 API Key，注意公用电脑）。换浏览器可用导出/导入迁移。</div>`;
}

olmUI.tabs.settings = { render: olmRenderSettings };

olmUI.actions.setField = function (el) {
  var st = olmUI.state.settings;
  if (!st.draft) return;
  var path = el.getAttribute("data-path");
  var type = el.getAttribute("data-type");
  var v;
  if (type === "bool") v = !!el.checked;
  else if (type === "num") { v = parseFloat(el.value); if (isNaN(v)) v = 0; }
  else v = el.value;
  olmSetPath(st.draft, path, v);
  // 切换悬浮按钮默认边：清除拖动位置并立即生效
  if (path === "ui.fabSide") olmResetFabPos(v);
  // 联动可见性/预览的字段需要重绘
  if (path === "organize.targetMode" || path.indexOf("naming.") === 0) olmRenderTab();
};

olmUI.actions.saveSettings = function () {
  var st = olmUI.state.settings;
  olmSaveSettings(st.draft);
  st.draft = deepClone(olmGetSettings());
  olmToast("设置已保存", "ok");
};

olmUI.actions.resetSettings = function () {
  olmConfirm({ title: "重置设置", text: "恢复全部默认设置（API Key 也会清空）？", danger: true, okText: "重置" })
    .then(function (ok) {
      if (!ok) return;
      olmResetSettings();
      olmUI.state.settings.draft = null;
      olmRenderTab();
      olmToast("已重置", "ok");
    });
};

olmUI.actions.exportSettings = function () {
  var text = JSON.stringify(olmUI.state.settings.draft, null, 2);
  var close = olmModal(`<h3>导出设置</h3>
    <textarea class="olm-input mono" style="height:280px" readonly>${escHtml(text)}</textarea>
    <div class="acts"><button class="olm-btn" data-olm-cancel>关闭</button></div>`);
  var mask = olmEl(".olm-modal-mask:last-child");
  if (mask) {
    mask.querySelector("textarea").select();
    mask.querySelector("[data-olm-cancel]").addEventListener("click", close);
  }
};

olmUI.actions.importSettings = function () {
  var close = olmModal(`<h3>导入设置</h3>
    <textarea class="olm-input mono" style="height:280px" placeholder="粘贴导出的 JSON"></textarea>
    <div class="acts"><button class="olm-btn" data-olm-cancel>取消</button><button class="olm-btn pri" data-olm-do>导入</button></div>`);
  var mask = olmEl(".olm-modal-mask:last-child");
  if (!mask) return;
  mask.querySelector("[data-olm-cancel]").addEventListener("click", close);
  mask.querySelector("[data-olm-do]").addEventListener("click", function () {
    try {
      var v = JSON.parse(mask.querySelector("textarea").value);
      olmUI.state.settings.draft = deepMerge(OLM_DEFAULT_SETTINGS, v);
      close();
      olmRenderTab();
      olmToast("已导入（记得点保存）", "ok");
    } catch (e) {
      olmToast("JSON 解析失败: " + e.message, "err");
    }
  });
};

function olmDraftClients() {
  var d = olmUI.state.settings.draft || olmGetSettings();
  return {
    ol: createOpenListClient({
      getBaseUrl: function () { return (d.general.baseUrl || "").trim() || olmApiBase(); },
      getToken: function () { return (d.general.tokenOverride || "").trim() || findOpenListToken(); }
    }),
    ai: createAiClient(function () { return d.ai; }),
    tmdb: createTmdbClient(function () { return d.tmdb; })
  };
}

olmUI.actions.testOl = function (el) {
  el.disabled = true;
  olmDraftClients().ol.me().then(function (me) {
    olmToast("连接成功：" + ((me && me.username) || "已登录"), "ok");
  }).catch(function (e) {
    olmToast("连接失败: " + ((e && e.message) || e), "err", 4000);
  }).finally(function () { el.disabled = false; });
};

olmUI.actions.testAi = function (el) {
  el.disabled = true;
  olmToast("正在测试 AI…", null, 15000);
  olmDraftClients().ai.test().then(function () {
    olmToast("AI 接口正常 ✓", "ok");
  }).catch(function (e) {
    olmToast("AI 测试失败: " + ((e && e.message) || e), "err", 5000);
  }).finally(function () { el.disabled = false; });
};

olmUI.actions.testTmdb = function (el) {
  el.disabled = true;
  olmDraftClients().tmdb.test().then(function () {
    olmToast("TMDB 连接正常 ✓", "ok");
  }).catch(function (e) {
    olmToast("TMDB 测试失败: " + ((e && e.message) || e), "err", 5000);
  }).finally(function () { el.disabled = false; });
};

/* ==== src/15-boot.js ==== */
/* ==== 导出与启动 ==== */

var OLM = {
  version: OLM_VERSION,
  // 工具
  cnNumToInt: cnNumToInt,
  sanitizeFileName: sanitizeFileName,
  cleanupName: cleanupName,
  titleKey: titleKey,
  pathJoin: pathJoin,
  pathDir: pathDir,
  pathName: pathName,
  pathExt: pathExt,
  pathStem: pathStem,
  fmtSize: fmtSize,
  deepMerge: deepMerge,
  pad2: pad2,
  // 解析
  parseNameCore: parseNameCore,
  localParseFile: localParseFile,
  detectSubLang: detectSubLang,
  olmCanonRes: olmCanonRes,
  // AI
  olmAiEndpoint: olmAiEndpoint,
  extractJSONBlock: extractJSONBlock,
  normalizeAiItem: normalizeAiItem,
  mergeParsed: mergeParsed,
  createAiClient: createAiClient,
  // TMDB
  createTmdbClient: createTmdbClient,
  scoreTmdbCandidate: scoreTmdbCandidate,
  normalizeTmdbEntry: normalizeTmdbEntry,
  // 命名
  olmBuildMediaName: olmBuildMediaName,
  olmDirIsMediaFolder: olmDirIsMediaFolder,
  olmGroupDisplay: olmGroupDisplay,
  // 流水线 / 执行
  createPipeline: createPipeline,
  createExecutor: createExecutor,
  olmOrderRenames: olmOrderRenames,
  olmComputeStats: olmComputeStats,
  // OpenList
  createOpenListClient: createOpenListClient,
  OlmError: OlmError,
  OlmAuthError: OlmAuthError,
  // 设置与记录
  olmGetSettings: olmGetSettings,
  olmSaveSettings: olmSaveSettings,
  OLM_DEFAULT_SETTINGS: OLM_DEFAULT_SETTINGS,
  listTaskRecords: listTaskRecords,
  taskToRecord: taskToRecord,
  findOpenListToken: findOpenListToken
};

try {
  if (typeof globalThis !== "undefined") globalThis.__OLM__ = OLM;
  else if (typeof window !== "undefined") window.__OLM__ = OLM;
} catch (e) { /* ignore */ }

/* 浏览器内自动挂载：仅登录用户可见入口 */
(function olmBoot() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (window.__OLM_BOOTED__) return;
  window.__OLM_BOOTED__ = true;

  function tryMount() {
    try {
      if (!document.body) return false;
      if (findOpenListToken()) {
        olmMountUI();
        return true;
      }
    } catch (e) {
      olmLog("mount error", (e && e.message) || e);
      return true; // 出错就别再轮询了
    }
    return false;
  }

  function start() {
    if (tryMount()) return;
    // 未登录：轮询等待登录后再挂载（SPA 登录不刷新页面）
    var timer = setInterval(function () {
      if (tryMount()) clearInterval(timer);
    }, 4000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

})();
