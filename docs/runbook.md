# Runbook — Ausfälle erkennen, einordnen, beheben

Jede Alarm-Nachricht enthält bereits die wichtigste Sofortmaßnahme. Dieses
Dokument ist die Langform: Was bedeutet welcher Ausfall, was geht remote,
was nur vor Ort — und wie das System sich selbst heilt.

## Grundprinzip

Bei einem Router-/WLAN-Ausfall gibt es **keinen** Remote-Weg — der
Rückkanal stirbt mit. Deshalb ist die Architektur auf Selbstheilung
ausgelegt; Remote-Eingriffe sind nur für die Cloud-Komponenten möglich.

| Komponente | Selbstheilung | Remote möglich | Vor Ort |
|---|---|---|---|
| Shelly 3EM | rejoint WLAN selbst | Shelly-Cloud-App: Neustart | Sicherung aus/ein |
| Pico-Bridge | WLAN-Reconnect + Auto-Reboot (seit `0dc0161`) | — | USB aus/ein am Router |
| B2500 (Speicher) | rejoint **meist** selbst; hängt nach Tiefentladung | — | Marstek-App in Gerätenähe öffnen (**Bluetooth weckt es**) |
| Router | Watchdog-Plug (optional, `apps/shelly-script/router-watchdog.js`) | — | Neustart |
| Oracle-VM (MQTT/Forwarder) | Docker `--restart unless-stopped` | SSH: `docker restart b2500-stack` | — |
| Vercel / Supabase | Managed | Dashboard der Anbieter | — |

## Incident-Historie & gelernte Muster

**Juli 2026 (18.–25.07.): Router-Degradation.** WLAN-Clients fielen
gestaffelt aus, 7 Tage Datenlücke. Konsequenzen: Pico-Reconnect-Patch,
B2500-Datenfluss als eigene Überwachung, Router-Watchdog-Script.

**August 2026 (08.–10.08.): B2500-Kommunikationsmodul hing nach
Tiefentladung.** Bei SOC 1 % trennte das Gerät seine MQTT-Verbindung und
kam nicht zurück, obwohl es intern weiter lud (SOC 86 % bei Rückkehr).
hm2mqtt pollte durchgehend vergeblich; die Regelung (Nulleinspeisung) lief
in der Zeit nicht. Geweckt wurde es erst durch Öffnen der Marstek-App in
Gerätenähe — Bluetooth, nicht MQTT. **Prävention: In der Marstek-App die
minimale Entladetiefe auf ≥ 10 % stellen** — dann erreicht das Gerät den
kritischen Zustand gar nicht erst.

## Benachrichtigungskanäle

1. **ntfy-Push** (Topic `b2500-mon-…`): Sofort-Kanal. Achtung: Die
   APNs-Zustellung der iOS-App ist unzuverlässig (Nachrichten erreichen
   ntfy.sh, erscheinen aber nicht als Banner). Nach App-Reinstall testen:
   `curl -d test -H "Priority: high" https://ntfy.sh/<topic>`
2. **E-Mail** (zuverlässig): In den Dashboard-Einstellungen (Tarif-Sheet)
   „Alarm-E-Mail" setzen UND `RESEND_API_KEY` in der Vercel-Env hinterlegen
   (resend.com, Free-Tier, kein eigenes Absender-Domain-Setup nötig).
   ntfys eigenes E-Mail-Gateway ist für anonyme Nutzung abgeschaltet.
   Beide Kanäle werden pro Alarm unabhängig versucht — ein kaputter Kanal
   reißt den anderen nicht mit.

**Kanal-Test jederzeit:**
`GET /api/health-check?test=push` bzw. `?test=email` — sendet eine
Testnachricht auf genau diesem Kanal und meldet das Ergebnis, ohne den
Alarm-Status anzufassen.

## Alarm-Auslösung (zwei unabhängige Wege)

- Oracle-VM-Crontab: alle 5 min `GET /api/health-check`
- GitHub Actions (`.github/workflows/health-cron.yml`): alle 10 min —
  unabhängige Failure-Domain, falls die Oracle-VM selbst ausfällt.

Schwellen: Shelly/Pico warn 8 min / down 20 min · Forwarder 5/15 min ·
B2500-Daten 10/30 min. Alarme nur bei Statuswechsel (kein Spam), inklusive
„wieder online".
