#!/usr/bin/env bash
# Redeploy this plugin into the local dev instance (see docker-compose.yml)
# after editing it. Run it from anywhere:  ./dev/redeploy.sh
#
# Why it uninstalls first: PeerTube installs local plugins with
# `pnpm add file:<path>`. Once that file: dependency is in the plugin storage
# lockfile, pnpm treats it as resolved and copies nothing -- so a plain
# re-install, and `peertube-cli plugins update --path`, both silently keep the
# OLD files, even after a version bump. Uninstalling only sets
# `uninstalled = true` in the database, so configured settings survive.
#
# Why it bumps the version: client scripts are served with
# `Cache-Control: immutable, max-age=30 days` and the plugin version is part of
# their URL, so without a bump the browser keeps running the old client script.
# The bump dirties package.json -- `git checkout package.json` before
# committing, or run with NO_BUMP=1 and hard-reload the page (Ctrl+Shift+R).
#
# The source is copied into the container instead of bind-mounted, because
# Docker Desktop cannot bind-mount SMB/network paths -- such a mount shows up
# empty inside the container, and the install then fails with a confusing
# ENOENT on the plugin's package.json.
#
# Talks to the REST API directly, so no global peertube-cli install is needed.
set -euo pipefail

URL=${URL:-http://localhost:9000}
PT_USER=${PT_USER:-root}          # NB: not USERNAME -- Windows already exports that
PT_PASSWORD=${PT_PASSWORD:-test}
NPM_NAME=${NPM_NAME:-peertube-plugin-age-verification}
# Path as seen INSIDE the container (see the bind mount in docker-compose.yml).
# Its last segment must equal NPM_NAME.
PLUGIN_PATH=${PLUGIN_PATH:-/plugin-src/$NPM_NAME}
HOST_PLUGIN_DIR=${HOST_PLUGIN_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}

if [ -z "${NO_BUMP:-}" ]; then
  node -e 'const f=process.argv[1]+"/package.json",fs=require("fs");const p=JSON.parse(fs.readFileSync(f,"utf8"));const v=p.version.split(".");v[2]=String(Number(v[2]||0)+1);p.version=v.join(".");fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n");console.log("version ->",p.version)' "$HOST_PLUGIN_DIR"
fi

COMPOSE="docker compose -f $(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/docker-compose.yml"

if [ "$(basename "$HOST_PLUGIN_DIR")" != "$NPM_NAME" ]; then
  echo "The plugin folder must be named $NPM_NAME (PeerTube derives the plugin" >&2
  echo "name from the last path segment), but it is $(basename "$HOST_PLUGIN_DIR")." >&2
  exit 1
fi

# Refresh the copy inside the container. Delete first so files removed from the
# source do not linger; copy the folder INTO /plugin-src (docker cp ignores a
# trailing /. and would otherwise nest it one level too deep).
$COMPOSE exec -T -u root peertube sh -c "rm -rf '$PLUGIN_PATH' && mkdir -p '$(dirname "$PLUGIN_PATH")'"
$COMPOSE cp "$HOST_PLUGIN_DIR" "peertube:$(dirname "$PLUGIN_PATH")" > /dev/null
$COMPOSE exec -T -u root peertube sh -c "rm -rf '$PLUGIN_PATH/dev' '$PLUGIN_PATH/node_modules' && chown -R peertube:peertube '$PLUGIN_PATH'"

API=$URL/api/v1
client=$(curl -sf "$API/oauth-clients/local")
id=$(sed -n 's/.*"client_id":"\([^"]*\)".*/\1/p' <<< "$client")
secret=$(sed -n 's/.*"client_secret":"\([^"]*\)".*/\1/p' <<< "$client")
token=$(curl -sf -X POST "$API/users/token" \
  -d "client_id=$id&client_secret=$secret&grant_type=password&response_type=code&username=$PT_USER&password=$PT_PASSWORD" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

auth=(-H "Authorization: Bearer $token" -H "Content-Type: application/json")

curl -s -o /dev/null -w "uninstall HTTP %{http_code}\n" -X POST "$API/plugins/uninstall" "${auth[@]}" -d "{\"npmName\":\"$NPM_NAME\"}"
# PeerTube's uninstall returns early when the database row is missing (after a
# failed install, say), leaving a stale `file:` entry in the plugin storage
# lockfile. pnpm then treats the package as already resolved and installs
# nothing, so every later attempt fails with ENOENT on its package.json. Clear
# it unconditionally -- a no-op when the uninstall above already did it.
$COMPOSE exec -T -u peertube peertube sh -c "cd /data/plugins && pnpm remove $NPM_NAME" > /dev/null 2>&1 || true

curl -s -o /dev/null -w "install   HTTP %{http_code}\n" -X POST "$API/plugins/install"   "${auth[@]}" -d "{\"path\":\"$PLUGIN_PATH\"}"

echo "Redeployed $NPM_NAME -- reload the page."
