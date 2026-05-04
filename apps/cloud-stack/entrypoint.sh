#!/bin/sh
# Renders runtime configs from env vars, then hands off to supervisord.
#
# Required env (typically passed via `docker run --env-file .env`):
#   MQTT_DEVICE_PASSWORD       — password for the B2500's MQTT login
#   MQTT_STACK_PASSWORD        — password for hame-relay/hm2mqtt/forwarder
#   HAME_USERNAME              — Marstek-app email
#   HAME_PASSWORD              — Marstek-app password
#   MARSTEK_DEVICE_MAC         — from hmjs (12 hex chars, no colons)
#   MARSTEK_DEVICE_TYPE        — e.g. "HMJ-2"
#   MARSTEK_DEVICE_ID          — 24 hex chars from hmjs
#   SUPABASE_URL
#   SUPABASE_SERVICE_KEY

set -eu

require() {
  eval "v=\${$1:-}"
  if [ -z "$v" ]; then
    echo "[fatal] required env var $1 is not set"
    exit 1
  fi
}

for var in MQTT_DEVICE_PASSWORD MQTT_STACK_PASSWORD \
           HAME_USERNAME HAME_PASSWORD \
           MARSTEK_DEVICE_MAC MARSTEK_DEVICE_TYPE MARSTEK_DEVICE_ID \
           SUPABASE_URL SUPABASE_SERVICE_KEY; do
  require "$var"
done

# ─── Mosquitto password file ────────────────────────────────────────────────
echo "[entrypoint] generating mosquitto password file"
PASSWD_FILE=/run/mosquitto/passwords
: > "$PASSWD_FILE"
mosquitto_passwd -b "$PASSWD_FILE" b2500-device "$MQTT_DEVICE_PASSWORD"
mosquitto_passwd -b "$PASSWD_FILE" b2500-stack  "$MQTT_STACK_PASSWORD"
chown mosquitto:mosquitto "$PASSWD_FILE"
chmod 600 "$PASSWD_FILE"

# ─── Hame-Relay config ──────────────────────────────────────────────────────
echo "[entrypoint] generating hame-relay config"
mkdir -p /opt/hame-relay/config
cat > /opt/hame-relay/config/config.json <<EOF
{
  "broker_url": "mqtt://b2500-stack:${MQTT_STACK_PASSWORD}@127.0.0.1:1883",
  "username": "${HAME_USERNAME}",
  "password": "${HAME_PASSWORD}",
  "devices": [
    {
      "device_id": "${MARSTEK_DEVICE_ID}",
      "mac": "${MARSTEK_DEVICE_MAC}",
      "type": "${MARSTEK_DEVICE_TYPE}"
    }
  ]
}
EOF

# ─── hm2mqtt env ────────────────────────────────────────────────────────────
# hm2mqtt reads from env at runtime; supervisord will inherit our exports.
# Env-var names are MQTT_* per upstream src (verified via grep on dist/).
echo "[entrypoint] exporting hm2mqtt env"
export MQTT_BROKER_URL="mqtt://127.0.0.1:1883"
export MQTT_USERNAME="b2500-stack"
export MQTT_PASSWORD="${MQTT_STACK_PASSWORD}"
export DEVICE_0="${MARSTEK_DEVICE_TYPE}:${MARSTEK_DEVICE_MAC}"
export MQTT_TOPIC_PREFIX="hm2mqtt"
export MQTT_POLLING_INTERVAL="60"
export MQTT_RESPONSE_TIMEOUT="30"

# ─── Forwarder env ──────────────────────────────────────────────────────────
echo "[entrypoint] exporting forwarder env"
export MQTT_URL="mqtt://b2500-stack:${MQTT_STACK_PASSWORD}@127.0.0.1:1883"
export MQTT_TOPIC="hm2mqtt/+/device/+/data"
# SUPABASE_URL and SUPABASE_SERVICE_KEY are already in env

# Persist the exported env so supervisord's child processes see it.
# supervisord reads env from its own process at startup; we exec it,
# so all our exports propagate.

echo "[entrypoint] starting supervisord"
exec /usr/bin/supervisord -c /etc/supervisord.conf
