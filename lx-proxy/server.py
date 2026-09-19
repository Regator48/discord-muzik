import http.server
import json
import os
import urllib.request
import urllib.parse
import urllib.error
import ssl
import re
import threading
import time
from functools import partial

PORT = 4568

# API endpoints
XINGHAI_MAIN_API = "https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light"
SUYIN_QQ_API = "https://oiapi.net/api/QQ_Music"
SUYIN_QQ_KEY = os.environ.get("OIAPI_KEY", "")
SUYIN_163_API = "https://oiapi.net/api/Music_163"
SUYIN_KUWO_API = "https://oiapi.net/api/Kuwo"
SUYIN_MIGU_API = "https://api.xcvts.cn/api/music/migu"

CHANGQING_TEMPLATES = {
    "tx": "http://175.27.166.236/kgqq/qq.php?type=mp3&id={id}&level={level}",
    "wy": "http://175.27.166.236/wy/wy.php?type=mp3&id={id}&level={level}",
    "kw": "https://musicapi.haitangw.net/music/kw.php?type=mp3&id={id}&level={level}",
    "kg": "https://music.haitangw.cc/kgqq/kg.php?type=mp3&id={id}&level={level}",
    "mg": "https://music.haitangw.cc/musicapi/mg.php?type=mp3&id={id}&level={level}",
}

NIANXIN_TEMPLATES = {
    "tx": "https://music.nxinxz.com/kgqq/tx.php?id={id}&level={level}&type=mp3",
    "wy": "http://music.nxinxz.com/wy.php?id={id}&level={level}&type=mp3",
    "kw": "http://music.nxinxz.com/kw.php?id={id}&level={level}&type=mp3",
    "kg": "https://music.nxinxz.com/kgqq/kg.php?id={id}&level={level}&type=mp3",
    "mg": "http://music.nxinxz.com/mg.php?id={id}&level={level}&type=mp3",
}

PLATFORM_QUALITIES = {
    "wy": ["24bit", "flac", "320k", "192k", "128k"],
    "tx": ["24bit", "flac", "320k", "192k", "128k"],
    "kw": ["24bit", "flac", "320k", "192k", "128k"],
    "kg": ["24bit", "flac", "320k", "192k", "128k"],
    "mg": ["24bit", "flac", "320k", "192k", "128k"],
}

PLATFORM_TO_XINGHAI = {"wy": "netease", "tx": "tencent", "kw": "kuwo", "kg": "kugou", "mg": "migu"}
QUALITY_TO_BR = {"128k": "128", "192k": "192", "320k": "320", "flac": "740", "flac24bit": "999", "24bit": "999"}
QUALITY_TO_KUWO_BR = {"flac": 1, "320k": 5, "128k": 7, "24bit": 1}
QUALITY_PRIORITY = ["flac24bit", "flac", "320k", "192k", "128k"]

url_cache = {}
CACHE_TTL = 21600
CACHE_TTL_KW = 300

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE


