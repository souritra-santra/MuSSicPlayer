# yt-dlp stream resolver (reference server)

A small, dependency-light resolver that gives the MusicPlayer app **full-length
YouTube audio** — the thing the app's built-in extractor can no longer do for
long songs, because YouTube now serves third-party innertube clients a ~70-second
preview cap (any read past the head answers 403, which used to kill playback
with a cryptic "source error").

Rather than reimplementing YouTube's poToken/botguard dance inside the app
(not viable on Hermes — no WASM, no Python), this server runs **yt-dlp**, which
solves the challenge for us and returns a URL that serves the *whole* file.
The app already speaks the server's dialect: point **Settings → Stream
resolver** at it and YouTube results fall back to it automatically whenever the
built-in extractor's stream is preview-capped or restricted.

## What it does

```
app  --POST JSON {url, audioQuality, ...}-->  server
server --yt-dlp (EJS)--> minted full-length URL
server --verify deep read--> served in full?
server --{"status":"tunnel","url": ".../stream/<token>"}--> app
app   --GET /stream/<token> (Range/Accept headers)--> server relays googlevideo -> app
```

* **Tunnel mode (default).** The minted googlevideo URL is bound to the
  server's IP — a phone on another network gets 403 fetching it directly. So
  the server relays the bytes and forwards `Range` requests, which keeps
  playback and seeking working no matter where the phone is. The relay always
  asks googlevideo for an explicit range (`bytes=0-` if the client sent none),
  because plain unranged responses get cut after a few hundred KB; that `206`
  is then restated as a normal `200` for clients that never asked for a range.
* **Verified.** Every minted URL is probed with a deep ranged read before it is
  handed to the player. If YouTube answers 403 (preview cap), the server retries
  with fallback strategies instead of sending the player a URL that dies
  mid-stream.
* **Redirect mode (optional).** `--mode redirect` hands the phone the minted URL
  directly — only useful when phone and server share an egress IP (same LAN/NAT,
  or testing from the same machine).

## Requirements

* **Python 3.10+**
* **yt-dlp (nightly with default extras)** — the default extras bundle
  `yt-dlp-ejs`, which is what actually defeats YouTube's challenge:

  ```bash
  python -m pip install -U --pre "yt-dlp[default]"
  ```

  or use the official standalone `yt-dlp.exe`/`yt-dlp_linux` build (EJS is
  bundled; point at it with `YTDLP_BIN`).
* **A JavaScript runtime for EJS**: node ≥ 22 or deno ≥ 2.3 (deno is yt-dlp's
  default; this server requests `node` first). Update yt-dlp often:

  ```bash
  python -m pip install -U --pre "yt-dlp[default]"
  ```

## Run

```bash
python ytdlp_resolver.py --port 8080
```

Then in the app: **Settings → Stream resolver** → enter
`http://<your-machine>:8080` (plus the API token if you run with `--api-key`).

For phones, the server must be reachable from the phone's network:

* Same Wi-Fi: use your machine's LAN IP (`ipconfig`/`ip addr`), not `localhost`.
* Internet: run it on a VPS (optionally behind a reverse proxy for HTTPS) and
  set `--public-url https://resolver.example` so the tunnel URLs it hands back
  are reachable.

Plain `http://` endpoints are fine on Android — the app enables cleartext for
user-configured resolver URLs. On iOS, a self-hosted `http://` resolver over
HTTPS-less LAN may be blocked by App Transport Security; prefer HTTPS.

### Options

| Flag | Default | Purpose |
| --- | --- | --- |
| `--port` | `8080` | Listen port. |
| `--host` | `0.0.0.0` | Bind address. |
| `--mode` | `tunnel` | `tunnel` (relay; use for phones) or `redirect` (direct link; same egress IP only). |
| `--api-key` | off | If set, require `Authorization: Apikey <key>` on POST. |
| `--public-url` | request Host | Public base URL for tunnel links (needed behind a proxy / on the internet). |
| `--cookies` | off | Netscape-format cookies file for yt-dlp (see *Authenticating with YouTube*). |
| `--player-client` | yt-dlp default | Force a YouTube player client (e.g. `tv`, `web_safari`) on every attempt. |

