# Astro — self-hosted installation

This bundle runs Astro on your own server with Docker Compose. It pulls the
Astro images from the registry you were given access to. No application
source code is included.

## Requirements

- Linux server, Docker Engine 24+ with the Compose plugin, 4 vCPU / 8 GB RAM minimum
- Two DNS names pointing at the server (application and file storage), ports 80/443 open
- An SMTP account for e-mail notifications
- Your registry credentials and license key (provided by Astro)

## Install

```bash
cd deploy/self-hosted
cp .env.example .env          # fill in every empty value — secrets: openssl rand -hex 32
docker login registry.astro.app
docker compose up -d          # migrations run first, then the application starts
docker compose run --rm api node dist/cli.js setup \
  --org "Your company" --email admin@your-company.com --first-name Ada --last-name Admin
# the admin password is asked through --password or SETUP_ADMIN_PASSWORD (≥ 10 characters)
```

Sign in at `https://<APP_DOMAIN>` with that account, open **Administration →
Licence** and paste the license key (or set `ASTRO_LICENSE_KEY` in `.env`).
Until a license is installed the application is read-only.

If your license must be bound to this server, send Astro the **installation
ID** shown on the same page (or `docker compose run --rm api node dist/cli.js instance-id`).

## License lifecycle

- 30 days before expiry, administrators see a banner and receive notifications.
- After the expiry date, everything keeps working during the grace period stated in the license.
- After the grace period the application becomes **read-only**. Consultation and
  exports remain available. Install the renewed license to resume.
- A renewal can be installed in advance. It takes over on its start date.
- Accounts are counted across the whole installation. Inviting beyond the
  licensed number is refused.
- Do not move the server clock backwards: an inconsistent clock makes the
  application read-only until the license is installed again.

## Operations

| Task | Command |
|---|---|
| Upgrade | set `ASTRO_VERSION` in `.env`, then `docker compose pull && docker compose up -d` |
| License status | `docker compose run --rm api node dist/cli.js license status` |
| Install a license file | `docker compose run --rm -v "$PWD/license.lic:/license.lic:ro" api node dist/cli.js license install /license.lic` |
| Logs | `docker compose logs -f api worker` |
| Backups | nightly encrypted database dump + file mirror in `./backups` (service `backup`; keep `BACKUP_ENCRYPTION_PASSPHRASE` outside the server). Restore drill: `docker compose exec backup restore.sh verify <dump>`; `apply <dump>` replaces the live database (stop `api` and `worker` first). |

Never change `APP_ENCRYPTION_KEY` after the first start: two-factor secrets and
the license clock are sealed with it.
