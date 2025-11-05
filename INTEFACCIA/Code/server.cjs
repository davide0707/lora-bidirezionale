// server.js
// Bridge MQTT <-> WebSocket + API comandi

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mqtt = require("mqtt");
const cors = require("cors");
const bodyParser = require("body-parser");
const base64 = require("base-64");

// ========================
// CONFIG
// ========================
const HTTP_PORT = port;         // porta web interfaccia
const WS_PORT = port;           // porta WebSocket
const MQTT_HOST = "your ip";
const MQTT_PORT = port;
const MQTT_USERNAME = "mqtt_user";
const MQTT_PASSWORD = "mqtt_pass";


const MQTT_TOPIC_UPLINK =
  "your topic";


const MQTT_TOPIC_DOWNLINK =
  "your topic";

// ========================
// EXPRESS HTTP
// ========================
const app = express();
app.use(cors());
app.use(bodyParser.json());

// servi i file statici (index.html, app.js, style.css)
app.use(express.static(__dirname));

// API test
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, msg: "pong" });
});

// API per mandare comandi downlink (es: "calibrazione")
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, msg: "pong" });
});

// API per mandare comandi downlink (es: "calibrazione")
app.post("/api/command", (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({ error: "No command provided" });
  }

  //  Topic di downlink corretto per ChirpStack
  const TOPIC_DOWN = "application/TestComV2/device/0080e115063862f2/tx";

  //  Payload nel formato che funziona su MQTTX
  const payload = {
    confirmed: false,
    fPort: 2,
    data: Buffer.from(command, "utf8").toString("base64"), // "calibrazione" → base64
  };

  try {
    // Usa mqttClient invece di client
    mqttClient.publish(TOPIC_DOWN, JSON.stringify(payload));
    console.log("MQTT downlink sent:", payload);
    res.json({ ok: true });
  } catch (err) {
    console.error("MQTT send error:", err);
    res.status(500).json({ error: "MQTT send error" });
  }
});




const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, () => {
  console.log(`HTTP server on http://localhost:${HTTP_PORT}`);
});

// ========================
// WEBSOCKET SERVER
// ========================
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`WebSocket bridge on ws://localhost:${WS_PORT}`);
});

// tiene traccia dei client connessi
function broadcastAll(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function broadcastLog(level, message) {
  const logMsg = {
    type: "log",
    level,
    message,
    timestamp: Date.now(),
  };
  broadcastAll(logMsg);
}

wss.on("connection", (ws) => {
  console.log("Client WebSocket connected");
  ws.send(
    JSON.stringify({
      type: "status",
      message: "WebSocket connected to server",
      timestamp: Date.now(),
    })
  );
});

wss.on("close", () => {
  console.log("Client WebSocket disconnected");
});

// ========================
// MQTT CLIENT
// ========================
const mqttUrl = `mqtt://${MQTT_HOST}:${MQTT_PORT}`;
const mqttOptions = {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
};

const mqttClient = mqtt.connect(mqttUrl, mqttOptions);

mqttClient.on("connect", () => {
  console.log(`Connected to MQTT broker ${MQTT_HOST}:${MQTT_PORT}`);
  broadcastLog("info", `Connected to MQTT ${MQTT_HOST}:${MQTT_PORT}`);

  mqttClient.subscribe(MQTT_TOPIC_UPLINK, (err) => {
    if (err) {
      console.error("Error subscribing to uplink:", err);
      broadcastLog("error", `Error subscribing to uplink: ${err.message}`);
    } else {
      console.log("Subscribed to", MQTT_TOPIC_UPLINK);
      broadcastLog("info", `Listening on ${MQTT_TOPIC_UPLINK}`);
    }
  });
});

mqttClient.on("error", (err) => {
  console.error("MQTT error:", err);
  broadcastLog("error", `MQTT error: ${err.message}`);
});

mqttClient.on("close", () => {
  console.log("MQTT disconnected");
  broadcastLog("error", "MQTT disconnected");
});

// decode 16 byte (4 float32 little-endian) => X,Y,Z,Temp
function decodePayloadFloats(dataB64) {
  try {
    const buf = Buffer.from(dataB64, "base64");
    if (buf.length !== 16) {
      return null;
    }
    const x = buf.readFloatLE(0);
    const y = buf.readFloatLE(4);
    const z = buf.readFloatLE(8);
    const t = buf.readFloatLE(12);
    return { x, y, z, t };
  } catch (e) {
    console.error("Error decoding payload:", e);
    return null;
  }
}

mqttClient.on("message", (topic, messageBuf) => {
  try {
    const msgStr = messageBuf.toString("utf-8");
    let payload;
    try {
      payload = JSON.parse(msgStr);
    } catch (e) {
      console.error("MQTT message not JSON:", msgStr);
      broadcastLog("error", `MQTT message not JSON: ${msgStr}`);
      return;
    }

    if (topic === MQTT_TOPIC_UPLINK) {
      const dataB64 = payload.data;
      const decoded = decodePayloadFloats(dataB64);

      const timestamp = payload.timestamp
        ? payload.timestamp * 1000
        : Date.now();

      const meta = {
        fCnt: payload.fCnt,
        fPort: payload.fPort,
        frequency: payload.txInfo?.frequency,
        dr: payload.txInfo?.dr,
        rssi: payload.rxInfo?.[0]?.rssi,
        snr: payload.rxInfo?.[0]?.loRaSNR,
      };

      if (decoded) {
        const { x, y, z, t } = decoded;
        console.log(
          `Uplink X=${x.toFixed(2)} Y=${y.toFixed(
            2
          )} Z=${z.toFixed(2)} T=${t.toFixed(2)}`
        );

        broadcastAll({
          type: "uplink",
          timestamp,
          x,
          y,
          z,
          temp: t,
          meta,
          raw: payload,
        });

        broadcastLog(
          "uplink",
          `Uplink fCnt=${meta.fCnt} X=${x.toFixed(2)} Y=${y.toFixed(
            2
          )} Z=${z.toFixed(2)} T=${t.toFixed(2)}`
        );
      } else {
        broadcastLog("error", `Invalid uplink payload (base64=${dataB64})`);
      }
    } else {
      // altri topic, se in futuro servono
      broadcastLog("info", `MQTT ${topic}: ${msgStr}`);
    }
  } catch (e) {
    console.error("Error processing MQTT message:", e);
    broadcastLog("error", `MQTT message error: ${e.message}`);
  }
});
