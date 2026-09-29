# Deploying trial-booking

Target: one Ubuntu VPS running **PM2 + nginx + PostgreSQL**. GitHub Actions builds
on the runner and ships the result over SSH with rsync. There is no Docker in
this setup.

```
browser --HTTPS--> nginx :443 --> apps/web/dist (static SPA, served from disk)
                     |
                     +-- /api/*, /health* --> 127.0.0.1:4001  trial-booking-api (PM2)
                     |
                     +-- not exposed          127.0.0.1:4002  trial-booking-payments-sandbox (PM2)

trial-booking-worker (PM2, no port) and PostgreSQL 16 (127.0.0.1:5432) sit behind the API.
```

UFW allows SSH, 80 and 443 only. The API, the sandbox and Postgres listen on
loopback, and `ecosystem.config.cjs` pins the API and sandbox bind addresses so
an env file cannot change them.

## Files

| File | Purpose |
| --- | --- |
| `vps-setup.sh` | Idempotent provisioning of a fresh Ubuntu 22.04/24.04/26.04 server. Run as root. |
| `nginx.conf` | Plain-HTTP vhost. Installed until a certificate exists. |
| `nginx-tls.conf` | HTTPS vhost with a port 80 redirect. Installed once `certbot certonly` succeeds. |
| `snippets/trial-booking-app.conf` | Static root, gzip, cache rules, every `location`. Shared by both vhosts. |
| `snippets/trial-booking-proxy.conf` | Proxy settings for the API (X-Forwarded-*, timeouts, header dedup). |
| `snippets/trial-booking-security-headers.conf` | CSP, HSTS, nosniff, frame and referrer policy. Included in every `location`. |
| `../ecosystem.config.cjs` | PM2 process list (api, worker, payments-sandbox). |
| `../.github/workflows/ci.yml` | Lint, prose lint, typecheck, unit, integration and e2e tests. |
| `../.github/workflows/deploy.yml` | Runs CI, then builds, rsyncs, migrates, reloads PM2 and checks health. |

### Placeholders

The templates are valid nginx config as committed, with two placeholders that
`vps-setup.sh` replaces. Replace them by hand if you install the files yourself:

| Placeholder | Replace with | Found in |
| --- | --- | --- |
| `example.com` | your domain (also the certbot certificate name) | `nginx.conf`, `nginx-tls.conf` |
| `/home/deploy/trial-booking` | the deploy root, same as the `DEPLOY_PATH` variable | `snippets/trial-booking-app.conf` |

## First-time server setup

1. Point an A (and AAAA, if the server has IPv6) record for your domain at the
   server. Let's Encrypt's HTTP-01 check needs it before a certificate can be
   issued.
2. Create a deploy key pair on your machine. The private half goes to GitHub,
   the public half to the server:
   ```sh
   ssh-keygen -t ed25519 -N "" -C "trial-booking-deploy" -f ./trial-booking-deploy
   ```
3. Copy this folder to the server and run the script as root:
   ```sh
   scp -r .deploy root@<server>:/root/trial-booking-deploy
   ssh root@<server>
   DOMAIN=trial.example.org \
   CERTBOT_EMAIL=you@example.org \
   DEPLOY_SSH_PUBKEY="$(cat trial-booking-deploy.pub)" \
     bash /root/trial-booking-deploy/vps-setup.sh
   ```
   (Run the `$(cat ...)` part on your machine, or paste the key line.) Every
   variable the script accepts is documented at the top of `vps-setup.sh`.
   Without `DOMAIN` and `CERTBOT_EMAIL` it skips TLS and the site answers on the
   server IP over plain HTTP.
4. The script ends with a summary: the deploy root, the values for the GitHub
   secrets below, and the exact `VPS_HOST_KEY` line read from the server's own
   host key file.

Re-running the script is safe. Existing users, roles, databases, env files and
certificates are detected and left alone. nginx files are rewritten from the
templates each run, checked with `nginx -t`, and rolled back if the check fails.
Re-run it after changing anything in `.deploy/`: the deploy workflow does not
touch nginx.

## GitHub settings

Settings > Secrets and variables > Actions. The deploy job runs in the
`production` environment, so you can also add required reviewers there.

| Name | Kind | Value |
| --- | --- | --- |
| `VPS_HOST` | secret | Server IP or DNS name. |
| `VPS_USER` | secret | `deploy` (the `APP_USER` of `vps-setup.sh`). |
| `VPS_PORT` | secret | SSH port. Optional, defaults to 22. |
| `VPS_SSH_KEY` | secret | Private half of the deploy key (the whole file). |
| `VPS_HOST_KEY` | secret | The server's host key as a known_hosts line. The deploy fails closed without it. |
| `DEPLOY_PATH` | variable | The deploy root, e.g. `/home/deploy/trial-booking`. |
| `SHOW_DEMO_ACCOUNTS` | variable | Optional. `true` shows the seeded demo logins on the login page. |

