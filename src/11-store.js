/* ==== 任务记录持久化（localStorage） ==== */

function taskToRecord(task) {
  return {
    id: task.id,
    createdAt: task.createdAt,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    undoneAt: task.undoneAt || null,
    root: task.root,
    renamedRoot: task.renamedRoot || null,
    rootRename: task.rootRename
      ? { from: task.rootRename.from, to: task.rootRename.to, status: task.rootRename.status, reason: task.rootRename.reason || "" }
      : null,
    dirRenames: (task.dirRenames || []).map(function (d) {
      return { dir: d.dir, from: d.from, to: d.to, status: d.status };
    }),
    status: task.status,
    stats: task.stats || null,
    groups: (task.groups || [])
      .filter(function (g) { return g.type === "movie" || g.type === "tv"; })
      .map(function (g) {
        return {
          type: g.type,
          display: olmGroupDisplay(g),
          tmdbId: g.tmdb ? g.tmdb.id : null,
          matchStatus: g.matchStatus,
          count: (g.itemIds || []).length
        };
      }),
    items: (task.items || []).map(function (it) {
      return {
        src: it.file.path,
        dst: it.dstDir && it.dstName ? pathJoin(it.dstDir, it.dstName) : null,
        action: it.action,
        include: it.include,
        status: it.status,
        reason: it.reason || ""
      };
    }),
    ops: task.ops || [],
    log: task.log || []
  };
}

function listTaskRecords() {
  return lsGetJSON(OLM_KEYS.tasks, []);
}

function getTaskRecord(id) {
  var list = listTaskRecords();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function saveTaskRecord(rec) {
  var list = listTaskRecords();
  list = list.filter(function (r) { return r.id !== rec.id; });
  list.unshift(rec);
  while (list.length > 20) list.pop();
  // 存储超限时丢弃最老的记录重试
  while (!lsSetJSON(OLM_KEYS.tasks, list) && list.length > 1) list.pop();
  return rec;
}

function updateTaskRecord(rec) {
  return saveTaskRecord(rec);
}

function deleteTaskRecord(id) {
  var list = listTaskRecords().filter(function (r) { return r.id !== id; });
  lsSetJSON(OLM_KEYS.tasks, list);
}
