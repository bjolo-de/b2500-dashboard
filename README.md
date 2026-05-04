# b2500-dashboard

A small, self-hostable energy dashboard for a balcony-PV setup with a
Marstek B2500 storage system and a Shelly 3EM Gen3 smart meter.

Companion to [b2500-pico-bridge](https://github.com/bjolo-de/b2500-pico-bridge),
which handles the live B2500 ↔ Shelly meter relay. This repo is the
monitoring layer on top.

## What it shows

- **Top KPIs**: current PV production, current battery SOC, money saved today
- **Today chart**: PV / grid balance / SOC over the day, exact step-lines (no
  spline smoothing — the line follows the measurement)
- **SOC trend**: per-day min/max bands for week and month views
- **System status**: passive heartbeat banner if any component goes silent
- **Push alerts**: ntfy.sh notification when a component drops offline

Mobile-first PWA, add-to-homescreen on iOS.

## Architecture

```
B2500 ──MQTT──→ HiveMQ Cloud ──→ fly.io stack ──→ Supabase
                                  (Hame-Relay,    (Postgres)
                                   hm2mqtt,           │
                                   Forwarder)         ▼
Shelly 3EM ──HTTP/script──────────────────────→ Vercel (Next.js PWA)
                                                      │
Pico Bridge ──heartbeat────────────────────────→      ▼
                                                  iPhone
```

The Marstek app keeps working: Hame-Relay forwards the local MQTT topics
back to the Hame cloud, so the official mobile app sees the device exactly
as before.

See [docs/architecture.md](docs/architecture.md) for the long version and
[docs/setup.md](docs/setup.md) for end-to-end setup.

## Repository layout

```
apps/
  web/             Next.js dashboard (deployed to Vercel)
  shelly-script/   JS script that runs on the Shelly 3EM Gen3
  cloud-stack/     Docker stack (Hame-Relay + hm2mqtt + Forwarder) on fly.io
packages/
  db/migrations/   SQL run against the Supabase Postgres
docs/
  setup.md         Step-by-step setup, including hmjs B2500 reconfig
  architecture.md  Why the components look the way they do
```

## License

MIT