Environment variables: `YTDLP_RESOLVER_API_KEY`, `YTDLP_RESOLVER_MODE`,
`YTDLP_RESOLVER_PUBLIC_URL`, `YTDLP_RESOLVER_HOST`, `YTDLP_RESOLVER_PORT`
(falls back to the platform's `PORT`), `YTDLP_BIN` (path to the `yt-dlp`
executable), `YTDLP_JS_RUNTIME` (default `node`), `YTDLP_COOKIES`,
`YTDLP_PLAYER_CLIENT`.

`GET /health` echoes a one-line toolchain summary, so you can see exactly what
a hosted instance is running:

```json
{"ok": true, "deps": "yt-dlp 2026.09.27.232945; js runtime node (found at /usr/bin/node); cookies off"}
```

### Quality

The app sends `audioQuality` (`best`, `320`, `256`, `192`, `128`, `96`, `64`).
The server maps it to a yt-dlp format selector that prefers AAC-in-m4a (plays
on both Android and iOS), then falls back to any audio track, then any file.
`128` is the app's default and maps to roughly a 128 kbps stream (itag 140 when
available).

### Auth

Run with `--api-key supersecret`:

```bash
python ytdlp_resolver.py --api-key supersecret
```

and put the same token in the app under **Settings → Stream resolver → API
token**. Requests without a matching `Authorization: Apikey <token>` header get
`401` (compared in constant time). The key can also come from the
`YTDLP_RESOLVER_API_KEY` environment variable — that's how you pass it on
hosted platforms that inject secrets as env vars.

What is and isn't protected:

* `POST /` (resolve) — requires the API key; the check happens before any
  body is read or yt-dlp work is done, and the connection is closed with the
  `401`.
* `GET /stream/<token>` — no API key. The player fetches media with a plain
  HTTP GET and cannot attach headers, so the stream URL *is* the credential:
  a random 128-bit token, handed out only to callers who passed the API key,
  expiring after 45 minutes.
* `GET /health` — open; it only reveals the `ok`/`deps` summary.

### Authenticating with YouTube (cookies)

On datacenter hosts (Render, Hugging Face Spaces, most VPSes) YouTube frequently
answers extraction with `Sign in to confirm you're not a bot` or `Failed to
extract any player response`. Exporting a YouTube cookies file and pointing the
server at it is the reliable fix:

1. Export cookies in **Netscape** format from a browser signed in to YouTube — a
   "Get cookies.txt" extension, or `yt-dlp --cookies-from-browser chrome
   --cookies cookies.txt` on a machine with that browser.
2. Point the server at the file: `--cookies cookies.txt` or
   `YTDLP_COOKIES=/path/cookies.txt`. On Render, add it as a **Secret File**
   mounted at `/etc/secrets/cookies.txt` and set
   `YTDLP_COOKIES=/etc/secrets/cookies.txt`.
3. Cookies expire (log out, password change, weeks of inactivity) — re-export if
   resolution starts failing again.

If an instance is refused even with cookies, try `--player-client tv` (also
`web_safari`, `mweb`); which client YouTube trusts varies by IP range.

## Deploy to Hugging Face Spaces

The server packages as a Docker Space on Hugging Face's free CPU hardware —
no credit card, HTTPS URL included, and the phone connects to it over the
internet.

1. **Create the Space**: <https://huggingface.co/new> → *Space* → SDK
   **Docker**, hardware **CPU basic** (free), Space visibility as you like.
   When prompted for the port, use **8080**. HF writes the README front
   matter (`sdk: docker`, `app_port: 8080`) for you.

