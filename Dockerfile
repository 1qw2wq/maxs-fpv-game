# Trench Front - deploy image.
#
# One container, one port: python:3.12-slim + aiohttp and the repository itself.
# The client is plain ES modules with no build step, so there is nothing to
# compile here -- COPY, pip install, run.
#
#   docker build -t trench-front .
#   docker run -p 8080:8080 trench-front
#
# A hosting platform overrides PORT (Render/Railway/Fly/Heroku all do); the
# server reads it, binds 0.0.0.0 and never probes past it, so the proxy in front
# always finds the game on the port it expects.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# Dependencies first: this layer is cached until requirements.txt changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# The whole game: server/, shared/ (data) and public/ (client, models, sound).
# .dockerignore keeps the git history, caches and design notes out.
COPY server/ ./server/
COPY shared/ ./shared/
COPY public/ ./public/
COPY README.md ./

# Nobody needs to be root to serve static files.
RUN useradd --create-home --uid 10001 trench \
    && chown -R trench:trench /app
USER trench

EXPOSE 8080

# /api/health is the same endpoint a platform's health check uses, so the image
# is self-describing: no curl in the slim image, hence urllib.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/api/health',timeout=4)"

CMD ["python", "server/server.py"]
