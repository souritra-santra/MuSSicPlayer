# yt-dlp stream resolver (ytdlp_resolver.py) packaged for a Hugging Face
# Space using the Docker SDK (app port 8080). The build context is this
# directory: when you deploy, Dockerfile / requirements.txt /
# ytdlp_resolver.py sit at the root of the Space.

FROM python:3.12-slim-bookworm

# yt-dlp's EJS component (the poToken/botguard solver that unlocks full-length
# audio) needs a JS runtime, and it must be node >= 22. Debian's own nodejs
# package is too old on bookworm, so use NodeSource.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg apt-transport-https \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node --version

WORKDIR /app

COPY requirements.txt .
# --pre: yt-dlp occasionally publishes versions the regular index treats as
# pre-releases; the nightly is what defeats YouTube's current anti-bot wall.
RUN pip install --no-cache-dir --pre -r requirements.txt

COPY ytdlp_resolver.py .

# Build-time sanity check: both halves yt-dlp needs for EJS must be importable.
RUN python -c "import yt_dlp; print('yt-dlp', yt_dlp.version.__version__)" \
    && node --version

# Non-root: the server only needs to read its own code and write yt-dlp's
# EJS/cache files under $HOME.
#
# Render mounts Secret Files (e.g. /etc/secrets/cookies.txt) owned by
# root:1000, so also join GID 1000 or the non-root server cannot read them.
# Best-effort: the base image normally already gives `resolver` GID 1000.
RUN useradd --create-home --shell /usr/sbin/nologin resolver \
    && { usermod -aG 1000 resolver || true; } \
    && id resolver
USER resolver

ENV YTDLP_RESOLVER_HOST=0.0.0.0 \
    YTDLP_RESOLVER_PORT=8080 \
    PYTHONUNBUFFERED=1

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["python", "ytdlp_resolver.py"]