`VPS_HOST_KEY` must start with the exact `VPS_HOST` value, plus the port in
brackets when it is not 22:

```
203.0.113.10 ssh-ed25519 AAAAC3Nza...
[203.0.113.10]:2222 ssh-ed25519 AAAAC3Nza...
```

Take it from the `vps-setup.sh` summary, or read `/etc/ssh/ssh_host_ed25519_key.pub`
through your provider's web console. If you use `ssh-keyscan` from your machine
instead, compare its fingerprint (`ssh-keygen -lf`) with the one the console
shows. The workflow never scans for keys itself: scanning right before
connecting trusts whoever answers.

## Environment files

Each app loads the root `.env`, then its own `.env` (dotenv, existing variables
win). On the server the secrets live in:

- `$DEPLOY_PATH/apps/api/.env` (API and worker)
- `$DEPLOY_PATH/apps/payments-sandbox/.env`

Both are mode 600, owned by `deploy`, excluded from rsync (so deploys never
overwrite or delete them) and never committed. `vps-setup.sh` writes them with
generated secrets when they do not exist. Keep secrets out of a root `.env`:
both apps read it, and the sandbox has no business seeing `JWT_SECRET`.

After the first deploy, compare each file with the matching `.env.example`,
which lists every variable with its default.

### `apps/api/.env`

| Variable | Production value | What it does |
| --- | --- | --- |
| `NODE_ENV` | `production` | Also pinned by `ecosystem.config.cjs`. |
| `PORT` | `4001` | API port. nginx and the deploy health check use 4001; pinned by `ecosystem.config.cjs`. |
| `BIND_HOST` | `127.0.0.1` | Listen on loopback only. Pinned by `ecosystem.config.cjs`. |
| `DATABASE_URL` | `postgres://trial_booking_app:<pw>@127.0.0.1:5432/trial_booking` | Postgres connection, used by the API, the worker and migrations. |
| `JWT_SECRET` | 64 hex chars (`openssl rand -hex 32`) | Signs access tokens (HS256). 32+ characters. |
| `JWT_ACCESS_TTL` | `30m` | Access token lifetime. |
| `REFRESH_TTL_DAYS` | `7` | Refresh token (`tb_refresh` cookie) lifetime. |
| `CORS_ORIGIN` | `https://<your domain>` | Allowed browser origins, comma separated. The SPA is same-origin, so this is the site's own origin. |
| `COOKIE_SECURE` | `true` | Sets `Secure` on the refresh cookie. `false` only for a plain-HTTP demo, where browsers would drop a secure cookie. |
| `TRUST_PROXY` | `1` | nginx is one proxy hop, so Express reads the client IP (rate limits) and HTTPS scheme from nginx's headers. |
| `PAYMENT_PROVIDER_URL` | `http://127.0.0.1:4002` | The payments sandbox, over loopback. |
| `PAYMENT_PROVIDER_API_KEY` | 48 hex chars | Shared secret with the sandbox. Must equal `SANDBOX_API_KEY`. |
| `PAYMENT_PROVIDER_TIMEOUT_MS` | default | Timeout for one call to the provider. |
| `LOG_LEVEL` | `info` | Log verbosity. |
| `BCRYPT_COST` | default | bcrypt work factor for password hashes. |
| `RATE_LIMIT_WINDOW_MS` | default | Window for the per-IP rate limits below. |
| `RATE_LIMIT_MAX` | default | Requests per window per IP, all of `/api`. |
| `LOGIN_RATE_LIMIT_MAX` | default | Login attempts per window per IP. |
| `PAYMENT_RATE_LIMIT_MAX` | default | Payment attempts per window per IP. |
| `UNPAID_BOOKING_TTL_MINUTES` | default | After this long the worker expires an unpaid booking. |
| `WORKER_INTERVAL_MS` | default | How often the worker polls for jobs. |
| `PAYMENT_JOB_MAX_ATTEMPTS` | default | Retries for a capture or void job before it is marked failed. |
| `RECONCILE_AFTER_SECONDS` | default | Age at which the worker reconciles a payment attempt stuck in progress. |

### `apps/payments-sandbox/.env`

