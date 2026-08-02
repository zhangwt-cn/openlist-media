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
      <div class="olm-hint">电影/剧集的规范目录会建到这里（垃圾回收站仍在扫描目录内）。直接整理某部影视自己的文件夹时无需填写：会自动识别并只建 Season 结构，还可顺带把目录名改规范。</div>
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
    <b style="color:#cbd5e1">安全</b>：默认只做 新建目录/重命名/移动；删除仅两处且都需确认（垃圾文件的「直接删除」选项、整理后搬空的原目录）；每次执行都有操作日志，支持撤销（删除的文件除外，删除的空目录撤销时自动重建）。
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

// 方案页的「目录名规范化」条：季目录改名（Season 1 → Season 01）与根目录改名
function olmDirNormalizeBanner(task) {
  var rr = task.rootRename;
  var drs = task.dirRenames || [];
  if (!rr && !drs.length) return "";
  var parts = drs.map(function (d) {
    return `<span class="path">${escHtml(d.from)}</span> → <span class="path">${escHtml(d.to)}</span>` +
      (d.status === "conflict" ? `<span style="color:#fbbf24">（目标已存在，跳过）</span>` : "");
  });
  if (rr) {
    parts.push(`本目录 → <b class="path" style="color:#34d399">${escHtml(rr.to)}</b>` +
      (rr.status === "conflict" ? `<span style="color:#fbbf24">（${escHtml(rr.reason)}，跳过）</span>` : ""));
  }
  var toggleable = (rr && rr.status === "ok") || drs.some(function (d) { return d.status === "ok"; });
  var on = (rr && rr.status === "ok" && rr.include) || drs.some(function (d) { return d.status === "ok" && d.include; });
  return `<div class="olm-banner info">
    <label class="olm-switch" style="margin:0;font-size:13px;align-items:flex-start">
      <input type="checkbox" data-chg="toggleDirNormalize" ${on ? "checked" : ""} ${toggleable ? "" : "disabled"}/>
      <span>整理完成后规范化目录名：${parts.join("　")}</span>
    </label>
  </div>`;
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
  var scraped = task.items.filter(function (x) { return x.scrapedMeta && x.include && (x.action === "move" || x.action === "rename"); });
  if (scraped.length) {
    var metaN = 0;
    scraped.forEach(function (x) { metaN += x.scrapedMeta; });
    banners += `<div class="olm-banner warn" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="flex:1;min-width:240px">📀 ${scraped.length} 个视频旁有同名刮削元数据（.nfo/缩略图等 ${metaN} 个），说明该目录已刮削、Emby 通常已能直接识别；改名/移动后这些元数据会失联，需重新刮削。若媒体库显示正常，建议保持原样不处理。</span>
      <button class="olm-btn sm" data-act="excludeScraped" style="flex:none">排除这些视频及字幕</button>
    </div>`;
  }

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
    <button class="olm-btn pri" data-act="executePlan" ${stats.included || (task.rootRename && task.rootRename.include && task.rootRename.status === "ok") || (task.dirRenames || []).some(function (d) { return d.include && d.status === "ok"; }) ? "" : "disabled"}>🚀 执行 ${stats.included} 项</button>
  </div>
  <div class="olm-hint" style="margin:-6px 0 12px">目录：<span style="color:#94a3b8">${escHtml(task.root)}</span>${task.targetDir ? `　整理到：<span style="color:#34d399">${escHtml(task.targetDir)}</span>` : ""}　勾选=执行；✎ 可手动改目标路径；冲突项需修改或放弃其一。</div>
  ${olmDirNormalizeBanner(task)}
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
  ${task.renamedRoot ? `<div class="olm-banner info">📁 目录已改名：<span class="path" style="color:#34d399">${escHtml(task.renamedRoot)}</span></div>` : ""}
  ${task.rootRename && task.rootRename.status === "failed" ? `<div class="olm-banner warn">⚠ ${escHtml(task.rootRename.reason)}</div>` : ""}
  ${task.emptyDirs && task.emptyDirs.length ? `<div class="olm-banner info" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span style="flex:1;min-width:200px">🧹 ${task.emptyDirs.length} 个原目录已搬空：${task.emptyDirs.map(function (d) { return `<span class="path">${escHtml(olmRelToRoot(task.renamedRoot || task.root, pathDir(d), pathName(d)))}</span>`; }).join("、")}</span>
    <button class="olm-btn sm warn" data-act="removeEmptySrcDirs" style="flex:none">删除空目录</button>
  </div>` : ""}
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

olmUI.actions.toggleDirNormalize = function (el) {
  var task = olmUI.state.organize.task;
  if (!task) return;
  var on = !!el.checked;
  if (task.rootRename && task.rootRename.status !== "conflict") {
    task.rootRename.include = on;
    task.rootRename.userExcluded = !on;
  }
  (task.dirRenames || []).forEach(function (d) {
    if (d.status !== "conflict") {
      d.include = on;
      d.userExcluded = !on;
    }
  });
  olmRenderTab();
};

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

// 已刮削视频一键排除：连同配对字幕一起保持原名（元数据/外挂字幕都靠同名关联）
olmUI.actions.excludeScraped = function () {
  var task = olmUI.state.organize.task;
  if (!task) return;
  function pairKey(x) {
    var p = x.parsed || {};
    return x.groupId + "|" + (p.season == null ? "" : p.season) + "|" + (p.episode == null ? "" : p.episode) + "|" + (p.part || "");
  }
  var keys = {};
  task.items.forEach(function (it) {
    if (it.scrapedMeta && it.include && (it.action === "move" || it.action === "rename")) keys[pairKey(it)] = 1;
  });
  var n = 0;
  task.items.forEach(function (it) {
    if (!it.include || it.status === "done" || it.status === "failed") return;
    var hit = (it.scrapedMeta && (it.action === "move" || it.action === "rename")) ||
      (it.file.kind === "subtitle" && keys[pairKey(it)]);
    if (!hit) return;
    it.userExcluded = true;
    it.include = false;
    it.status = "excluded";
    it.reason = "已刮削（同名 nfo/缩略图），保持原名";
    n++;
  });
  if (n) olmToast("已排除 " + n + " 项，保持原文件名", "ok");
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
  var willRenameRoot = task.rootRename && task.rootRename.include && task.rootRename.status === "ok";
  var dirRenN = (task.dirRenames || []).filter(function (d) { return d.include && d.status === "ok"; }).length;
  olmConfirm({
    title: "确认执行整理",
    html: `将执行 <b style="color:#34d399">${stats.included}</b> 项操作（移动 ${stats.move} / 改名 ${stats.rename}${stats.trash ? " / 回收 " + stats.trash : ""}${stats.del ? " / 删除 " + stats.del : ""}）。<br/>` +
      (dirRenN || willRenameRoot ? `完成后规范化 ${dirRenN + (willRenameRoot ? 1 : 0)} 个目录名${willRenameRoot ? `（本目录 → <b style="color:#34d399">${escHtml(task.rootRename.to)}</b>）` : ""}。<br/>` : "") +
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

olmUI.actions.removeEmptySrcDirs = function () {
  var st = olmUI.state.organize;
  var task = st.task;
  if (!task || !task.emptyDirs || !task.emptyDirs.length) return;
  var dirs = task.emptyDirs.slice();   // 已按"深目录在前"排序，子目录先删
  olmConfirm({
    title: "删除空目录",
    html: `将删除 <b>${dirs.length}</b> 个已搬空的原目录。删除前会再次校验是否为空，非空则跳过；撤销整理时会自动重建。确定？`,
    okText: "删除",
    danger: true
  }).then(function (ok) {
    if (!ok) return;
    var ol = createOpenListClient({});
    (async function () {
      var okN = 0, skipN = 0, failN = 0;
      for (var i = 0; i < dirs.length; i++) {
        var d = dirs[i];
        try {
          var es = await ol.listAll(d);
          if (es.length) { skipN++; continue; }
          await ol.remove(pathDir(d), [pathName(d)]);
          task.ops.push({ t: "rmdir", path: d });
          okN++;
        } catch (e) { failN++; }
      }
      task.emptyDirs = [];
      try {
        if (st.record) {
          st.record.ops = task.ops;
          updateTaskRecord(st.record);
        }
      } catch (e) { olmLog("update record fail", e); }
      olmToast("已删除 " + okN + " 个空目录" + (skipN ? "，非空跳过 " + skipN : "") + (failN ? "，失败 " + failN : ""), failN ? "err" : "ok", 4000);
      olmRenderTab();
    })();
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
