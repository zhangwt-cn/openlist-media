/* 单元测试：
 *   本地(macOS):  jsc dist/openlist-media.js tests/core.test.js
 *   CI(node):     cat dist/openlist-media.js tests/core.test.js | node -
 * 失败时打印 "TEST FAIL"，成功打印 "ALL TESTS PASSED"（运行脚本靠哨兵判定） */

if (typeof print === "undefined") {
  globalThis.print = function () { console.log.apply(console, arguments); };
}
if (typeof quit === "undefined" && typeof process !== "undefined") {
  globalThis.quit = function (code) { process.exit(code); };
}

var O = globalThis.__OLM__;
var __n = 0;

function ok(cond, msg) {
  __n++;
  if (!cond) throw new Error("断言 #" + __n + " 失败: " + msg);
}
function eq(a, b, msg) {
  __n++;
  if (a !== b) throw new Error("断言 #" + __n + " 失败 " + (msg || "") +
    " | got=" + JSON.stringify(a) + " want=" + JSON.stringify(b));
}

function section(name) { print("== " + name); }

/* ---------- 工具 ---------- */
function testUtils() {
  section("utils");
  eq(O.cnNumToInt("十二"), 12);
  eq(O.cnNumToInt("二十三"), 23);
  eq(O.cnNumToInt("一百零五"), 105);
  eq(O.cnNumToInt("1997"), 1997);
  eq(O.cnNumToInt("一九九七"), 1997);
  eq(O.cnNumToInt("abc"), null);
  eq(O.pathExt("a.b.MKV"), "mkv");
  eq(O.pathExt("noext"), "");
  eq(O.pathStem("show.S01E01.mkv"), "show.S01E01");
  eq(O.pathJoin("/a/b", "c.mkv"), "/a/b/c.mkv");
  eq(O.pathJoin("/", "c"), "/c");
  eq(O.pathDir("/a/b/c.mkv"), "/a/b");
  eq(O.pathDir("/c.mkv"), "/");
  eq(O.pathName("/a/b/c.mkv"), "c.mkv");
  eq(O.sanitizeFileName("Mission: Impossible"), "Mission： Impossible");
  eq(O.sanitizeFileName("a/b*c?"), "a bc");
  eq(O.sanitizeFileName("trailing. "), "trailing");
  eq(O.cleanupName("Title ( ) - []"), "Title");
  eq(O.cleanupName("A -  - B"), "A - B");
  eq(O.pad2(3), "03");
  eq(O.pad2(12), "12");
  eq(O.titleKey("凡人·修仙传: 第二季!"), "凡人修仙传第二季");
}