2. **Upload the server files** from this directory — either drag them into
   the Space's *Files* tab, or with git:

   ```bash
   cd server
   git init -b main
   git remote add space https://huggingface.co/spaces/<user>/<space>
   git add Dockerfile .dockerignore ytdlp_resolver.py requirements.txt
   git commit -m "yt-dlp resolver"
   hf auth login        # create a write token; `huggingface-cli login` also works
   git push space main
   ```

   Don't overwrite the Space's auto-generated README — its YAML front matter
   is what tells HF to build the Dockerfile. (If you do want this document as
   the Space README, keep a front-matter block with `sdk: docker` and
   `app_port: 8080` at the very top.)

3. **Set secrets** in *Space → Settings → Variables and secrets*:

   | Secret | Value |
   | --- | --- |
   | `YTDLP_RESOLVER_API_KEY` | a long random string (`openssl rand -hex 32`) — without it the Space is an open resolver for anyone who finds the URL |
   | `YTDLP_RESOLVER_PUBLIC_URL` | `https://<user>-<space>.hf.space` — makes tunnel links exact; normally derived from the proxy's forwarded headers anyway, so this is a belt-and-braces override |

4. **Wait for the build** (a few minutes), then open
   `https://<user>-<space>.hf.space/health` → `{"ok": true, "deps": "..."}` (the
   `deps` string confirms the yt-dlp version, JS runtime, and whether cookies
   loaded).

5. **In the app**: *Settings → Stream resolver* → endpoint
   `https://<user>-<space>.hf.space`, API token = the same key. Both fields
   save on blur; restart playback so the player re-resolves.

Caveats on the free tier:

* Spaces **sleep after ~2 days of inactivity**; the first request after a
  wake pays the container start plus yt-dlp's EJS warm-up (the app's 75s
  resolve timeout covers it), after which the 10-minute cache keeps it warm.
* YouTube flags some **datacenter IP ranges**. If resolves work on your
  machine but fail (or come back as ~70s capped previews) from the Space,
  that's why — add a cookies file (see *Authenticating with YouTube*) and
  re-check `/health`.
* Seeking depends on the proxy passing `Range` through — tap midway into a
  song immediately after deploying to confirm.

## Deploy to Render

The free instance is CPU-light, so the first (cold) resolve can take a while —
the app's resolver timeout is sized to cover it.

1. **New → Web Service**, connect the repo, and set **Root Directory** to
   `server`.
2. For **Language** pick **Docker** — Render builds `server/Dockerfile`, which
   installs Node for yt-dlp's EJS solver.
3. Add environment variables / secrets:

   | Variable | Value |
   | --- | --- |
   | `YTDLP_RESOLVER_API_KEY` | a long random string |
   | `YTDLP_COOKIES` | `/etc/secrets/cookies.txt`, after adding that file under **Secret Files** — this is what makes Render's datacenter IP work (see *Authenticating with YouTube*) |
   | `YTDLP_RESOLVER_PUBLIC_URL` | optional — `https://<service>.onrender.com` |

4. Deploy, then open `https://<service>.onrender.com/health` and confirm the
   `deps` string shows a recent yt-dlp, `js runtime node (found ...)`, and
   `cookies set (...)`.
5. In the app: endpoint `https://<service>.onrender.com`, API token = the key.

Free Render services spin down after ~15 minutes idle; a request during the
wake-up may return Render's loading page instead of JSON, so the first resolve
after a long pause can need a retry.

### Other hosting options

For a personal music app the most reliable host is usually **your own machine
behind a tunnel** — residential IPs are what YouTube trusts most, and it
costs nothing:

