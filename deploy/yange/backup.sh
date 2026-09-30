#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/yange-crypto-news
mkdir -p backups
chmod 700 backups
exec 9>backups/.lock
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
stage=$(mktemp -d backups/.full-XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
# Refuse to consume the host's last 2 GiB. Uploads independently reserve 1 GiB.
[[ $(df -Pk backups | awk 'NR==2 {print $4}') -gt 2097152 ]]
manifest() { sudo -n docker compose exec -T api node --input-type=module < data-manifest.mjs; }
consistent=false
for attempt in 1 2 3; do
  manifest > "$stage/data-manifest.json"
  sudo -n docker compose exec -T api tar -C /data --exclude=./imgcache --exclude=./ogcache -czf - . > "$stage/data.tar.gz"
  sudo -n docker compose exec -T db pg_dump -U yange yange_crypto | gzip > "$stage/db.sql.gz"
  manifest > "$stage/after.json"
  if cmp -s "$stage/data-manifest.json" "$stage/after.json"; then consistent=true; break; fi
 done
[[ "$consistent" == true ]] || { echo 'Persistent files changed during backup; no completed backup published' >&2; exit 1; }
rm "$stage/after.json"
mkdir "$stage/config"
sudo -n cat .env > "$stage/config/.env"
if [[ -f square-publish.env ]]; then sudo -n cat square-publish.env > "$stage/config/square-publish.env"; fi
cp docker-compose.yml backup.sh data-manifest.mjs "$stage/config/"
tar -czf "$stage/config.tar.gz" -C "$stage/config" .
rm -rf "$stage/config"
gzip -t "$stage/db.sql.gz" "$stage/data.tar.gz" "$stage/config.tar.gz"
(cd "$stage" && sha256sum db.sql.gz data.tar.gz config.tar.gz data-manifest.json > SHA256SUMS && sha256sum -c SHA256SUMS)
chmod 600 "$stage"/*
mv "$stage" "backups/full-${stamp}"
# Only completed backups owned by this job are expired.
find backups -maxdepth 1 -type d -name 'full-*' -mtime +14 -exec rm -rf -- {} +
find backups -maxdepth 1 -type f -name 'db-*.sql.gz' -mtime +14 -delete
printf 'Complete backup: full-%s\n' "$stamp"
