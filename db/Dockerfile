# Runs db/migrate.sh against whatever Postgres PGHOST/PGUSER/PGPASSWORD/
# PGDATABASE point to. Used as a one-off migration runner on platforms
# (like Render) where a deployed service has real network egress, as
# opposed to environments that only permit HTTPS-proxied traffic.
FROM postgres:16
COPY . /db
WORKDIR /db
ENTRYPOINT ["/db/migrate.sh"]
