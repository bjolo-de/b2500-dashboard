# b2500-dashboard

A small, self-hostable energy dashboard for a balcony-PV setup with a
**Marstek B2500** storage system and a **Shelly 3EM Gen3** smart meter.

Companion to [b2500-pico-bridge](https://github.com/bjolo-de/b2500-pico-bridge)
— that one handles the live B2500 ↔ Shelly relay; this one is the
monitoring layer on top.

## What it shows

- **Live energy flow** — animated diagram with PV, battery, home, grid;
  each path's watt-flow labelled, dots flow in the direction of energy.
  Tap any arrow for an explanation.
- **Period KPIs** (Heute / Woche / Monat): PV produced, consumption,
  Eigenverbrauchsquote, Autarkiegrad, grid import/export, savings — with
  formula tooltips so you can hand the dashboard to a non-technical friend.
- **Today chart** — PV, grid balance, SOC on a single time axis; linear
  lines (anti-spline) so the visual follows the measurement exactly.
- **System health** — three pills, one per component (Shelly, Marstek-MQTT,
  Pico-Bridge); plain-language hints if a heartbeat goes stale.
- **Push alerts** via ntfy.sh on offline transitions.
- **Editable tariff** — click the footer to adjust energy price, base
  fee, feed-in rate. Used live in the savings calculation.
- **Mobile-first PWA**, add-to-homescreen on iOS — opens fullscreen,
  status bar tinted to theme.

## Architecture

```
B2500 ──MQTT (plain :1883)──→ Oracle Cloud Always-Free VM
                              ├─ Mosquitto (broker)
                              ├─ Hame-Relay   ↔ Hame Cloud (keeps Marstek app alive)
                              ├─ hm2mqtt      (parses B2500 telemetry)
                              └─ Forwarder    → Supabase
                              ↑
                              cron */5 min curls /api/health-check on Vercel
                              └→ ntfy.sh push on outage
Shelly 3EM Gen3 ──Shelly script──→ Supabase
Pico Bridge ──heartbeat──────────→ Supabase

Supabase (Postgres + RLS, anon read-only)
   ↓
Vercel (Next.js 15 PWA) → iPhone
```

Why these choices specifically: see [docs/architecture.md](docs/architecture.md).

## Repository layout

```
apps/
  web/                Next.js dashboard (Vercel)
  shelly-script/      Single-file Shelly Script
  cloud-stack/        Single Docker image bundling Mosquitto + Hame-Relay
                      + hm2mqtt + Forwarder via supervisord (Oracle VM)
packages/
  db/migrations/      Supabase SQL migrations
docs/
  setup.md            End-to-end setup walkthrough
  architecture.md     Decision records — why this shape, what's not solved
```

## Setup

See [docs/setup.md](docs/setup.md) for the full walkthrough. Estimated
time: ~2–3 h, mostly waiting for Oracle Cloud to provision.

## Costs

0 €/year:
- Supabase free tier
- Oracle Cloud Always-Free (Ampere or AMD micro VM, free public IPv4)
- Vercel Hobby
- ntfy.sh public

The only required spend is hardware you already have (Marstek B2500,
Shelly 3EM Gen3, Pico W). No additional sensors or gateways needed.

## License

MIT
