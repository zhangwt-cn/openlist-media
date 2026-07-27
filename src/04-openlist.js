/* ==== OpenList API 客户端 ==== */

function OlmError(message, code) {
  this.name = "OlmError";
  this.message = String(message || "未知错误");
  this.code = code == null ? -1 : code;
  this.stack = (new Error(this.message)).stack;
}
OlmError.prototype = Object.create(Error.prototype);
OlmError.prototype.constructor = OlmError;

function OlmAuthError(message) {
  OlmError.call(this, message || "未登录或登录已过期", 401);
  this.name = "OlmAuthError";
}
OlmAuthError.prototype = Object.create(OlmError.prototype);
OlmAuthError.prototype.constructor = OlmAuthError;

/*
 * opts: {
 *   getBaseUrl: () => string,
 *   getToken:   () => string,
 *   fetchFn:    可注入（测试/mock）,
 *   timeoutMs
 * }
 */
function createOpenListClient(opts) {
  opts = opts || {};
  var fetchFn = opts.fetchFn ||
    (typeof fetch !== "undefined"
      ? fetch.bind(typeof window !== "undefined" ? window : globalThis)
      : null);
  var getToken = opts.getToken || function () { return findOpenListToken(); };
  var getBaseUrl = opts.getBaseUrl || function () { return olmApiBase(); };
  var timeoutMs = opts.timeoutMs || 60000;

  async function req(apiPath, body, o) {
    o = o || {};
    if (!fetchFn) throw new OlmError("当前环境没有 fetch");
    var url = String(getBaseUrl() || "").replace(/\/+$/, "") + apiPath;
    var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, o.timeoutMs || timeoutMs) : null;
    var resp;
    try {
      resp = await fetchFn(url, {
        method: o.method || "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Authorization": getToken() || ""
        },
        body: (o.method === "GET") ? undefined : JSON.stringify(body || {}),
        signal: ctl ? ctl.signal : undefined
      });
    } catch (e) {
      throw new OlmError("请求 OpenList 失败: " + ((e && e.message) || e), 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (resp.status === 401) throw new OlmAuthError();
    var data = null;
    try { data = await resp.json(); }
    catch (e) { throw new OlmError("OpenList 响应不是 JSON (HTTP " + resp.status + ")", resp.status); }
    if (!data || typeof data.code === "undefined") {
      throw new OlmError("OpenList 响应格式异常 (HTTP " + resp.status + ")", resp.status);
    }
    if (data.code === 401) throw new OlmAuthError(data.message);
    if (data.code !== 200) throw new OlmError(data.message || ("OpenList 错误码 " + data.code), data.code);
    return data.data;
  }

  return {
    req: req,

    // 连通性/登录测试
    me: function () {
      return req("/api/me", null, { method: "GET" });
    },

    list: function (path, o) {
      o = o || {};
      return req("/api/fs/list", {
        path: path,
        password: o.password || "",
        page: 1,
        per_page: 0,
        refresh: !!o.refresh
      });
    },

    // 返回 content 数组（目录为空时 OpenList 返回 null）
    listAll: async function (path, o) {
      var d = await this.list(path, o);
      return (d && d.content) || [];
    },

    getObj: function (path) {
      return req("/api/fs/get", { path: path, password: "", page: 1, per_page: 0, refresh: false });
    },

    // OpenList 的 mkdir 会递归创建父目录；已存在视为成功
    mkdir: async function (path) {
      try {
        return await req("/api/fs/mkdir", { path: path });
      } catch (e) {
        if (e instanceof OlmAuthError) throw e;
        if (/exist|已存在|存在同名/i.test((e && e.message) || "")) return null;
        throw e;
      }
    },

    rename: function (path, newName) {
      return req("/api/fs/rename", { path: path, name: newName, overwrite: false });
    },

    // pairs: [{src, dst}]
    batchRename: function (srcDir, pairs) {
      return req("/api/fs/batch_rename", {
        src_dir: srcDir,
        rename_objects: pairs.map(function (p) { return { src_name: p.src, new_name: p.dst }; })
      });
    },

    move: function (srcDir, dstDir, names) {
      return req("/api/fs/move", {
        src_dir: srcDir,
        dst_dir: dstDir,
        names: names,
        overwrite: false
      });
    },

    removeEmptyDirectory: function (srcDir) {
      return req("/api/fs/remove_empty_directory", { src_dir: srcDir });
    }
  };
}
