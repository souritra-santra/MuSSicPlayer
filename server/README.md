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

Environment variables: `YTDLP_RESOLVER_API_KEY`, `YTDLP_RESOLVER_MODE`,
`YTDLP_RESOLVER_PUBLIC_URL`, `YTDLP_RESOLVER_HOST`, `YTDLP_RESOLVER_PORT`,
`YTDLP_BIN` (path to the `yt-dlp` executable), `YTDLP_JS_RUNTIME`.

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
* `GET /health` — open; it only reveals `{"ok": true}`.

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
   `https://<user>-<space>.hf.space/health` → `{"ok": true}`.

5. **In the app**: *Settings → Stream resolver* → endpoint
   `https://<user>-<space>.hf.space`, API token = the same key. Both fields
   save on blur; restart playback so the player re-resolves.

Caveats on the free tier:

* Spaces **sleep after ~2 days of inactivity**; the first request after a
  wake pays the container start plus yt-dlp's EJS warm-up (the app's 45s
  resolve timeout covers it), after which the 10-minute cache keeps it warm.
* YouTube flags some **datacenter IP ranges**. If resolves work on your
  machine but fail (or come back as ~70s capped previews) from the Space,
  that's why — yt-dlp's EJS defeats the bot checks, but not IP reputation.
  See the table below and test right after deploying.
* Seeking depends on the proxy passing `Range` through — tap midway into a
  song immediately after deploying to confirm.

### Other hosting options

For a personal music app the most reliable host is usually **your own machine
behind a tunnel** — residential IPs are what YouTube trusts most, and it
costs nothing:

| Host | Cost | Watch out for |
| --- | --- | --- |
| Your PC + [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | free | the PC must be on; Funnel/trycloudflare gives you a public HTTPS URL with no port forwarding |
| Hugging Face Spaces | free | sleeps when idle; datacenter IPs may be flagged by YouTube |
| Oracle Cloud *always free* ARM VM | free (card required) | a real always-on VPS with a static IP; same datacenter-IP caveat |
| Render / Koyeb / Fly.io | free tier or cheap | free instances spin down or burn through credits quickly |

Recommendation: start with HF Spaces above — it's the easiest hosted option
and this repo is already set up for it. If YouTube turns away the Space's IP,
move the same Docker image (or run the script) on a tunnel in front of your
own box; the app only needs an HTTPS URL plus the API token.

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
  app's resolver timeout (45s) covers this.
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