def http_get(url, timeout=8):
    try:
        # Encode non-ASCII characters in URL
        encoded = urllib.parse.quote(url, safe=":/?=&%#")
        req = urllib.request.Request(encoded, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
            data = resp.read().decode("utf-8", errors="replace")
            try:
                return json.loads(data.strip())
            except Exception:
                return data
    except Exception as e:
        raise e


AUDIO_CT_RE = re.compile(r"audio/|octet-stream|application/ogg|video/mp4", re.IGNORECASE)


def is_audio_stream(url, timeout=8):
    """Quickly verify a URL serves audio, following redirects."""
    urls = [url]
    try:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme == "http":
            urls.append(parsed._replace(scheme="https").geturl())
    except Exception:
        pass
    for candidate in urls:
        try:
            encoded = urllib.parse.quote(candidate, safe=":/?=&%#")
            req = urllib.request.Request(encoded, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=timeout, context=ssl_ctx) as resp:
                ct = resp.headers.get("Content-Type", "")
                if AUDIO_CT_RE.search(ct):
                    return True
        except Exception:
            continue
    return False


def normalize_keyword(k):
    if not k:
        return ""
    k = re.sub(r"\(\s*Live\s*\)", "", k, flags=re.I)
    k = re.sub(r"[（(][^)）]*[)）]", "", k)
    k = re.sub(r"\s+", "", k)
    k = re.sub(r"[^\w\u4e00-\u9fa5]", "", k)
    return k.strip().lower()


def title_match(a, b):
    na, nb = normalize_keyword(a), normalize_keyword(b)
    if not na or not nb:
        return True
    return na in nb or nb in na


def select_quality(requested, supported):
    r = (requested or "128k").lower()
    if r in supported:
        return r
    for q in QUALITY_PRIORITY:
        if q in supported:
            return q
    return supported[0] if supported else "128k"


def quality_to_netease(q):
    q = (q or "128k").lower()
    if q in ("flac", "flac24bit", "hires", "master", "atmos"):
        return "lossless"
    if q in ("320k", "192k"):
        return "exhigh"
    return "standard"


def get_cache(prefix, name, singer, quality):
    key = f"{prefix}_{name}_{singer}_{quality}"
    entry = url_cache.get(key)
    ttl = CACHE_TTL_KW if prefix == "kw" else CACHE_TTL
    if entry and time.time() - entry[1] < ttl:
        return entry[0]
    return None


def set_cache(prefix, name, singer, quality, url):
    key = f"{prefix}_{name}_{singer}_{quality}"
    url_cache[key] = (url, time.time())


# --- Source handlers ---

def xinghai_main_get_url(platform, song_id, quality):
    source = PLATFORM_TO_XINGHAI.get(platform)
    if not source:
        raise Exception("星海主不支持该平台")
    q = select_quality(quality, ["128k", "192k", "320k", "flac", "flac24bit"])
    br = QUALITY_TO_BR.get(q, "128")
    url = f"{XINGHAI_MAIN_API}&types=url&source={urllib.parse.quote(source)}&id={urllib.parse.quote(song_id)}&br={br}"
    res = http_get(url)
    if isinstance(res, dict) and res.get("url"):
        return res["url"]
    raise Exception("星海主无URL")


def suyin_qq_get_url(song_info, quality):
    mid = song_info.get("songmid") or song_info.get("id")
    if not mid:
        raise Exception("溯音QQ缺少songmid")
    br_map = {"128k": 7, "320k": 5, "flac": 4, "24bit": 1}
    br = br_map.get(quality, 7)
    url = f"{SUYIN_QQ_API}?key={SUYIN_QQ_KEY}&type=json&br={br}&n=1&mid={urllib.parse.quote(str(mid))}"
    res = http_get(url)
    if isinstance(res, dict):
        if res.get("music"):
            return res["music"]
        if res.get("url"):
            return res["url"]
        if res.get("message"):
            m = re.search(r"音频链接[：:](.+?)(?:\n|$)", str(res["message"]))
            if m:
                return m.group(1).strip()
    raise Exception("溯音QQ无URL")


def suyin_163_get_url(song_info):
    sid = song_info.get("songmid") or song_info.get("id")
    if not sid:
        raise Exception("溯音163缺少id")
    res = http_get(f"{SUYIN_163_API}?id={urllib.parse.quote(str(sid))}")
    if isinstance(res, dict) and res.get("code") == 0 and res.get("data"):
        item = res["data"][0] if isinstance(res["data"], list) else res["data"]
        if isinstance(item, dict) and item.get("url"):
            return item["url"]
    raise Exception("溯音163无URL")


def parse_kuwo_message(msg):
    """Parse KuWo oiapi message into (title, singer, url)."""
    title_m = re.search(r"歌名[：:](.+?)(?:\n|$)", msg)
    singer_m = re.search(r"歌手[：:](.+?)(?:\n|$)", msg)
    url_m = re.search(r"音乐链接[：:](\S+)", msg)
    return (
        title_m.group(1).strip() if title_m else "",
        singer_m.group(1).strip() if singer_m else "",
        url_m.group(1).strip().replace("$", "=") if url_m else "",
    )


def kuwo_search_terms(name, singer, album=""):
    """Build search keyword variants (title first, then title+singer)."""
    terms = []
    if not name:
        return terms
    plain_name = normalize_keyword(name)
    terms.append(name)
    if singer:
        terms.append(normalize_keyword(f"{name}{singer}"))
        terms.append(normalize_keyword(f"{name} {singer}"))
    if album:
        terms.append(normalize_keyword(f"{name}{album}"))
    seen = set()
    out = []
    for t in terms:
        k = normalize_keyword(t)
        if k and k not in seen:
            seen.add(k)
            out.append(t)
    return out


def singer_match(a, b):
    na, nb = normalize_keyword(a), normalize_keyword(b)
    if not na or not nb:
        return False
    return na in nb or nb in na


def kuwo_version_ok(title, result_singer, requested_name, requested_singer=""):
    """Reject live/cover/instrumental versions; keep exact originals by the right artist."""
    if not title or not requested_name:
        return False
    normalized = normalize_keyword(title)
    requested = normalize_keyword(requested_name)
    if not normalized or not requested:
        return False
    if BAD_KEYWORDS.search(title):
        return False
    # Title must match the requested song name.
    if requested in normalized or normalized in requested:
        title_ok = True
    else:
        title_ok = False
    if not title_ok:
        return False
    # When an artist is known, the matched track must be by that artist too.
    # This prevents e.g. "Can't Stop" resolving CNBLUE while the UI says RHCP.
    if requested_singer:
        return singer_match(result_singer, requested_singer)
    return True


def kuwo_haitangw_stream(rid, quality):
    """Resolve a KuWo rid to a fresh CDN stream via musicapi.haitangw.net kw.php,
    which 302-redirects to a newly signed kuwo CDN URL on every call.
    oiapi's embedded signed URLs are often stale (HTTP 410); this is not."""
    rid = str(rid or "").strip().replace("MUSIC_", "")
    if not rid:
        raise Exception("缺少rid")
    level = quality_to_netease(quality)
    levels = [level] + [l for l in ("exhigh", "standard", "lossless") if l != level]
    for lv in levels:
        url = f"https://musicapi.haitangw.net/music/kw.php?type=mp3&id={urllib.parse.quote(rid)}&level={lv}"
        if is_audio_stream(url):
            return url
    raise Exception("海棠酷我无URL")


def suyin_kuwo_get_url(song_info, quality):
    name = song_info.get("name", "")
    singer = song_info.get("singer", "")
    album = song_info.get("album") or song_info.get("albumName") or ""
    if not name:
        raise Exception("溯音酷我需要歌名")
    cached = get_cache("kw", name, singer, quality)
    if cached:
        return cached
    q = select_quality(quality, ["flac", "320k", "128k"])
    br = QUALITY_TO_KUWO_BR.get(q, 1)
    errors = []
    terms = kuwo_search_terms(name, singer, album)
    for term in terms:
        try:
            res = http_get(f"{SUYIN_KUWO_API}?msg={urllib.parse.quote(term)}&n=1&br={br}")
            if isinstance(res, dict) and res.get("code") == 1 and res.get("message"):
                title, res_singer, url = parse_kuwo_message(str(res["message"]))
                data = res.get("data")
                rid = str(data.get("rid", "") or "") if isinstance(data, dict) else ""
                if url or rid:
                    if not kuwo_version_ok(title, res_singer, requested_name=name, requested_singer=singer):
                        errors.append(f"版本不匹配: {title} — {res_singer}")
                        continue
                    # Prefer a freshly-signed stream via haitangw; oiapi's own
                    # embedded URLs are frequently cached and stale (HTTP 410).
                    if rid:
                        try:
                            stream = kuwo_haitangw_stream(rid, q)
                            set_cache("kw", name, singer, quality, stream)
                            return stream
                        except Exception as e:
                            errors.append(f"海棠: {e}")
                    if url and is_audio_stream(url):
                        set_cache("kw", name, singer, quality, url)
                        return url
                    errors.append(f"URL失效: {title}")
                    continue
            errors.append("无URL")
        except Exception as e:
            errors.append(str(e))
    raise Exception(f"溯音酷我无URL: {'; '.join(errors)}")


def suyin_migu_get_url(song_info):
    name = song_info.get("name", "")
    singer = song_info.get("singer", "")
    if not name:
        raise Exception("溯音咪咕需要歌名")
    cached = get_cache("mg", name, singer, "")
    if cached:
        return cached
    search_term = f"{name} {singer}" if singer else name
    res = http_get(f"{SUYIN_MIGU_API}?gm={urllib.parse.quote(search_term)}&n=1&num=1&type=json")
    if isinstance(res, dict) and res.get("code") == 200 and res.get("musicInfo"):
        url = res["musicInfo"]
        set_cache("mg", name, singer, "", url)
        return url
    raise Exception("溯音咪咕无URL")


def changqing_get_url(platform, song_info, quality):
    tpl = CHANGQING_TEMPLATES.get(platform)
    if not tpl:
        raise Exception("长青不支持该平台")
    sid = song_info.get("hash") or song_info.get("songmid") or song_info.get("id")
    if not sid:
        raise Exception("长青缺少songId")
    level = quality_to_netease(quality)
    return tpl.replace("{id}", urllib.parse.quote(str(sid))).replace("{level}", level)


def nianxin_get_url(platform, song_info, quality):
    tpl = NIANXIN_TEMPLATES.get(platform)
    if not tpl:
        raise Exception("念心不支持该平台")
    sid = song_info.get("hash") or song_info.get("songmid") or song_info.get("id")
    if not sid:
        raise Exception("念心缺少songId")
    level = quality_to_netease(quality)
    return tpl.replace("{id}", urllib.parse.quote(str(sid))).replace("{level}", level)


def get_url_with_fallback(platform, song_info, quality):
    if platform not in PLATFORM_QUALITIES:
        raise Exception("无效平台")
    q = select_quality(quality or "320k", PLATFORM_QUALITIES[platform])
    song_id = str(song_info.get("hash") or song_info.get("songmid") or song_info.get("id") or "").replace("MUSIC_", "")
    name = song_info.get("name", "")
    singer = song_info.get("singer", "")

    errors = []

    # Try platform-specific handlers in the order: wy -> qq(tx) -> kg -> kw
    platform_priority = ["wy", "tx", "kg", "kw"]

    def resolved_url(platform_key, song_info_src):
        if platform_key == "wy":
            try:
                return suyin_163_get_url(song_info_src)
            except Exception:
                sid = str(song_info_src.get("id") or "")
                if sid.isdigit():
                    # gdstudio natively resolves netease ids (non-VIP tracks)
                    return xinghai_main_get_url("wy", sid, q)
                raise
        if platform_key == "tx":
            return suyin_qq_get_url(song_info_src, q)
        if platform_key == "kg":
            return xinghai_main_get_url("kg", song_info_src.get("id"), q)
        if platform_key == "kw":
            return suyin_kuwo_get_url(song_info_src, q)
        raise Exception("不支持的平台")

    # Prefer the platform the search result came from if it's in the priority list
    ordered = platform_priority if platform not in platform_priority else [platform] + [p for p in platform_priority if p != platform]

    for plat in ordered:
        # For cross-platform fallback, pass name+singer so kw/wy/mg can search by name
        song_info_src = dict(song_info)
        if plat != platform and not plat == "kw":
            # only name-based resolution possible for wy/qq/kg from other platforms; use the id if numeric
            song_info_src = {"id": song_id, "hash": song_id, "songmid": song_id, "name": name, "singer": singer}
        try:
            url = resolved_url(plat, song_info_src)
            if url and isinstance(url, str) and url.startswith("http"):
                if is_audio_stream(url):
                    return url
                errors.append(f"{plat}: 非音频流")
            else:
                errors.append(f"{plat}: 空URL")
        except Exception as e:
            errors.append(f"{plat}: {e}")

    raise Exception(f"所有源均失败: {'; '.join(errors)}")


# --- Search ---

def suyin_kuwo_search(keyword):
    try:
        res = http_get(f"{SUYIN_KUWO_API}?msg={urllib.parse.quote(keyword)}&n=10")
        if isinstance(res, dict) and res.get("code") == 1 and res.get("data"):
            raw = res["data"]
            items = raw if isinstance(raw, list) else [raw]
            results = []
            for item in items:
                rid = str(item.get("rid", "") or "")
                rid = rid.replace("MUSIC_", "")
                if not rid:
                    continue
                name = item.get("name") or item.get("song") or "未知"
                if not is_original(name):
                    continue
                results.append({
                    "id": rid,
                    "name": name,
                    "singer": item.get("artist") or item.get("singer") or "未知",
                    "album": item.get("album") or "",
                    "duration": int(item.get("duration", 0) or 0) // 1000 if item.get("duration") else 0,
                    "platform": "酷我",
                })
            return results
        # Single result with message only (no data array)
        if isinstance(res, dict) and res.get("message"):
            m_name = re.search(r"歌名[：:](.+?)(?:\n|$)", str(res["message"]))
            m_singer = re.search(r"歌手[：:](.+?)(?:\n|$)", str(res["message"]))
            if m_name:
                data = res.get("data", {})
                rid = str(data.get("rid", "") or data.get("id", "") or "")
                rid = rid.replace("MUSIC_", "")
                if rid:
                    return [{
                        "id": rid,
                        "name": m_name.group(1).strip(),
                        "singer": m_singer.group(1).strip() if m_singer else "未知",
                        "album": data.get("album", "") if isinstance(data, dict) else "",
                        "duration": 0,
                        "platform": "kw",
                    }]
    except Exception:
        pass
    return []


def suyin_163_search(keyword):
    """Search NetEase via 汽水VIP search endpoint (free, no key needed)"""
    try:
        qishui_urls = [
            "https://api.vsaa.cn/api/music.qishui.vip",
            "http://api.vsaa.cn/api/music.qishui.vip",
        ]
        for base in qishui_urls:
            try:
                url = f"{base}?act=search&keywords={urllib.parse.quote(keyword)}&page=1&pagesize=10&type=music"
                res = http_get(url, timeout=10)
                if isinstance(res, dict):
                    lists = res.get("data", {}).get("lists", []) if isinstance(res.get("data"), dict) else []
                    if lists:
                        results = []
                        for item in lists:
                            results.append({
                                "id": str(item.get("id", "")),
                                "name": item.get("name") or "未知",
                                "singer": item.get("artists") or item.get("singer") or "未知",
                                "album": item.get("album") or "",
                                "duration": int(item.get("duration", 0) or 0) // 1000 if item.get("duration") else 0,
                                "platform": "qishui",
                            })
                        return results
            except Exception:
                continue
    except Exception:
        pass
    return []


BAD_KEYWORDS = re.compile(
    r"(live|现场|演唱会|巡回|巡演|音乐节|不插电|unplugged|livehouse|地表最强|concert)"
    r"|(翻唱|cover|翻奏|伴奏|翻唱版|翻唱版)"
    r"|(纯音乐|钢琴|吉他|小提琴|二胡|古筝|口琴|演奏|独奏|弹唱|乐器版|yanzou)"
    r"|(remix|remake|混音|mashup|串烧|medley|鬼畜|mix版|组曲)"
    r"|(\s\+\s)"
    r"|(铃声|彩铃|闹钟|手机铃)"
    r"|(dj|DJ|蹦迪|夜店|电音)"
    r"|(女声|男声|童声|深情版|伤感|治愈版|温柔版|说唱版|独白|纯享|女版|男版|女生版|男生版|御姐|氛围|BGM版|微醺|R&B版)"
    r"|(抖音|热曲|热歌|推荐|新歌速递|网友自制|自制|节目|综艺)"
    r"|(\d\.\dx|0\.\dx|(?<=\s)\d\.\d\s?x|加速|减速|变速|变调)"
    r"|(Instrumental|kara|卡拉|KTV|清唱|a cappella|Acoustic)"
    r"|(beat|Beat|盘|style|衍生|3d环绕|环绕)"
    r"|(demos?|未发行|demo|幕后|花絮|练习|排练|霸榜|飙高音)",
    re.IGNORECASE,
)

# Traditional -> Simplified Chinese mapping (common chars)
TRAD_TO_SIMP_TABLE = {
    '倫': '伦', '傑': '杰', '華': '华', '國': '国', '東': '东', '車': '车',
    '蘭': '兰', '書': '书', '風': '风', '雲': '云', '魚': '鱼', '馬': '马',
    '鳥': '鸟', '龍': '龙', '島': '岛', '區': '区', '園': '园', '備': '备',
    '內': '内', '齡': '龄', '層': '层', '強': '强', '衛': '卫', '環': '环',
    '僅': '仅', '樂': '乐', '機': '机', '積': '积', '減': '减', '據': '据',
    '獨': '独', '廣': '广', '優': '优', '響': '响', '頁': '页', '頂': '顶',
    '預': '预', '養': '养', '護': '护', '組': '组', '設': '设', '請': '请',
    '負': '负', '輸': '输', '額': '额', '質': '质', '際': '际', '動': '动',
    '徑': '径', '為': '为', '從': '从', '維': '维', '網': '网', '義': '义',
    '與': '与', '幣': '币', '認': '认', '鮮': '鲜', '補': '补', '製': '制',
    '閱': '阅', '錄': '录', '錯': '错', '鍾': '钟', '鏈': '链', '鎮': '镇',
    '鑄': '铸', '鍛': '锻', '鑰': '钥', '閣': '阁', '陸': '陆', '隨': '随',
    '雞': '鸡', '飯': '饭', '飲': '饮', '館': '馆', '餅': '饼', '香': '香',
    '個': '个', '節': '节', '術': '术', '觀': '观', '門': '门', '鐵': '铁',
    '構': '构', '確': '确', '準': '准', '雜': '杂', '統': '统', '穩': '稳',
    '達': '达', '選': '选', '連': '连', '遲': '迟', '適': '适', '銀': '银',
    '幣': '币', '認': '认', '鮮': '鲜', '補': '补', '製': '制', '閱': '阅',
    '錄': '录', '錯': '错', '鍾': '钟', '鏈': '链', '鎮': '镇', '鑄': '铸',
    '鍛': '锻', '鑰': '钥', '閣': '阁', '陸': '陆', '隨': '随', '雞': '鸡',
    # Extra common chars that IME might produce
    '儒': '伦', '偊': '亿', '僑': '侨', '儀': '仪', '償': '偿',
    '優': '优', '傳': '传', '傷': '伤', '價': '价', '偉': '伟',
    '側': '侧', '偵': '侦', '備': '备', '傳': '传', '債': '债',
    '傾': '倾', '僅': '仅', '僱': '雇', '像': '像', '僧': '僧',
    '僖': '僖', '儆': '儆', '僵': '僵', '價': '价', '儀': '仪',
    '億': '亿', '僥': '侥', '儘': '尽', '償': '偿', '儡': '儡',
}
TRAD_TO_SIMP = str.maketrans(TRAD_TO_SIMP_TABLE)

def to_simplified(text):
    """Convert traditional Chinese to simplified"""
    return text.translate(TRAD_TO_SIMP)

def is_original(title):
    """Check if a track title looks like an original studio recording"""
    return not BAD_KEYWORDS.search(title)


def qq_music_search(keyword):
    """Search QQ Music — returns original versions first"""
    try:
        url = f"https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w={urllib.parse.quote(keyword)}&p=1&n=15&format=json"
        res = http_get(url, timeout=8)
        if isinstance(res, dict):
            songs = res.get("data", {}).get("song", {}).get("list", [])
            results = []
            for s in songs:
                artists = ", ".join([a.get("name", "") for a in s.get("singer", [])])
                mid = s.get("songmid", "") or str(s.get("songid", ""))
                results.append({
                    "id": mid,
                    "name": s.get("songname") or "未知",
                    "singer": artists or "未知",
                    "album": s.get("albumname") or "",
                    "duration": s.get("interval", 0),
                    "platform": "QQ",
                })
            return results
    except Exception:
        pass
    return []


def xinghai_search(keyword):
    """Search via Xinghai API (NetEase source) — returns many results"""
    try:
        url = f"https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name={urllib.parse.quote(keyword)}&br=320"
        res = http_get(url, timeout=8)
        if isinstance(res, list):
            results = []
            for s in res:
                artist = s.get("artist", [])
                if isinstance(artist, list):
                    artist = ", ".join(artist)
                results.append({
                    "id": str(s.get("id", "")),
                    "name": s.get("name") or "未知",
                    "singer": artist or "未知",
                    "album": s.get("album") or "",
                    "duration": s.get("duration", 0) // 1000 if s.get("duration") else 0,
                    "platform": "网易云",
                })
            return results
    except Exception:
        pass
    return []


def xinghai_netease_playlist(playlist_id):
    """Fetch a NetEase playlist's track list via gdstudio (types=playlist)."""
    url = f"{XINGHAI_MAIN_API}&types=playlist&id={urllib.parse.quote(str(playlist_id))}"
    res = http_get(url, timeout=15)
    playlist = res.get("playlist") if isinstance(res, dict) else None
    tracks = playlist.get("tracks") if isinstance(playlist, dict) else None
    if not tracks:
        raise Exception("无法获取网易云歌单")
    items = []
    for t in tracks:
        tid = t.get("id")
        if not tid:
            continue
        artists = [a.get("name", "") for a in t.get("ar", []) if isinstance(a, dict) and a.get("name")]
        items.append({
            "id": str(tid),
            "name": t.get("name") or "未知",
            "singer": "/".join(artists) or "未知",
            "album": (t.get("al") or {}).get("name") or "",
            "duration": int(t.get("dt") or 0) // 1000,
        })
    return {
        "name": playlist.get("name") or "",
        "count": playlist.get("trackCount") or len(items),
        "items": items,
    }


def search_all(keyword):
    # Convert traditional to simplified
    keyword = to_simplified(keyword)

    # Search QQ Music + KuWo + NetEase in parallel
    qq_results = []
    kuwo_results = []
    netease_results = []

    def search_qq():
        nonlocal qq_results
        qq_results = qq_music_search(keyword)

    def search_kuwo():
        nonlocal kuwo_results
        kuwo_results = suyin_kuwo_search(keyword)

    def search_netease():
        nonlocal netease_results
        netease_results = xinghai_search(keyword)

    t1 = threading.Thread(target=search_qq)
    t2 = threading.Thread(target=search_kuwo)
    t3 = threading.Thread(target=search_netease)
    t1.start()
    t2.start()
    t3.start()
    t1.join(timeout=8)
    t2.join(timeout=8)
    t3.join(timeout=8)

    # Merge all results
    all_results = qq_results + netease_results + kuwo_results

    # Deduplicate by normalized song name only, preferring the top-ranked
    # (usually the platform's original/album version) and rejecting covers.
    seen = set()
    seen_names = set()
    originals = []
    covers = []
    for track in all_results:
        name = track.get("name", "")
        nkey = normalize_keyword(name)
        akey = normalize_keyword(track.get("singer") or "")
        if not nkey:
            continue
        is_latin = not re.search(r"[\u4e00-\u9fa5]", nkey)
        if is_latin:
            key = f"{nkey}|{akey}"
        else:
            key = nkey
        # span rule: reject fan uploads / mashups whose name is a strict superset
        # of an already-accepted original name (e.g. "我怀念的 孙燕姿").
        is_span = False
        for seen_key in seen_names:
            if seen_key and nkey != seen_key and seen_key in nkey:
                is_span = True
                break
        if is_span:
            covers.append(track)
            continue
        if key in seen:
            continue
        seen.add(key)
        seen_names.add(nkey)
        if is_original(name):
            originals.append(track)
        else:
            covers.append(track)

    # Return originals only by default; fall back to covers only if nothing original matched.
    results = originals if originals else covers
    return results[:15]


# --- HTTP Handler ---

class LXHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        # Handle raw UTF-8 in path by encoding it
        try:
            path = self.path.encode("ascii").decode("ascii")
        except UnicodeEncodeError:
            path = urllib.parse.quote(self.path, safe=":/?=&%#")
        parsed = urllib.parse.urlparse(path)
        params = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/health":
            return self._json({"status": "ok", "uptime": time.time()})

        if parsed.path == "/search":
            q = params.get("q", [""])[0]
            if not q:
                return self._json({"error": "missing q"}, 400)
            tracks = search_all(q)
            return self._json({"tracks": tracks})

        if parsed.path == "/wy/playlist":
            pid = params.get("id", [""])[0]
            if not pid:
                return self._json({"error": "missing id"}, 400)
            try:
                return self._json(xinghai_netease_playlist(pid))
            except Exception as e:
                return self._json({"error": str(e)}, 404)

        if parsed.path == "/url":
            source = params.get("source", ["kw"])[0]
            song_id = params.get("id", [""])[0]
            quality = params.get("quality", ["320k"])[0]
            name = params.get("name", [""])[0]
            singer = params.get("singer", [""])[0]

            if not song_id and not name:
                return self._json({"error": "missing id or name"}, 400)

            song_info = {"id": song_id, "hash": song_id, "songmid": song_id, "name": name, "singer": singer}

            try:
                url = get_url_with_fallback(source, song_info, quality)
                return self._json({"url": url, "source": source})
            except Exception as e:
                # get_url_with_fallback already tries every resolver internally
                # (wy -> tx -> kg -> kw); re-running it per platform just
                # multiplies latency into minute-long hangs.
                return self._json({"error": str(e)}, 404)

        self._json({"error": "not found"}, 404)


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), LXHandler)
    print(f"LX Proxy listening on port {PORT}")
    server.serve_forever()
