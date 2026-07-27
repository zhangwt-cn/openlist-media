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
      ${olmField(d, "接口地址 (base_url)", "ai.baseUrl", { mono: true, placeholder: "https://api.deepseek.com/v1", hint: "DeepSeek: https://api.deepseek.com/v1　通义: https://dashscope.aliyuncs.com/compatible-mode/v1　Kimi: https://api.moonshot.cn/v1" })}
      ${olmField(d, "API Key", "ai.apiKey", { password: true })}
      ${olmField(d, "模型", "ai.model", { placeholder: "deepseek-chat" })}
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
        ${olmField(d, "垃圾文件处理", "organize.junkAction", { type: "select", options: [["ignore", "忽略（不动它们）"], ["trash", "移入回收站目录"]] })}
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
        ${olmField(d, "悬浮按钮位置", "ui.fabSide", { type: "select", options: [["right", "右下"], ["left", "左下"]], hint: "刷新页面后生效" })}
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
