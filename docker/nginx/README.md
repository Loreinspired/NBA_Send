# Nginx + Let's Encrypt (Option B only)

Used only for the VPS deployment path (`docker-compose.prod.yml`). Render/Railway
(Option A) terminate TLS themselves — none of this applies there.

`nginx.conf.template` is rendered by the official `nginx:alpine` image's
built-in `envsubst` entrypoint on container start, substituting `$N8N_HOST`
and `$ADMIN_GUI_HOST` from the `nginx` service's environment (set in
`docker-compose.prod.yml`, sourced from your `.env`).

## First-time certificate issuance (chicken-and-egg)

Nginx needs a certificate to serve HTTPS, but Certbot needs Nginx running on
port 80 to complete the HTTP-01 challenge. Bootstrap order:

1. Comment out (or temporarily delete) the two `listen 443 ssl` server
   blocks in `nginx.conf.template`, keeping only the port 80 block with the
   `/.well-known/acme-challenge/` location.
2. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx`
3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot`
4. Restore the `listen 443 ssl` blocks.
5. `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate nginx`

## Renewal

Certificates expire after 90 days. Add a host crontab entry (not a compose
service, since it only needs to run periodically, not stay up):

```
0 3 * * 1 cd /path/to/nba_send && docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm certbot renew && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec nginx nginx -s reload
```
