#!/usr/bin/env python3
"""
Reference yt-dlp stream resolver for the MusicPlayer app.

Implements the cobalt-compatible JSON dialect the app speaks
(src/services/player/resolver.ts, ``resolveViaCobalt``):

    POST /
      { "url": "https://www.youtube.com/watch?v=...",
        "audioFormat": "mp3",
        "audioQuality": "best" | 320 | 256 | 192 | 128 | 96 | 64,
        "downloadMode": "audio",
        "aFormat": "mp3",
        "isAudioOnly": true }
      Authorization: Apikey <token>            (only when --api-key is set)

    -> 200  { "status": "redirect", "url": "<direct stream>", "audioDuration": <s> }
       or   { "status": "tunnel",   "url": "<this server>/stream/<token>", "audioDuration": <s> }
       or   { "error": { "code": "...", "context": "..." } }

The point of this server is *full-length* YouTube audio. The app's built-in
extractor mints streams through an unauthenticated innertube client, which
YouTube now caps at a ~70-second preview (403 on reads past the head). yt-dlp
defeats that wall via its EJS component (poToken/botguard solving) and returns
URLs that serve the whole file.

Because YouTube's minted URLs are inconsistent (some extractions return a
capped preview even to yt-dlp), every extraction is VERIFIED with a deep ranged
read before it is handed to the player, and rejections retry with fallback
strategies. See README.md in this directory.

Tunnel vs redirect:
  * tunnel (default) is the reliable path for a phone. The googlevideo URL that
    yt-dlp mints is bound to THIS server's IP (the ``ip`` param is signed); a
    phone on a different network gets 403 fetching it directly. In tunnel mode
    the server relays the bytes, so any network works, and Range requests are
    forwarded so seeking still works.
  * redirect hands the minted URL straight to the player. Use it only when the
    phone and the server share an egress IP (e.g. testing from the same box).

Dependencies: Python 3.10+, yt-dlp (nightly) with the default extras (which
bundle yt-dlp-ejs), and a JS runtime for EJS (node>=22 or deno>=2.3):

    python -m pip install -U --pre "yt-dlp[default]"

Run:

    python ytdlp_resolver.py --port 8080
"""

from __future__ import annotations

import hmac
import http.client
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional, Tuple
from urllib.parse import urlparse

API_KEY_ENV = "YTDLP_RESOLVER_API_KEY"
BIN_ENV = "YTDLP_BIN"
JS_RUNTIME_ENV = "YTDLP_JS_RUNTIME"
COOKIES_ENV = "YTDLP_COOKIES"
PLAYER_CLIENT_ENV = "YTDLP_PLAYER_CLIENT"
PUBLIC_URL_ENV = "YTDLP_RESOLVER_PUBLIC_URL"

# How long a single yt-dlp extraction may take. Cold starts can be slow (EJS
# fetches its components once, then caches).
EXTRACT_TIMEOUT_S = 120
# How long a minted stream URL stays valid on this server.
STREAM_TTL_S = 45 * 60
# How many bytes deep a verification read must go before we trust a URL.
VERIFY_READ = 128 * 1024

# Quality -> yt-dlp -f selector. Prefer AAC in m4a (plays on Android AND iOS);
# fall back to any audio, then any file. Numeric qualities clamp to the closest
# available bitrate at-or-below the request (e.g. 128 picks itag 140 when there
# is one, otherwise the nearest fallback).
SELECTORS = {
    "best": "ba[ext=m4a]/ba/b",
    320: "ba[ext=m4a][abr<=320]/ba[abr<=320]/ba[ext=m4a]/ba/b",
    256: "ba[ext=m4a][abr<=256]/ba[abr<=256]/ba[ext=m4a]/ba/b",
    192: "ba[ext=m4a][abr<=192]/ba[abr<=192]/ba[ext=m4a]/ba/b",
    128: "ba[ext=m4a][abr<=128]/ba[abr<=128]/ba[ext=m4a]/ba/b",
    96: "ba[ext=m4a][abr<=96]/ba[abr<=96]/ba[ext=m4a]/ba/b",
    64: "ba[ext=m4a][abr<=64]/ba[abr<=64]/ba[ext=m4a]/ba/b",
}

