# LoRa Sensor Dashboard
Real-time data visualization for an SCL3300 sensor via STM32WL, LoRa, and MQTT.

## Overview
This project provides a complete real-time dashboard for monitoring and controlling a LoRa-based sensor node. It integrates:
- SCL3300 accelerometer and temperature sensor
- STM32WL LoRa board as a transmitter
- MQTT (Mosquitto) as a message broker
- Node.js WebSocket + Express server for backend data handling
- Chart.js-based web dashboard for visualization and control

## System Architecture
```
[SCL3300 Sensor]
     ↓  (SPI/I2C)
[STM32WL Board]
     ↓  (LoRa RF)
[LoRa Modem / Gateway]
     ↓  (MQTT via Mosquitto)
[Node.js Server]
     ↓  (WebSocket)
[Web Dashboard - Chart.js]
```

## Project Structure
```
.
├── app.js              # Frontend logic (WebSocket client, charts, logs)
├── index.html          # Dashboard UI
├── style.css           # Dashboard styling
├── EnergyFlow.svg      # Data flow diagram
├── server.cjs          # Node.js server (Express + MQTT + WebSocket)
├── package.json        # Project metadata and dependencies
├── package-lock.json   # Dependency lock file
└── README.md           # This documentation
```

## Prerequisites
- Node.js 18 or newer, with npm
- Mosquitto MQTT broker (local or remote)
- A LoRa modem/gateway that publishes to MQTT topics used by this project

## Installation on Windows
1. Install Node.js (LTS): https://nodejs.org
2. Install Mosquitto for Windows: https://mosquitto.org/download/ (ensure the broker service is running on port 1883).
3. Clone or copy this project:
   ```bash
   git clone https://github.com/yourusername/lora-sensor-dashboard.git
   cd lora-sensor-dashboard
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Fix the start script if needed (see the section "Start Script Note").
6. Start the backend:
   ```bash
   npm start
   ```
7. Open the dashboard at:
   - http://localhost:8080

## Installation on Linux (Ubuntu/Debian)
1. Install Node.js and npm:
   ```bash
   sudo apt update
   sudo apt install -y nodejs npm
   ```
2. Install Mosquitto:
   ```bash
   sudo apt install -y mosquitto mosquitto-clients
   sudo systemctl enable mosquitto
   sudo systemctl start mosquitto
   ```
3. Clone the project and install dependencies:
   ```bash
   git clone https://github.com/yourusername/lora-sensor-dashboard.git
   cd lora-sensor-dashboard
   npm install
   ```
4. Fix the start script if needed (see below), then run:
   ```bash
   npm start
   ```
5. Open the dashboard in your browser:
   - http://localhost:8080

## Start Script Note
This repository uses a Node.js server file named `server.cjs`. Ensure your `package.json` uses the correct start command:
```json
"scripts": {
  "start": "node server.cjs"
}
```
If you prefer to keep the default `"start": "node server.js"`, rename `server.cjs` to `server.js` instead.

## Configuration
The backend connects to the MQTT broker. Adjust the connection string and credentials in `server.cjs` if required, for example:
```js
// Example
const mqttClient = mqtt.connect('mqtt://localhost:1883', {
  // username: 'mqtt_user',
  // password: 'mqtt_pass'
});
```
If your broker is remote, use its host/IP and port. For TLS, use `mqtts://` and provide the necessary options.

## Testing the MQTT Broker
Use Mosquitto clients to verify message flow.

Subscribe to uplinks:
```bash
mosquitto_sub -t "sensor/uplink" -v
```

Publish a test downlink:
```bash
mosquitto_pub -t "sensor/downlink" -m "LEDON"
```

## Running the Dashboard
- Start the Node.js backend with `npm start`.
- The server serves static assets (HTML/CSS/JS) over HTTP (default 8080) and exposes a WebSocket bridge (default 8081).
- Open `http://localhost:8080` and click "Connect" to establish the WebSocket connection.

## WebSocket and Frontend Notes
- The frontend connects to `ws://localhost:8081`. If you change the WebSocket port or host, update the URL in `app.js` accordingly.
- The dashboard renders real-time charts of X, Y, Z and temperature using Chart.js with zoom support.
- A command panel allows sending plain-text commands (for example `calibration`, `LEDON`, `LEDOFF`, `RESET`) that are published to MQTT as downlinks.

## MQTT Topics
| Direction | Topic            | Description                                                |
|----------:|------------------|------------------------------------------------------------|
| Uplink    | `sensor/uplink`  | Data from STM32WL (e.g., X, Y, Z, Temp, RSSI, SNR, FCnt)  |
| Downlink  | `sensor/downlink`| Commands to the node (string payload or base64 as needed) |

## Ports
- HTTP: 8080 (serving the dashboard)
- WebSocket: 8081 (bridge to the browser clients)
- MQTT: 1883 (Mosquitto default)

## Troubleshooting
- WebSocket not connecting: ensure the Node.js backend is running and listening on the expected port (8081).
- MQTT disconnected: verify Mosquitto is running on port 1883 and reachable from the machine running Node.js.
- No sensor data: confirm that your modem/gateway is publishing to `sensor/uplink`.
- Port already in use: change the HTTP/WebSocket ports in the server file or stop the conflicting service.
- Charts not updating: check the browser console for JSON parse errors and verify the payload format forwarded by the server.

## Security Notes
- If exposing the broker beyond localhost, configure authentication, TLS, and topic ACLs.
- Consider running Node.js and Mosquitto behind a reverse proxy and firewall rules.
