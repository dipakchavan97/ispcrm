FROM freeradius/freeradius-server:3.2.3-alpine

USER root

# Install postgresql driver module for FreeRADIUS
RUN apk update && apk add --no-cache freeradius-postgresql postgresql-client || true

COPY raddb/clients.conf /etc/raddb/clients.conf
COPY raddb/mods-available/sql /etc/raddb/mods-available/sql
COPY raddb/sites-available/default /etc/raddb/sites-available/default
COPY raddb/queries.conf /etc/raddb/mods-config/sql/main/postgresql/queries.conf

# Ensure /usr/sbin/radiusd links to FreeRADIUS 3.2.3 and enable SQL module
RUN ln -sf /opt/sbin/radiusd /usr/sbin/radiusd && \
    ln -sf /etc/raddb/mods-available/sql /etc/raddb/mods-enabled/sql

EXPOSE 1812/udp 1813/udp 3799/udp

CMD ["freeradius", "-f", "-l", "stdout"]