/* ---------- 本地解析 ---------- */
function testLocalParse() {
  section("localparse");
  var p;

  p = O.localParseFile("凡人修仙传/【高清剧集网发布 www.DDHDTV.com】凡人修仙传[第10集][国语配音+中文字幕].Fan.Ren.Xiu.Xian.Zhuan.2020.S01E10.2160p.WEB-DL.H265.AAC-DDHDTV.mp4", { sizeMB: 1200 });
  eq(p.type, "tv", "凡人 type");
  eq(p.title, "凡人修仙传", "凡人 title");
  eq(p.year, 2020, "凡人 year");
  eq(p.season, 1, "凡人 season");
  eq(p.episode, 10, "凡人 episode");
  eq(p.resolution, "2160p", "凡人 res");

  p = O.localParseFile("Interstellar.2014.IMAX.2160p.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWTYBLZ.mkv", { sizeMB: 8000 });
  eq(p.type, "movie", "星际 type");
  eq(p.title, "Interstellar", "星际 title");
  eq(p.year, 2014, "星际 year");
  eq(p.resolution, "2160p", "星际 res");
  eq(p.version, "IMAX", "星际 version");

  p = O.localParseFile("[GM-Team][国漫][斗破苍穹 年番][Fights Break Sphere][2022][05][AVC][GB][1080P].mp4", { sizeMB: 600 });
  eq(p.type, "tv", "斗破 type");
  eq(p.title, "斗破苍穹 年番", "斗破 title");
  eq(p.year, 2022, "斗破 year");
  eq(p.episode, 5, "斗破 ep");
  eq(p.season, 1, "斗破 season 默认1");
  eq(p.resolution, "1080p", "斗破 res");

  p = O.localParseFile("流浪地球2.The.Wandering.Earth.II.2023.2160p.WEB-DL.H265.DDP5.1.Atmos-CHDWEB.mp4", { sizeMB: 9000 });
  eq(p.type, "movie", "流浪 type");
  eq(p.title, "流浪地球2", "流浪 title");
  eq(p.originalTitle, "The Wandering Earth II", "流浪 original");
  eq(p.year, 2023, "流浪 year");

  p = O.localParseFile("凡人修仙传/第二季/第十二集.mp4", { sizeMB: 800 });
  eq(p.type, "tv", "第十二集 type");
  eq(p.title, "凡人修仙传", "第十二集 从父目录取剧名");
  eq(p.season, 2, "第十二集 从目录取季");
  eq(p.episode, 12, "第十二集 中文数字");

  p = O.localParseFile("绝命毒师/Season 5/Breaking.Bad.S05E14.Ozymandias.1080p.mkv", { sizeMB: 2000 });
  eq(p.type, "tv");
  eq(p.title, "绝命毒师", "毒师 title 取目录中文名");
  eq(p.originalTitle, "Breaking Bad", "毒师 原名保留");
  eq(p.season, 5, "毒师 season");
  eq(p.episode, 14, "毒师 ep");

  p = O.localParseFile("Breaking.Bad.S05E14.Ozymandias.1080p.mkv", { sizeMB: 2000 });
  eq(p.title, "Breaking Bad", "无中文目录时保留英文名");

  p = O.localParseFile("老友记 第一季/01.mp4", { sizeMB: 500 });
  eq(p.type, "tv", "老友记 type");
  eq(p.title, "老友记", "老友记 title");
  eq(p.season, 1, "老友记 season");
  eq(p.episode, 1, "老友记 纯数字文件名当集数");

  p = O.localParseFile("TV/雪中悍刀行 第一季（2021）全38集 内嵌简英双语字幕 1080P/03.mp4", { sizeMB: 800 });
  eq(p.type, "tv", "雪中 type");
  eq(p.title, "雪中悍刀行", "雪中 title（跳过 TV 分类目录）");
  eq(p.season, 1, "雪中 season");
  eq(p.episode, 3, "雪中 纯数字文件名当集数");
  eq(p.year, 2021, "雪中 year 全角括号");
  eq(p.resolution, "1080p", "雪中 res");

  p = O.localParseFile("百花杀（2026）/Blossoms.of.Power.S01E05.2026.2160p.WEB-DL.mp4", { sizeMB: 900 });
  eq(p.title, "百花杀", "全角括号紧贴年份不残留半个括号");
  eq(p.originalTitle, "Blossoms of Power", "英文文件名降为原名");
  eq(p.year, 2026, "百花杀 year");
  eq(p.episode, 5, "百花杀 ep");

  p = O.localParseFile("最新电影首发 www.dygod.org.txt", { sizeMB: 0.01 });
  eq(p.type, "junk", "广告 txt");

  p = O.localParseFile("sample.mkv", { sizeMB: 30 });
  eq(p.type, "junk", "sample 判垃圾");

  p = O.localParseFile("凡人修仙传.S01E10.chs.srt", { sizeMB: 0.1 });
  eq(p.type, "tv", "字幕 type 跟随剧集");
  eq(p.lang, "chs", "字幕语言");
  eq(p.episode, 10, "字幕 ep");

  p = O.localParseFile("Titanic.1997.CD1.mkv", { sizeMB: 4000 });
  eq(p.type, "movie");
  eq(p.part, 1, "CD1 part");
  eq(p.year, 1997);

  p = O.localParseFile("赤壁(上).2008.BluRay.mkv", { sizeMB: 4000 });
  eq(p.title, "赤壁", "赤壁 title");
  eq(p.part, 1, "上部 part=1");
  eq(p.year, 2008);

  p = O.localParseFile("小视频广告 电影天堂/某片.2020.mkv", { sizeMB: 3000 });
  eq(p.type, "movie", "目录含广告词不传染文件");

  p = O.localParseFile("流浪地球2 (2023)/流浪地球2 (2023) - 2160p.mkv", { sizeMB: 8000 });
  eq(p.type, "movie");
  eq(p.title, "流浪地球2");
  eq(p.year, 2023);
  eq(p.resolution, "2160p");

  eq(O.detectSubLang("xx.简体"), "chs");
  eq(O.detectSubLang("show.S01E01.CHT"), "cht");
  eq(O.detectSubLang("movie.eng"), "eng");
  eq(O.detectSubLang("movie.中英双语"), "chs");
  eq(O.olmCanonRes("4K"), "2160p");
  eq(O.olmCanonRes("1080P"), "1080p");
}

/* ---------- AI 辅助 ---------- */
function testAiHelpers() {
  section("ai helpers");
  var j = O.extractJSONBlock('{"items":[{"i":0}]}');
  eq(j.items.length, 1);
  j = O.extractJSONBlock('```json\n{"items":[]}\n```');
  ok(Array.isArray(j.items), "fenced json");
  j = O.extractJSONBlock('好的，以下是结果：\n{"items":[{"i":0,"title":"a{b}c\\"x"}]}\n以上。');
  eq(j.items[0].title, 'a{b}c"x', "嵌套括号与引号");

  var ai = O.normalizeAiItem({ i: 0, type: "tv", title: "《凡人修仙传》", year: "2020", season: "1", episode: "10", resolution: "4K", confidence: 0.9 });
  eq(ai.title, "凡人修仙传", "去书名号");
  eq(ai.year, 2020, "year 数字化");
  eq(ai.resolution, "2160p", "res 归一");

  var local = { type: "movie", title: "本地", year: 2000, season: null, episode: null, resolution: "1080p", confidence: 0.4, from: "local" };
  var merged = O.mergeParsed({ type: "unknown", title: null, year: null, season: null, episode: null, episodeEnd: null, resolution: null, version: null, part: null, lang: null, confidence: 0.3, from: "ai" }, local);
  eq(merged.type, "movie", "ai unknown 时用本地 type");
  eq(merged.title, "本地", "ai 空字段回填本地");
  var merged2 = O.mergeParsed({ type: "tv", title: "AI名", year: null, season: 2, episode: 3, episodeEnd: null, resolution: null, version: null, part: null, lang: null, confidence: 0.9, from: "ai" }, local);
  eq(merged2.title, "AI名", "ai 优先");
  eq(merged2.year, 2000, "本地补缺 year");
  eq(merged2.season, 2);
}

