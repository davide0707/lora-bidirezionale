// app.js

let ws = null;

// Grafici
let chartMode = "single"; // "single" | "multi"
let chartMain = null;
let chartX = null;
let chartY = null;
let chartZ = null;
let chartT = null;

const MAX_POINTS = 200;
const dataHistory = []; // {time, x, y, z, temp, meta}

// Log
const logs = []; // {time, level, message, type}

const els = {};
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  setupTabsAndButtons();
  initCharts();

  // Lucide icons
  if (window.lucide && window.lucide.createIcons) {
    window.lucide.createIcons();
  }
});

/* ======================
   DOM
   ====================== */
function cacheDom() {
  els.btnResetAll = $("btn-reset-all");
  els.wsStatus = $("ws-status");
  els.mqttStatus = $("mqtt-status");
  els.btnConnect = $("btn-connect");

  els.statX = $("stat-x");
  els.statY = $("stat-y");
  els.statZ = $("stat-z");
  els.statTemp = $("stat-temp");

  els.rfRssi = $("rf-rssi");
  els.rfSnr = $("rf-snr");
  els.rfFreq = $("rf-freq");
  els.rfFcnt = $("rf-fcnt");

  els.logsList = $("logs-list");
  els.logCount = $("log-count");

  els.cmdInput = $("cmd-input");
  els.cmdStatus = $("cmd-status");
  els.mqttRaw = $("mqtt-raw");

  els.btnResetZoom = $("btn-reset-zoom");
  els.btnToggleCharts = $("btn-toggle-charts");
  els.btnShowHistory = $("btn-show-history");
  els.historyPanel = $("history-panel");
  els.historyList = $("history-list");
  els.btnCloseHistory = $("btn-close-history");
  els.btnCalcExtrema = $("btn-calc-extrema");

  els.extXMin = $("ext-x-min");
  els.extXMax = $("ext-x-max");
  els.extYMin = $("ext-y-min");
  els.extYMax = $("ext-y-max");
  els.extZMin = $("ext-z-min");
  els.extZMax = $("ext-z-max");
  els.extTMin = $("ext-t-min");
  els.extTMax = $("ext-t-max");

  els.chartSingle = $("chart-single");
  els.chartMulti = $("chart-multi");

  els.ledSensor = $("led-sensor");
  els.ledBoard = $("led-board");
  els.ledModem = $("led-modem");
  els.badgeBoard = $("badge-board");
  els.badgeModem = $("badge-modem");

  els.arrowBoardModem = $("arrow-board-modem");
  els.arrowModemBoard = $("arrow-modem-board");

  els.toast = $("toast");
}

/* Qui non ci sono tab veri, solo pulsanti */
function setupTabsAndButtons() {
  els.btnConnect.addEventListener("click", connectWS);

  els.btnResetZoom.addEventListener("click", () => {
    if (chartMain && chartMain.resetZoom) chartMain.resetZoom();
  });

  els.btnToggleCharts.addEventListener("click", toggleChartsMode);
  els.btnResetAll.addEventListener("click", resetDashboard);

  els.btnShowHistory.addEventListener("click", () => {
    renderHistory();
    els.historyPanel.classList.add("history-panel-open");
  });

  els.btnCloseHistory.addEventListener("click", () => {
    els.historyPanel.classList.remove("history-panel-open");
  });

  els.btnCalcExtrema.addEventListener("click", calculateExtrema);

  $("btn-send-command").addEventListener("click", sendCommand);
  document.querySelectorAll(".chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      els.cmdInput.value = chip.dataset.cmd;
      sendCommand();
    });
  });
}

/* ======================
   WEBSOCKET
   ====================== */