| Variable | Production value | What it does |
| --- | --- | --- |
| `NODE_ENV` | `production` | Also pinned by `ecosystem.config.cjs`. |
| `SANDBOX_PORT` | `4002` | Sandbox port. Pinned by `ecosystem.config.cjs`. |
| `SANDBOX_BIND_HOST` | `127.0.0.1` | Loopback only; nginx does not expose the sandbox. Pinned by `ecosystem.config.cjs`. |
| `SANDBOX_API_KEY` | same as `PAYMENT_PROVIDER_API_KEY` | The key the API must present. |
| `SANDBOX_LATENCY_MS` | `800` | Simulated provider latency. |
| `SANDBOX_SLOW_LATENCY_MS` | `10000` | Latency for the "slow" test card, to exercise timeouts. |

### `apps/web` (build time, on the runner)

| Variable | Where | What it does |
| --- | --- | --- |
| `SHOW_DEMO_ACCOUNTS` | repository variable | `true` prints the seeded demo logins on the login page. Leave unset (false) unless the site is a public demo. |
| `WEB_PORT` | dev only | Rspack dev server port. Not used in production. |
| `API_URL` | dev only | Dev server proxy target. In production nginx proxies `/api`. |

Run `npm` and `pm2` commands on the server as the deploy user
(`sudo -iu deploy`). `vps-setup.sh` sets up its login shell with nvm loaded and
`DEPLOY_PATH` exported, which the commands below rely on.

## First deploy

1. Provision the server and set the GitHub secrets and variables above.
2. Push to `main`, or open Actions > Deploy > Run workflow.
3. Watch the run: CI, then build, rsync, `npm ci --omit=dev`, migrations,
   `pm2 startOrReload`, health check.
