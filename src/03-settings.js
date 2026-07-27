/* ==== 设置 ==== */

var olmSettingsCache = null;

function olmGetSettings() {
  if (!olmSettingsCache) {
    olmSettingsCache = deepMerge(OLM_DEFAULT_SETTINGS, lsGetJSON(OLM_KEYS.settings, {}));
  }
  return olmSettingsCache;
}

function olmSaveSettings(s) {
  olmSettingsCache = deepMerge(OLM_DEFAULT_SETTINGS, s || {});
  lsSetJSON(OLM_KEYS.settings, olmSettingsCache);
  return olmSettingsCache;
}

function olmResetSettings() {
  olmSettingsCache = deepClone(OLM_DEFAULT_SETTINGS);
  lsSetJSON(OLM_KEYS.settings, olmSettingsCache);
  return olmSettingsCache;
}

function olmExportSettings() {
  var s = deepClone(olmGetSettings());
  return JSON.stringify(s, null, 2);
}

function olmImportSettings(text) {
  var v = JSON.parse(text);
  if (!isPlainObj(v)) throw new Error("不是有效的设置 JSON");
  return olmSaveSettings(v);
}

// OpenList 登录 token：设置覆盖 > localStorage["token"] > 扫描疑似 JWT
function findOpenListToken(settings) {
  var s = settings || olmGetSettings();
  var o = s.general && s.general.tokenOverride;
  if (o && String(o).trim()) return String(o).trim();
  try {
    var direct = olmStorage.getItem("token");
    if (direct) {
      direct = String(direct).trim().replace(/^"+|"+$/g, "");
      if (direct.length > 20) return direct;
    }
    for (var i = 0; i < olmStorage.length; i++) {
      var k = olmStorage.key(i);
      if (!k || k.indexOf("olm.") === 0) continue;
      var v = olmStorage.getItem(k);
      if (!v) continue;
      v = String(v).trim().replace(/^"+|"+$/g, "");
      if (/^ey[\w-]{10,}\.[\w-]+\.[\w-]+$/.test(v)) return v;
    }
  } catch (e) { /* ignore */ }
  return "";
}

function olmApiBase(settings) {
  var s = settings || olmGetSettings();
  var o = s.general && s.general.baseUrl;
  if (o && String(o).trim()) return String(o).trim().replace(/\/+$/, "");
  if (typeof location !== "undefined" && location.origin) return location.origin;
  return "";
}
