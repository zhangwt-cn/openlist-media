/* ==== Emby 命名器 ==== */

function olmCleanTitle(s) {
  return sanitizeFileName(cleanupName(String(s == null ? "" : s).replace(/[《》]/g, "")));
}

// 组的展示名（TMDB 优先）
function olmGroupDisplay(group) {
  var t = (group.tmdb && group.tmdb.title) || group.title || "未识别";
  var y = (group.tmdb && group.tmdb.year) || group.year;
  return t + (y ? " (" + y + ")" : "");
}

/*
 * 计算一个视频文件的目标（不含根目录、不含扩展名）
 * 返回 { folderRel: "剧名 (2020) [tmdbid=x]/Season 01", fileBase: "剧名 - S01E01 - 集标题" } 或 null
 */
function olmBuildMediaName(group, parsed, naming) {
  var tmdb = group.tmdb || null;
  var title = olmCleanTitle((tmdb && tmdb.title) || parsed.title || group.title);
  if (!title || title === "_") return null;
  var idTag = "";
  if (naming.includeTmdbId && tmdb && tmdb.id != null) {
    idTag = String(naming.tmdbTag || "[tmdbid={id}]").replace("{id}", tmdb.id);
  }

  if (group.type === "movie") {
    var my = (tmdb && tmdb.year) || parsed.year || group.year;
    var folder = cleanupName(title + (my ? " (" + my + ")" : "") + (idTag ? " " + idTag : ""));
    var base = title + (my ? " (" + my + ")" : "");
    if (naming.includeVersion && parsed.version) base += " - " + sanitizeFileName(parsed.version);
    if (parsed.part != null) base += " - part" + parsed.part;
    if (naming.includeResolution && parsed.resolution) base += " - " + parsed.resolution;
    return { folderRel: sanitizeFileName(folder), fileBase: cleanupName(base) };
  }

  if (group.type === "tv") {
    var season = parsed.season == null ? 1 : parsed.season;
    var ty = (tmdb && tmdb.year) || group.year || parsed.year;
    var showFolder = sanitizeFileName(cleanupName(title + (ty ? " (" + ty + ")" : "") + (idTag ? " " + idTag : "")));
    var seasonDir = sanitizeFileName(
      String(naming.seasonFolder || "Season {season2}")
        .replace("{season2}", pad2(season))
        .replace("{season}", String(season))
    );
    if (parsed.episode == null) return null;
    var epSeg = "S" + pad2(season) + "E" + pad2(parsed.episode);
    if (parsed.episodeEnd != null && parsed.episodeEnd > parsed.episode) {
      epSeg += "-E" + pad2(parsed.episodeEnd);
    }
    var epTitle = "";
    if (naming.includeEpTitle && tmdb && tmdb.seasons &&
      tmdb.seasons[season] && tmdb.seasons[season][parsed.episode]) {
      epTitle = sanitizeFileName(String(tmdb.seasons[season][parsed.episode]).slice(0, 60));
    }
    var epBase = title + " - " + epSeg + (epTitle ? " - " + epTitle : "");
    return {
      folderRel: showFolder + "/" + seasonDir,
      fileBase: cleanupName(epBase)
    };
  }

  return null;
}
