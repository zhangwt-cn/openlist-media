/* ==== UI 核心：Shadow DOM 面板骨架 / 样式 / 模态 / 事件分发 ==== */

var OLM_CSS = [
  ":host { all: initial; }",
  "* { box-sizing: border-box; margin: 0; padding: 0; }",
  ".olm-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; font-size: 14px; color: #e5e7eb; }",
  "",
  "/* 悬浮按钮 */",
  ".olm-fab { position: fixed; bottom: 96px; z-index: 2147483000; width: 48px; height: 48px; border-radius: 50%; border: none; cursor: pointer; background: linear-gradient(135deg, #059669, #0d9488); color: #fff; font-size: 22px; line-height: 1; box-shadow: 0 4px 14px rgba(0,0,0,.35); transition: transform .15s ease; display: flex; align-items: center; justify-content: center; }",
  ".olm-fab:hover { transform: scale(1.08); }",
  ".olm-fab.right { right: 20px; } .olm-fab.left { left: 20px; }",
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

  root.querySelector(".olm-fab").addEventListener("click", function () {
    if (olmUI.open) olmClosePanel();
    else {
      // 每次打开时刷新默认路径为当前浏览目录
      if (olmUI.state.organize && olmUI.state.organize.step === "idle") {
        olmUI.state.organize.path = olmCurrentDirFromLocation();
      }
      olmOpenPanel();
    }
  });
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
