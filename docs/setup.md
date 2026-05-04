# Setup guide

End-to-end walkthrough — from zero to a live dashboard with push
notifications. Written for someone cloning this repo fresh.

---

## What you're building

```
B2500 ─MQTT─→ Oracle Cloud VM (Mosquitto + Hame-Relay + hm2mqtt + Forwarder)
                      ↓ HTTP
Shelly 3EM ─script──→ Supabase Postgres ←─ Pico-Bridge heartbeat
                      ↓ anon read
                Vercel (Next.js PWA) → iPhone
                      ↑ cron from Oracle VM (5 min)
                  /api/health-check → ntfy push on outage
```

Total time: ~2–3 hours. Most of it is account creation and waiting for
Oracle's tenancy provisioning. Hands-on coding/configuration is ~45 min.

## Prerequisites

- Working [b2500-pico-bridge](https://github.com/bjolo-de/b2500-pico-bridge)
  (Marstek B2500 ↔ Shelly 3EM Gen3 via Pico — separate repo, set that up first)
- Bluetooth-capable computer running Chrome/Edge (one-time, for B2500 reconfig)
- Mac/Linux with `ssh`, `gh` (GitHub CLI), `python3`, `mpremote` (for Pico)
- Credit card for Oracle Cloud identity verification (no charges in Always-Free)

---

## Sprint 0 — Accounts (~45 min)

Five accounts, no costs. Order matters: Supabase first (rest reference it).

### 0.1 Supabase

1. Sign up at <https://supabase.com>
2. New project, region `eu-central-1` (Frankfurt). Strong DB password → password manager.
3. Project Settings → API → copy three values:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_KEY` (keep secret!)
4. SQL Editor → run [`packages/db/migrations/0001_init.sql`](../packages/db/migrations/0001_init.sql) and [`0002_alert_state.sql`](../packages/db/migrations/0002_alert_state.sql)

### 0.2 Oracle Cloud Always-Free

1. Sign up at <https://signup.cloud.oracle.com>
2. **Home Region: Germany Central (Frankfurt)** during signup. *Permanent — you can't change later.*
3. Provide credit card for ID verification (Oracle places ~1€ auth hold that drops in 5 days, no charges in Always-Free).
4. Wait for tenancy provisioning (5–60 min).
5. Sign in to <https://cloud.oracle.com>.

### 0.3 Vercel

Sign up with your GitHub account at <https://vercel.com>. Connect GitHub if not auto-linked.

### 0.4 ntfy.sh

No account needed. Install **ntfy** on iOS, generate a random topic name (`openssl rand -hex 6` works), subscribe in the app. Note this topic — it goes into the database in Sprint 4.

### 0.5 Marstek-App-Credentials

You'll need the email + password you registered the B2500 with. Hame-Relay uses these to connect to the Hame cloud broker.

---

## Sprint 1 — Oracle VM + MQTT stack (~45 min)

### 1.1 Create the VM (≈10 min, Oracle Console)

1. Top-left menu → **Compute → Instances** → **Create instance**
2. **Name**: `b2500-stack`
3. **Image**: edit → **Canonical Ubuntu 22.04**
4. **Shape**: edit → either:
   - **Ampere A1.Flex** (1 OCPU, 6 GB) — preferred, more RAM
   - **VM.Standard.E2.1.Micro** (1 OCPU, 1 GB AMD) — fallback if A1 capacity unavailable
5. **Networking**:
   - VCN: pick **Create new virtual cloud network**
   - Subnet: **Create new public subnet**
   - **Public IPv4: Assign** (toggle ON; if greyed out during creation, do it after — Compute → Instance → VNIC → Edit IP → Public IP type: Ephemeral)
6. **SSH keys**: **Generate a key pair for me** → Download both private + public key files.
   `chmod 600 <private-key>` and move to `~/.ssh/oracle-b2500.key` (or similar) so you don't lose them.
7. **Create**. Wait until status = RUNNING (~1 min).
8. From the instance page, copy the **Public IPv4** — call it `ORACLE_IP`.

### 1.2 Open MQTT port 1883 in Oracle's cloud firewall

1. Instance page → click the **Subnet** name under "Primary VNIC".
2. Click the **Default Security List**.
3. **Add Ingress Rules**:
   - Stateless: off
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: TCP
   - Source Port Range: blank
   - Destination Port Range: **1883**
   - Description: `Mosquitto MQTT`

### 1.3 Provision the VM (≈10 min, SSH)

```sh
ssh -i ~/.ssh/oracle-b2500.key ubuntu@<ORACLE_IP>
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io git iptables-persistent cron
sudo systemctl enable cron --now
sudo usermod -aG docker $USER
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 1883 -j ACCEPT
sudo netfilter-persistent save
exit
```

> Why `iptables -I` *and* the cloud security list: Ubuntu's local firewall blocks
> non-SSH inbound by default. Both layers must allow port 1883.

Reconnect (so docker group membership applies):

```sh
ssh -i ~/.ssh/oracle-b2500.key ubuntu@<ORACLE_IP>
docker --version    # confirm docker works
```

### 1.4 Clone repo + write env file (≈5 min, on the VM)

```sh
git clone https://github.com/bjolo-de/b2500-dashboard.git
cd b2500-dashboard/apps/cloud-stack

DEVICE_PW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
STACK_PW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
echo "Device password (note for hmjs step 1.6): $DEVICE_PW"

umask 077
cat > .env <<EOF
MQTT_DEVICE_PASSWORD=$DEVICE_PW
MQTT_STACK_PASSWORD=$STACK_PW
HAME_USERNAME=<your-marstek-app-email>
HAME_PASSWORD=<your-marstek-app-password>
MARSTEK_DEVICE_MAC=<from-hmjs-step-1.6>
MARSTEK_DEVICE_TYPE=HMJ-2
MARSTEK_DEVICE_ID=<from-hmjs-step-1.6>
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_KEY=<your-service-role-key>
EOF
```

The MAC and Device-ID come from hmjs in step 1.6 — you can leave them placeholder for now and update before deploy.

### 1.5 Build + run the stack

```sh
sudo docker build -t b2500-stack .
sudo docker run -d --name b2500-stack \
  --restart unless-stopped \
  -p 1883:1883 \
  --env-file .env \
  b2500-stack
sudo docker logs -f b2500-stack
```

Wait until the logs show:
- `mosquitto STDOUT  Opening ipv4 listen socket on port 1883`
- `[hame-2025] Connected to remote broker`
- `[mqtt] connected, subscribing to hm2mqtt/+/device/+/data`

### 1.6 B2500 reconfig via hmjs (≈10 min, on Bluetooth device)

> Web Bluetooth requires Chrome/Edge on macOS, Windows, or Android. Safari/iOS doesn't work.

1. Close the Marstek app fully on iPhone.
2. In Chrome on a BT-capable device: <https://tomquist.github.io/hmjs/>
3. **Pair device** → pick the B2500.
4. Read off:
   - **Device MAC** (12 hex, no colons)
   - **Device ID** (24 hex)
   Update the `.env` on the VM with these values, then `sudo docker restart b2500-stack`.
5. Set MQTT settings in hmjs:

   | Field | Value |
   |---|---|
   | Broker | `<ORACLE_IP>` |
   | Port | `1883` |
   | **SSL/TLS** | **disabled** ← critical, B2500 firmware doesn't trust Let's Encrypt |
   | Username | `b2500-device` |
   | Password | `$DEVICE_PW` from 1.4 |

6. **Save**. Be quick — Web Bluetooth GATT drops after idle. If hmjs disconnects, the save likely went through anyway.

### 1.7 Verify

```sh
sudo docker logs b2500-stack 2>&1 | grep -E 'b2500-device|hame_energy' | tail -10
```

You should see:
- A connection from `b2500-device` to Mosquitto
- hm2mqtt logging `hame_energy/HMJ-2/...` topics

In Supabase → Table Editor → `marstek_readings` — rows growing every ~60s.

In the Marstek app: B2500 is **online again** within 1–2 min (Hame-Relay forwards local data back).

---

## Sprint 2 — Shelly Script (~10 min)

1. Open Shelly 3EM web UI (typically <http://shelly3em.local> or its IP)
2. **Scripts** → **Add** → name `supabase-ingest`
3. Paste [`apps/shelly-script/supabase-ingest.js`](../apps/shelly-script/supabase-ingest.js), fill in `SUPABASE_URL` and `SUPABASE_KEY` (service_role) at the top.
4. Save → **Run on startup: ON** → **Start**.

Console output: `[boot] sampling every 60s -> https://...`

Verify: Supabase → `shelly_readings` fills every 60s.

---

## Sprint 3 — Frontend on Vercel (~15 min)

1. **Vercel Dashboard** → Add New → Project → Import `bjolo-de/b2500-dashboard` (your fork).
2. **Configure Project**:
   - **Root Directory**: `apps/web` (critical — Next.js lives in subdir)
   - Framework Preset: Next.js (auto-detected)
3. **Environment Variables** (set scope = Production & Preview for all):
   - `NEXT_PUBLIC_SUPABASE_URL` → your Supabase URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → anon public key
   - `SUPABASE_SERVICE_KEY` → service_role key
4. **Deploy**. ~2 min. Note the deployment URL.

PWA icons + manifest are bundled. On iPhone: Safari → your URL → Share → **Add to Home Screen**.

---

## Sprint 4 — Pico Heartbeat (~10 min)

Adds a third heartbeat ("pico_bridge") so the dashboard's status row shows
all three components green when healthy.

The bridge code already supports this — it just needs config. Edit
`b2500-pico-bridge/src/config.py` to add:

```python
SUPABASE_HEARTBEAT_URL = "https://your-project.supabase.co/rest/v1/system_heartbeat"
SUPABASE_KEY = "<service_role_key>"
```

Upload via mpremote (Pico connected via USB):

```sh
mpremote connect /dev/cu.usbmodem* reset
sleep 2
mpremote connect /dev/cu.usbmodem* cp config.py :config.py + cp main.py :main.py
mpremote connect /dev/cu.usbmodem* reset
```

Watch the boot logs:
```sh
mpremote connect /dev/cu.usbmodem* repl
```

Look for `NTP synced`. Disconnect REPL with `Ctrl+]`. After ~5 min, the dashboard's third status pill turns green.

Move the Pico back to the router USB port.

---

## Sprint 5 — Health-Check Cron (~5 min)

The dashboard exposes `/api/health-check` which checks heartbeat freshness
and sends ntfy push on state transitions. We trigger it every 5 min from
the Oracle VM (Vercel Hobby plan caps cron at daily; Oracle's free).

On the Oracle VM via SSH:

```sh
(echo "*/5 * * * * curl -fsS -m 20 https://<your-vercel-url>/api/health-check >/dev/null 2>&1") | crontab -
crontab -l    # verify
```

Set the ntfy topic in Supabase → Table Editor → `user_settings` → row id=1:
- `ntfy_topic` = your topic from Sprint 0.4

Test:

```sh
curl -X POST "https://ntfy.sh/<your-topic>" \
  -H "Title: B2500 Energy" -H "Priority: low" \
  -d "Test push from setup"
```

You should get a notification on iPhone.

---

## Update / redeploy

**Cloud stack** (when this repo gets new commits affecting `apps/cloud-stack`):

```sh
ssh -i ~/.ssh/oracle-b2500.key ubuntu@<ORACLE_IP>
cd b2500-dashboard && git pull
cd apps/cloud-stack
sudo docker build -t b2500-stack .
sudo docker stop b2500-stack && sudo docker rm b2500-stack
sudo docker run -d --name b2500-stack --restart unless-stopped \
  -p 1883:1883 --env-file .env b2500-stack
```

Downtime: ~10s.

**Frontend**: Vercel auto-deploys on every push to `main`.

**Schema migrations**: open Supabase SQL Editor → paste new migration from `packages/db/migrations/`.

---

## Rollback / decommission

To revert the B2500 to the Hame cloud and shut everything down:

1. Reconnect via [hmjs](https://tomquist.github.io/hmjs/), set broker to
   `mqtt.iot.hamedata.com`, port 1883, SSL off, leave username/password empty.
2. `sudo docker stop b2500-stack && sudo docker rm b2500-stack` on Oracle VM.
   Optionally terminate the VM in the Oracle console.
3. Delete the Vercel project.
4. Delete the Supabase project.

The Marstek app keeps working throughout. The Pico bridge is unaffected
(it'll just stop reporting heartbeats — set `SUPABASE_HEARTBEAT_URL = ""`
in `config.py` if you want a clean state).