# Fallback strategies tried when extraction fails or the minted URL turns out
# to be preview-capped. Going plain `ba` (opus/webm first) sidesteps m4a-only
# regressions; `default` is yt-dlp's own client preference.
FALLBACK_SELECTORS_AND_CLIENTS: list[Tuple[str, Optional[str]]] = [
    (SELECTORS[128], None),  # 128 kbps is the app default
    ("ba[acodec!=none]", None),
    ("ba[acodec!=none]", "default"),
]

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

# yt-dlp refuses YouTube extraction on most datacenter IPs (Render, Hugging
# Face, cheap VPSes) unless a signed-in cookies file is supplied. When
# YTDLP_COOKIES is unset we look where a deploy commonly drops one, so a Render
# Secret File named cookies.txt works without also setting an env var.
DEFAULT_COOKIE_FILES = (
    "/etc/secrets/cookies.txt",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt"),
)


def cookies_source() -> Optional[str]:
    """Configured or auto-detected cookies file (as mounted), or None."""
    explicit = os.environ.get(COOKIES_ENV)
    if explicit:
        return explicit
    for candidate in DEFAULT_COOKIE_FILES:
        if os.path.isfile(candidate):
            return candidate
    return None


# yt-dlp re-writes the cookie jar it was given (refreshed sessions, POT
# tokens), so a file on a read-only mount — Render Secret Files, Vault, some
# config volumes — fails with `OSError: Read-only file system` (Errno 30).
# Stage a private writable copy once per process and hand THAT to yt-dlp.
_STAGED_COOKIES_PATH = os.path.join(tempfile.gettempdir(), "ytdlp_resolver_cookies.txt")
_staged_cookies: Optional[str] = None


def _stage_cookies() -> Optional[str]:
    global _staged_cookies
    source = cookies_source()
    if not source:
        return None
    if _staged_cookies is not None:
        return _staged_cookies
    try:
        shutil.copyfile(source, _STAGED_COOKIES_PATH)
        os.chmod(_STAGED_COOKIES_PATH, 0o600)
    except OSError as exc:
        log(f"could not stage a writable copy of the cookies file ({exc}); using the original")
        # The original may still be readable; let yt-dlp report precisely if not.
        _staged_cookies = source
    else:
        _staged_cookies = _STAGED_COOKIES_PATH
        log(f"staged writable cookies copy at {_STAGED_COOKIES_PATH}")
    return _staged_cookies


def cookies_file() -> Optional[str]:
    """Writable cookies path for yt-dlp, or None when none is available."""
    return _stage_cookies()


def _log_secrets_dir() -> None:
    """Log what the platform mounted under /etc/secrets (Render Secret Files).

    Rendering the cookies file found by auto-detection silently depends on a
    Secret File being named exactly `cookies.txt`. Listing the directory at
    startup makes a misnamed, unsaved, or unreadable upload visible in the
    host's logs instead of an opaque `cookies off`.
    """
    secrets_dir = "/etc/secrets"
    if not os.path.isdir(secrets_dir):
        return
    try:
        names = sorted(os.listdir(secrets_dir))
    except OSError as exc:
        names = [f"<unreadable: {exc}>"]
    log(f"secret files in {secrets_dir}: {', '.join(names) if names else '(empty)'}")


def log(msg: str) -> None:
    print(f"[ytdlp-resolver] {msg}", flush=True)


def build_ytdlp_command(client: Optional[str]) -> list[str]:
    """yt-dlp command prefix: binary + runtime + client flags."""
    bin_env = os.environ.get(BIN_ENV)
    if bin_env:
        base = bin_env.split()
    elif shutil.which("yt-dlp"):
        base = ["yt-dlp"]
    else:
        base = [sys.executable, "-m", "yt_dlp"]

    # No --no-warnings: the warnings yt-dlp prints on failure (bot wall, missing
    # JS runtime, nsig problems) are exactly what makes a hosted instance
    # debuggable, and they only go to stderr, which we ignore on success.
    runtime = os.environ.get(JS_RUNTIME_ENV) or "node"
    cmd = [*base, "--no-playlist", "--js-runtimes", runtime]
    cookies = cookies_file()
    if cookies:
        cmd += ["--cookies", cookies]
    # An explicit client wins, then the per-strategy one, then the env default.
    client = client or os.environ.get(PLAYER_CLIENT_ENV) or None
    if client:
        cmd += ["--extractor-args", f"youtube:player_client={client}"]
    cmd += ["--user-agent", USER_AGENT]
    return cmd


