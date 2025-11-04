# Sistema di Comunicazione LoRa Bidirezionale con SCL3300
## Implementazione Embedded su STM32WLE5 (LoRa-E5 Mini) e Gateway RAK7268V2

## Abstract
Questo progetto realizza un sistema completo di comunicazione LoRaWAN bidirezionale tra una scheda LoRa-E5 Mini (STM32WLE5) e un gateway RAK7268V2. Il firmware, scritto in C con STM32CubeIDE, sostituisce integralmente il vecchio firmware AT e implementa: join OTAA autonomo, gestione uplink/downlink, acquisizione da sensore SCL3300 via SPI, calibrazione automatica, filtraggio EMA ottimizzato e pipeline di codifica/decodifica (binario → HEX → Base64). L’infrastruttura lato rete utilizza MQTT (Mosquitto) e una dashboard web per visualizzazione dati e comandi remoti. La soluzione è plug & play: una volta allineate le chiavi OTAA su gateway e firmware, la comunicazione si avvia senza ulteriori interventi.

---

## Caratteristiche
- Comunicazione LoRaWAN bidirezionale su banda EU868.
- Join OTAA già integrato nel firmware, con gestione autonoma dello stato di rete.
- Firmware custom in C (STM32CubeIDE) senza dipendenza da comandi AT.
- Driver proprietario per sensore Murata SCL3300 via SPI, con verifica WHOAMI.
- Calibrazione automatica iniziale (100 campioni) e filtro EMA sui tre assi.
- Pipeline dati: acquisizione → filtraggio → impacchettamento 16 byte → HEX → Base64.
- Dashboard web con grafico in tempo reale, log eventi e comandi remoti (es. calibrazione).
- Integrazione MQTT (Mosquitto) per telemetria e controllo.
- PCB personalizzato con LoRa-E5 + SCL3300 (circa 40 mm × 20 mm).

---

## Architettura di Sistema

[ SCL3300 (SPI) ]
│
▼
[ LoRa-E5 Mini - STM32WLE5 ]
• Firmware C
• Driver SCL3300
• EMA
• LoRaWAN (OTAA)
│ LoRa EU868
▼
[ Gateway RAK7268V2 ]
• Application (OTAA)
• Forwarder MQTT
│ Ethernet/Wi-Fi
▼
[ Broker MQTT (Mosquitto) ]
│
▼
[ Web Dashboard ]


---

## Requisiti Tecnici

### Hardware
- Scheda LoRa-E5 Mini (STM32WLE5).
- Sensore Murata SCL3300 collegato via SPI.
- Gateway LoRaWAN RAK7268V2.
- PC di sviluppo con interfaccia ST-Link o equivalente per flashing/debug.
- PCB personalizzato (opzionale, dimensioni circa 4 × 2 cm).

### Software
- STM32CubeIDE (versione recente).
- Toolchain GCC ARM Embedded integrata in STM32CubeIDE.
- Mosquitto MQTT Broker.
- Browser moderno per la dashboard web.
- Facoltativi: utilità per monitor seriale (es. PuTTY), Node.js se si estende la dashboard.

---

## Struttura del Repository

/Firmware
project (STM32CubeIDE)

/Web
interfaccia

/Docs
spiegazione dettagliata

/LICENSE
/README.md


---

## Dettagli Firmware

### Flusso di avvio
1. Inizializzazione clock, GPIO, SPI, UART/USART (log opzionale).
2. Inizializzazione stack LoRaWAN; caricamento parametri OTAA (DevEUI, AppEUI/JoinEUI, AppKey).
3. Join OTAA; al completamento, disattivazione del LED rosso lampeggiante come indicatore di rete attiva.
4. Inizializzazione SCL3300: verifica WHOAMI, settaggio modalità operativa da datasheet.
5. Calibrazione automatica: acquisizione 100 campioni, calcolo offset per X/Y/Z.
6. Loop di misura: lettura dati, applicazione filtro EMA, impacchettamento payload, invio periodico uplink. Gestione downlink per comandi remoti (es. ri-calibrazione).

### Filtro EMA
- Implementazione su ciascun asse: `y[n] = α·x[n] + (1−α)·y[n−1]`.
- Valore predefinito α tipicamente compreso tra 0,1 e 0,3 (configurabile in `app_config.h`).

### Indicatori di stato
- LED rosso lampeggiante: dispositivo in join/ricerca rete.
- LED rosso spento: join completato, rete attiva.
- Messaggi UART opzionali: log diagnostico di inizializzazione, WHOAMI, calibrazione, errori.

---

## Formato dei Dati e Codifica

### Payload binario (uplink)
- Dimensione: 16 byte totali.
- Struttura (little-endian consigliato):
  - Byte 0–3: Asse X (float IEEE-754 32-bit) oppure int32 scalato.
  - Byte 4–7: Asse Y (float 32-bit) oppure int32 scalato.
  - Byte 8–11: Asse Z (float 32-bit) oppure int32 scalato.
  - Byte 12–15: Temperatura interna (float 32-bit) oppure int32 scalato.
- Nota: per deployment a basso overhead si consiglia la rappresentazione int32 scalata (es. mdeg o mg) documentando i fattori di scala in `payload_format.md`.

### Pipeline di trasmissione
1. Acquisizione → filtraggio EMA → normalizzazione/scala → packing binario 16 byte.
2. Conversione in HEX.
3. Codifica Base64 per inoltro su MQTT, quando previsto dal flusso gateway.

### Pipeline di ricezione (lato server/dashboard)
1. Base64 → HEX → binario.
2. Parse dei 4 campi (X, Y, Z, T).
3. Applicazione fattori di scala inversi o interpretazione float IEEE-754.

