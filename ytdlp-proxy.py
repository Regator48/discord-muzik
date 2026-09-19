#!/usr/bin/env python3
from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess
import json
import shutil
import sys
from urllib.parse import urlparse, parse_qs

YTDLP = shutil.which("yt-dlp") or "/usr/bin/yt-dlp"
FFMPEG = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"


def get_params(path):
    return {k: v[0] for k, v in parse_qs(urlparse(path).query).items()}


def send_json(handler, code, obj):
    body = json.dumps(obj).encode()
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def yt_entries(url, limit):
    result = subprocess.run(
        [YTDLP, "--no-warnings", "--flat-playlist", "--playlist-end", str(limit),
         "--print", "%(.{id,title,duration,webpage_url,channel,thumbnail,is_live})j", url],
        capture_output=True, text=True, timeout=60
    )
    items = []
    for line in result.stdout.strip().splitlines():
        try:
            j = json.loads(line)
        except Exception:
            continue
        if not j.get("title") or not j.get("webpage_url"):
            continue
        if j.get("is_live"):
            continue
        dur = j.get("duration")
        if not isinstance(dur, (int, float)) or dur <= 0:
            continue
        items.append({
            "title": j["title"],
            "author": j.get("channel") or "YouTube",
            "duration": int(dur) * 1000,
            "pageUrl": j["webpage_url"],
            "thumbnail": j.get("thumbnail"),
        })
    return items


def _norm_tokens(text):
    import re
    return set(re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]+", (text or "").lower()))


def spotify_entries(url, limit):
    import re
    import urllib.request as reqmod

    spotify_id = re.search(r"/(?:playlist|album|track)/([A-Za-z0-9]+)", url)
    if not spotify_id:
        return []
    item = spotify_id.group(0).lstrip("/")
    embed_url = "https://open.spotify.com/embed/" + item
    req = reqmod.Request(embed_url, headers={"User-Agent": "Mozilla/5.0"})
    html = reqmod.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
    pairs = re.findall(r'"title":"([^"]{1,80})","subtitle":"([^"]{1,80})"', html)
    items = []
    for title, artists in pairs:
        if not title.strip() or not artists.strip() or artists.strip() == "Spotify":
            continue
        items.append({
            "title": title,
            "artists": artists,
            "query": f"{title} - {artists}".strip(),
        })
        if len(items) >= limit:
            break
    return items


class YtdlpHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        params = get_params(self.path)

        if self.path.startswith("/resolve"):
            url = params.get("url")
            if not url:
                return send_json(self, 400, {"error": "missing url param"})
            try:
                if url.startswith("ytsearch"):
                    # Single yt-dlp call for search + stream URL
                    result = subprocess.run(
                        [YTDLP, "--no-warnings", "-f", "bestaudio", "-g",
                         "--match-filter", "!is_live & duration>30 & duration<3600",
                         "--print", "%(title)s", "--print", "%(duration)s",
                         "--print", "%(webpage_url)s", url],
                        capture_output=True, text=True, timeout=40
                    )
                    lines = result.stdout.strip().split("\n")
                    if len(lines) >= 4:
                        abr = 0
                        try:
                            ar = subprocess.run(
                                [YTDLP, "--no-warnings", "-f", "bestaudio", "--print", "%(abr)s",
                                 lines[2]],
                                capture_output=True, text=True, timeout=20
                            )
                            abr = float(ar.stdout.strip()) if ar.stdout.strip() else 0
                        except Exception:
                            pass
                        data = {
                            "title": lines[0],
                            "duration": int(lines[1]) * 1000 if lines[1].isdigit() else 0,
                            "url": lines[3],
                            "pageUrl": lines[2],
                            "abr": int(abr),
                        }
                        send_json(self, 200, data)
                    else:
                        send_json(self, 404, {"error": "could not resolve"})
                else:
                    # Direct URL - get stream URL + metadata
                    result = subprocess.run(
                        [YTDLP, "--no-warnings", "-f", "bestaudio", "-g",
                         "--print", "%(title)s", "--print", "%(duration)s",
                         "--print", "%(webpage_url)s", url],
                        capture_output=True, text=True, timeout=30
                    )
                    lines = result.stdout.strip().split("\n")
                    if len(lines) >= 4:
                        abr = 0
                        try:
                            ar = subprocess.run(
                                [YTDLP, "--no-warnings", "-f", "bestaudio", "--print", "%(abr)s",
                                 url],
                                capture_output=True, text=True, timeout=20
                            )
                            abr = float(ar.stdout.strip()) if ar.stdout.strip() else 0
                        except Exception:
                            pass
                        data = {
                            "title": lines[0],
                            "duration": int(lines[1]) * 1000 if lines[1].isdigit() else 0,
                            "url": lines[3],
                            "pageUrl": lines[2],
                            "abr": int(abr),
                        }
                        send_json(self, 200, data)
                    else:
                        send_json(self, 404, {"error": "could not resolve"})
            except Exception as e:
                send_json(self, 500, {"error": str(e)})

        elif self.path.startswith("/search"):
            q = params.get("q")
            if not q:
                return send_json(self, 400, {"error": "missing q param"})
            try:
                n = max(1, min(int(params.get("n", 5)), 10))
                target = "ytsearch%d:%s" % (n, q)
                items = yt_entries(target, n)
                if items:
                    send_json(self, 200, {"results": items})
                else:
                    send_json(self, 404, {"error": "no results"})
            except Exception as e:
                send_json(self, 500, {"error": str(e)})

        elif self.path.startswith("/playlist"):
            url = params.get("url")
            if not url:
                return send_json(self, 400, {"error": "missing url param"})
            try:
                limit = max(1, min(int(params.get("limit", 50)), 100))
                items = yt_entries(url, limit)
                if items:
                    send_json(self, 200, {"title": url, "items": items})
                else:
                    send_json(self, 404, {"error": "no items"})
            except Exception as e:
                send_json(self, 500, {"error": str(e)})

        elif self.path.startswith("/spotify"):
            url = params.get("url")
            if not url:
                return send_json(self, 400, {"error": "missing url param"})
            try:
                limit = max(1, min(int(params.get("limit", 20)), 100))
                items = spotify_entries(url, limit)
                if items:
                    send_json(self, 200, {"title": url, "items": items})
                else:
                    send_json(self, 404, {"error": "no items"})
            except Exception as e:
                send_json(self, 500, {"error": str(e)})

        elif self.path.startswith("/stream"):
            url = params.get("url")
            if not url:
                return send_json(self, 400, {"error": "missing url param"})

            # Support HEAD request (Lavalink probes with HEAD first)
            if self.command == "HEAD":
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                return

            # Support Range header (Lavalink may request partial content)
            range_header = self.headers.get("Range")

            # ALWAYS use yt-dlp to get stream URL - handles all URL types reliably
            dl = ff = None
            try:
                dl = subprocess.Popen(
                    [YTDLP, "--no-warnings", "-f", "bestaudio/b", "-o", "-",
                     "--no-playlist", url],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                ff = subprocess.Popen(
                    [FFMPEG, "-loglevel", "error", "-i", "-", "-f", "mp3",
                     "-ab", "128k", "-ac", "2", "-ar", "44100",
                     "-write_xing", "1", "-id3v2_version", "3", "-avoid_negative_ts", "make_zero", "-fflags", "+genpts", "-"],
                    stdin=dl.stdout, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                if dl:
                    dl.stdout.close()

                # Stream directly
                self.send_response(206 if range_header else 200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()

                while True:
                    chunk = ff.stdout.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
                ff.wait()
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:
                print(f"[/stream] error: {e}", file=sys.stderr)
            finally:
                for p in (dl, ff):
                    if p and p.poll() is None:
                        p.kill()

        else:
            send_json(self, 404, {"error": "unknown endpoint"})

    def do_HEAD(self):
        params = get_params(self.path)
        if self.path.startswith("/stream"):
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            return
        # For other endpoints, delegate to GET but don't send body
        self.do_GET()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 4567), YtdlpHandler)
    print("yt-dlp proxy on :4567", file=sys.stderr)
    server.serve_forever()