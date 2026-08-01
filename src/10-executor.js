/* ==== 执行器：mkdir → 重命名（链/环安全）→ 移动（占位感知）；全程限速 + 重试 + 操作日志 ==== */

/*
 * 同目录内重命名排序：
 * - 目标名被其他待重命名文件占用时先等待其让位
 * - 出现环（A→B, B→A）时用临时名打断
 * 输入 [{id, src, dst}]，输出 [{id, src, dst, temp?}]（可能比输入多，因为环需要两步）
 */
function olmOrderRenames(renames) {
  var result = [];
  var pending = renames.map(function (r) { return { id: r.id, src: r.src, dst: r.dst }; });
  var current = {};   // 当前占用中的名字
  var i;
  for (i = 0; i < pending.length; i++) current[pending[i].src] = true;
  var guard = pending.length * 3 + 10;
  var tempSeq = 0;
  while (pending.length && guard-- > 0) {
    var idx = -1;
    for (i = 0; i < pending.length; i++) {
      var r = pending[i];
      if (r.dst === r.src || !current[r.dst]) { idx = i; break; }
    }
    if (idx === -1) {
      // 环：把第一个先改成临时名
      var head = pending[0];
      var tmp = head.dst + ".olmtmp" + (tempSeq++);
      result.push({ id: head.id, src: head.src, dst: tmp, temp: true });
      delete current[head.src];
      current[tmp] = true;
      head.src = tmp;
      continue;
    }
    var picked = pending.splice(idx, 1)[0];
    if (picked.src !== picked.dst) {
      result.push({ id: picked.id, src: picked.src, dst: picked.dst });
      delete current[picked.src];
      current[picked.dst] = true;
    }
  }
  return result;
}

/*
 * deps: { ol, getSettings, onProgress, isCancelled, sleepFn }
 */
