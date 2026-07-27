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
 * getCfg: () => settings.ai
 */
function createAiClient(getCfg, deps) {
  deps = deps || {};
  var fetchFn = deps.fetchFn ||
    (typeof fetch !== "undefined"
      ? fetch.bind(typeof window !== "undefined" ? window : globalThis)
      : null);
  var sleepFn = deps.sleepFn || olmSleep;

  async function chat(messages, o) {
    o = o || {};
    var cfg = getCfg();
    if (!fetchFn) throw new Error("当前环境没有 fetch");
    if (!cfg.apiKey) throw new Error("未配置 AI API Key");
    var url = String(cfg.baseUrl || "").replace(/\/+$/, "") + "/chat/completions";
    var body = {
      model: cfg.model,
      messages: messages,
      temperature: cfg.temperature == null ? 0.1 : cfg.temperature,
      stream: false
    };
    var useJson = o.jsonMode !== undefined ? o.jsonMode : cfg.jsonMode;
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
      // 部分网关不支持 response_format，去掉后重试一次
      if (useJson && resp.status === 400 && /response_format|json_object/i.test(text || "")) {
        return chat(messages, Object.assign({}, o, { jsonMode: false }));
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
