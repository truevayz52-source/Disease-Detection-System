# Hugging Face Space image for DDS — clones the public repo, builds client +
# server, runs the whole stack in one container. HF proxies :443 -> :7860.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl git ca-certificates openssl mariadb-server \
      python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

ARG REPO_URL=https://github.com/truevayz52-source/Disease-Detection-System.git
ARG REPO_REF=master
WORKDIR /opt/dds
RUN git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" .

RUN pnpm install --frozen-lockfile=false \
    && (cd client && pnpm exec vite build) \
    && pnpm --filter server build

# Analytics + pathology services. Transcription is skipped on purpose:
# faster-whisper pulls in ~1 GB of deps and WHISPER_URL simply stays down.
RUN python3 -m venv /opt/dds-venv \
    && /opt/dds-venv/bin/pip install -q --upgrade pip \
    && /opt/dds-venv/bin/pip install -q -r analytics/requirements.txt \
    && /opt/dds-venv/bin/pip install -q -r analytics/requirements-pathology.txt

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7860
CMD ["/entrypoint.sh"]