function createExecutor(deps) {
  deps = deps || {};
  var ol = deps.ol;
  var getSettings = deps.getSettings || olmGetSettings;
  var onProgress = deps.onProgress || function () {};
  var isCancelled = deps.isCancelled || function () { return false; };
  var sleepFn = deps.sleepFn || olmSleep;

  function isRetryable(e) {
    if (e instanceof OlmAuthError) return false;
    var msg = String((e && e.message) || e);
    if (/exist|已存在|存在同名|not found|不存在/i.test(msg)) return false;
    var code = e && e.code;
    return code === 0 || code === 429 || (code >= 500 && code <= 599) ||
      /timeout|abort|network|fetch|load failed/i.test(msg);
  }

  var opSeq = 0;
  async function writeOp(fn, label) {
    var s = getSettings();
    var interval = Math.max(0, s.exec.intervalMs || 0);
    var retries = Math.max(0, s.exec.retries || 0);
    if (opSeq++ > 0 && interval) await sleepFn(interval);
    for (var attempt = 0; ; attempt++) {
      if (isCancelled()) {
        var ce = new Error("已取消");
        ce.cancelled = true;
        throw ce;
      }
      try {
        return await fn();
      } catch (e) {
        if (e && e.cancelled) throw e;
        if (e instanceof OlmAuthError) throw e;
        if (attempt >= retries || !isRetryable(e)) throw e;
        await sleepFn(Math.min(8000, (interval || 300) * Math.pow(2, attempt + 1)));
        olmLog("retry", label, (e && e.message) || e);
      }
    }
  }

  function taskLog(task, msg) {
    task.log.push(olmNowIso().slice(11, 19) + " " + msg);
    if (task.log.length > 500) task.log.splice(0, task.log.length - 400);
  }

  async function execute(task) {
    var s = getSettings();
    var items = task.items.filter(function (it) {
      return it.include && it.status === "ok" &&
        ((it.dstDir && it.dstName) || it.action === "delete");
    });
    var rootRen = task.rootRename && task.rootRename.include && task.rootRename.status === "ok"
      ? task.rootRename : null;
    var dirRens = (task.dirRenames || []).filter(function (d) { return d.include && d.status === "ok"; });
    if (!items.length && !rootRen && !dirRens.length) throw new Error("没有可执行的条目");
    task.status = "executing";
    task.startedAt = olmNowIso();
    opSeq = 0;

    var known = task._dirs || {};
    var i, it;

    // 每个 item 的当前位置状态
    var st = {};
    for (i = 0; i < items.length; i++) {
      it = items[i];
      st[it.id] = { item: it, curDir: it.file.dir, curName: it.file.name, done: false, failed: false };
    }

    /* A. 建目录 */
    var needDirs = {};
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (it.dstDir && it.dstDir !== it.file.dir && !known[it.dstDir]) needDirs[it.dstDir] = true;
    }
    var dirList = Object.keys(needDirs).sort(function (a, b) { return a.length - b.length; });
    var totalSteps = dirList.length + items.length + dirRens.length + (rootRen ? 1 : 0);
    var doneSteps = 0;

    for (i = 0; i < dirList.length; i++) {
      var dp = dirList[i];
      try {
        await writeOp(function () { return ol.mkdir(dp); }, "mkdir " + dp);
        task.ops.push({ t: "mkdir", path: dp });
        known[dp] = known[dp] || [];
        taskLog(task, "mkdir " + dp);
      } catch (e) {
        if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
        // 目录建不出来 → 其下所有 item 直接失败
        for (var k = 0; k < items.length; k++) {
          if (items[k].dstDir === dp) {
            st[items[k].id].failed = true;
            items[k].status = "failed";
            items[k].reason = "创建目录失败: " + ((e && e.message) || e);
          }
        }
        taskLog(task, "mkdir 失败 " + dp + ": " + ((e && e.message) || e));
      }
      doneSteps++;
      onProgress({ phase: "exec", done: doneSteps, total: totalSteps, note: "建目录" });
    }

    /* B. 同目录改名（移动前先改成最终名） */
    var renamesByDir = {};
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (st[it.id].failed || it.action === "delete") continue;
      var finalName = it.dstName;
      if (it.action === "trash") {
        // 回收站重名 → 加时间戳后缀
        var trashNames = (known[it.dstDir] || []).slice();
        for (var t2 = 0; t2 < items.length; t2++) {
          if (items[t2] !== it && items[t2].action === "trash" && items[t2].dstDir === it.dstDir) {
            trashNames.push(items[t2].dstName);
          }
        }
        if (trashNames.indexOf(finalName) !== -1) {
          var stem = pathStem(finalName), ext0 = pathExt(finalName);
          finalName = stem + "." + Date.now().toString(36) + (ext0 ? "." + ext0 : "");
          it.dstName = finalName;
        }
      }
      if (finalName !== it.file.name) {
        (renamesByDir[it.file.dir] = renamesByDir[it.file.dir] || []).push({
          id: it.id, src: it.file.name, dst: finalName
        });
      }
    }

    for (var dir in renamesByDir) {
      var ordered = olmOrderRenames(renamesByDir[dir]);
      var srcSet = {};
      renamesByDir[dir].forEach(function (r) { srcSet[r.src] = 1; });
      var hasChain = ordered.length !== renamesByDir[dir].length ||
        renamesByDir[dir].some(function (r) { return r.dst !== r.src && srcSet[r.dst]; });
      var useBatch = s.exec.useBatchRename && !hasChain && ordered.length > 1;
      if (useBatch) {
        var chunks = [];
        for (i = 0; i < ordered.length; i += 30) chunks.push(ordered.slice(i, i + 30));
        for (var c = 0; c < chunks.length; c++) {
          var chunk = chunks[c];
          try {
            await writeOp(function () { return ol.batchRename(dir, chunk); }, "batch_rename " + dir);
            for (i = 0; i < chunk.length; i++) applyRenameOk(task, st, dir, chunk[i]);
            doneSteps += countNonTemp(chunk);
          } catch (e) {
            if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
            // 整批失败 → 逐个来，定位失败者
            for (i = 0; i < chunk.length; i++) {
              await renameOne(task, st, dir, chunk[i]);
              doneSteps++;
            }
          }
          onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "重命名" });
        }
      } else {
        for (i = 0; i < ordered.length; i++) {
          await renameOne(task, st, dir, ordered[i]);
          if (!ordered[i].temp) doneSteps++;
          onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "重命名" });
        }
      }
    }

    // 纯改名的 item 已就位
    for (i = 0; i < items.length; i++) {
      it = items[i];
      var stt = st[it.id];
      if (stt.failed || it.action === "move" || it.action === "trash") continue;
      if (stt.curName === it.dstName && stt.curDir === it.dstDir) {
        stt.done = true;
        it.status = "done";
      }
    }

    /* C. 移动（多轮：等目标位被让出后再进入） */
    var movesPending = [];
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (st[it.id].failed || st[it.id].done) continue;
      if (it.action !== "move" && it.action !== "trash") continue;
      if (st[it.id].curName !== it.dstName) {
        st[it.id].failed = true;
        it.status = "failed";
        it.reason = it.reason || "移动前的重命名未完成";
        continue;
      }
      movesPending.push(st[it.id]);
    }

    // 占用表：其他 pending item 的当前位置
    function occupiedBy(path) {
      for (var x = 0; x < movesPending.length; x++) {
        var ms = movesPending[x];
        if (!ms.done && !ms.failed && pathJoin(ms.curDir, ms.curName) === path) return ms;
      }
      return null;
    }

    var guard = movesPending.length * 3 + 5;
    while (guard-- > 0) {
      var ready = [];
      var waiting = [];
      for (i = 0; i < movesPending.length; i++) {
        var ms = movesPending[i];
        if (ms.done || ms.failed) continue;
        var targetPath = pathJoin(ms.item.dstDir, ms.item.dstName);
        var occ = occupiedBy(targetPath);
        if (occ && occ !== ms) waiting.push(ms);
        else ready.push(ms);
      }
      if (!ready.length && !waiting.length) break;
      if (!ready.length && waiting.length) {
        // 跨目录环：把第一个等待者在原目录改成临时名
        var w = waiting[0];
        var tmpName = w.curName + ".olmtmp" + Math.floor(Math.random() * 1e4);
        try {
          await writeOp(function () { return ol.rename(pathJoin(w.curDir, w.curName), tmpName); }, "temp rename");
          task.ops.push({ t: "rename", dir: w.curDir, from: w.curName, to: tmpName });
          taskLog(task, "临时改名 " + w.curName + " → " + tmpName);
          w.curName = tmpName;
          // 目标名与最终名不同了，移动后需要再改回；标记
          w.needFinalRename = true;
        } catch (e) {
          if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
          w.failed = true;
          w.item.status = "failed";
          w.item.reason = "打断移动环失败: " + ((e && e.message) || e);
        }
        continue;
      }

      // 按 (srcDir → dstDir) 分组批量移动
      var byPair = {};
      for (i = 0; i < ready.length; i++) {
        var pr = ready[i];
        var pk = pr.curDir + "\n" + pr.item.dstDir;
        (byPair[pk] = byPair[pk] || []).push(pr);
      }
      for (var pk2 in byPair) {
        var grp = byPair[pk2];
        var srcDir = grp[0].curDir, dstDir = grp[0].item.dstDir;
        for (var off = 0; off < grp.length; off += 15) {
          var part = grp.slice(off, off + 15);
          var names = part.map(function (x) { return x.curName; });
          try {
            await writeOp(function () { return ol.move(srcDir, dstDir, names); }, "move → " + dstDir);
            for (i = 0; i < part.length; i++) applyMoveOk(task, part[i], srcDir, dstDir);
            doneSteps += part.length;
          } catch (e) {
            if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
            // 整批失败 → 逐个
            for (i = 0; i < part.length; i++) {
              var one = part[i];
              try {
                await writeOp(function () { return ol.move(srcDir, dstDir, [one.curName]); }, "move1 → " + dstDir);
                applyMoveOk(task, one, srcDir, dstDir);
              } catch (e2) {
                if (e2 instanceof OlmAuthError || (e2 && e2.cancelled)) { finish(task, e2); throw e2; }
                one.failed = true;
                one.item.status = "failed";
                one.item.reason = "移动失败: " + ((e2 && e2.message) || e2);
                taskLog(task, "移动失败 " + one.curName + ": " + ((e2 && e2.message) || e2));
              }
              doneSteps++;
            }
          }
          onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "移动" });
        }
      }

      // 临时名的收尾：移动完成后改回最终名
      for (i = 0; i < movesPending.length; i++) {
        var fs = movesPending[i];
        if (fs.done && fs.needFinalRename && fs.curName !== fs.item.dstName) {
          try {
            await writeOp(function () {
              return ol.rename(pathJoin(fs.curDir, fs.curName), fs.item.dstName);
            }, "final rename");
            task.ops.push({ t: "rename", dir: fs.curDir, from: fs.curName, to: fs.item.dstName });
            fs.curName = fs.item.dstName;
            fs.needFinalRename = false;
            fs.item.status = "done";
          } catch (e) {
            if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
            fs.item.status = "failed";
            fs.item.reason = "移动后改回最终名失败: " + ((e && e.message) || e);
            fs.failed = true;
            fs.done = false;
          }
        }
      }
    }

    // 没轮到执行的（链条断裂等）
    for (i = 0; i < movesPending.length; i++) {
      if (!movesPending[i].done && !movesPending[i].failed) {
        movesPending[i].item.status = "failed";
        movesPending[i].item.reason = movesPending[i].item.reason || "未能完成（目标位置始终被占用）";
      }
    }

    /* D. 删除垃圾文件（junkAction=delete；不可撤销，放最后执行） */
    for (i = 0; i < items.length; i++) {
      it = items[i];
      var sd = st[it.id];
      if (it.action !== "delete" || sd.failed || sd.done) continue;
      var delDir = it.file.dir, delName = it.file.name;
      try {
        await writeOp(function () { return ol.remove(delDir, [delName]); }, "remove " + delName);
        task.ops.push({ t: "remove", dir: delDir, name: delName });
        sd.done = true;
        it.status = "done";
        taskLog(task, "删除 " + delName);
      } catch (e) {
        if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
        sd.failed = true;
        it.status = "failed";
        it.reason = "删除失败: " + ((e && e.message) || e);
        taskLog(task, "删除失败 " + delName + ": " + ((e && e.message) || e));
      }
      doneSteps++;
      onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "删除垃圾文件" });
    }

    /* E. 目录名规范化（放最后执行；撤销时最先还原，文件操作记录的旧路径因此始终有效）
     *    先季目录（Season 1 → Season 01），再根目录 */
    var canNormalize = !items.length || items.some(function (x) { return x.status === "done"; });
    for (i = 0; i < dirRens.length; i++) {
      var dren = dirRens[i];
      if (!canNormalize) {
        dren.status = "skipped";
        dren.reason = "文件操作无一成功，跳过目录改名";
        continue;
      }
      try {
        await writeOp(function () { return ol.rename(pathJoin(dren.dir, dren.from), dren.to); }, "rename dir " + dren.from);
        task.ops.push({ t: "rename", dir: dren.dir, from: dren.from, to: dren.to });
        dren.status = "done";
        taskLog(task, "目录改名 " + dren.from + " → " + dren.to);
      } catch (e) {
        if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
        dren.status = "failed";
        dren.reason = "目录改名失败: " + ((e && e.message) || e);
        taskLog(task, "目录改名失败 " + dren.from + ": " + ((e && e.message) || e));
      }
      doneSteps++;
      onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "目录改名" });
    }

    if (rootRen) {
      var anyDone = canNormalize;
      if (anyDone) {
        try {
          await writeOp(function () { return ol.rename(task.root, rootRen.to); }, "rename root");
          task.ops.push({ t: "rename", dir: pathDir(task.root), from: rootRen.from, to: rootRen.to });
          rootRen.status = "done";
          task.renamedRoot = pathJoin(pathDir(task.root), rootRen.to);
          taskLog(task, "目录改名 " + rootRen.from + " → " + rootRen.to);
        } catch (e) {
          if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
          rootRen.status = "failed";
          rootRen.reason = "目录改名失败: " + ((e && e.message) || e);
          taskLog(task, "目录改名失败: " + ((e && e.message) || e));
        }
      } else {
        rootRen.status = "skipped";
        rootRen.reason = "文件操作无一成功，跳过目录改名";
        taskLog(task, "跳过目录改名（文件操作无一成功）");
      }
      doneSteps++;
      onProgress({ phase: "exec", done: Math.min(doneSteps, totalSteps), total: totalSteps, note: "目录改名" });
    }

    /* 收尾 */
    finish(task, null);
    if (rootRen && rootRen.status === "failed") {
      task.status = items.length ? (task.status === "done" ? "partial" : task.status) : "failed";
    }

    if (s.organize.cleanEmptyDirs && task.status !== "failed") {
      try {
        await writeOp(function () { return ol.removeEmptyDirectory(task.renamedRoot || task.root); }, "clean empty dirs");
        taskLog(task, "已清理空目录");
      } catch (e) {
        taskLog(task, "清理空目录失败: " + ((e && e.message) || e));
      }
    }

    /* F. 检出已搬空的原目录（含扫描时就已为空的遗留目录），供结果页提示删除 */
    task.emptyDirs = [];
    try {
      var effRoot = task.renamedRoot || task.root;
      var cand = {};
      for (i = 0; i < items.length; i++) {
        it = items[i];
        if (it.status !== "done") continue;
        if (it.action !== "move" && it.action !== "trash" && it.action !== "delete") continue;
        var sdir = it.file.dir;
        if (sdir && sdir !== task.root && sdir.indexOf(task.root + "/") === 0) cand[sdir] = 1;
      }
      var scanned = task._dirs || {};
      for (var sk in scanned) {
        if (scanned[sk] && scanned[sk].length === 0 && sk !== task.root && sk.indexOf(task.root + "/") === 0) cand[sk] = 1;
      }
      // 深目录在前：子目录先判定/先删除，父目录若只剩空子目录也能一并检出
      var candList = Object.keys(cand).sort(function (a, b) { return b.length - a.length; });
      var emptySet = {};
      for (i = 0; i < candList.length; i++) {
        var mapped = effRoot + candList[i].slice(task.root.length);
        try {
          var es = await ol.listAll(mapped);
          var allEmpty = true;
          for (var ei = 0; ei < es.length; ei++) {
            if (!es[ei].is_dir || !emptySet[mapped + "/" + es[ei].name]) { allEmpty = false; break; }
          }
          if (allEmpty) { emptySet[mapped] = 1; task.emptyDirs.push(mapped); }
        } catch (e) { /* 目录已不存在等，忽略 */ }
      }
    } catch (e) { /* 检测失败不影响任务结果 */ }
    return task;
  }

  function countNonTemp(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (!list[i].temp) n++;
    return n;
  }

  function applyRenameOk(task, st, dir, r) {
    task.ops.push({ t: "rename", dir: dir, from: r.src, to: r.dst });
    var stt = st[r.id];
    if (stt) stt.curName = r.dst;
    taskLog(task, "改名 " + r.src + " → " + r.dst);
  }

  async function renameOne(task, st, dir, r) {
    try {
      await writeOp(function () { return ol.rename(pathJoin(dir, r.src), r.dst); }, "rename " + r.src);
      applyRenameOk(task, st, dir, r);
      return true;
    } catch (e) {
      if (e instanceof OlmAuthError || (e && e.cancelled)) { finish(task, e); throw e; }
      var stt = st[r.id];
      if (stt) {
        stt.failed = true;
        stt.item.status = "failed";
        stt.item.reason = "重命名失败: " + ((e && e.message) || e);
      }
      taskLog(task, "改名失败 " + r.src + ": " + ((e && e.message) || e));
      return false;
    }
  }

  function applyMoveOk(task, ms, srcDir, dstDir) {
    task.ops.push({ t: "move", src: srcDir, dst: dstDir, name: ms.curName });
    ms.curDir = dstDir;
    if (!ms.needFinalRename) {
      ms.done = true;
      ms.item.status = "done";
    } else {
      ms.done = true; // 位置到了，名字待收尾
    }
    taskLog(task, "移动 " + ms.curName + " → " + dstDir);
  }

  function finish(task, err) {
    task.finishedAt = olmNowIso();
    var st2 = olmComputeStats(task.items);
    task.stats = st2;
    if (err && err.cancelled) task.status = "partial";
    else if (err instanceof OlmAuthError) task.status = "failed";
    else if (st2.failed > 0 && st2.done > 0) task.status = "partial";
    else if (st2.failed > 0 && st2.done === 0) task.status = "failed";
    else task.status = "done";
    if (err) taskLog(task, "中止: " + ((err && err.message) || err));
  }

  /*
   * 撤销：逆序回放操作日志
   * rec: {ops: [...]}（任务对象或历史记录均可）
   */
  async function undo(rec) {
    opSeq = 0;
    var ops = (rec.ops || []).slice().reverse();
    var done = 0, failed = 0, skippedDeletes = 0, errors = [];
    for (var i = 0; i < ops.length; i++) {
      if (isCancelled()) break;
      var op = ops[i];
      try {
        if (op.t === "move") {
          await writeOp(function () { return ol.move(op.dst, op.src, [op.name]); }, "undo move");
          done++;
        } else if (op.t === "rename") {
          await writeOp(function () { return ol.rename(pathJoin(op.dir, op.to), op.from); }, "undo rename");
          done++;
        } else if (op.t === "rmdir") {
          await writeOp(function () { return ol.mkdir(op.path); }, "undo rmdir");
          done++;   // 删除的空目录重建回来，后续文件移回才有落点
        } else if (op.t === "remove") {
          skippedDeletes++;   // 删除不可恢复，跳过
        }
        // mkdir 不回滚（留空目录无害，可用清理空目录功能处理）
      } catch (e) {
        if (e instanceof OlmAuthError) throw e;
        failed++;
        errors.push((op.t === "move" ? "移回 " + op.name : op.t === "rmdir" ? "重建 " + op.path : "改回 " + op.to) + " 失败: " + ((e && e.message) || e));
      }
      onProgress({ phase: "undo", done: i + 1, total: ops.length });
    }
    rec.status = failed ? "undo_partial" : "undone";
    rec.undoneAt = olmNowIso();
    return { done: done, failed: failed, errors: errors, skippedDeletes: skippedDeletes };
  }

  return { execute: execute, undo: undo };
}