/* ---------- AI 客户端（端点推导 + 参数兼容降级） ---------- */
async function testAiClient() {
  section("ai client");
  var ep = O.olmAiEndpoint;
  eq(ep("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions", "标准 /v1");
  eq(ep("https://api.openai.com"), "https://api.openai.com/v1/chat/completions", "裸域名自动补 /v1");
  eq(ep("https://api.openai.com/v1/"), "https://api.openai.com/v1/chat/completions", "尾斜杠");
  eq(ep("api.moonshot.cn/v1"), "https://api.moonshot.cn/v1/chat/completions", "无协议补 https");
  eq(ep("https://dashscope.aliyuncs.com/compatible-mode/v1"), "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", "版本段在路径末尾");
  eq(ep("https://open.bigmodel.cn/api/paas/v4"), "https://open.bigmodel.cn/api/paas/v4/chat/completions", "v4");
  eq(ep("https://gw.example.com/v1/acc/openai"), "https://gw.example.com/v1/acc/openai/chat/completions", "路径中已含 /v1/ 不重复补");
  eq(ep("https://x.com/v1/chat/completions"), "https://x.com/v1/chat/completions", "完整端点原样");
  eq(ep("https://x.com/custom/endpoint#"), "https://x.com/custom/endpoint", "# 强制原样");
  eq(ep(""), "", "空返回空");

  var calls = [];
  var mode = "no-temp";
  function resp(ok, status, bodyText) {
    return { ok: ok, status: status, text: async function () { return bodyText; } };
  }
  var fakeFetch = async function (url, init) {
    var body = JSON.parse(init.body);
    calls.push({ url: url, body: body });
    if (mode === "no-temp" && body.temperature != null) {
      return resp(false, 400, '{"error":{"message":"Unsupported value: \'temperature\' does not support 0.1 with this model."}}');
    }
    if (mode === "no-json" && body.response_format) {
      return resp(false, 400, '{"error":{"message":"response_format is not supported"}}');
    }
    return resp(true, 200, JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  };
  var cfg = { enabled: true, baseUrl: "https://api.openai.com", apiKey: "sk-test", model: "gpt-5-mini", temperature: 0.1, jsonMode: true, timeoutMs: 5000, batchSize: 25, concurrency: 1 };
  var noSleep = function () { return Promise.resolve(); };

  // gpt-5/o 系列拒绝自定义 temperature → 去掉重试并记住
  var ai = O.createAiClient(function () { return cfg; }, { fetchFn: fakeFetch, sleepFn: noSleep });
  ok(await ai.test(), "temperature 被拒后自动重试成功");
  eq(calls.length, 2, "重试一次");
  eq(calls[0].url, "https://api.openai.com/v1/chat/completions", "URL 自动补 /v1");
  ok(calls[0].body.temperature != null, "首次带 temperature");
  ok(calls[1].body.temperature == null, "重试不带 temperature");
  await ai.chat([{ role: "user", content: "hi" }]);
  eq(calls.length, 3, "后续请求不再带 temperature（无重试）");
  ok(calls[2].body.temperature == null, "记住兼容性");

  // response_format 不支持 → 降级重试并记住
  calls.length = 0;
  mode = "no-json";
  var ai2 = O.createAiClient(function () { return cfg; }, { fetchFn: fakeFetch, sleepFn: noSleep });
  ok(await ai2.test(), "response_format 降级成功");
  eq(calls.length, 2, "json 降级重试一次");
  ok(!calls[1].body.response_format, "重试不带 response_format");
  ok(calls[1].body.temperature != null, "temperature 不受影响");
}

/* ---------- 命名器 ---------- */
function testNamer() {
  section("namer");
  var naming = JSON.parse(JSON.stringify(O.OLM_DEFAULT_SETTINGS.naming));
  var mg = { type: "movie", title: "流浪地球2", year: 2023, tmdb: { id: 842675, mediaType: "movie", title: "流浪地球2", year: 2023 } };
  var mp = { type: "movie", title: "流浪地球2", year: 2023, resolution: "2160p", version: null, part: null };
  var r = O.olmBuildMediaName(mg, mp, naming);
  eq(r.folderRel, "流浪地球2 (2023) [tmdbid=842675]", "movie folder");
  eq(r.fileBase, "流浪地球2 (2023) - 2160p", "movie file");

  naming.includeTmdbId = false;
  naming.includeResolution = false;
  r = O.olmBuildMediaName(mg, mp, naming);
  eq(r.folderRel, "流浪地球2 (2023)", "toggles off folder");
  eq(r.fileBase, "流浪地球2 (2023)", "toggles off file");
  naming = JSON.parse(JSON.stringify(O.OLM_DEFAULT_SETTINGS.naming));

  var tg = { type: "tv", title: "凡人修仙传", year: 2020, tmdb: { id: 100565, mediaType: "tv", title: "凡人修仙传", year: 2020, seasons: { 1: { 10: "重返七玄门" } } } };
  var tp = { type: "tv", title: "凡人修仙传", year: 2020, season: 1, episode: 10 };
  r = O.olmBuildMediaName(tg, tp, naming);
  eq(r.folderRel, "凡人修仙传 (2020) [tmdbid=100565]/Season 01", "tv folder");
  eq(r.fileBase, "凡人修仙传 - S01E10 - 重返七玄门", "tv file with ep title");

  // 无 TMDB、多集
  var tg2 = { type: "tv", title: "某剧", year: null, tmdb: null };
  var tp2 = { type: "tv", title: "某剧", season: 2, episode: 1, episodeEnd: 2 };
  r = O.olmBuildMediaName(tg2, tp2, naming);
  eq(r.folderRel, "某剧/Season 02", "tv no tmdb folder");
  eq(r.fileBase, "某剧 - S02E01-E02", "多集");

  // 非法字符
  var mg3 = { type: "movie", title: "Mission: Impossible", year: 1996, tmdb: null };
  var mp3 = { type: "movie", title: "Mission: Impossible", year: 1996, resolution: null };
  r = O.olmBuildMediaName(mg3, mp3, naming);
  eq(r.folderRel, "Mission： Impossible (1996)", "冒号转全角");

  // 缺集数 → null
  eq(O.olmBuildMediaName(tg2, { type: "tv", title: "某剧", season: 1, episode: null }, naming), null, "无集数返回 null");

  var sc = O.scoreTmdbCandidate({ title: "流浪地球2", original_title: "The Wandering Earth II", release_date: "2023-01-22", popularity: 50 }, "流浪地球2", null, 2023);
  ok(sc >= 5, "tmdb 精确匹配得分 " + sc);

  // 目录本身就是该影视的文件夹（用于避免重复嵌套）
  var bg = { type: "tv", title: "百花杀", originalTitle: "Blossoms of Power", year: 2026, tmdb: { id: 286506, title: "百花杀", originalTitle: "百花杀", year: 2026 } };
  ok(O.olmDirIsMediaFolder("百花杀（2026）", bg), "全角括号年份");
  ok(O.olmDirIsMediaFolder("百花杀 (2026)", bg), "半角括号年份");
  ok(O.olmDirIsMediaFolder("百花杀 (2026) [tmdbid=286506]", bg), "含 tmdbid 标记");
  ok(O.olmDirIsMediaFolder("百花杀", bg), "裸剧名");
  ok(O.olmDirIsMediaFolder("Blossoms of Power (2026)", bg), "英文原名目录");
  ok(!O.olmDirIsMediaFolder("cn_tv", bg), "库目录不误判");
  ok(!O.olmDirIsMediaFolder("百花杀（2020）", bg), "年份不符不算");
  ok(!O.olmDirIsMediaFolder("凡人修仙传 第一季 (2020) 全12集 1080P", { type: "tv", title: "凡人修仙传", year: 2020, tmdb: null }), "带杂质的发布目录不算");
  ok(O.olmBuildMediaName(tg, tp, naming).innerRel === "Season 01", "tv innerRel");
  ok(O.olmBuildMediaName(mg, mp, naming).innerRel === "", "movie innerRel 为空");
}

/* ---------- 重命名排序 ---------- */
function testOrderRenames() {
  section("order renames");
  var ord = O.olmOrderRenames([{ id: "1", src: "a", dst: "b" }, { id: "2", src: "b", dst: "c" }]);
  eq(ord.length, 2);
  eq(ord[0].src, "b", "链式先让位");
  eq(ord[1].src, "a");

  var swap = O.olmOrderRenames([{ id: "1", src: "a", dst: "b" }, { id: "2", src: "b", dst: "a" }]);
  eq(swap.length, 3, "环需要三步");
  ok(swap[0].temp, "第一步临时名");
  eq(swap[1].src, "b");
  eq(swap[2].dst, "b", "临时名归位");

  eq(O.olmOrderRenames([{ id: "1", src: "x", dst: "x" }]).length, 0, "同名跳过");
}

/* ---------- 假 OpenList ---------- */
function makeFakeOl(init) {
  var tree = {};   // dir → { name → {size, is_dir} }
  var calls = [];
  function ensureDir(path) {
    if (tree[path]) return;
    tree[path] = {};
    if (path !== "/") {
      var parent = O.pathDir(path);
      ensureDir(parent);
      tree[parent][O.pathName(path)] = { size: 0, is_dir: true };
    }
  }
  for (var p in init) {
    ensureDir(O.pathDir(p));
    tree[O.pathDir(p)][O.pathName(p)] = { size: init[p], is_dir: false };
  }
  function fail(msg) { var e = new O.OlmError(msg, 500); return e; }
  return {
    calls: calls,
    tree: tree,
    has: function (path) {
      var d = tree[O.pathDir(path)];
      return !!(d && d[O.pathName(path)]);
    },
    isDir: function (path) { return !!tree[path]; },
    listAll: async function (path) {
      calls.push(["list", path]);
      if (!tree[path]) throw fail("object not found: " + path);
      var out = [];
      for (var n in tree[path]) out.push({ name: n, size: tree[path][n].size, is_dir: !!tree[path][n].is_dir });
      return out;
    },
    mkdir: async function (path) {
      calls.push(["mkdir", path]);
      ensureDir(path);
      return null;
    },
    rename: async function (path, newName) {
      calls.push(["rename", path, newName]);
      var dir = O.pathDir(path), name = O.pathName(path);
      if (!tree[dir] || !tree[dir][name]) throw fail("rename: not found " + path);
      if (tree[dir][newName]) throw fail("rename: already exist " + newName);
      tree[dir][newName] = tree[dir][name];
      delete tree[dir][name];
      return null;
    },
    batchRename: async function (srcDir, pairs) {
      calls.push(["batch_rename", srcDir, pairs.length]);
      for (var i = 0; i < pairs.length; i++) {
        if (!tree[srcDir] || !tree[srcDir][pairs[i].src]) throw fail("batch: not found " + pairs[i].src);
        if (tree[srcDir][pairs[i].dst]) throw fail("batch: exist " + pairs[i].dst);
      }
      for (var j = 0; j < pairs.length; j++) {
        tree[srcDir][pairs[j].dst] = tree[srcDir][pairs[j].src];
        delete tree[srcDir][pairs[j].src];
      }
      return null;
    },
    move: async function (srcDir, dstDir, names) {
      calls.push(["move", srcDir, dstDir, names.slice()]);
      if (!tree[dstDir]) throw fail("move: dst dir missing " + dstDir);
      var i;
      for (i = 0; i < names.length; i++) {
        if (!tree[srcDir] || !tree[srcDir][names[i]]) throw fail("move: not found " + names[i]);
        if (tree[dstDir][names[i]]) throw fail("move: exist in dst " + names[i]);
      }
      for (i = 0; i < names.length; i++) {
        tree[dstDir][names[i]] = tree[srcDir][names[i]];
        delete tree[srcDir][names[i]];
      }
      return null;
    },
    remove: async function (dir, names) {
      calls.push(["remove", dir, names.slice()]);
      var i;
      for (i = 0; i < names.length; i++) {
        if (!tree[dir] || !tree[dir][names[i]]) throw fail("remove: not found " + names[i]);
      }
      for (i = 0; i < names.length; i++) delete tree[dir][names[i]];
      return null;
    },
    removeEmptyDirectory: async function () { calls.push(["rmempty"]); return null; }
  };
}

function testSettings() {
  return O.deepMerge(O.OLM_DEFAULT_SETTINGS, {
    ai: { enabled: false },
    tmdb: { enabled: false },
    exec: { intervalMs: 0, retries: 0 },
    organize: { minVideoMB: 50 }
  });
}

/* ---------- 流水线 ---------- */
async function testPipeline() {
  section("pipeline");
  var ROOT = "/media/downloads";
  var fake = makeFakeOl((function () {
    var m = {};
    var msgDir = ROOT + "/【XX影视 www.ad-site.com】凡人修仙传 2020 4K";
    m[msgDir + "/Fan.Ren.Xiu.Xian.Zhuan.2020.S01E10.2160p.mp4"] = 1200 * 1048576;
    m[msgDir + "/Fan.Ren.Xiu.Xian.Zhuan.2020.S01E11.2160p.mp4"] = 1200 * 1048576;
    m[msgDir + "/凡人修仙传.S01E10.chs.srt"] = 60 * 1024;
    m[msgDir + "/最新电影 www.ad-site.com.txt"] = 1024;
    m[ROOT + "/Interstellar.2014.IMAX.2160p.BluRay.mkv"] = 8000 * 1048576;
    m[ROOT + "/sample.mkv"] = 30 * 1048576;
    return m;
  })());
  var S = testSettings();
  var pipe = O.createPipeline({ ol: fake, ai: null, tmdb: null, getSettings: function () { return S; } });
  var task = await pipe.organize(ROOT, {});

  eq(task.items.length, 6, "全部文件进入方案");
  function byName(n) {
    for (var i = 0; i < task.items.length; i++) if (task.items[i].file.name === n) return task.items[i];
    return null;
  }
  var e10 = byName("Fan.Ren.Xiu.Xian.Zhuan.2020.S01E10.2160p.mp4");
  eq(e10.dstDir, ROOT + "/凡人修仙传 (2020)/Season 01", "e10 目标目录");
  eq(e10.dstName, "凡人修仙传 - S01E10.mp4", "e10 目标名");
  eq(e10.action, "move");
  ok(e10.include, "e10 默认勾选");

  var sub = byName("凡人修仙传.S01E10.chs.srt");
  eq(sub.dstDir, e10.dstDir, "字幕跟随视频目录");
  eq(sub.dstName, "凡人修仙传 - S01E10.chs.srt", "字幕命名");

  var movie = byName("Interstellar.2014.IMAX.2160p.BluRay.mkv");
  eq(movie.dstDir, ROOT + "/Interstellar (2014)", "电影目录");
  eq(movie.dstName, "Interstellar (2014) - IMAX - 2160p.mkv", "电影文件名");

  var junk = byName("最新电影 www.ad-site.com.txt");
  eq(junk.parsed.type, "junk");
  eq(junk.include, false, "垃圾默认忽略");

  var sample = byName("sample.mkv");
  eq(sample.include, false, "样片不执行");

  eq(task.stats.included, 4, "将执行 4 项");
  eq(task.stats.conflict, 0);

  // 电影组合并（有年份与无年份）
  var fake2 = makeFakeOl((function () {
    var m = {};
    m[ROOT + "/Avatar.2009.1080p.mkv"] = 3000 * 1048576;
    m[ROOT + "/Avatar.1080p.mkv"] = 3000 * 1048576;
    return m;
  })());
  var pipe2 = O.createPipeline({ ol: fake2, ai: null, tmdb: null, getSettings: function () { return S; } });
  var task2 = await pipe2.organize(ROOT, {});
  var mediaGroups = task2.groups.filter(function (g) { return g.type === "movie"; });
  eq(mediaGroups.length, 1, "同名电影组合并");
  eq(mediaGroups[0].year, 2009, "合并后取有年份的");
  // 两个文件 → 同一目标 → 冲突
  eq(task2.stats.conflict, 2, "同目标冲突");

  // 已规范文件识别 + 与新文件的冲突
  var fake3 = makeFakeOl((function () {
    var m = {};
    m[ROOT + "/凡人修仙传 (2020)/Season 01/凡人修仙传 - S01E10.mp4"] = 1200 * 1048576;
    m[ROOT + "/凡人修仙传E10.mp4"] = 1100 * 1048576;
    return m;
  })());
  var pipe3 = O.createPipeline({ ol: fake3, ai: null, tmdb: null, getSettings: function () { return S; } });
  var task3 = await pipe3.organize(ROOT, {});
  var organized = null, messy = null;
  task3.items.forEach(function (it) {
    if (it.file.name === "凡人修仙传 - S01E10.mp4") organized = it;
    if (it.file.name === "凡人修仙传E10.mp4") messy = it;
  });
  eq(organized.status, "same", "已规范识别");
  eq(messy.status, "conflict", "与已存在文件冲突");

  // 扫描根本身就是剧集文件夹：根目录名提供剧名/季/年份上下文
  var showRoot = "/media/downloads/凡人修仙传 第一季 (2020) 全12集 1080P";
  var fake4 = makeFakeOl((function () {
    var m = {};
    m[showRoot + "/01.mp4"] = 900 * 1048576;
    m[showRoot + "/02.mp4"] = 900 * 1048576;
    return m;
  })());
  var pipe4 = O.createPipeline({ ol: fake4, ai: null, tmdb: null, getSettings: function () { return S; } });
  var task4 = await pipe4.organize(showRoot, {});
  var it01 = null;
  task4.items.forEach(function (x) { if (x.file.name === "01.mp4") it01 = x; });
  eq(it01.parsed.type, "tv", "根目录名提供剧集上下文");
  eq(it01.parsed.title, "凡人修仙传", "剧名取自扫描根目录名");
  eq(it01.parsed.season, 1, "季取自根目录名");
  eq(it01.parsed.episode, 1, "纯数字文件名当集数");
  eq(it01.parsed.year, 2020, "年份取自根目录名");
  eq(it01.dstDir, showRoot + "/凡人修仙传 (2020)/Season 01", "目标目录");
  eq(it01.dstName, "凡人修仙传 - S01E01.mp4", "目标文件名");

  // 扫描根已是规范剧集文件夹（剧名+年份）→ 只建 Season 层，不再嵌套「剧名 (年份)」目录
  var cleanRoot = "/media/tv/百花杀（2026）";
  var fake6 = makeFakeOl((function () {
    var m = {};
    m[cleanRoot + "/Blossoms.of.Power.S01E05.2026.2160p.WEB-DL.mp4"] = 900 * 1048576;
    m[cleanRoot + "/Blossoms.of.Power.S01E06.2026.2160p.WEB-DL.mp4"] = 900 * 1048576;
    return m;
  })());
  var pipe6 = O.createPipeline({ ol: fake6, ai: null, tmdb: null, getSettings: function () { return S; } });
  var task6 = await pipe6.organize(cleanRoot, {});
  var e05 = null;
  task6.items.forEach(function (x) { if (/S01E05/.test(x.file.name)) e05 = x; });
  eq(e05.parsed.title, "百花杀", "剧名取自根目录名");
  eq(e05.dstDir, cleanRoot + "/Season 01", "根目录即剧集文件夹时不重复嵌套");
  eq(e05.dstName, "百花杀 - S01E05.mp4", "目标文件名");
  eq(e05.action, "move");

  // 扫描根已是规范电影文件夹 → 文件直接落在根目录
  var movieRoot = "/media/movies/流浪地球2 (2023)";
  var fake7 = makeFakeOl((function () {
    var m = {};
    m[movieRoot + "/流浪地球2.2023.2160p.WEB-DL.mkv"] = 8000 * 1048576;
    return m;
  })());
  var pipe7 = O.createPipeline({ ol: fake7, ai: null, tmdb: null, getSettings: function () { return S; } });
  var task7 = await pipe7.organize(movieRoot, {});
  eq(task7.items[0].dstDir, movieRoot, "电影文件夹内不再嵌套");
  eq(task7.items[0].dstName, "流浪地球2 (2023) - 2160p.mkv", "电影目标名");
  eq(task7.items[0].action, "rename", "同目录内改名");

  // AI 收到的 path 也带根目录上下文
  var seenPaths = [];
  var fakeAi = {
    parseFiles: async function (entries) {
      entries.forEach(function (e) { seenPaths.push(e.path); });
      return { byI: {}, errors: [] };
    }
  };
  var S2 = O.deepMerge(S, { ai: { enabled: true, apiKey: "x" } });
  var pipe5 = O.createPipeline({ ol: fake4, ai: fakeAi, tmdb: null, getSettings: function () { return S2; } });
  await pipe5.organize(showRoot, {});
  ok(seenPaths.length === 2, "AI 收到 2 个文件");
  ok(seenPaths[0].indexOf("凡人修仙传 第一季 (2020) 全12集 1080P/") !== -1, "AI path 含根目录名: " + seenPaths[0]);
}

/* ---------- 执行器 + 撤销 ---------- */
async function testExecutor() {
  section("executor");
  var ROOT = "/media/downloads";
  var msgDir = ROOT + "/【XX影视 www.ad-site.com】凡人修仙传 2020 4K";
  var initFiles = (function () {
    var m = {};
    m[msgDir + "/Fan.Ren.Xiu.Xian.Zhuan.2020.S01E10.2160p.mp4"] = 1200 * 1048576;
    m[msgDir + "/Fan.Ren.Xiu.Xian.Zhuan.2020.S01E11.2160p.mp4"] = 1200 * 1048576;
    m[msgDir + "/凡人修仙传.S01E10.chs.srt"] = 60 * 1024;
    m[ROOT + "/Interstellar.2014.IMAX.2160p.BluRay.mkv"] = 8000 * 1048576;
    return m;
  })();
  var fake = makeFakeOl(initFiles);
  var S = testSettings();
  var getS = function () { return S; };
  var pipe = O.createPipeline({ ol: fake, ai: null, tmdb: null, getSettings: getS });
  var task = await pipe.organize(ROOT, {});
  eq(task.stats.included, 4, "执行前 4 项");

  var exec = O.createExecutor({ ol: fake, getSettings: getS, sleepFn: function () { return Promise.resolve(); } });
  await exec.execute(task);

  eq(task.status, "done", "任务完成; log=" + task.log.join(" | "));
  ok(fake.has(ROOT + "/凡人修仙传 (2020)/Season 01/凡人修仙传 - S01E10.mp4"), "e10 到位");
  ok(fake.has(ROOT + "/凡人修仙传 (2020)/Season 01/凡人修仙传 - S01E11.mp4"), "e11 到位");
  ok(fake.has(ROOT + "/凡人修仙传 (2020)/Season 01/凡人修仙传 - S01E10.chs.srt"), "字幕到位");
  ok(fake.has(ROOT + "/Interstellar (2014)/Interstellar (2014) - IMAX - 2160p.mkv"), "电影到位");
  ok(!fake.has(msgDir + "/Fan.Ren.Xiu.Xian.Zhuan.2020.S01E10.2160p.mp4"), "原文件已移走");
  ok(task.ops.length >= 8, "操作日志 " + task.ops.length + " 条");
  eq(task.stats.done, 4, "4 项完成");
  eq(task.stats.failed, 0, "0 失败");

  // 撤销
  var rec = O.taskToRecord(task);
  var r = await exec.undo(rec);
  eq(r.failed, 0, "撤销无失败: " + (r.errors || []).join(";"));
  for (var p in initFiles) ok(fake.has(p), "撤销后恢复 " + p);
  ok(!fake.has(ROOT + "/凡人修仙传 (2020)/Season 01/凡人修仙传 - S01E10.mp4"), "撤销后新位置无文件");
  eq(rec.status, "undone");
}

/* ---------- 执行器：同目录交换命名（环） ---------- */
async function testExecutorSwap() {
  section("executor swap");
  var DIR = "/x";
  var fake = makeFakeOl({ "/x/a.mkv": 100, "/x/b.mkv": 100 });
  var S = testSettings();
  S.exec.useBatchRename = true;
  function mkItem(id, name, dstName) {
    return {
      id: id, groupId: "g",
      file: { path: DIR + "/" + name, dir: DIR, name: name, size: 100, sizeMB: 100, ext: "mkv", kind: "video", relPath: name, depth: 1 },
      parsed: { type: "movie" },
      dstDir: DIR, dstName: dstName,
      action: "rename", include: true, status: "ok", reason: "", edited: false
    };
  }
  var task = {
    id: "t1", createdAt: "now", root: DIR, status: "ready",
    groups: [], items: [mkItem("i1", "a.mkv", "b.mkv"), mkItem("i2", "b.mkv", "a.mkv")],
    ops: [], log: [], stats: null,
    _dirs: { "/x": ["a.mkv", "b.mkv"] }
  };
  var exec = O.createExecutor({ ol: fake, getSettings: function () { return S; }, sleepFn: function () { return Promise.resolve(); } });
  await exec.execute(task);
  eq(task.status, "done", "交换完成; " + task.log.join(" | "));
  ok(fake.has("/x/a.mkv") && fake.has("/x/b.mkv"), "两个文件都在");
  // 内容交换验证：初始 a=100 b=100 无法区分，改用 ops 验证使用了临时名
  var usedTemp = task.ops.some(function (op) { return op.t === "rename" && /olmtmp/.test(op.to); });
  ok(usedTemp, "使用了临时名打断环");
  // 撤销后仍是两个原名
  var r = await exec.undo({ ops: task.ops });
  eq(r.failed, 0, "交换撤销成功: " + (r.errors || []).join(";"));
  ok(fake.has("/x/a.mkv") && fake.has("/x/b.mkv"), "撤销后原名都在");
}

/* ---------- 垃圾回收站模式 ---------- */
async function testTrashMode() {
  section("trash mode");
  var ROOT = "/dl";
  var fake = makeFakeOl({
    "/dl/最新电影 www.ad.com.txt": 1024,
    "/dl/防失联说明.txt": 1024,
    "/dl/Movie.2020.1080p.mkv": 3000 * 1048576
  });
  var S = testSettings();
  S.organize.junkAction = "trash";
  var pipe = O.createPipeline({ ol: fake, ai: null, tmdb: null, getSettings: function () { return S; } });
  var task = await pipe.organize(ROOT, {});
  var trashed = task.items.filter(function (it) { return it.action === "trash"; });
  eq(trashed.length, 2, "两个垃圾文件进回收站");
  ok(trashed[0].include, "回收默认勾选");
  var exec = O.createExecutor({ ol: fake, getSettings: function () { return S; }, sleepFn: function () { return Promise.resolve(); } });
  await exec.execute(task);
  ok(fake.has("/dl/.整理回收站/最新电影 www.ad.com.txt"), "垃圾进回收站");
  ok(!fake.has("/dl/最新电影 www.ad.com.txt"), "原位置已移走");
  ok(fake.has("/dl/Movie (2020)/Movie (2020) - 1080p.mkv"), "电影正常整理");
}

/* ---------- 指定目标目录 + 垃圾直接删除 ---------- */
async function testTargetDirAndDelete() {
  section("target dir & delete");
  var ROOT = "/dl2";
  var showDir = ROOT + "/凡人修仙传 第一季 (2020) 全12集";
  var fake = makeFakeOl((function () {
    var m = {};
    m[showDir + "/01.mp4"] = 900 * 1048576;
    m[showDir + "/最新电影 www.ad-site.com.txt"] = 1024;
    return m;
  })());
  var S = testSettings();
  S.organize.junkAction = "delete";
  var pipe = O.createPipeline({ ol: fake, ai: null, tmdb: null, getSettings: function () { return S; } });
  var task = await pipe.organize(ROOT, { targetDir: "/lib/tv" });
  var vid = null, junk = null;
  task.items.forEach(function (it) {
    if (it.file.ext === "mp4") vid = it;
    if (it.file.ext === "txt") junk = it;
  });
  eq(vid.dstDir, "/lib/tv/凡人修仙传 (2020)/Season 01", "目标目录重定向到 targetDir");
  eq(vid.dstName, "凡人修仙传 - S01E01.mp4", "目标文件名");
  eq(junk.action, "delete", "垃圾文件标记删除");
  ok(junk.include, "删除项默认勾选");
  eq(junk.status, "ok", "删除项状态 ok");
  eq(task.stats.del, 1, "stats.del 统计");
  eq(task.targetDir, "/lib/tv", "task 记录 targetDir");

  var exec = O.createExecutor({ ol: fake, getSettings: function () { return S; }, sleepFn: function () { return Promise.resolve(); } });
  await exec.execute(task);
  eq(task.status, "done", "执行完成; " + task.log.join(" | "));
  ok(fake.has("/lib/tv/凡人修仙传 (2020)/Season 01/凡人修仙传 - S01E01.mp4"), "视频进入目标库");
  ok(!fake.has(showDir + "/01.mp4"), "原视频已移走");
  ok(!fake.has(showDir + "/最新电影 www.ad-site.com.txt"), "垃圾文件已删除");
  ok(task.ops.some(function (op) { return op.t === "remove"; }), "记录 remove 操作");

  var rec = O.taskToRecord(task);
  var r = await exec.undo(rec);
  eq(r.failed, 0, "撤销无失败: " + (r.errors || []).join(";"));
  eq(r.skippedDeletes, 1, "删除项跳过计数");
  ok(fake.has(showDir + "/01.mp4"), "视频撤回原位");
  ok(!fake.has(showDir + "/最新电影 www.ad-site.com.txt"), "删除的文件不会复活");
  eq(rec.status, "undone", "撤销状态");
}

/* ---------- run ---------- */
async function main() {
  testUtils();
  testLocalParse();
  testAiHelpers();
  await testAiClient();
  testNamer();
  testOrderRenames();
  await testPipeline();
  await testExecutor();
  await testExecutorSwap();
  await testTrashMode();
  await testTargetDirAndDelete();
  print("ALL TESTS PASSED (" + __n + " assertions)");
}

main().catch(function (e) {
  print("TEST FAIL: " + (e && e.message));
  if (e && e.stack) print(e.stack);
  if (typeof quit === "function") quit(1);
  throw e;
});
