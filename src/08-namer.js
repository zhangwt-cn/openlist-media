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

// 解析目录名的影视身份：先剥掉 provider 标记（{tmdbid-1411} 这类花括号形式解析器不认识），再走完整解析
function olmParseDirName(dirName) {
  var s = String(dirName == null ? "" : dirName).replace(/[\[{【]\s*(tmdb|imdb|tvdb)[^\]}】]*[\]}】]/gi, " ");
  return parseNameCore(s);
}

/*
 * 身份比对：identity（{title, originalTitle, year}，来自目录名解析或 AI）指的是否就是该组影视。
 * 标题（中文名或原名）与组的 TMDB 中文名/原名/解析名一致，且年份不冲突。
 */
function olmIdentityMatchesGroup(identity, group) {
  if (!identity || !group || !identity.title) return false;
  var tmdb = group.tmdb || null;
  var gy = (tmdb && tmdb.year) || group.year || null;
  if (identity.year != null && gy != null && identity.year !== gy) return false;
  var keys = [titleKey(identity.title), identity.originalTitle ? titleKey(identity.originalTitle) : ""];
  var names = [tmdb && tmdb.title, tmdb && tmdb.originalTitle, group.title, group.originalTitle];
  for (var i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    var nk = titleKey(names[i]);
    if (nk && (nk === keys[0] || nk === keys[1])) return true;
  }
  return false;
}

/*
 * 判断目录名是否就是该组影视自己的文件夹。发布目录名的前后缀装饰
 * （如 "【古早经典剧集】疑犯追踪 (2011) {tmdbid-1411}【蓝光原盘 Remux】"）由解析器剥除。
 * 用于用户直接选中剧集/电影文件夹整理时，避免在其中再嵌套一层「剧名 (年份)」目录。
 */
function olmDirIsMediaFolder(dirName, group) {
  return olmIdentityMatchesGroup(olmParseDirName(dirName), group);
}

// 现有目录名是否等价于第 season 季的季目录（"Season 1"/"S01"/"第1季"；Specials ↔ season 0）
function olmSeasonDirEquivalent(name, season) {
  var s = String(name == null ? "" : name).trim();
  var m = s.match(/^s(?:eason)?[\s._-]*(\d{1,3})$/i);
  if (m) return parseInt(m[1], 10) === season;
  if (/^specials?$/i.test(s)) return season === 0;
  m = s.match(/^第\s*([0-9一二三四五六七八九十两]+)\s*季$/);
  if (m) return cnNumToInt(m[1]) === season;
  return false;
}

// 组的规范文件夹名："剧名 (年份) [tmdbid=x]"（与 olmBuildMediaName 的目录层一致，用于根目录改名建议）
function olmMediaFolderName(group, naming) {
  var tmdb = group.tmdb || null;
  var title = olmCleanTitle((tmdb && tmdb.title) || group.title);
  if (!title || title === "_") return null;
  var idTag = "";
  if (naming.includeTmdbId && tmdb && tmdb.id != null) {
    idTag = String(naming.tmdbTag || "[tmdbid={id}]").replace("{id}", tmdb.id);
  }
  var y = (tmdb && tmdb.year) || group.year;
  return sanitizeFileName(cleanupName(title + (y ? " (" + y + ")" : "") + (idTag ? " " + idTag : "")));
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
