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
    // 扫描根目录自己的影视身份（本地解析打底，AI 结果覆盖）：
    // 用于判断"根目录本身就是某部影视的文件夹"，避免整理时再嵌套一层剧名目录
    var rootName = segs.length ? segs[segs.length - 1] : "";
    var dpRoot = olmParseDirName(rootName);
    var rootParsed = {
      type: "unknown", title: dpRoot.title, originalTitle: dpRoot.originalTitle,
      year: dpRoot.year, season: dpRoot.season, episode: null, episodeEnd: null,
      resolution: null, version: null, part: null, lang: null, confidence: 0.3, from: "local"
    };
    var aiErrors = [];
    if (s.ai.enabled && s.ai.apiKey && deps.ai) {
      // 只把媒体类文件交给 AI，省 token；junk/meta 扩展名本地即可判定
      var entries = [];
      for (var i = 0; i < files.length; i++) {
        if (files[i].kind === "video" || files[i].kind === "subtitle") {
          entries.push({ i: i, path: ctxPath(files[i].relPath), sizeMB: files[i].sizeMB });
        }
      }
      if (entries.length && ctx) {
        entries.push({ i: -1, path: ctx, sizeMB: null }); // 根目录名也交给 AI 识别身份
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
        if (r.byI[-1]) rootParsed = mergeParsed(r.byI[-1], rootParsed);
      }
    }
    checkCancel();
    return { parsedList: parsedList, aiErrors: aiErrors, rootParsed: rootParsed };
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

    // 目标根目录的影视身份：扫描根用解析阶段的结果（含 AI 识别），其它目标目录现场解析
    var identCache = {};
    function baseIsGroupFolder(base, grp) {
      var ident;
      if (base === task.root && task.rootParsed) ident = task.rootParsed;
      else ident = identCache[base] || (identCache[base] = olmParseDirName(pathName(base)));
      return olmIdentityMatchesGroup(ident, grp);
    }

    // 计算目标目录：根目录是影视自身文件夹则不嵌套剧名层；
    // 剧集优先复用已存在的等价季目录（如 Season 1 ≈ Season 01），避免另建一份再搬文件——
    // 名字不规范的等价目录记入 dirRenamesMap，整理完成后整体改名规范
    var dirRenamesMap = {};   // "父目录\n现名" → 规范名
    function dstDirFor(base, grp, built, parsed) {
      var flatten = baseIsGroupFolder(base, grp);
      if (grp.type !== "tv" || !built.innerRel) {
        return flatten ? base : base + "/" + built.folderRel;
      }
      var showDir = flatten ? base : base + "/" + built.folderRel.split("/")[0];
      var canonical = built.innerRel;
      var listing = task._dirs ? task._dirs[showDir] : undefined;
      if (listing && listing.indexOf(canonical) === -1) {
        var season = parsed.season == null ? 1 : parsed.season;
        for (var k = 0; k < listing.length; k++) {
          if (olmSeasonDirEquivalent(listing[k], season)) {
            // Specials 本身就是 Emby 认可的特别篇目录名，不改名
            if (!(season === 0 && /^specials?$/i.test(listing[k]))) {
              dirRenamesMap[showDir + "\n" + listing[k]] = canonical;
            }
            return showDir + "/" + listing[k];
          }
        }
      }
      return showDir + "/" + canonical;
    }

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
      it.dstDir = dstDirFor(base, g, built, p);
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
          it.dstDir = dstDirFor(base2, g, built2, p);
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

    // 季目录规范化改名清单（保留用户此前的勾选状态）
    var prevDR = task.dirRenames || [];
    task.dirRenames = Object.keys(dirRenamesMap).map(function (key) {
      var seg = key.split("\n");
      var prev = null;
      for (var d = 0; d < prevDR.length; d++) {
        if (prevDR[d].dir === seg[0] && prevDR[d].from === seg[1]) prev = prevDR[d];
      }
      return {
        dir: seg[0], from: seg[1], to: dirRenamesMap[key],
        userExcluded: prev ? !!prev.userExcluded : false,
        include: prev ? !prev.userExcluded : true,
        status: "ok", reason: ""
      };
    });

    // 根目录改名建议：扫描目录本身就是某部影视的文件夹但名字不规范（如带发布组前后缀装饰）。
    // 目录名解析出季号的不建议（多为「剧名 第二季」这类季文件夹，不该改成剧名层目录名）。
    var prevRR = task.rootRename;
    task.rootRename = null;
    var rootName = pathName(task.root);
    var rootIdent = task.rootParsed || olmParseDirName(rootName);
    if (rootName && rootIdent.season == null) {
      var rrGroup = null;
      for (i = 0; i < task.groups.length; i++) {
        g = task.groups[i];
        if (g.type !== "movie" && g.type !== "tv") continue;
        if ((g.type === "movie" ? roots.movieRoot : roots.tvRoot) !== task.root) continue;
        if (!olmIdentityMatchesGroup(rootIdent, g)) continue;
        if (!rrGroup || (g.itemIds || []).length > (rrGroup.itemIds || []).length) rrGroup = g;
      }
      var wantName = rrGroup ? olmMediaFolderName(rrGroup, s.naming) : null;
      if (wantName && wantName !== rootName) {
        task.rootRename = {
          from: rootName,
          to: wantName,
          groupId: rrGroup.id,
          userExcluded: prevRR ? !!prevRR.userExcluded : false,
          include: prevRR ? !prevRR.userExcluded : true,
          status: "ok",
          reason: ""
        };
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

    // 季目录改名：规范名是否已被占用
    var drs = task.dirRenames || [];
    for (i = 0; i < drs.length; i++) {
      var dr = drs[i];
      var dnames = dirs[dr.dir];
      if (dnames && dnames.indexOf(dr.to) !== -1) {
        dr.status = "conflict";
        dr.include = false;
        dr.reason = "已存在同名条目：" + pathJoin(dr.dir, dr.to);
      } else if (dr.status === "conflict") {
        dr.status = "ok";
        dr.include = !dr.userExcluded;
        dr.reason = "";
      }
    }

    // 根目录改名：上级目录里是否已被同名条目占用
    if (task.rootRename) {
      var rr = task.rootRename;
      var parentDir = pathDir(task.root);
      if (dirs[parentDir] === undefined) {
        try {
          var pes = await ol.listAll(parentDir);
          dirs[parentDir] = pes.map(function (e) { return e.name; });
        } catch (e3) {
          dirs[parentDir] = null;
        }
      }
      var sib = dirs[parentDir];
      if (sib && sib.indexOf(rr.to) !== -1) {
        rr.status = "conflict";
        rr.include = false;
        rr.reason = "上级目录已存在同名条目：" + pathJoin(parentDir, rr.to);
      } else if (rr.status === "conflict") {
        rr.status = "ok";
        rr.include = !rr.userExcluded;
        rr.reason = "";
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
      rootParsed: pr.rootParsed || null,
      rootRename: null,
      dirRenames: [],
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
