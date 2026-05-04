# Architecture

## Why this shape

The Pico bridge is a stateless, single-purpose UDP relay. It must not
become a data store or grow new dependencies — its job is to keep the
B2500 talking to its meter, full stop. So all monitoring is built
*around* the Pico, not on top of it.

The B2500 has no documented local API on firmware V110 — only Bluetooth
(config) and MQTT (telemetry). MQTT is therefore the only viable
streaming-data path.

The official Marstek app must keep working as a redundant view onto the
device. That rules out any change that breaks the device's cloud
connection. Hame-Relay solves this by bridging your local broker back
to the Hame cloud — the app sees the same telemetry, just travelling
the long way round.

## Why self-hosted Mosquitto, not HiveMQ Cloud

The original plan was to use HiveMQ Cloud's free tier as the MQTT broker.
This turns out to be unworkable for B2500:

- B2500 firmware (V110.x, HMJ-2) has a limited TLS trust store. It does
  not include the Let's Encrypt root CA (ISRG Root X1) that HiveMQ Cloud
  uses. TLS handshake fails silently — the device "saves" the config
  but never actually connects. Reading the config back via hmjs returns
  empty fields.
- Tomquist (maintainer of hm2mqtt and hame-relay) explicitly recommends
  *"disable the SSL checkbox"* for B2500 in
  [hm2mqtt#226](https://github.com/tomquist/hm2mqtt/issues/226).
- The entire hm2mqtt/hame-relay community runs B2500 against plain
  Mosquitto, never against cloud TLS brokers. Working production setup
  with the same hardware (HMJ-2, FW 110.9) confirmed in that issue.

We therefore self-host Mosquitto on Oracle Cloud with plain MQTT (port 1883)
and username/password auth.

**Trade-off accepted:** B2500↔broker traffic is unencrypted on the public
internet. The data is operational telemetry (PV power, SOC, charge
power) — not identifying or sensitive. Auth credentials are sent in
clear during MQTT CONNECT; mitigated by using a strong random password
that can be rotated in seconds.

## Data flow

```
                       B2500-D (HMJ-2)
                        │       │
        ┌───────────────┘       └────────┐
        │ UDP                            │ MQTT/plain (1883)
        │ EM.GetStatus                   │ over public internet
        ▼                                ▼
   Pico Bridge                  ┌─────────────────────────┐
        │                       │   Oracle Cloud VM (single)    │
        │ HTTP                  │  ┌──────────┐           │
        ▼                       │  │ Mosquitto│ ←─────────┤  B2500 publishes here
   Shelly 3EM                   │  └────┬─────┘           │
        │                       │   localhost:1883        │
        │ HTTP POST             │     ├─────┬──────┐      │
        │ (Shelly Script)       │     ▼     ▼      ▼      │
        │                       │  Hame-  hm2mqtt Forwarder│
        │                       │  Relay                  │
        │                       └────┬─────┬─────┬────────┘
        │                            │     │     │
        │                            │     │     │ HTTP POST
        │           Hame Cloud ←─────┘     │     │
        │           (Marstek app)          │     ▼
        └──────────────┬───────────────────┘  Supabase
                       │ HTTP POST                │
                       ▼                          │ anon read
                  Supabase Postgres ──────────────┘
                       │
                       ▼
                  Vercel (Next.js PWA) → iPhone
```

## Component decisions

### Why one Docker container with supervisord, not split services

Multi-container would mean either multiple VMs (each with their own
public-IP exposure surface) or container-internal networking with
docker-compose. With everything in one supervisord-managed image:
- All consumers reach the broker via `127.0.0.1:1883` (no auth required
  across loopback, no cross-network ACL to maintain)
- Single log stream from `docker logs b2500-stack`
- Single rebuild, single restart
- Memory budget: ~30 MB per Node service + ~3 MB Mosquitto = ~95 MB,
  well under the 1 GB Oracle Always-Free Ampere A1 VM

### Why Recharts with linear lines

The Marstek app uses spline-smoothed lines, which visually misrepresent
sudden changes (e.g. PV-cloud transitions). Recharts with `type="linear"`
follows the measurements exactly. This is a deliberate UX differentiator,
not a default.

### Why `user_settings` lives in the DB, not in env vars

Tariff and feed-in rate change. The user must be able to edit them in the
deployed dashboard without redeploying. A single-row `user_settings`
table read by both client and server hits this. Default values match
the original install (0.2693 €/kWh arbeit, 8.41 €/Monat grund, 0 €/kWh
Einspeisung) but are editable in the Settings page.

## Reversibility

Every component is independently removable.

- **B2500 reconfig**: any Bluetooth client (hmjs again, or Marstek-app
  factory reset) restores the Hame cloud broker. The device's stored
  history is unaffected because it has none.
- **Oracle Cloud stack**: `docker stop b2500-stack` halts the data
  pipeline. The Marstek app then stops working *unless* the B2500 is
  also reconfigured back to Hame cloud. So always do these two together.
  To free the VM entirely: terminate the instance in the Oracle console.
- **Supabase**: deletable; nothing else depends on it durably.
- **Vercel**: unhook the project; nothing else depends on it.
- **Pico bridge**: untouched throughout.

## What is *not* solved

- **Brutto-Hausverbrauch** requires Marstek PV power AND Shelly net
  balance. Available once Marstek MQTT data flows.
- **Per-circuit consumption**: not visible from a single meter. Out of
  scope.
- **Hoymiles inverter telemetry**: optional later phase. Hoymiles sits
  downstream of the B2500, so its output ≈ B2500's output — redundant
  for the current dashboard.