| Host | Cost | Watch out for |
| --- | --- | --- |
| Your PC + [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | free | the PC must be on; Funnel/trycloudflare gives you a public HTTPS URL with no port forwarding |
| Hugging Face Spaces / Render | free | sleeps when idle; datacenter IPs are usually refused by YouTube, so add a cookies file (see *Authenticating with YouTube*) |
| Oracle Cloud *always free* ARM VM | free (card required) | a real always-on VPS with a static IP; same datacenter-IP caveat |
| Koyeb / Fly.io | free tier or cheap | free instances spin down or burn through credits quickly |

Recommendation: any datacenter host needs a cookies file to satisfy YouTube;
start with whichever of these you already have (the section above for your
platform), set `YTDLP_COOKIES`, and confirm via `/health`. If YouTube still
turns it away, run the same Docker image on a tunnel in front of your own box —
residential IPs rarely need cookies at all. The app only needs an HTTPS URL
plus the API token.

## Verification

Did it actually fix the 403 preview-cap problem for a song that breaks in the
built-in extractor? Yes — a 3:41 video (`x5Oag4hISgU`, which the app currently
rejects as "could not load track") resolves through this server with
`audioDuration: 221` and a tunnel that answers deep ranged reads with `206`.
Probe it yourself:

```bash
# resolve
curl -X POST http://127.0.0.1:8080/ -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=x5Oag4hISgU","audioQuality":128}'

# then deep-read the tunneled stream near the end of the file (expect 206)
curl -H 'Range: bytes=1300000-1308191' http://127.0.0.1:8080/stream/<token>
```

## Troubleshooting

* **`yt-dlp is not installed`** — install the nightly with default extras as
  above; EJS (the poToken solver) comes from `yt-dlp[default]`.
* **`yt-dlp failed: ... page needs to be reloaded`** — YouTube rotates its
  anti-bot measures; update yt-dlp to the latest nightly and retry.
* **Slow first request** — the first extraction after install fetches EJS
  components. Later requests are cached (10 minutes in memory) and fast. The
  app's resolver timeout (75s) covers this.
* **`Failed to extract any player response` on a hosted instance** — YouTube is
  refusing that server's IP range (datacenter hosts get this constantly). Add a
  cookies file (`--cookies` / `YTDLP_COOKIES`; see *Authenticating with
  YouTube*) and re-check `/health`'s `deps`, or try `--player-client tv`. The
  server logs the last few yt-dlp lines for each failed strategy, so the real
  cause is visible in the host's log.
* **`Failed to extract any player response` even on your own machine** — the
  installed yt-dlp is stale; update to the nightly (`--pre`).
* **All strategies fail for a specific video** — some uploads are pot/nsig-
  protected or geo-restricted even for yt-dlp; no client can currently stream
  those, and the error message in the app will say so.
* **`relay dropped: client closed the connection`** — normal and harmless: the
  player stopped reading mid-relay (seek, pause, or it switched tracks), so the
  server drops that connection quietly.
* **`relay truncated: upstream ended after N/M bytes`** — googlevideo closed the
  transfer early. The server closes the relay too, so the player sees a short
  read and re-requests from where it stopped with a `Range`. An occasional line
  is fine; a steady stream of them means YouTube is throttling this server's IP.
* **`502` on `GET /stream/<token>`** — the minted URL was refused (e.g. 403) or
  unreachable before any bytes were sent, so the player got a clean `502` it can
  retry. Re-resolving (the app's next `POST /`) mints a fresh URL. Note that
  `502` is only reported *before* the response starts; mid-transfer failures
  close the connection instead (see `relay truncated` above). The reason is
  logged right before the access line (`relay upstream refused the request: HTTP
  403` / `relay upstream unreachable: ...`); the common `HTTP 416` means the
  player asked for a byte range past the end of the file, which is harmless.
* **`401 UNAUTHORIZED` from a hosted resolver** — the API token in the app
  (*Settings → Stream resolver → API token*) must match the server's
  `--api-key` / `YTDLP_RESOLVER_API_KEY` exactly (no surrounding spaces or
  quotes).
* **First request to a hosted Space is very slow** — free Spaces sleep when
  idle and wake on the first hit (container start + EJS warm-up); later
  requests are served from the 10-minute cache.

## Notes

* This is a **reference** server for personal use. It will happily resolve any
  URL you POST, so don't expose it to the internet without `--api-key`. It does
  not transcode (no ffmpeg needed): it returns the native audio stream (m4a or
  opus), which ExoPlayer/AVPlayer both handle.
* Streaming relays through the tunnel count against the server's bandwidth for
  the duration of playback. For a single user that's usually nothing to worry
  about; use `--mode redirect` if you'd rather the phone stream from
  googlevideo directly (only when IPs match).