# Koyeb image for DDS — builds the client + server from this repo and runs
# Node API + Python services in one container. MySQL is external (env-driven),
# e.g. Aiven's free managed MySQL (MYSQL_SSL=1).
FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile=false \
    && (cd client && pnpm exec vite build) \
    && pnpm --filter server build

# Analytics + pathology services. Transcription skipped — faster-whisper is
# heavy and free-tier RAM is tight; WHISPER_URL just stays unreachable.
RUN python3 -m venv /opt/dds-venv \
    && /opt/dds-venv/bin/pip install -q --upgrade pip \
    && /opt/dds-venv/bin/pip install -q -r analytics/requirements.txt \
    && /opt/dds-venv/bin/pip install -q -r analytics/requirements-pathology.txt

EXPOSE 8000
CMD ["bash", "deploy/koyeb/entrypoint.sh"]