function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    showToast("WebSocket already connected", "info");
    return;
  }

  ws = new WebSocket("ws://localhost:8081");

  ws.onopen = () => {
    els.wsStatus.textContent = "Connected";
    els.wsStatus.classList.remove("status-disconnected");
    els.wsStatus.classList.add("status-connected");
    showToast("WebSocket connected", "success");
  };

  ws.onclose = () => {
    els.wsStatus.textContent = "Disconnected";
    els.wsStatus.classList.remove("status-connected");
    els.wsStatus.classList.add("status-disconnected");
    showToast("WebSocket disconnected", "warning");
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    showToast("WebSocket error", "error");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWSMessage(msg);
    } catch (e) {
      console.error("Error parsing WS msg:", e);
    }
  };
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case "status":
      addLog("info", msg.message || "Status", "info");
      break;

    case "uplink":
      handleUplink(msg);
      break;

    case "log":
      handleRemoteLog(msg);
      break;

    case "downlink_sent":
      animateDownlinkFlow();
      addLog(
        "downlink",
        `Downlink Sent: "${msg.command}" (base64=${msg.dataB64})`,
        "downlink"
      );
      break;

    case "mqtt":
      // se vuoi aggiornare stato MQTT
      if (typeof msg.connected === "boolean") {
        els.mqttStatus.textContent = msg.connected ? "Connected" : "Disconnected";
        els.mqttStatus.classList.toggle(
          "status-connected",
          msg.connected
        );
        els.mqttStatus.classList.toggle(
          "status-disconnected",
          !msg.connected
        );
      }
      break;

    default:
      addLog("info", JSON.stringify(msg), "info");
  }
}

/* ======================
   HANDLER UPLINK
   ====================== */
function handleUplink(msg) {
  const time = msg.timestamp ? new Date(msg.timestamp) : new Date();
  const x = msg.x;
  const y = msg.y;
  const z = msg.z;
  const t = msg.temp;

  // Aggiorna valori istantanei
  if (typeof x === "number") els.statX.textContent = x.toFixed(2);
  if (typeof y === "number") els.statY.textContent = y.toFixed(2);
  if (typeof z === "number") els.statZ.textContent = z.toFixed(2);
  if (typeof t === "number") els.statTemp.textContent = t.toFixed(2);

  const meta = msg.meta || {};
  if (meta.rssi !== undefined) els.rfRssi.textContent = `${meta.rssi} dBm`;
  if (meta.snr !== undefined)
    els.rfSnr.textContent = `${meta.snr.toFixed(1)} dB`;
  if (meta.frequency)
    els.rfFreq.textContent = `${(meta.frequency / 1e6).toFixed(3)} MHz`;
  if (meta.fCnt !== undefined) els.rfFcnt.textContent = meta.fCnt;

  // Aggiorna storico (solo quando arriva: calcolo max/min lo fai a pulsante)
  dataHistory.push({ time, x, y, z, temp: t, meta });
  if (dataHistory.length > MAX_POINTS) dataHistory.shift();

  updateCharts();
  saveToLocal(); // salva automaticamente i dati ricevuti


  addLog(
    "uplink",
    `X=${x.toFixed(2)} Y=${y.toFixed(2)} Z=${z.toFixed(
      2
    )} T=${t.toFixed(2)} (fCnt=${meta.fCnt ?? "?"})`,
    "uplink"
  );

  // Raw JSON
  if (msg.raw) {
    els.mqttRaw.textContent = JSON.stringify(msg.raw, null, 2);
  }

  // Animazione flusso uplink
  animateUplinkFlow();
}

/* ======================
   LOGS
   ====================== */
function handleRemoteLog(msg) {
  const level = msg.level || "info";
  const text = msg.message || "";
  let type = "info";
  if (level === "uplink") type = "uplink";
  else if (level === "downlink") type = "downlink";
  else if (level === "error") type = "error";
  addLog(level, text, type);
}


function addLog(level, message, type) {
  const time = new Date();
  logs.push({ time, level, message, type });
  if (logs.length > 400) logs.shift();
  renderLogs();
}