def dependency_report() -> str:
    """One-line summary of the yt-dlp toolchain (startup log + /health)."""
    runtime = os.environ.get(JS_RUNTIME_ENV) or "node"
    runtime_path = shutil.which(runtime)
    runtime_desc = f"found at {runtime_path}" if runtime_path else "NOT FOUND"
    try:
        proc = subprocess.run(
            [*build_ytdlp_command(None), "--version"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        lines = (proc.stdout or proc.stderr or "unknown").strip().splitlines()
        version = lines[0].strip() if lines else "unknown"
    except (OSError, subprocess.SubprocessError):
        version = "not found"
    cookies = cookies_source()
    if cookies:
        # Prove the file is actually readable: Render mounts Secret Files
        # root-owned, so a permissions mistake would otherwise surface only as
        # an opaque yt-dlp failure at resolve time.
        try:
            with open(cookies, "rb") as handle:
                handle.read(1)
            cookies_desc = f"set ({cookies})"
        except OSError as exc:
            cookies_desc = f"set but UNREADABLE ({cookies}: {exc})"
    else:
        cookies_desc = "off"
    return (
        f"yt-dlp {version}; js runtime {runtime} ({runtime_desc}); "
        f"cookies {cookies_desc}"
    )


def extract_stream(
    source_url: str, selector: str, client: Optional[str]
) -> Tuple[str, Optional[float]]:
    """Run yt-dlp (simulate only, no download) and return (url, duration_s)."""
    cmd = [
        *build_ytdlp_command(client),
        "-f",
        selector,
        "--simulate",
        "--print",
        "%(url)s",
        "--print",
        "%(duration)s",
        source_url,
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=EXTRACT_TIMEOUT_S,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "yt-dlp is not installed on the resolver host. Install it with "
            '`python -m pip install -U --pre "yt-dlp[default]"` and ensure '
            "node>=22 or deno>=2.3 is available for EJS."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"yt-dlp took longer than {EXTRACT_TIMEOUT_S}s to resolve the stream."
        ) from exc

    if proc.returncode != 0:
        detail = [ln for ln in (proc.stderr or proc.stdout or "").splitlines() if ln.strip()]
        tail = detail[-1] if detail else f"yt-dlp exited with {proc.returncode}"
        # The final line alone often hides the cause (bot wall, preview cap,
        # missing JS runtime), so keep the last few lines in the server log.
        if len(detail) > 1:
            log("yt-dlp output:\n  " + "\n  ".join(detail[-6:]))
        raise RuntimeError(f"yt-dlp failed: {tail[:500]}")

    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    if not lines:
        raise RuntimeError("yt-dlp returned no stream URL.")
    url = lines[0].strip()
    if not url.startswith("http"):
        raise RuntimeError(f"yt-dlp returned an unusable stream: {url[:200]}")

    duration: Optional[float] = None
    if len(lines) > 1:
        raw = lines[1].strip()
        if raw not in ("", "NA", "None"):
            try:
                duration = float(raw)
            except ValueError:
                duration = None
    return url, duration


def stream_starts_serving_full(url: str) -> bool:
    """Verify the minted stream serves a read deep inside the file.

    Mirrors the app's own probe (src/services/player/youtube.ts,
    ``probeMediaServes``): a read at ~85% of the file's length either gets a
    2xx (the URL serves in full) or a 403 from YouTube's preview-cap (it only
    serves the first ~minute of audio). The read is deliberately small so the
    check is cheap. Files under a megabyte are preview-safe by definition.
    """
    clen_match = re.search(r"[?&]clen=(\d+)", url)
    if not clen_match:
        return True  # unknown size: let the player decide
    clen = int(clen_match.group(1))
    if clen <= 1_000_000:
        return True  # preview-safe by size, same as the app

    start = max(clen * 85 // 100, 1_000_000)
    end = min(clen - 1, start + VERIFY_READ - 1)
    if start > end:
        return True

    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Range": f"bytes={start}-{end}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status < 300
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError):
        return False


def verify_stream(url: str, duration: Optional[float]) -> Tuple[str, Optional[float]]:
    """Return the URL as-is when it serves in full; else raise RuntimeError."""
    if stream_starts_serving_full(url):
        return url, duration
    raise RuntimeError(
        "YouTube returned a preview-capped stream (it only serves the first "
        "~minute of audio). Retrying with a different client."
    )


BOT_WALL_MARKERS = (
    "too many requests",
    "forbidden",
    "sign in to confirm",
    "not a bot",
    "failed to extract any player response",
    "http error 429",
    "http error 403",
)


def _looks_like_bot_wall(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in BOT_WALL_MARKERS)


def resolve_with_fallback(
    source_url: str, requested_quality: object
) -> Tuple[str, Optional[float]]:
    """Resolve a playable full-length stream, verifying and retrying as needed.

    Strategy list: prefer the requested quality, then plain audio, then the
    plain audio with yt-dlp's default client explicitly. Each successful
    extraction is verified with a deep read before it is accepted.
    """
    strategies = [(SELECTORS[requested_quality], None)]
    for selector, client in FALLBACK_SELECTORS_AND_CLIENTS:
        if (selector, client) != strategies[0]:
            strategies.append((selector, client))

    last_error = "no strategy resolved a stream"
    for selector, client in strategies:
        try:
            url, duration = extract_stream(source_url, selector, client)
            return verify_stream(url, duration)
        except RuntimeError as exc:
            last_error = str(exc)
            log(f"strategy {selector!r} client={client} failed: {exc}")

    # A host whose IP YouTube refuses fails every strategy the same way. Say so
    # explicitly, because "Failed to extract any player response" reads like a
    # yt-dlp bug when it is really an authentication/IP problem.
    if cookies_file() is None and _looks_like_bot_wall(last_error):
        hint = (
            "YouTube refused this host's IP (HTTP 429/403). Give the server a "
            "signed-in cookies file: --cookies / YTDLP_COOKIES, or a Render "
            "Secret File named cookies.txt (auto-detected at /etc/secrets/)."
        )
        log("hint: " + hint)
        raise RuntimeError(f"{last_error} {hint}")
    raise RuntimeError(last_error)


class ResolverState:
    def __init__(
        self,
        mode: str,
        api_key: Optional[str],
        public_url: Optional[str],
        deps: str = "",
    ):
        self.mode = mode
        self.api_key = api_key
        self.public_url = public_url
        self.deps = deps
        self.lock = threading.Lock()
        # token -> (upstream url, expiry)
        self.streams: dict[str, Tuple[str, float]] = {}
        # (source url, quality) -> (resolved url, duration, verified_at) : 10 min
        self.results: dict[Tuple[str, object], Tuple[str, Optional[float], float]] = {}

    def register_stream(self, url: str) -> str:
        token = os.urandom(16).hex()
        with self.lock:
            self._sweep()
            self.streams[token] = (url, time.time() + STREAM_TTL_S)
        return token

    def take_stream(self, token: str) -> Optional[Tuple[str, float]]:
        with self.lock:
            self._sweep()
            entry = self.streams.get(token)
            if entry is None or entry[1] < time.time():
                self.streams.pop(token, None)
                return None
            return entry

    def _sweep(self) -> None:
        now = time.time()
        expired = [t for t, (_, exp) in self.streams.items() if exp < now]
        for t in expired:
            self.streams.pop(t, None)

    def cache_result(self, url: str, quality: object, result) -> None:
        with self.lock:
            self.results[(url, quality)] = (*result, time.time())

    def cached_result(self, url: str, quality: object):
        with self.lock:
            entry = self.results.get((url, quality))
            if entry and entry[2] > time.time() - 10 * 60:
                return entry[0], entry[1]
            return None


class ResolverHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ytdlp-resolver/1.0"

    state: ResolverState  # set on the server instance before serving

    # Body length promised to the client by _send_relay_headers; consumed by
    # _relay_body to detect a short transfer. Per-request (handlers are
    # instantiated fresh for every request).
    _relay_expected: Optional[int] = None

    # -- helpers -------------------------------------------------------------

    def _send_json(self, obj, status: int = 200) -> None:
        body = json.dumps(obj).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionError, TimeoutError):
            # The client hung up before the response landed (player seek,
            # pause, next track). There is nobody left to write to; drop the
            # connection instead of letting the exception escape as a traceback.
            self.close_connection = True
            log("client disconnected before the response was sent")

    def _authorized(self) -> bool:
        key = self.state.api_key
        if not key:
            return True
        header = self.headers.get("Authorization", "")
        scheme, _, provided = header.partition(" ")
        # Constant-time comparison so a wrong key can't be probed byte by byte
        # through response timing.
        return scheme.lower() == "apikey" and hmac.compare_digest(
            provided.strip().encode("utf-8"), key.encode("utf-8")
        )

    def _source_url(self, payload: dict) -> Optional[str]:
        url = payload.get("url")
        if not isinstance(url, str) or not url.strip():
            return None
        parsed = urlparse(url.strip())
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return None
        return url.strip()

    def _request_base_url(self) -> str:
        """This server's public origin as the client reached it.

        Behind a reverse proxy (Hugging Face Space, nginx, ...) the Host header
        alone would mint `http://` links for an `https://` endpoint, so
        forwarded headers win when present. --public-url (state.public_url)
        wins over both; callers check it first.
        """
        proto = self.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() or "http"
        host = (
            self.headers.get("X-Forwarded-Host", "").split(",")[0].strip()
            or self.headers.get("Host", "localhost")
        )
        return f"{proto}://{host}"

    def log_message(self, fmt, *args) -> None:  # quieter than stderr spam
        log("%s - %s" % (self.address_string(), fmt % args))

    # -- resolve -------------------------------------------------------------

    def do_POST(self) -> None:
        # Both error paths below answer WITHOUT reading the request body;
        # closing the connection stops a keep-alive client from having that
        # body misparsed as the next request, and keeps unauthenticated
        # callers from holding connections open for free.
        if self.path != "/":
            self.close_connection = True
            self._send_json(
                {"error": {"code": "NOT_FOUND", "context": f"Unknown path {self.path}"}},
                404,
            )
            return
        if not self._authorized():
            self.close_connection = True
            self._send_json(
                {"error": {"code": "UNAUTHORIZED", "context": "Invalid API token."}},
                401,
            )
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send_json(
                {"error": {"code": "BAD_REQUEST", "context": "Invalid JSON body."}}, 400
            )
            return

        source = self._source_url(payload)
        if not source:
            self._send_json(
                {"error": {"code": "BAD_REQUEST", "context": "`url` must be an http(s) URL."}},
                400,
            )
            return

        quality = payload.get("audioQuality", 128)
        if quality not in SELECTORS:
            self._send_json(
                {
                    "error": {
                        "code": "BAD_REQUEST",
                        "context": f"Unsupported audioQuality {quality!r}. "
                        f"Use {sorted(map(str, SELECTORS))}.",
                    }
                },
                400,
            )
            return

        cached = self.state.cached_result(source, quality)
        if cached:
            url, duration = cached
        else:
            try:
                url, duration = resolve_with_fallback(source, quality)
            except RuntimeError as exc:
                self._send_json(
                    {
                        "error": {
                            "code": "EXTRACTION_FAILED",
                            "context": (
                                f"{exc} If this keeps happening, YouTube may be "
                                "refusing full-length streams for this video even "
                                "through yt-dlp."
                            ),
                        }
                    }
                )
                return
            self.state.cache_result(source, quality, (url, duration))

        response = {"status": self.state.mode, "audioDuration": duration}
        if self.state.mode == "tunnel":
            token = self.state.register_stream(url)
            base = self.state.public_url or self._request_base_url()
            response["url"] = f"{base.rstrip('/')}/stream/{token}"
        else:
            response["url"] = url
        self._send_json(response)

    # -- tunnel proxy --------------------------------------------------------

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json({"ok": True, "deps": self.state.deps})
            return
        token = self.path.removeprefix("/stream/")
        if not token or "/" in token:
            self._send_json(
                {"error": {"code": "NOT_FOUND", "context": "Unknown path."}}, 404
            )
            return
        entry = self.state.take_stream(token)
        if entry is None:
            self._send_json(
                {"error": {"code": "NOT_FOUND", "context": "Stream not found or expired."}},
                404,
            )
            return
        upstream, _expiry = entry
        self._relay(upstream)

    do_HEAD = do_GET

    def _relay(self, upstream: str) -> None:
        """Forward this request to the minted stream URL, passing Range along.

        The body is streamed in chunks rather than buffered so playback can
        start before the whole file has crossed the wire.

        Failures are handled per phase because the remedy differs:

          * upstream never answered -> the response has not started yet, so the
            client gets a clean 502 it can retry;
          * upstream dies mid-body -> a status line can no longer be sent, so
            we close early; the client sees a short read and recovers with a
            Range request from where it stopped;
          * the client hangs up -> normal for a player (seek, pause, next
            track), so drop quietly. Reads and writes sit in separate try
            blocks so a ConnectionError is attributed to the right side:
            upstream for resp.read(), the player for wfile.write().
        """
        headers = {"User-Agent": USER_AGENT}
        for name in ("Range", "Accept"):
            value = self.headers.get(name)
            if value:
                headers[name] = value

        # Always ask upstream for an explicit range. A HEAD probe needs only a
        # byte; a client that sent no Range gets `bytes=0-`, because googlevideo
        # cuts plain unranged 200 responses after a few hundred KB while ranged
        # (206) responses reliably serve the whole file. The 206 is restated as
        # a normal 200 in _send_relay_headers.
        if self.command == "HEAD":
            headers.setdefault("Range", "bytes=0-1")
        else:
            headers.setdefault("Range", "bytes=0-")

        req = urllib.request.Request(upstream, headers=headers)
        try:
            upstream_resp = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as exc:
            log(f"relay upstream refused the request: HTTP {exc.code} {exc.reason}")
            self._send_json(
                {
                    "error": {
                        "code": "UPSTREAM_ERROR",
                        "context": f"Upstream stream answered {exc.code}.",
                    }
                },
                502,
            )
            return
        except (urllib.error.URLError, OSError) as exc:
            # TimeoutError is an OSError, so socket timeouts land here too.
            log(f"relay upstream unreachable: {exc}")
            self._send_json(
                {"error": {"code": "UPSTREAM_ERROR", "context": f"Upstream unreachable: {exc}."}},
                502,
            )
            return

        with upstream_resp as resp:
            if not self._send_relay_headers(resp):
                return  # client hung up while the status line was in flight
            if self.command != "GET":
                return
            self._relay_body(resp)

    def _send_relay_headers(self, resp) -> bool:
        """Send the relayed status line and headers; False if the client hung up.

        Also records the client-facing body length in ``self._relay_expected``
        so _relay_body can tell a complete transfer from a short one.
        """
        status = resp.status
        content_range = resp.headers.get("Content-Range")
        total: Optional[int] = None
        if content_range and "/" in content_range:
            tail = content_range.rsplit("/", 1)[1]
            if tail.isdigit():
                total = int(tail)

        # The client never sent a Range, so it expects a plain 200 of the whole
        # file; upstream 206 is the answer to the `bytes=0-` we asked for on the
        # client's behalf. Restate it as 200 and drop Content-Range (which only
        # belongs on a 206). If the total is unknown, keep the 206 rather than
        # misreport the length.
        convert = status == 206 and not self.headers.get("Range") and total is not None
        if convert:
            status = 200

        self._relay_expected = None
        try:
            self.send_response(status)
            # Relay every header as-is except Content-Length, which is
            # rebuilt below: a GET body is sized by its range, and a HEAD
            # (probed as bytes=0-1) must report the true total.
            for name in ("Content-Type", "Accept-Ranges", "Last-Modified"):
                value = resp.headers.get(name)
                if value:
                    self.send_header(name, value)
            if content_range and not convert:
                self.send_header("Content-Range", content_range)
            if self.command == "HEAD":
                length = str(total) if total is not None else resp.headers.get("Content-Length")
            elif convert:
                length = str(total)
            else:
                length = resp.headers.get("Content-Length")
            if length:
                self.send_header("Content-Length", length)
                try:
                    self._relay_expected = int(length)
                except ValueError:
                    self._relay_expected = None
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return True
        except (ConnectionError, TimeoutError):
            self.close_connection = True
            log("relay dropped: client closed the connection")
            return False

    def _relay_body(self, resp) -> None:
        """Stream the upstream body to the client, one side at a time.

        Read and write are wrapped separately so a failure is attributable:
        resp.read() only talks to upstream, wfile.write() only to the client.
        ``self._relay_expected`` is the body length promised to the client by
        _send_relay_headers (None if no length was promised).
        """
        expected = self._relay_expected
        written = 0
        while True:
            try:
                chunk = resp.read(64 * 1024)
            except (http.client.HTTPException, OSError) as exc:
                # The response already started, so 502 is no longer expressible.
                # Closing early yields a short read, which the player recovers
                # from by re-requesting with a Range from where it stopped.
                self.close_connection = True
                log(f"relay truncated: upstream failed mid-body ({exc}); sent {written} bytes")
                return
            if not chunk:
                break
            written += len(chunk)
            try:
                self.wfile.write(chunk)
                self.wfile.flush()
            except (ConnectionError, TimeoutError):
                # The player stopped reading (seek, pause, or a new track).
                # Nothing to relay to, so just drop the connection quietly.
                self.close_connection = True
                log("relay dropped: client closed the connection")
                return
        if expected is not None and written < expected:
            # http.client.read(n) returns b"" at EOF instead of raising, so a
            # premature upstream close only shows up as a short body. Promise
            # unfulfilled -> close, so the player sees the short read and
            # re-requests with a Range rather than waiting forever.
            self.close_connection = True
            log(f"relay truncated: upstream ended after {written}/{expected} bytes")
        elif expected is None and self.command == "GET":
            # No length was promised, so the body is framed only by closing the
            # connection; keeping it alive would leave the client waiting.
            self.close_connection = True


class ResolverServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        # Players disconnect at arbitrary moments; a connection-level failure
        # (reset, broken pipe, abort) that escapes the handler is routine, not
        # a crash — log one line, not a traceback. Everything else keeps the
        # normal traceback.
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionError, TimeoutError)):
            log(f"client {client_address} disconnected: {exc}")
            return
        super().handle_error(request, client_address)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--host", default=os.environ.get("YTDLP_RESOLVER_HOST", "0.0.0.0"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(
            os.environ.get("YTDLP_RESOLVER_PORT")
            or os.environ.get("PORT")
            or "8080"
        ),
        help="Listen port. Falls back to the platform's $PORT (Render/Heroku/Fly).",
    )
    parser.add_argument(
        "--mode",
        choices=("tunnel", "redirect"),
        default=os.environ.get("YTDLP_RESOLVER_MODE", "tunnel"),
        help="tunnel relays the stream through this server (default); "
        "redirect hands the phone the minted URL directly (same egress IP only).",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get(API_KEY_ENV),
        help="If set, require `Authorization: Apikey <key>` on POST requests.",
    )
    parser.add_argument(
        "--public-url",
        default=os.environ.get(PUBLIC_URL_ENV),
        help="Base URL phones use to reach this server (e.g. https://resolver.example). "
        "Defaults to the Host header of the incoming request.",
    )
    parser.add_argument(
        "--cookies",
        default=os.environ.get(COOKIES_ENV),
        help="Netscape-format cookies file for yt-dlp. Fixes `Sign in to confirm "
        "you're not a bot` on datacenter hosts (Render, Spaces, cheap VPS).",
    )
    parser.add_argument(
        "--player-client",
        default=os.environ.get(PLAYER_CLIENT_ENV),
        help="Force a YouTube player client for every attempt (e.g. tv, "
        "web_safari, mweb). Useful when a datacenter IP is refused.",
    )
    args = parser.parse_args()

    # The yt-dlp command builder reads these from the environment; promote any
    # CLI values so both paths behave the same.
    if args.cookies:
        os.environ[COOKIES_ENV] = args.cookies
    if args.player_client:
        os.environ[PLAYER_CLIENT_ENV] = args.player_client

    deps = dependency_report()
    state = ResolverState(args.mode, args.api_key, args.public_url, deps)
    handler = type("ConfiguredHandler", (ResolverHandler,), {"state": state})
    server = ResolverServer((args.host, args.port), handler)
    _log_secrets_dir()
    log(
        f"listening on http://{args.host}:{args.port} mode={args.mode} "
        f"api_key={'set' if args.api_key else 'off'}"
    )
    log(deps)
    log("POST / resolves a stream (cobalt dialect); GET /stream/<token> relays it.")
    if not args.api_key:
        log(
            "API key is OFF - anyone who can reach this server can resolve "
            "streams through it. Set --api-key (or YTDLP_RESOLVER_API_KEY) "
            "before exposing it publicly."
        )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())