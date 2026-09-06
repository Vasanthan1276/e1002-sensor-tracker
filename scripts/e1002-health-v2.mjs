import fs from "fs";
import path from "path";

const DEVICE_ID = "20230256";
const RETENTION_DAYS = 366;
const MINIMUM_SPACING_MINUTES = 50;
const DEVICE_MAC = "9C:13:9E:AB:F6:94";

const IOT_ENDPOINT =
  `https://sensecraft-hmi-api.seeed.cc/api/v1/user/device/iot_data/${DEVICE_ID}`;

const DEVICE_LIST_ENDPOINT =
  "https://sensecraft-hmi-api.seeed.cc/api/v2/user/device/list";

const DATA_DIR = "data";
const HISTORY_FILE = path.join(DATA_DIR, "sensor-history.json");
const CSV_FILE = path.join(DATA_DIR, "e1002-status-history.csv");
const DASHBOARD_FILE = "index.html";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function statusLabel(rawStatus) {
  if (rawStatus === 1) return "Online";
  if (rawStatus === 3) return "Sleep";
  if (rawStatus === 0) return "Offline";

  return Number.isFinite(rawStatus)
    ? `Unknown (${rawStatus})`
    : "Status unavailable";
}

function normalizeLastSeen(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const milliseconds =
    numeric < 100000000000 ? numeric * 1000 : numeric;

  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function findTargetDevice(payload) {
  const result = payload?.result;

  const devices =
    Array.isArray(result)
      ? result
      : result?.list ||
        result?.devices ||
        result?.items ||
        result?.rows ||
        result?.data ||
        [];

  if (!Array.isArray(devices)) return null;

  const normalizedMac = DEVICE_MAC.toLowerCase();

  return (
    devices.find(item => String(item?.id) === String(DEVICE_ID)) ||
    devices.find(
      item =>
        String(
          item?.mac_address ??
          item?.macAddress ??
          ""
        ).toLowerCase() === normalizedMac
    ) ||
    null
  );
}

async function fetchWithRetry(url, options, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          `SenseCraft API failed: ${response.status} ${text}`
        );
      }

      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      console.error(
        `SenseCraft API attempt ${attempt}/${attempts} failed:`,
        error.message
      );

      if (attempt < attempts) {
        await sleep(attempt * 5000);
      }
    }
  }

  throw lastError;
}

function formatSingaporeTimestamp(timestamp) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(new Date(timestamp));
}

function formatSingaporeHour(timestamp) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

const metricConfig = {
  battery: {
    minSpan: 10,
    increment: 5,
    hardMin: 0,
    hardMax: 100,
    decimals: 0
  },
  temperature: {
    minSpan: 3,
    increment: 0.5,
    hardMin: null,
    hardMax: null,
    decimals: 1
  },
  humidity: {
    minSpan: 15,
    increment: 5,
    hardMin: 0,
    hardMax: 100,
    decimals: 0
  }
};

function getSmartRange(values, metric) {
  const cfg = metricConfig[metric];
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const dataSpan = Math.max(dataMax - dataMin, 0);
  const center = (dataMin + dataMax) / 2;

  let low;
  let high;

  if (dataSpan < cfg.minSpan) {
    low = center - cfg.minSpan / 2;
    high = center + cfg.minSpan / 2;
  } else {
    const pad = Math.max(dataSpan * 0.12, cfg.increment);
    low = dataMin - pad;
    high = dataMax + pad;
  }

  let min = Math.round(low / cfg.increment) * cfg.increment;
  let max = Math.round(high / cfg.increment) * cfg.increment;

  while (min > dataMin) min -= cfg.increment;
  while (max < dataMax) max += cfg.increment;

  if (cfg.hardMin !== null) min = Math.max(cfg.hardMin, min);
  if (cfg.hardMax !== null) max = Math.min(cfg.hardMax, max);

  if (max <= min) max = min + cfg.increment;

  return { min, max };
}

function axisText(value, metric) {
  return metric === "temperature"
    ? value.toFixed(1)
    : Math.round(value);
}

