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
