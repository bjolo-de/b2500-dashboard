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

## Benachrichtigung: E-Mail (via Resend)

Einziger Kanal. ntfy wurde entfernt — seine iOS-Push-Zustellung war über
zwei Monate und mehrere Anläufe nicht zum Laufen zu bringen (Nachrichten
erreichten ntfy.sh, erschienen aber nie als Banner). E-Mail stellt
zuverlässig als Mail-Banner zu.

Einrichtung:
1. `RESEND_API_KEY` in der Vercel-Env setzen (resend.com, Free-Tier,
   Absender `onboarding@resend.dev`, kein eigenes Domain-Setup nötig).
2. Im Dashboard (Tarif-Sheet) „Alarm-E-Mail" eintragen.

Was löst eine Mail aus: nur **down** (Komponente offline) und **Wiederkehr**
aus down. Die `warn`-Stufe (kurze Verzögerung) bleibt bewusst still — sonst
flackern kurze WLAN-Hänger mehrmals täglich in die Inbox; im Dashboard ist
`warn` weiterhin sichtbar.

**Kanal-Test jederzeit:**
`GET /api/health-check?test=email` — sendet eine Testmail und meldet das
Ergebnis, ohne den Alarm-Status anzufassen.

**Zweiter, unabhängiger Push-Kanal (offen):** Für Redundanz gegen einen
E-Mail-/Resend-Ausfall ist ein Push-Dienst vorgesehen, der auf iOS
zuverlässig zustellt (Pushover empfohlen, Telegram als Gratis-Alternative).
Andockpunkt: `notify()` in `app/api/health-check/route.ts`.

## Alarm-Auslösung (zwei unabhängige Wege)

- Oracle-VM-Crontab: alle 5 min `GET /api/health-check`
- GitHub Actions (`.github/workflows/health-cron.yml`): alle 10 min —
  unabhängige Failure-Domain, falls die Oracle-VM selbst ausfällt.

Schwellen: Shelly/Pico warn 8 min / down 20 min · Forwarder 5/15 min ·
B2500-Daten 10/30 min. Alarme nur bei Statuswechsel (kein Spam), inklusive
„wieder online".
