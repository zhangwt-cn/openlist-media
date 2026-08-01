/* ==== 本地文件名解析引擎（无 AI 兜底 / AI 结果校验） ==== */

var OLM_AD_TLDS = "com|net|org|cn|cc|tv|me|io|co|vip|xyz|top|club|la|life|live|site|online|store|fun|icu|pro|info|app|one|red|run|link|art|ltd|group|work|team|cloud|space|world|today|video|movie|film|fans|wang|xin|shop|host|press|website|win|buzz|cyou|best|lol|pw|tk|ml|ga|cf|gq";

var RE_OLM_URL = new RegExp(
  "(?:https?://)?(?:www\\.)?[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:" + OLM_AD_TLDS + ")(?![a-z0-9-])(?:/[^\\s\\]】]*)?",
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