### Esempio di decodifica (JavaScript, valori float 32-bit little-endian)
```js
function decodeBase64Payload(b64) {
  const raw = atob(b64); // stringa binaria
  const bytes = new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  const view = new DataView(bytes.buffer);
  const x = view.getFloat32(0, true);
  const y = view.getFloat32(4, true);
  const z = view.getFloat32(8, true);
  const t = view.getFloat32(12, true);
  return { x, y, z, t };
}
```


## Comandi Remoti (Downlink)

- **Calibrazione remota**: comando per ri-avviare la sequenza di offset (100 campioni).
- **Reset filtro EMA**: re-inizializza gli stati dei tre canali.
- **Parametrizzazione**: aggiornamento del coefficiente α dell’EMA, del periodo di uplink e delle soglie di warning.

I comandi sono ricevuti e interpretati nel firmware (callback di downlink), con ack opzionale via uplink.

---

## Configurazione del Gateway RAK7268V2 (OTAA)

1. Creare un’applicazione LoRaWAN nel gateway.
2. Registrare il dispositivo in modalità OTAA, annotando **DevEUI**, **JoinEUI (AppEUI)** e **AppKey**.
3. Impostare la **regione EU868** e un profilo di data rate adeguato.
4. Abilitare l’inoltro a un **broker MQTT** (interno/esterno), specificando topic e credenziali.
5. Verificare la corrispondenza dei parametri anche nel firmware (`app_config.h`):
   - `DEV_EUI`, `JOIN_EUI`, `APP_KEY`.
6. Riavviare il nodo: al join completato, l’indicatore **LED rosso si spegne**.

---

## Build e Flash (STM32CubeIDE)

### Import del progetto
- `File → Import → Existing Projects into Workspace` → selezionare la cartella `/Firmware`.
- Verificare la toolchain (GCC for STM32) e le opzioni di ottimizzazione.

### Configurazione
- Aggiornare `app_config.h` con chiavi OTAA e parametri operativi (α EMA, periodo uplink, pin SPI).
- Verificare i pin SPI per SCL3300 (MOSI/MISO/SCK/CS) e GPIO LED.

### Compilazione e flash
- Build del progetto in modalità **Release**.
- Collegare **ST-Link**, eseguire `Run → Debug/Run`.
- Opzionale: abilitare retarget UART per log su seriale.

---

## Installazione e Avvio (Plug & Play)

1. Flash del firmware sulla **LoRa-E5 Mini**.
2. Collegamento fisico **SCL3300** su bus **SPI** come da schemi (vedi `/Docs/schematic.pdf`).
3. Configurazione del gateway **RAK7268V2** in **OTAA** con le stesse chiavi del firmware.
4. Avvio **broker Mosquitto** e, se previsto, servizio di decoding.
5. Alimentazione del nodo: il dispositivo esegue **join**, si **calibra** e avvia gli **uplink** secondo il periodo configurato.

---

## Dashboard Web

- File nella cartella `/Web` (HTML/CSS/JS, Chart.js o libreria equivalente).
- Connessione a broker **MQTT** via **WebSocket** (se abilitato) o tramite un backend di bridging.

### Visualizzazioni
- Trend di **X / Y / Z / Temperatura**.
- Log eventi (**join**, **uplink**, **downlink**).
- Stato rete e ultimo **RSSI/SNR** (se disponibili nei metadati).

### Pannello comandi
- Pulsante **calibrazione remota**.
- Impostazione parametri (**α EMA**, **periodo uplink**).

---

## Prestazioni e Considerazioni

- **Filtraggio**: l’EMA riduce il rumore preservando la dinamica; scegliere α in funzione della latenza accettabile.
- **Consumi**: per nodi a batteria, ottimizzare duty-cycle, data rate, potenza TX e sleep tra misure.
- **Affidabilità**: verificare retry LoRaWAN, conferme ACK e politiche di rejoin.
- **Sicurezza**: mantenere segrete le chiavi OTAA; usare **TLS** per il trasporto MQTT su reti pubbliche.

---

## PCB e Collegamenti

- PCB personalizzato con integrazione **LoRa-E5 + SCL3300**.
- Dimensioni indicative: **40 mm × 20 mm**.
- Vedere `/Docs/schematic.pdf` e `/Docs/pcb_layout.png` per pinout e footprint.
- Layout consigliato: tracce SPI corte, piano di massa continuo, separazione RF/analogico.

---

## Troubleshooting

- **Join non riuscito**: verificare regione **EU868**, chiavi OTAA e copertura gateway.
- **WHOAMI fallito**: controllare cablaggio SPI, CS, frequenza clock e alimentazione sensore.
- **Dati errati o saturi**: rivedere scala fisica/offset; eseguire **calibrazione remota**.
- **Dashboard vuota**: controllare connessione MQTT, topic e decoder **Base64/HEX**.

---

## Licenza

Questo progetto è distribuito con licenza **MIT**. Vedere il file `LICENSE` per i dettagli.

---

## Riferimenti

- Murata, **SCL3300 Datasheet**.
- STMicroelectronics, **STM32WLE5 Reference Manual (RM0461)** e HAL Drivers.
- LoRa Alliance, **LoRaWAN 1.0.4 Specification**.
- RAKwireless, **Documentazione RAK7268V2**.
- Eclipse Mosquitto, **Documentazione MQTT**.

---

## Autore e Contatti

- Autore: DI FILIPPO DAVIDE 
- Email/Contatti: /davide0707  
- Anno: 2025