4. Optional: [seed demo data](#seeding-demo-data).
5. Open `https://<your domain>` and check the [health endpoints](#health-checks).

## Routine deploy

Merge to `main`. The Deploy workflow runs when `apps/`, `packages/`, the root
`package.json`/`package-lock.json`, `ecosystem.config.cjs` or the workflow
itself changed. It:

1. runs the full CI workflow for that commit and stops if any job fails;
2. builds on the runner (`npm ci`, `npm run build`);
3. rsyncs the checkout, with build output, to `DEPLOY_PATH`, skipping `.git`,
   `node_modules`, `.env*`, `logs/` and test artifacts. Anything else you put in
   `DEPLOY_PATH` by hand is deleted;
4. on the server: `npm ci --omit=dev`, `npm run migrate -w @trial-booking/api`,
   `pm2 startOrReload ecosystem.config.cjs --update-env`, `pm2 save`;
5. polls `http://127.0.0.1:4001/health/ready` (10 tries, 3s apart), checks the
   worker and sandbox are running, and fails the job otherwise, printing the
   last PM2 log lines.

Deploys are serialized (`concurrency: production`); a newer push waits for the
running deploy rather than cancelling it.

## Migrations

Migrations run on every deploy before PM2 reloads. By hand, on the server:

```sh
cd "$DEPLOY_PATH"
NODE_ENV=production npm run migrate -w @trial-booking/api        # apply pending
NODE_ENV=production npm run migrate:undo -w @trial-booking/api   # undo the last one
```

`sequelize-cli` is a runtime dependency, so both work after `npm ci --omit=dev`.
The old release keeps running while migrations apply, so write them to be
compatible with the previous code (add columns before using them, drop them a
release later). Take a [backup](#backups-and-restore) before a destructive one.

## Seeding demo data

`npm run seed -w @trial-booking/api` runs through `tsx`, a dev dependency that
the server does not have. Run it from your machine through an SSH tunnel:

```sh
ssh -N -L 15432:127.0.0.1:5432 <you>@<server> &
DATABASE_URL='postgres://trial_booking_app:<pw>@127.0.0.1:15432/trial_booking' \
  npm run seed -w @trial-booking/api
kill %1
```

Use your own SSH login for the tunnel; the `deploy` user only accepts the CI
key. The password is in `apps/api/.env` on the server. `DATABASE_URL` on the
command line wins over your local `.env`, which supplies any other variable the
seed script reads. Pair this with `SHOW_DEMO_ACCOUNTS=true` only for a public
demo.

## Rollback

Code:

- Durable fix: `git revert <bad commit>` and push to `main`. CI and the deploy
  run as usual.
- Faster: tag the last good commit (`git tag rollback-<date> <sha> && git push origin rollback-<date>`),
  then Actions > Deploy > Run workflow > "Use workflow from" > that tag. The
  deploy job accepts `main` and tags only. The next push to `main` deploys
  `main` again, so revert there as well.

Database: rolling code back does not undo migrations. If the bad release added
a migration the old code cannot live with, undo it **before** deploying the old
code, while the migration file is still on the server:

```sh
cd "$DEPLOY_PATH"
NODE_ENV=production npm run migrate:undo -w @trial-booking/api
```

If a migration destroyed data, restore from a backup instead.

## Logs

| What | Where |
| --- | --- |
| App stdout/stderr | `$DEPLOY_PATH/logs/{api,worker,payments-sandbox}-{out,error}.log` (timestamped, rotated by pm2-logrotate: 10 MB, 14 files, gzip) |
| Live tail | `pm2 logs`, or `pm2 logs trial-booking-api --lines 200` |
| Process state | `pm2 status`, `pm2 describe trial-booking-worker` |
| PM2 boot unit | `journalctl -u pm2-deploy` |
| nginx | `/var/log/nginx/access.log`, `/var/log/nginx/error.log` |
| PostgreSQL | `/var/log/postgresql/postgresql-16-main.log` |
| certbot | `/var/log/letsencrypt/letsencrypt.log`, `systemctl list-timers certbot.timer` |

Run `pm2` commands as `deploy` (`sudo -iu deploy`); root has its own, empty PM2.

## Health checks

```sh
# On the server, straight to the API
curl -sf http://127.0.0.1:4001/health         # liveness: the process answers
curl -sf http://127.0.0.1:4001/health/ready   # readiness: the API can query Postgres

# From anywhere, through nginx
curl -sf https://<your domain>/health/ready

# Security headers on the HTML and on a hashed asset
curl -sI https://<your domain>/ | grep -iE 'content-security|strict-transport|x-frame|cache-control'
```

Point an uptime monitor at `/health/ready`.

## Rotating `JWT_SECRET`

```sh
sudo -iu deploy
cd "$DEPLOY_PATH"
NEW="$(openssl rand -hex 32)"
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${NEW}/" apps/api/.env
pm2 restart trial-booking-api
curl -sf http://127.0.0.1:4001/health/ready
```

Access tokens signed with the old secret stop verifying at once. Refresh tokens
are opaque values stored in the database, not JWTs, so the SPA's next
`POST /api/auth/refresh` gets a fresh access token and users stay signed in. If
you rotate because the secret leaked, also revoke all refresh tokens in the
database so every session has to log in again.

## Backups and restore

Suggested nightly dump, as the `postgres` system user (peer auth, no password
on disk). Create `/etc/cron.d/trial-booking-backup`:

```cron
# m h dom mon dow user  command
15 3 * * * postgres pg_dump -Fc trial_booking > /var/backups/trial-booking/trial_booking-$(date +\%F).dump && find /var/backups/trial-booking -name '*.dump' -mtime +14 -delete
```

```sh
sudo install -d -m 700 -o postgres -g postgres /var/backups/trial-booking
```

Copy the dumps off the server too (object storage, another host); a backup on
the same disk does not survive losing the disk.

Restore into a scratch database first, check it, then swap:

```sh
sudo -iu deploy pm2 stop trial-booking-api trial-booking-worker

sudo -u postgres createdb -O trial_booking_app trial_booking_restore
sudo -u postgres pg_restore --no-owner --role=trial_booking_app \
  -d trial_booking_restore /var/backups/trial-booking/trial_booking-YYYY-MM-DD.dump

sudo -u postgres psql -c 'ALTER DATABASE trial_booking RENAME TO trial_booking_broken'
sudo -u postgres psql -c 'ALTER DATABASE trial_booking_restore RENAME TO trial_booking'
sudo -u postgres psql -c 'REVOKE ALL ON DATABASE trial_booking FROM PUBLIC'

sudo -iu deploy bash -c 'cd "$DEPLOY_PATH" && NODE_ENV=production npm run migrate -w @trial-booking/api'
sudo -iu deploy pm2 start trial-booking-api trial-booking-worker
curl -sf http://127.0.0.1:4001/health/ready
```

The migrate step brings an older dump up to the current schema.
Drop `trial_booking_broken` once you are satisfied.

## Changing the server

- **nginx or TLS:** edit the files in `.deploy/`, copy the folder to the server
  again and re-run `vps-setup.sh`.
- **Node major:** change `NODE_MAJOR` and re-run `vps-setup.sh`; it installs the
  new version and rewrites the PM2 boot unit, which holds the Node path.
- **Scaling:** every process runs as one fork-mode instance. Raising
  `instances` needs a review of in-process state first (see the comment in
  `ecosystem.config.cjs`).
