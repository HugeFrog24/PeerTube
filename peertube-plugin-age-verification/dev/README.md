# Local development

A throwaway PeerTube instance in Docker, so the plugin can be tested without a
production database or a live server. Nothing here is published to npm (see
`../.npmignore`).

## Quick start

```bash
cd dev
docker compose up -d     # first boot takes a minute or two (migrations)
./redeploy.sh            # copies the plugin in and installs it
```

Then open <http://localhost:9000> and log in as `root` / `test`.

Use `localhost`, **not** `127.0.0.1`: PeerTube refuses to hand out OAuth client
credentials for a host that does not match `webserver.hostname`, and the client
fails with "Getting client tokens for host 127.0.0.1:9000 is forbidden".

`docker compose down -v` removes the containers and every volume.

## Edit / test loop

Run `./redeploy.sh` after each change, then reload the page. It bumps the patch
version, copies the source into the container, uninstalls and reinstalls the
plugin. All of those steps matter:

- **Uninstall before install.** PeerTube installs local plugins with
  `pnpm add file:<path>`. Once that dependency is in the plugin storage
  lockfile, pnpm treats it as resolved and copies nothing, so a plain
  re-install -- and `peertube-cli plugins update --path` -- silently keep
  running the *old* code, even after a version bump. Uninstalling only sets
  `uninstalled = true` in the database, so configured settings survive.
- **Copy, not bind mount.** Docker Desktop cannot bind-mount SMB/network paths;
  such a mount shows up empty inside the container and the install fails with a
  confusing `ENOENT` on `package.json`. `docker compose cp` works wherever the
  checkout lives.
- **Version bump.** Client scripts are served with
  `Cache-Control: immutable, max-age=30 days` and the version is part of their
  URL, so without a bump the browser keeps the old script. The bump dirties
  `package.json`: `git checkout ../package.json` before committing, or run
  `NO_BUMP=1 ./redeploy.sh` and hard-reload with Ctrl+Shift+R.

The plugin folder must keep its exact npm name -- PeerTube derives the plugin
name from the last segment of the install path.

Useful while debugging: `docker compose logs -f peertube`. Client-side errors
are forwarded there too, prefixed with `Client log:`.

## Modal regression test

`modal-test.mjs` drives the verification modal in jsdom and covers the two
things about it that cannot be seen from the server side:

```bash
cd dev && npm install && node modal-test.mjs
```

**Clicks.** It dispatches a real click on the "Yes" button. The navigation
blocker installs capture-phase listeners on `document`, and anything it stops
never reaches its target -- which once left both modal buttons completely dead.
The test also asserts the blocker still swallows ordinary page clicks while the
visitor is unverified, and stops doing so afterwards.

**Translations.** It renders the modal in German with the minimum age set to
21. `peertubeHelpers.translate` is an exact key lookup that falls back to the
string it was given, so interpolating the age into a label *before* the lookup
silently drops every translation as soon as an admin picks an age other than
the one in the locale files. Labels are therefore translated first and the age
substituted into the `{age}` placeholder afterwards -- keep new locale strings
in that shape.
