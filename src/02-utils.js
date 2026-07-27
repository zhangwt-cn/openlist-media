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
