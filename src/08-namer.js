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
 * 判断目录名是否就是该组影视自己的文件夹（如 "百花杀（2026）"、"凡人修仙传 (2020) [tmdbid=x]"）：
 * 去掉 provider 标记与结尾年份后，剩余部分须与组的中文名/原名一致，且年份不冲突。
 * 用于用户直接选中剧集/电影文件夹整理时，避免在其中再嵌套一层「剧名 (年份)」目录。
 */
function olmDirIsMediaFolder(dirName, group) {
  var s = String(dirName == null ? "" : dirName).trim();
  if (!s || !group) return false;
  s = s.replace(/[\[{【]\s*(tmdb|imdb|tvdb)[^\]}】]*[\]}】]/gi, " ");
  var year = null;
  var m = s.match(/^(.*?)[\s.\-_]*[（(\[]?((19|20)\d{2})[）)\]]?[\s.\-_]*$/);
  if (m && m[1]) { year = parseInt(m[2], 10); s = m[1]; }
  var key = titleKey(s);
  if (!key) return false;
  var tmdb = group.tmdb || null;
  var gy = (tmdb && tmdb.year) || group.year || null;
  if (year != null && gy != null && year !== gy) return false;
  var names = [tmdb && tmdb.title, tmdb && tmdb.originalTitle, group.title, group.originalTitle];
  for (var i = 0; i < names.length; i++) {
    if (names[i] && titleKey(names[i]) === key) return true;
  }
  return false;
}

/*
 * 计算一个视频文件的目标（不含根目录、不含扩展名）
 * 返回 { folderRel: "剧名 (2020) [tmdbid=x]/Season 01", innerRel: "Season 01"（电影为 ""），
 *        fileBase: "剧名 - S01E01 - 集标题" } 或 null
 * innerRel = 去掉「剧名 (年份)」层后的相对目录，供目标根本身就是影视文件夹时使用
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
    return { folderRel: sanitizeFileName(folder), innerRel: "", fileBase: cleanupName(base) };
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
      innerRel: seasonDir,
      fileBase: cleanupName(epBase)
    };
  }

  return null;
}
