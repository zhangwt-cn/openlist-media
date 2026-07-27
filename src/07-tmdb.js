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