function buildChartSvg(readings, metric) {
  const width = 570;
  const height = 86;
  const p = { top: 8, right: 8, bottom: 20, left: 31 };
  const plotW = width - p.left - p.right;
  const plotH = height - p.top - p.bottom;

  const values = readings.map(item => Number(item[metric]));
  const yRange = getSmartRange(values, metric);

  const endTime =
    new Date(readings[readings.length - 1].timestamp).getTime();
  const startTime = endTime - 24 * 60 * 60 * 1000;
  const timeSpan = 24 * 60 * 60 * 1000;

  const grid = [];
  const labels = [];

  for (let i = 0; i <= 3; i += 1) {
    const y = p.top + (plotH / 3) * i;
    const value =
      yRange.max - ((yRange.max - yRange.min) / 3) * i;

    grid.push(
      `<line x1="${p.left}" y1="${y.toFixed(1)}" ` +
      `x2="${width - p.right}" y2="${y.toFixed(1)}" ` +
      `stroke="#d7d7d7" stroke-width="1"/>`
    );

    labels.push(
      `<text x="${p.left - 4}" y="${(y + 3).toFixed(1)}" ` +
      `text-anchor="end" font-size="8" fill="#666">` +
      `${axisText(value, metric)}</text>`
    );
  }

  const points = readings.map(reading => {
    const time = new Date(reading.timestamp).getTime();
    const x =
      p.left + ((time - startTime) / timeSpan) * plotW;

    const normalized =
      (Number(reading[metric]) - yRange.min) /
      (yRange.max - yRange.min);

    const y = p.top + plotH - normalized * plotH;
    return { x, y };
  });

  const trend =
    points.length > 1
      ? `<polyline points="${points
          .map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(" ")}" fill="none" stroke="#111" stroke-width="2" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`
      : "";

  const dots = points
    .map(
      (point, index) =>
        `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" ` +
        `r="${index === points.length - 1 ? 2.7 : 1.7}" fill="#111"/>`
    )
    .join("");

  const xTicks = Array.from({ length: 7 }, (_, i) => i)
    .map(i => {
      const fraction = i / 6;
      const time = startTime + timeSpan * fraction;
      const x = p.left + plotW * fraction;
      const anchor = i === 0 ? "start" : i === 6 ? "end" : "middle";
      const label = formatSingaporeHour(new Date(time).toISOString());

      return `
        <line x1="${x.toFixed(1)}" y1="${height - p.bottom}"
          x2="${x.toFixed(1)}" y2="${height - p.bottom + 3}"
          stroke="#111" stroke-width="1"/>
        <text x="${x.toFixed(1)}" y="${height - 5}"
          text-anchor="${anchor}" font-size="8" fill="#555">${label}</text>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg">
      ${grid.join("")}
      ${labels.join("")}
      <line x1="${p.left}" y1="${p.top}" x2="${p.left}"
        y2="${height - p.bottom}" stroke="#111" stroke-width="1"/>
      <line x1="${p.left}" y1="${height - p.bottom}"
        x2="${width - p.right}" y2="${height - p.bottom}"
        stroke="#111" stroke-width="1"/>
      ${trend}
      ${dots}
      ${xTicks}
    </svg>
  `;
}

function formatDelta(value, unit, decimals) {
  const rounded = Number(value).toFixed(decimals);
  const numeric = Number(rounded);
  const prefix = numeric > 0 ? "+" : numeric < 0 ? "−" : "";

  return `${prefix}${Math.abs(numeric).toFixed(decimals)}${unit}`;
}

function generateStaticDashboard(history) {
  const allReadings = (history.readings || [])
    .filter(
      item =>
        item.timestamp &&
        Number.isFinite(Number(item.battery)) &&
        Number.isFinite(Number(item.temperature)) &&
        Number.isFinite(Number(item.humidity))
    )
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime()
    );

  if (!allReadings.length) {
    throw new Error(
      "Cannot generate static dashboard because there are no valid readings."
    );
  }

  const latest = allReadings[allReadings.length - 1];
  const latestTime = new Date(latest.timestamp).getTime();
  const cutoff = latestTime - 24 * 60 * 60 * 1000;

  let readings = allReadings.filter(
    item => new Date(item.timestamp).getTime() >= cutoff
  );

  if (!readings.length) readings = [latest];

  const batteryValues = readings.map(item => Number(item.battery));
  const temperatureValues = readings.map(item => Number(item.temperature));
  const humidityValues = readings.map(item => Number(item.humidity));

  const battery = Number(latest.battery).toFixed(0);
  const temperature = Number(latest.temperature).toFixed(1);
  const humidity = Number(latest.humidity).toFixed(0);

  const batteryMin = Math.min(...batteryValues).toFixed(0);
  const batteryMax = Math.max(...batteryValues).toFixed(0);
  const temperatureMin = Math.min(...temperatureValues).toFixed(1);
  const temperatureMax = Math.max(...temperatureValues).toFixed(1);
  const humidityMin = Math.min(...humidityValues).toFixed(0);
  const humidityMax = Math.max(...humidityValues).toFixed(0);

  const first = readings[0];
  const batteryDelta = formatDelta(
    Number(latest.battery) - Number(first.battery), "%", 0
  );
  const temperatureDelta = formatDelta(
    Number(latest.temperature) - Number(first.temperature), "°C", 1
  );
  const humidityDelta = formatDelta(
    Number(latest.humidity) - Number(first.humidity), "%", 0
  );

  const updated = formatSingaporeTimestamp(
    history.updatedAt || latest.timestamp
  );

  const latestStatus = latest.status || "Status unavailable";

  const latestLastSeen =
    latest.lastSeen
      ? new Intl.DateTimeFormat("en-SG", {
          timeZone: "Asia/Singapore",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true
        }).format(new Date(latest.lastSeen))
      : "n/a";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>E1002 Health Monitor</title>

  <style>
    :root {
      --ink: #111;
      --muted: #666;
      --grid: #d7d7d7;
      --paper: #fff;
    }

    * { box-sizing: border-box; }

    html, body {
      width: 800px;
      height: 480px;
      margin: 0;
      overflow: hidden;
      background: var(--paper);
      color: var(--ink);
      font-family: Arial, Helvetica, sans-serif;
    }

    #app {
      width: 800px;
      height: 480px;
      padding: 14px 18px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    header {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid var(--ink);
      padding-bottom: 7px;
    }

    h1 {
      margin: 0;
      font-size: 22px;
    }

    .subtitle, .updated, .footer, .range, .change {
      color: var(--muted);
      font-size: 10px;
    }

    .subtitle { margin-top: 3px; }

    .updated {
      text-align: right;
      line-height: 1.4;
    }

    .updated strong {
      color: var(--ink);
      font-size: 12px;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }

    .card {
      border: 1px solid var(--ink);
      padding: 7px 10px;
      min-height: 55px;
    }

    .label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .value {
      margin-top: 3px;
      font-size: 27px;
      font-weight: 700;
    }

    .charts {
      flex: 1;
      display: grid;
      grid-template-rows: repeat(3, 1fr);
      gap: 7px;
      min-height: 0;
    }

    .chart-box {
      display: grid;
      grid-template-columns: 150px 1fr;
      border: 1px solid var(--ink);
      min-height: 0;
      padding: 5px 8px;
    }

    .chart-info {
      border-right: 1px solid var(--grid);
      padding: 5px 9px 4px 0;
    }

    .chart-title {
      font-size: 13px;
      font-weight: 700;
    }

    .chart-value {
      margin-top: 3px;
      font-size: 24px;
      font-weight: 700;
    }

    .change { margin-top: 2px; }

    .chart-wrap {
      height: 86px;
      min-width: 0;
      padding-left: 8px;
    }

    svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .footer {
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>

<body>
  <!--
    AUTO-GENERATED BY GITHUB ACTIONS.
    DO NOT EDIT THIS FILE MANUALLY.
    E1002 Health Monitor v3 - rolling 24h + dynamic chart scales.
  -->

  <main id="app">
    <header>
      <div>
        <h1>E1002 Health Monitor</h1>
        <div class="subtitle">
          Battery, temperature and humidity · rolling last 24 hours
        </div>
      </div>

      <div class="updated">
        <strong>${updated}</strong><br>
        Last sensor record
      </div>
    </header>

    <section class="cards">
      <div class="card">
        <div class="label">Battery</div>
        <div class="value">${battery}%</div>
      </div>
      <div class="card">
        <div class="label">Temperature</div>
        <div class="value">${temperature}°C</div>
      </div>
      <div class="card">
        <div class="label">Humidity</div>
        <div class="value">${humidity}%</div>
      </div>
    </section>

    <section class="charts">
      <article class="chart-box">
        <div class="chart-info">
          <div class="chart-title">Battery level</div>
          <div class="chart-value">${battery}%</div>
          <div class="change">24h Δ: ${batteryDelta}</div>
          <div class="range">Range: ${batteryMin}–${batteryMax}%</div>
        </div>
        <div class="chart-wrap">
          ${buildChartSvg(readings, "battery")}
        </div>
      </article>

      <article class="chart-box">
        <div class="chart-info">
          <div class="chart-title">Temperature</div>
          <div class="chart-value">${temperature}°C</div>
          <div class="change">24h Δ: ${temperatureDelta}</div>
          <div class="range">Range: ${temperatureMin}–${temperatureMax}°C</div>
        </div>
        <div class="chart-wrap">
          ${buildChartSvg(readings, "temperature")}
        </div>
      </article>

      <article class="chart-box">
        <div class="chart-info">
          <div class="chart-title">Humidity</div>
          <div class="chart-value">${humidity}%</div>
          <div class="change">24h Δ: ${humidityDelta}</div>
          <div class="range">Range: ${humidityMin}–${humidityMax}%</div>
        </div>
        <div class="chart-wrap">
          ${buildChartSvg(readings, "humidity")}
        </div>
      </article>
    </section>

    <div class="footer">
      <span>Status: ${latestStatus} · Last seen: ${latestLastSeen}</span>
      <span>Static v3 · rolling 24h · retained: ${RETENTION_DAYS} days</span>
    </div>
  </main>
</body>
</html>
`;
}

async function main() {
  if (!process.env.SENSECRAFT_API_KEY) {
    throw new Error("SENSECRAFT_API_KEY is missing.");
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  let history = {
    updatedAt: null,
    readings: []
  };

  if (fs.existsSync(HISTORY_FILE)) {
    history = JSON.parse(
      fs.readFileSync(HISTORY_FILE, "utf8")
    );
  }

  history.readings =
    Array.isArray(history.readings)
      ? history.readings
      : [];

  const eventName = process.env.GITHUB_EVENT_NAME;
  const lastReading =
    history.readings.length > 0
      ? history.readings[history.readings.length - 1]
      : null;

  if (
    eventName === "schedule" &&
    lastReading?.timestamp
  ) {
    const lastTime = new Date(lastReading.timestamp).getTime();
    const minutesSinceLastReading =
      (Date.now() - lastTime) / 60000;

    if (
      Number.isFinite(minutesSinceLastReading) &&
      minutesSinceLastReading < MINIMUM_SPACING_MINUTES
    ) {
      console.log(
        `Last reading was ${minutesSinceLastReading.toFixed(1)} minutes ago.`
      );
      console.log(
        `Minimum spacing is ${MINIMUM_SPACING_MINUTES} minutes.`
      );
      console.log(
        "Backup run only; nothing new will be saved."
      );
      return;
    }
  }

  const requestOptions = {
    headers: {
      "Api-Key": process.env.SENSECRAFT_API_KEY,
      "Accept": "application/json"
    }
  };

  const iotPayload = await fetchWithRetry(
    IOT_ENDPOINT,
    requestOptions
  );

  if (iotPayload.code !== 200 || !iotPayload.result) {
    throw new Error(
      `Unexpected SenseCraft IOT response: ${JSON.stringify(iotPayload)}`
    );
  }

  const result = iotPayload.result;
  const intervalSeconds = Number(result?.dataaccess?.interval);

  let device = null;
  let statusSource = "v2-device-list";

  try {
    const devicePayload = await fetchWithRetry(
      DEVICE_LIST_ENDPOINT,
      requestOptions
    );

    if (devicePayload.code !== 200) {
      throw new Error(
        `Unexpected device-list response: ${JSON.stringify(devicePayload)}`
      );
    }

    device = findTargetDevice(devicePayload);

    if (!device) {
      throw new Error(
        `Device ${DEVICE_ID} / ${DEVICE_MAC} was not found in device list.`
      );
    }
  } catch (error) {
    console.error(
      "SenseCraft device-list status lookup failed:",
      error.message
    );
    statusSource = "iot-data-fallback";
  }

  const listRawStatus = Number(device?.online_status);
  const fallbackRawStatus = Number(result?.deviceStatus?.status);

  const rawStatus =
    Number.isFinite(listRawStatus)
      ? listRawStatus
      : Number.isFinite(fallbackRawStatus)
        ? fallbackRawStatus
        : null;

  const pollTimestamp = new Date().toISOString();
  const lastSeen = normalizeLastSeen(device?.last_seen);

  const lastSeenAgeMinutes =
    lastSeen
      ? Math.max(
          0,
          Math.round(
            (
              new Date(pollTimestamp).getTime() -
              new Date(lastSeen).getTime()
            ) / 60000
          )
        )
      : null;

  const reading = {
    timestamp: pollTimestamp,
    deviceId: DEVICE_ID,

    battery: Number(
      result?.battery?.level ??
      result?.battery?.voltage ??
      result?.battery?.value
    ),

    charging: Boolean(result?.battery?.charging),

    temperature: Number(
      result?.sensor?.temp ??
      result?.sensor?.temperature
    ),

    humidity: Number(result?.sensor?.humidity),

    status: statusLabel(rawStatus),
    rawStatus,
    statusSource,
    lastSeen,
    lastSeenAgeMinutes,

    refreshIntervalMinutes:
      Number.isFinite(intervalSeconds)
        ? Math.round(intervalSeconds / 60)
        : null,

    deepSleepDisabled:
      result?.power?.deep_sleep_disabled === undefined
        ? null
        : Number(result.power.deep_sleep_disabled),

    targetDeepSleepEnabled:
      device?.target_deep_sleep_enabled === undefined
        ? null
        : Number(device.target_deep_sleep_enabled)
  };

  for (const key of ["battery", "temperature", "humidity"]) {
    if (!Number.isFinite(reading[key])) {
      throw new Error(
        `Invalid ${key} value from SenseCraft API.`
      );
    }
  }

  const cutoff =
    Date.now() -
    RETENTION_DAYS * 24 * 60 * 60 * 1000;

  history.readings.push(reading);

  history.readings = history.readings
    .filter(item => {
      const time = new Date(item.timestamp).getTime();
      return Number.isFinite(time) && time >= cutoff;
    })
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime()
    );

  history.updatedAt = reading.timestamp;

  fs.writeFileSync(
    HISTORY_FILE,
    `${JSON.stringify(history, null, 2)}\n`,
    "utf8"
  );

  const csvHeader = [
    "timestamp",
    "deviceId",
    "status",
    "rawStatus",
    "statusSource",
    "lastSeen",
    "lastSeenAgeMinutes",
    "battery",
    "charging",
    "temperature",
    "humidity",
    "refreshIntervalMinutes",
    "deepSleepDisabled",
    "targetDeepSleepEnabled"
  ];

  const csvRows = history.readings.map(item => [
    item.timestamp,
    item.deviceId ?? "",
    item.status ?? "Status unavailable",
    item.rawStatus ?? "",
    item.statusSource ?? "",
    item.lastSeen ?? "",
    item.lastSeenAgeMinutes ?? "",
    item.battery ?? "",
    item.charging ?? "",
    item.temperature ?? "",
    item.humidity ?? "",
    item.refreshIntervalMinutes ?? "",
    item.deepSleepDisabled ?? "",
    item.targetDeepSleepEnabled ?? ""
  ]);

  const csvContent = [
    csvHeader.map(csvEscape).join(","),
    ...csvRows.map(row => row.map(csvEscape).join(","))
  ].join("\n") + "\n";

  fs.writeFileSync(CSV_FILE, csvContent, "utf8");

  fs.writeFileSync(
    DASHBOARD_FILE,
    generateStaticDashboard(history),
    "utf8"
  );

  console.log("Saved E1002 reading:", reading);
  console.log(
    `SenseCraft status: ${reading.status} ` +
    `(raw=${reading.rawStatus ?? "n/a"}, source=${reading.statusSource}).`
  );
  console.log(
    `SenseCraft last seen: ${reading.lastSeen ?? "n/a"} ` +
    `(${reading.lastSeenAgeMinutes ?? "n/a"} min ago).`
  );
  console.log(
    `E1002 reports refresh interval: ` +
    `${reading.refreshIntervalMinutes} minutes.`
  );
  console.log(
    `Generated rolling-24h static dashboard: ${DASHBOARD_FILE}`
  );
  console.log(
    `Retaining ${RETENTION_DAYS} days of history.`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
