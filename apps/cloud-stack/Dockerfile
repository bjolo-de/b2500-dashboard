# Single-image bundle running:
#   - Mosquitto         (port 1883, plain MQTT for B2500)
#   - Hame-Relay        (mode 1: bridges localhost broker ↔ Hame Cloud)
#   - hm2mqtt           (subscribes raw B2500 topics, publishes parsed JSON)
#   - Forwarder         (subscribes parsed JSON, posts to Supabase)
#
# Co-locating these on one VM lets B2500 reach a plain MQTT endpoint while
# the Marstek/Hame cloud bridge and parsers talk over loopback only.
# Trade-off: B2500↔broker is unencrypted on the public internet. Risk
# acceptable: data is non-sensitive operational telemetry, broker creds
# can be rotated in seconds.

# Pull upstream artefacts so we don't bake build infra into the final image.
FROM ghcr.io/tomquist/hame-relay:latest AS hame-relay-src
FROM ghcr.io/tomquist/hm2mqtt:latest AS hm2mqtt-src

FROM node:20-alpine

# Mosquitto + supervisord (alpine-native, ~5 MB extra)
RUN apk add --no-cache mosquitto mosquitto-clients supervisor curl

# Bring in upstream apps
COPY --from=hame-relay-src /app /opt/hame-relay
COPY --from=hm2mqtt-src    /app /opt/hm2mqtt

# Forwarder (built locally)
COPY forwarder /opt/forwarder
WORKDIR /opt/forwarder
RUN npm install --omit=dev --no-audit --no-fund

# Configs and entrypoint
WORKDIR /
COPY mosquitto.conf  /etc/mosquitto/mosquitto.conf
COPY supervisord.conf /etc/supervisord.conf
COPY entrypoint.sh    /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Mosquitto runtime dirs (alpine's mosquitto package doesn't auto-create them)
RUN mkdir -p /var/lib/mosquitto /var/log/mosquitto /etc/mosquitto/conf.d /run/mosquitto && \
    addgroup -S mosquitto 2>/dev/null || true && \
    adduser -S -G mosquitto mosquitto 2>/dev/null || true && \
    chown -R mosquitto:mosquitto /var/lib/mosquitto /var/log/mosquitto /run/mosquitto

# Plain MQTT for B2500
EXPOSE 1883

CMD ["/entrypoint.sh"]