function renderLogs() {
  els.logsList.innerHTML = "";
  logs.slice(-200).forEach((log) => {
    const row = document.createElement("div");
    row.className = "log-item";

    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.textContent = timeToHHMMSS(log.time);

    const msgSpan = document.createElement("div");
    msgSpan.className = "log-msg";

    const tag = document.createElement("span");
    tag.className = "log-tag";
    let tagText = "INFO";

    switch (log.type) {
      case "uplink":
        tag.classList.add("log-tag-uplink");
        tagText = "UP";
        break;
      case "downlink":
        tag.classList.add("log-tag-downlink");
        tagText = "DN";
        break;
      case "error":
        tag.classList.add("log-tag-error");
        tagText = "ERR";
        break;
      default:
        tag.classList.add("log-tag-info");
        tagText = "INFO";
    }

    tag.textContent = tagText;
    msgSpan.appendChild(tag);
    msgSpan.appendChild(document.createTextNode(log.message));

    row.appendChild(timeSpan);
    row.appendChild(msgSpan);
    els.logsList.appendChild(row);
  });

  els.logsList.scrollTop = els.logsList.scrollHeight;
  els.logCount.textContent = `${logs.length} events`;
}

function timeToHHMMSS(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ======================
   STORICO AVANZATO
   ====================== */
function renderHistory() {
  els.historyList.innerHTML = "";
  const items = dataHistory.slice().reverse();
  items.forEach((p) => {
    const div = document.createElement("div");
    div.className = "history-item";

    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = timeToHHMMSS(p.time);

    const vals = document.createElement("div");
    vals.textContent = `X=${p.x.toFixed(2)} Y=${p.y.toFixed(
      2
    )} Z=${p.z.toFixed(2)} T=${p.temp.toFixed(2)} RSSI=${
      p.meta?.rssi ?? "?"
    } SNR=${p.meta?.snr ?? "?"}`;

    div.appendChild(time);
    div.appendChild(vals);
    els.historyList.appendChild(div);
  });
}

/**
 * Calcola max/min SOLO quando premi il pulsante
 */
function calculateExtrema() {
  if (!dataHistory.length) {
    showToast("Nothing in history.", "warning");
    return;
  }

  let xMin = Infinity,
    xMax = -Infinity;
  let yMin = Infinity,
    yMax = -Infinity;
  let zMin = Infinity,
    zMax = -Infinity;
  let tMin = Infinity,
    tMax = -Infinity;

  dataHistory.forEach((p) => {
    if (typeof p.x === "number") {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
    }
    if (typeof p.y === "number") {
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    if (typeof p.z === "number") {
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
    }
    if (typeof p.temp === "number") {
      if (p.temp < tMin) tMin = p.temp;
      if (p.temp > tMax) tMax = p.temp;
    }
  });

  els.extXMin.textContent = xMin === Infinity ? "–" : xMin.toFixed(2);
  els.extXMax.textContent = xMax === -Infinity ? "–" : xMax.toFixed(2);
  els.extYMin.textContent = yMin === Infinity ? "–" : yMin.toFixed(2);
  els.extYMax.textContent = yMax === -Infinity ? "–" : yMax.toFixed(2);
  els.extZMin.textContent = zMin === Infinity ? "–" : zMin.toFixed(2);
  els.extZMax.textContent = zMax === -Infinity ? "–" : zMax.toFixed(2);
  els.extTMin.textContent = tMin === Infinity ? "–" : tMin.toFixed(2);
  els.extTMax.textContent = tMax === -Infinity ? "–" : tMax.toFixed(2);

  showToast("Max/min calculated on history.", "info");
}

/* ======================
   GRAFICI
   ====================== */
function initCharts() {
  const ctxMain = document.getElementById("chart-main").getContext("2d");
  const ctxX = document.getElementById("chart-x").getContext("2d");
  const ctxY = document.getElementById("chart-y").getContext("2d");
  const ctxZ = document.getElementById("chart-z").getContext("2d");
  const ctxT = document.getElementById("chart-t").getContext("2d");

  const makeGradient = (ctx, c1, c2) => {
    const g = ctx.createLinearGradient(0, 0, 0, 220);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    return g;
  };

  // Grafico principale
  chartMain = new Chart(ctxMain, {
    type: "line",
    data: {
      datasets: [
        {
          label: "X (°)",
          data: [],
          borderColor: "#22d3ee",
          backgroundColor: makeGradient(
            ctxMain,
            "rgba(34,211,238,0.35)",
            "rgba(15,23,42,0.0)"
          ),
          tension: 0.36,
          borderWidth: 2.4,
          pointRadius: 0,
          fill: true,
        },
        {
          label: "Y (°)",
          data: [],
          borderColor: "#a855f7",
          backgroundColor: makeGradient(
            ctxMain,
            "rgba(168,85,247,0.3)",
            "rgba(15,23,42,0.0)"
          ),
          tension: 0.36,
          borderWidth: 2.4,
          pointRadius: 0,
          fill: true,
        },
        {
          label: "Z (°)",
          data: [],
          borderColor: "#fbbf24",
          backgroundColor: makeGradient(
            ctxMain,
            "rgba(251,191,36,0.27)",
            "rgba(15,23,42,0.0)"
          ),
          tension: 0.36,
          borderWidth: 2.4,
          pointRadius: 0,
          fill: true,
        },
        {
          label: "Temp (°C)",
          data: [],
          borderColor: "#4ade80",
          backgroundColor: makeGradient(
            ctxMain,
            "rgba(74,222,128,0.28)",
            "rgba(15,23,42,0.0)"
          ),
          tension: 0.36,
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: "y1",
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 150 },
      layout: {
        padding: { top: 6, right: 12, left: 4, bottom: 4 },
      },
      plugins: {
        legend: {
          labels: {
            color: "#e5e7eb",
            font: { size: 11 },
            usePointStyle: true,
            pointStyle: "line",
          },
          onClick: (e, legendItem, legend) => {
            const idx = legendItem.datasetIndex;
            const ci = legend.chart;
            const meta = ci.getDatasetMeta(idx);
            meta.hidden =
              meta.hidden === null ? !ci.data.datasets[idx].hidden : null;
            ci.update();
          },
        },
        tooltip: {
          mode: "index",
          intersect: false,
          backgroundColor: "rgba(15,23,42,0.97)",
          borderColor: "#22d3ee",
          borderWidth: 1,
          titleColor: "#22d3ee",
          bodyColor: "#e5e7eb",
          displayColors: false,
          callbacks: {
            title: (items) =>
              items.length ? timeToHHMMSS(new Date(items[0].parsed.x)) : "",
          },
        },
        zoom: {
          pan: { enabled: true, mode: "x" },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { tooltipFormat: "HH:mm:ss", unit: "second" },
          ticks: { color: "#9ca3af", font: { size: 10 } },
          grid: { color: "rgba(55,65,81,0.45)" },
        },
        y: {
          position: "left",
          ticks: { color: "#9ca3af", font: { size: 10 } },
          grid: { color: "rgba(31,41,55,0.6)" },
        },
        y1: {
          position: "right",
          ticks: { color: "#f97316", font: { size: 10 } },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });

  // Grafici piccoli separati
  chartX = new Chart(ctxX, makeSingleConfig(ctxX, "X (°)", "#22d3ee"));
  chartY = new Chart(ctxY, makeSingleConfig(ctxY, "Y (°)", "#a855f7"));
  chartZ = new Chart(ctxZ, makeSingleConfig(ctxZ, "Z (°)", "#fbbf24"));
  chartT = new Chart(ctxT, makeSingleConfig(ctxT, "Temp (°C)", "#4ade80"));
}

function makeSingleConfig(ctx, label, color) {
  const g = ctx.createLinearGradient(0, 0, 0, 180);
  g.addColorStop(0, "rgba(248,250,252,0.1)");
  g.addColorStop(1, "rgba(15,23,42,0.0)");

  return {
    type: "line",
    data: {
      datasets: [
        {
          label,
          data: [],
          borderColor: color,
          backgroundColor: g,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: "index",
          intersect: false,
          backgroundColor: "rgba(15,23,42,0.97)",
          borderColor: color,
          borderWidth: 1,
          titleColor: "#22d3ee",
          bodyColor: "#e5e7eb",
          displayColors: false,
          callbacks: {
            title: (items) =>
              items.length ? timeToHHMMSS(new Date(items[0].parsed.x)) : "",
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "second" },
          ticks: { color: "#9ca3af", font: { size: 9 } },
          grid: { color: "rgba(55,65,81,0.35)" },
        },
        y: {
          ticks: { color: "#9ca3af", font: { size: 9 } },
          grid: { color: "rgba(31,41,55,0.5)" },
        },
      },
    },
  };
}

function updateCharts() {
  if (!chartMain) return;

  const times = dataHistory.map(p => p.time);
  const xs = dataHistory.map(p => p.x);
  const ys = dataHistory.map(p => p.y);
  const zs = dataHistory.map(p => p.z);
  const ts = dataHistory.map(p => p.temp);

  chartMain.data.labels = times;
  chartMain.data.datasets[0].data = xs;
  chartMain.data.datasets[1].data = ys;
  chartMain.data.datasets[2].data = zs;
  chartMain.data.datasets[3].data = ts;
  chartMain.update();

  if (chartX) { chartX.data.labels = times; chartX.data.datasets[0].data = xs; chartX.update(); }
  if (chartY) { chartY.data.labels = times; chartY.data.datasets[0].data = ys; chartY.update(); }
  if (chartZ) { chartZ.data.labels = times; chartZ.data.datasets[0].data = zs; chartZ.update(); }
  if (chartT) { chartT.data.labels = times; chartT.data.datasets[0].data = ts; chartT.update(); }
}


/**
 * Switch tra grafico unico e 4 grafici separati (2x2)
 */
function toggleChartsMode() {
  if (chartMode === "single") {
    chartMode = "multi";
    els.chartSingle.style.display = "none";
    els.chartMulti.style.display = "grid";
    els.btnToggleCharts.textContent = "Single Chart View";
    updateCharts();
  } else {
    chartMode = "single";
    els.chartMulti.style.display = "none";
    els.chartSingle.style.display = "block";
    els.btnToggleCharts.textContent = "4 Chart View";
  }
}

/* ======================
   COMANDI
   ====================== */
async function sendCommand() {
  const cmd = els.cmdInput.value.trim();
  if (!cmd) {
    showToast("No command to send", "warning");
    return;
  }

  try {
    const res = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }

    els.cmdStatus.textContent = `Command "${cmd}" sent to modem.`;
    addLog("downlink", `Command sent: "${cmd}"`, "downlink");
    showToast(`Command "${cmd}" sent`, "success");

    if (cmd.toLowerCase() === "calibration") {
      addLog("info", "Calibration requested from sensor.", "info");
    }

    animateDownlinkFlow();
  } catch (e) {
    console.error("Error sending command:", e);
    els.cmdStatus.textContent = `Error sending command: ${e.message}`;
    addLog("error", `Error sending command: ${e.message}`, "error");
    showToast("Error sending command", "error");
  }
}

/* ======================
   ANIMAZIONI FLUSSO
   ====================== */


function flashNode(node) {
  if (!node) return;
  node.classList.add("node-active");
  setTimeout(() => node.classList.remove("node-active"), 700);
}

function pulseArrow(arrow) {
  if (!arrow) return;
  arrow.classList.add("arrow-visible");
  arrow.classList.add("arrow-flow");
  setTimeout(() => {
    arrow.classList.remove("arrow-flow");
    arrow.classList.remove("arrow-visible");
  }, 900);
}

/* ======================
   TOAST
   ====================== */
let toastTimeout = null;
function showToast(text, type = "info") {
  if (!els.toast) return;
  els.toast.textContent = text;

  ["info", "success", "error", "warning"].forEach((t) =>
    els.toast.classList.remove(`toast--${t}`)
  );
  els.toast.classList.add(`toast--${type}`);
  els.toast.classList.add("toast-show");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    els.toast.classList.remove("toast-show");
  }, 2400);
}

// ======================
// ENERGY FLOW ANIMATION
// ======================
let EnergyFlow = null;

// Attende caricamento SVG
document.addEventListener("DOMContentLoaded", () => {
  const svgObj = document.getElementById("EnergyFlowSvg");
  if (!svgObj) return;
  svgObj.addEventListener("load", () => {
    EnergyFlow = svgObj.contentDocument;
    console.log("EnergyFlow SVG caricato");
  });
});

// Animazioni personalizzate
function animateEnergyFlow(direction) {
  if (!EnergyFlow) return;
  const flowUp = EnergyFlow.getElementById("flowSensorBoard");
  const flowDown = EnergyFlow.getElementById("flowBoardModem");
  if (!flowUp || !flowDown) return;

  if (direction === "uplink") {
    flowUp.style.opacity = "1";
    setTimeout(() => (flowUp.style.opacity = "0.4"), 1200);
  } else if (direction === "downlink") {
    flowDown.style.opacity = "1";
    setTimeout(() => (flowDown.style.opacity = "0.4"), 1200);
  }
}

function animateUplinkFlow() {
  const svgDoc = document.getElementById("EnergyFlowSvg")?.contentDocument;
  if (!svgDoc) return;

  const payload = svgDoc.getElementById("payload-up");
  const path = svgDoc.getElementById("path-up");
  if (!payload || !path) return;

  // Mostra la pallina
  payload.style.opacity = 1;

  // Usa animateMotion dinamico
  const animateMotion = svgDoc.createElementNS("http://www.w3.org/2000/svg", "animateMotion");
  animateMotion.setAttribute("dur", "1.8s");
  animateMotion.setAttribute("fill", "freeze");
  animateMotion.setAttribute("begin", "indefinite");

  const mpath = svgDoc.createElementNS("http://www.w3.org/2000/svg", "mpath");
  mpath.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#path-up");
  animateMotion.appendChild(mpath);
  payload.appendChild(animateMotion);

  // Avvia animazione
  animateMotion.beginElement();

  // Rimuovi animazione dopo che finisce
  setTimeout(() => {
    payload.style.opacity = 0;
    payload.removeChild(animateMotion);
  }, 1800);
}


function animateDownlinkFlow() {
  const svgDoc = document.getElementById("EnergyFlowSvg")?.contentDocument;
  if (!svgDoc) return;

  const payload = svgDoc.getElementById("payload-down");
  const path = svgDoc.getElementById("path-up"); // <-- usa la stessa curva
  if (!payload || !path) return;

  payload.style.opacity = 1;

  // Ottiene la lunghezza totale del path
  const totalLength = path.getTotalLength();

  // Crea l'animazione manuale da destra a sinistra
  const startTime = performance.now();
  const duration = 1800; // ms

  function animate(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // calcola posizione inversa (1 - t)
    const point = path.getPointAtLength(totalLength * (1 - t));

    payload.setAttribute("cx", point.x);
    payload.setAttribute("cy", point.y);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      payload.style.opacity = 0;
    }
  }

  requestAnimationFrame(animate);
}


// ======================
// ESPORTAZIONE
// ======================
document.getElementById("btn-export-chart").addEventListener("click", exportChart);
document.getElementById("btn-export-data").addEventListener("click", exportData);

function exportChart() {
  const canvas = chartMode === "single"
    ? document.getElementById("chart-main")
    : document.getElementById("chart-x");
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `grafico_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  link.click();
}

function exportData() {
  if (!dataHistory.length) {
    showToast("Nothing to export", "warning");
    return;
  }

  // helper per 3 cifre decimali
  const fmt3 = (v) =>
    typeof v === "number" && !isNaN(v) ? v.toFixed(3) : "";

  const header =
    "Time_ISO;X_deg;Y_deg;Z_deg;Temp_C;RSSI_dBm;SNR_dB;Freq_MHz;FCNT\n";

  const rows = dataHistory
    .map((p) => {
      const m = p.meta || {};
      return [
        p.time.toISOString(),                    // timestamp ISO
        fmt3(p.x),
        fmt3(p.y),
        fmt3(p.z),
        fmt3(p.temp),
        m.rssi ?? "",
        typeof m.snr === "number" ? m.snr.toFixed(1) : "",
        typeof m.frequency === "number"
          ? (m.frequency / 1e6).toFixed(3)
          : "",
        m.fCnt ?? "",
      ].join(";");
    })
    .join("\n");

  const csv = header + rows + "\n";

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `storico_${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}



// ======================
// SALVATAGGIO LOCALE
// ======================
window.addEventListener("beforeunload", saveToLocal);
window.addEventListener("load", loadFromLocal);

function saveToLocal() {
  try {
    localStorage.setItem("dataHistory", JSON.stringify(dataHistory));
    localStorage.setItem("logs", JSON.stringify(logs));
    showAutoSaveBadge(); // <-- mostra il badge ogni volta che salvi
  } catch (e) {
    console.warn("Error saving to local storage:", e);
  }
}

function resetDashboard() {
  const ok = confirm("Are you sure you want to reset all local data?");
  if (!ok) return;

  // Svuota array in memoria
  dataHistory.length = 0;
  logs.length = 0;

  // Aggiorna grafici e log
  updateCharts();
  renderLogs();
  els.historyList.innerHTML = "";
  els.logCount.textContent = "0 eventi";

  // Reset valori istantanei
  if (els.statX) els.statX.textContent = "–";
  if (els.statY) els.statY.textContent = "–";
  if (els.statZ) els.statZ.textContent = "–";
  if (els.statTemp) els.statTemp.textContent = "–";

  if (els.rfRssi) els.rfRssi.textContent = "–";
  if (els.rfSnr) els.rfSnr.textContent = "–";
  if (els.rfFreq) els.rfFreq.textContent = "–";
  if (els.rfFcnt) els.rfFcnt.textContent = "–";

  // Reset estremi
  if (els.extXMin) els.extXMin.textContent = "–";
  if (els.extXMax) els.extXMax.textContent = "–";
  if (els.extYMin) els.extYMin.textContent = "–";
  if (els.extYMax) els.extYMax.textContent = "–";
  if (els.extZMin) els.extZMin.textContent = "–";
  if (els.extZMax) els.extZMax.textContent = "–";
  if (els.extTMin) els.extTMin.textContent = "–";
  if (els.extTMax) els.extTMax.textContent = "–";

  // Pulisci JSON raw MQTT
  if (els.mqttRaw) els.mqttRaw.textContent = "";

  // Chiudi pannello storico se aperto
  if (els.historyPanel) els.historyPanel.classList.remove("history-panel-open");

  // Pulisci storage
  localStorage.removeItem("dataHistory");
  localStorage.removeItem("logs");

  showToast("Dashboard reset.", "success");
}



function loadFromLocal() {
  const savedData = localStorage.getItem("dataHistory");
  const savedLogs = localStorage.getItem("logs");
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData);
      parsed.forEach(p => (p.time = new Date(p.time)));
      dataHistory.splice(0, dataHistory.length, ...parsed);
      updateCharts();
    } catch (e) {
      console.warn("Error loading history:", e);
    }
  }
  if (savedLogs) {
    try {
      const parsed = JSON.parse(savedLogs);
      logs.splice(0, logs.length, ...parsed);
      renderLogs();
    } catch (e) {
      console.warn("Error loading logs:", e);
    }
  }
}

// ======================
// BADGE AUTO-SALVATO
// ======================
let autosaveTimer = null;

function showAutoSaveBadge() {
  const badge = document.getElementById("autosave-badge");
  if (!badge) return;

  badge.classList.remove("hidden");
  badge.classList.add("show");

  // Rigenera l’icona Lucide (in caso non fosse già creata)
  if (window.lucide) window.lucide.createIcons({ icons: ["save"] });

  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    badge.classList.remove("show");
    setTimeout(() => badge.classList.add("hidden"), 250);
    setTimeout(() => badge.classList.add("hidden"), 250);
  }, 1800);
}

