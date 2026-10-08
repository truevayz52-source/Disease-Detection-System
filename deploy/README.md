# Deploying DDS

## Recommended: DigitalOcean ($200 / 60 days via GitHub Student Pack)

1. **Get the credit** — sign up at
   https://education.github.com/pack (student verification), then redeem the
   DigitalOcean offer. $200 credit covers ~60 days of a $12/mo droplet, or a
   year of the $6/mo size.

2. **Create the droplet** — Ubuntu 24.04, shared CPU. Use **2 GB RAM minimum**
   (4 GB recommended if you want Whisper transcription; `DDS_LIGHT=1` skips it).
   Add your SSH key.

3. **Get a free domain** — DuckDNS (https://www.duckdns.org, sign in, create
   e.g. `dds-mohcc.duckdns.org`) and point it at the droplet's public IP.
   HTTPS needs a domain; a bare IP won't work for the APK.

4. **Push your code first** — the script clones from GitHub, and the local
   repo has uncommitted work (biometric auth, i18n, outbreak scheduler).
   Commit and push to `master` before running setup, or the droplet gets the
   old code. Alternative: copy the tree directly instead of cloning —

   ```powershell
   # from the repo root on this PC (Windows: install WSL or use git bash)
   rsync -av --exclude node_modules --exclude build --exclude .dart_tool \
     ./ root@<droplet-ip>:/opt/dds/
   # then on the droplet:
   cd /opt/dds && sudo bash deploy/setup.sh dds-mohcc.duckdns.org
   ```

   (setup.sh detects the existing /opt/dds checkout and skips cloning.)

   If you use the rsync path, grab just the script first:

   ```bash
   # on the droplet, before running:
   cd /opt/dds
   sudo bash deploy/setup.sh dds-mohcc.duckdns.org
   ```

5. **Run the setup script** on the droplet (clone path — no rsync):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/truevayz52-source/Disease-Detection-System/master/deploy/setup.sh -o setup.sh
   GEMINI_API_KEY=<your-key> sudo bash setup.sh dds-mohcc.duckdns.org
   ```

   It installs Node/MariaDB/Python, builds the client + server, applies
   `db/*.sql` migrations, seeds demo users, registers systemd services
   (`dds-api`, `dds-analytics`, `dds-transcription`), and configures Caddy
   with automatic HTTPS.

6. **Phone APK** — rebuild once with the stable URL:

   ```powershell
   cd C:\dds\mob2
   flutter build apk --release --no-tree-shake-icons `
     --dart-define DDS_API_URL=https://dds-mohcc.duckdns.org/api
   ```

   Or skip the rebuild: the sign-in screen gear / "Find automatically" lets the
   app set the server URL at runtime.

## Re-deploying updates

```bash
sudo bash /opt/dds/deploy/setup.sh dds-mohcc.duckdns.org
```

The script pulls latest `master`, rebuilds, and restarts services.
