# Setup guide

End-to-end walkthrough, from zero to a live dashboard.

> Random ntfy topic for this install: **`b2500-mon-7g3kx9`**.
> Subscribe in the ntfy iOS app — that's the push channel for outages.

## Prerequisites

- Working [b2500-pico-bridge](https://github.com/bjolo-de/b2500-pico-bridge)
  setup (Marstek B2500 ↔ Shelly 3EM Gen3 via Pico)
- Bluetooth-capable computer running Chrome/Edge (one-time, for B2500 reconfig)
- Mac/Linux with `ssh`, `docker` (for image build), `python3`
- Credit card for Oracle Cloud identity verification (no charges in Always-Free)

---

## Sprint 0 — Accounts (≈45 min, you)

### 1. Supabase  ✅ done

Already provisioned this session.

### 2. Oracle Cloud Always-Free

This is where the MQTT stack will live. Always-free, forever, public IPv4 included.

1. Sign up at <https://signup.cloud.oracle.com/>
2. Choose **Home Region: Germany Central (Frankfurt)** during signup. **This
   cannot be changed later** — the home region is where your free resources
   live. Frankfurt = best latency for B2500 (also Frankfurt → German servers).
3. Provide credit card for ID verification. Oracle places a temporary auth
   hold (~1 €) that drops within 5 days. No charges in Always-Free.
4. After signup, Oracle sends activation emails. Wait until your tenancy
   is fully provisioned (5–15 min, sometimes up to 1 h on bad days).
5. Sign in to <https://cloud.oracle.com>.

### 3. Vercel  ✅ done

Already signed up. We'll create the project in Sprint 4.

### 4. ntfy.sh  ✅ done

Already subscribed.

---

## Sprint 1 — Oracle VM + stack deployment (≈45 min, together)

### 1.1 Create a VM (≈10 min, you, in Oracle Console)

In the Oracle Cloud Console:

1. Top-left menu → **Compute → Instances** → **Create instance**
2. Settings:
   - **Name**: `b2500-stack`
   - **Image**: click **Edit**, change to **Canonical Ubuntu 22.04** (Always-Free-Eligible)
   - **Shape**: click **Edit** → **Change shape** → **Ampere**
     - Series: VM.Standard.A1.Flex
     - **OCPUs: 1**, **Memory: 6 GB** (still in Always-Free; this is the
       "preferred" config that maximises capacity within the free tier)
   - **Networking**:
     - VCN: leave the auto-created one (`vcn-…`)
     - Subnet: public subnet (default)
     - **Public IPv4 address**: ensure **Assign a public IPv4 address** is ON
   - **SSH keys**: click **Generate a key pair for me**, then **Save private
     key** — store it safely. This is your VM access key.
3. Click **Create**
4. Wait until status = **RUNNING** (~1 min)
5. Click the instance, copy the **Public IPv4 address** — let's call it `ORACLE_IP`

#### Capacity gotcha

If creation fails with **"Out of capacity for shape VM.Standard.A1.Flex"**:
- Wait 10–60 min, retry — Frankfurt usually clears within an hour
- Or switch to **VM.Standard.E2.1.Micro** (AMD, 1 OCPU 1 GB, also
  Always-Free, separate capacity pool — 99% available)

### 1.2 Open MQTT port 1883 (≈3 min, you, in Oracle Console)

By default Oracle's VCN security list blocks all inbound except SSH.
We need to allow port 1883 for B2500 publishes.

1. From the instance page, click the **Subnet** name under "Primary VNIC"
2. Click the **Security List** name
3. **Add Ingress Rule**:
   - Stateless: **off**
   - Source: `0.0.0.0/0` (anywhere — required because B2500 connects from
     your home WAN; the auth on Mosquitto protects access)
   - IP Protocol: **TCP**
   - Source Port Range: leave blank
   - **Destination Port Range: 1883**
   - Description: `Mosquitto MQTT (B2500)`
4. Save

### 1.3 First SSH login (≈5 min, you, in your terminal)

```sh
chmod 600 ~/Downloads/<oracle-key-filename>.key
ssh -i ~/Downloads/<oracle-key-filename>.key ubuntu@<ORACLE_IP>
```

Once logged in:

```sh
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 1883 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo apt install -y iptables-persistent
exit
```

Reconnect SSH (so docker group membership applies):

```sh
ssh -i ~/Downloads/<oracle-key-filename>.key ubuntu@<ORACLE_IP>
docker --version    # confirm docker works
```

> **About iptables**: Ubuntu on Oracle has internal iptables rules that block
> non-SSH inbound by default. The line above pokes a hole for 1883 in the
> *VM-local* firewall (Oracle's *cloud* firewall is the security list from 1.2).

### 1.4 Get the stack onto the VM (≈5 min, you, in SSH session)

The Docker image is built locally on the VM the first time, takes ~5 min.

```sh
git clone https://github.com/bjolo-de/b2500-dashboard.git
cd b2500-dashboard/apps/cloud-stack
```

> **Note:** if the GitHub repo isn't public yet, Claude will hand you a
> tarball of the `apps/cloud-stack` directory. `scp` it to the VM:
> `scp -i ~/Downloads/<key> apps/cloud-stack.tar.gz ubuntu@<ORACLE_IP>:`

### 1.5 Generate passwords + write env file

```sh
DEVICE_PW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
STACK_PW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)

cat > .env <<EOF
MQTT_DEVICE_PASSWORD=$DEVICE_PW
MQTT_STACK_PASSWORD=$STACK_PW
HAME_USERNAME=<your-marstek-app-email>
HAME_PASSWORD=<your-marstek-app-password>
MARSTEK_DEVICE_MAC=60323bd1473a
MARSTEK_DEVICE_TYPE=HMJ-2
MARSTEK_DEVICE_ID=3601115030374d3334023f54
SUPABASE_URL=https://rwbiwkhtegaybctdnufk.supabase.co
SUPABASE_SERVICE_KEY=<paste-real-service-role-key>
EOF
chmod 600 .env

echo "Device password (note for hmjs in 1.7): $DEVICE_PW"
```

### 1.6 Build + run

```sh
docker build -t b2500-stack .
docker run -d --name b2500-stack \
  --restart unless-stopped \
  -p 1883:1883 \
  --env-file .env \
  b2500-stack

docker logs -f b2500-stack
```

Watch the logs — you should see Mosquitto start, hame-relay connect to
Hame Cloud, hm2mqtt connect to localhost broker, and forwarder connect.
Ctrl+C ends the log tail; container keeps running.

### 1.7 hmjs reconfig (≈10 min, you, on a Bluetooth-capable computer)

Same as the original B2500 reconfig. Critical settings:

| Field | Value |
|---|---|
| Broker / Host | `<ORACLE_IP>` (from 1.1) |
| Port | `1883` |
| **SSL / TLS** | **disabled** |
| Username | `b2500-device` |
| Password | `$DEVICE_PW` from step 1.5 |
| Client-ID | leave blank |

After save, B2500 reconnects in ~30 s. Power-cycle the B2500 if it doesn't
appear in `docker logs` within 2 min.

### 1.8 Verify

```sh
docker logs b2500-stack 2>&1 | grep -i 'b2500-device\|connected\|hame_energy'
```

You should see Mosquitto log a new connection from `b2500-device`, then
hm2mqtt logging incoming `hame_energy/HMJ-2/...` topics.

In Supabase → **Table Editor → marstek_readings** — rows growing every ~60 s.

In the Marstek app: B2500 should be **online again** within 1–2 min
(Hame-Relay forwards local telemetry back to Hame cloud).

---

## Sprint 2 — Shelly Script (≈10 min, you)

1. Open Shelly 3EM web UI → **Scripts**
2. **Add** → name `supabase-ingest`
3. Paste contents of [`apps/shelly-script/supabase-ingest.js`](../apps/shelly-script/supabase-ingest.js)
4. Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` at the top
5. Save → **Enable on boot** → **Start**

Verify: Supabase → `shelly_readings` fills every ~60 s.

---

## Sprint 3+ — Frontend, PWA, Health, Pico-heartbeat

Built by Claude after the data flow is validated end-to-end.

---

## Update / redeploy procedure

When we push changes to the cloud-stack code:

```sh
ssh -i ~/.ssh/<oracle-key> ubuntu@<ORACLE_IP>
cd b2500-dashboard
git pull
cd apps/cloud-stack
docker build -t b2500-stack .
docker stop b2500-stack && docker rm b2500-stack
docker run -d --name b2500-stack --restart unless-stopped \
  -p 1883:1883 --env-file .env b2500-stack
```

Total downtime: ~10 s. Marstek app shows offline for that brief window only.

---

## Rollback

To revert the B2500 to the Hame cloud:
1. Reconnect via [hmjs](https://tomquist.github.io/hmjs/)
2. Set broker to `mqtt.iot.hamedata.com`, port 1883, SSL off, default creds
   (Hame uses anonymous defaults for own broker)
   — or wipe to your Sprint-1.7 rollback screenshot
3. On Oracle: `docker stop b2500-stack && docker rm b2500-stack` to free the VM
4. Optionally terminate the Oracle VM (Console → instance → Terminate)

The Marstek app continues working unchanged.
