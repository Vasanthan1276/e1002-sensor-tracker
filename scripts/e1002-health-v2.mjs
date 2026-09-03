import fs from "fs";
import path from "path";

const DEVICE_ID = "20230256";
const RETENTION_DAYS = 366;
const MINIMUM_SPACING_MINUTES = 50;

const ENDPOINT =
  `https://sensecraft-hmi-api.seeed.cc/api/v1/user/device/iot_data/${DEVICE_ID}`;

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
  return "Unknown";
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

const singaporeDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function singaporeDayKey(timestamp) {
  const parts = singaporeDayFormatter.formatToParts(new Date(timestamp));
  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function singaporeMinutesSinceMidnight(timestamp) {
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(timestamp));

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  return values.hour * 60 + values.minute;
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

function getRange(values, padding) {
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    return { min: min - padding, max: max + padding };
  }

  const extra = Math.max((max - min) * 0.18, padding);
  return { min: min - extra, max: max + extra };
}

function buildChartSvg(readings, metric, fixedRange = null) {
  const width = 570;
  const height = 86;
  const p = { top: 8, right: 8, bottom: 20, left: 31 };
  const plotW = width - p.left - p.right;
  const plotH = height - p.top - p.bottom;

  const values = readings.map(item => Number(item[metric]));
  const yRange =
    fixedRange ||
    getRange(values, metric === "battery" ? 4 : 0.8);

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
      `text-anchor="end" font-size="8" fill="#666">${
        metric === "battery" ? Math.round(value) : value.toFixed(1)
      }</text>`
    );
  }

  const points = readings.map(reading => {
    const x =
      p.left +
      (singaporeMinutesSinceMidnight(reading.timestamp) / 1440) *
        plotW;

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
      point =>
        `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" ` +
        `r="2" fill="#111"/>`
    )
    .join("");

  const xTicks = [0, 4, 8, 12, 16, 20, 24]
    .map(hour => {
      const x = p.left + ((hour * 60) / 1440) * plotW;
      const anchor = hour === 24 ? "end" : "middle";
      const label =
        hour === 24 ? "24" : String(hour).padStart(2, "0");

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

  const todayKey = singaporeDayKey(new Date().toISOString());

  let readings = allReadings.filter(
    item => singaporeDayKey(item.timestamp) === todayKey
  );

  if (!readings.length) {
    readings = [allReadings[allReadings.length - 1]];
  }

  const latest = readings[readings.length - 1];

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

  const updated = formatSingaporeTimestamp(
    history.updatedAt || latest.timestamp
  );

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

    .subtitle, .updated, .footer, .range {
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
      grid-template-columns: 145px 1fr;
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
      margin-top: 5px;
      font-size: 25px;
      font-weight: 700;
    }

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
    E1002 Health Monitor v2 - fully static page.
  -->

  <main id="app">
    <header>
      <div>
        <h1>E1002 Health Monitor</h1>
        <div class="subtitle">
          Battery, temperature and humidity · today's hourly trend
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
          <div class="range">
            Today range: ${batteryMin}–${batteryMax}%
          </div>
        </div>
        <div class="chart-wrap">
          ${buildChartSvg(readings, "battery", { min: 0, max: 100 })}
        </div>
      </article>

      <article class="chart-box">
        <div class="chart-info">
          <div class="chart-title">Temperature</div>
          <div class="chart-value">${temperature}°C</div>
          <div class="range">
            Today range: ${temperatureMin}–${temperatureMax}°C
          </div>
        </div>
        <div class="chart-wrap">
          ${buildChartSvg(readings, "temperature")}
        </div>
      </article>

      <article class="chart-box">
        <div class="chart-info">
          <div class="chart-title">Humidity</div>
          <div class="chart-value">${humidity}%</div>
          <div class="range">
            Today range: ${humidityMin}–${humidityMax}%
          </div>
        </div>
        <div class="chart-wrap">
          ${buildChartSvg(readings, "humidity", { min: 0, max: 100 })}
        </div>
      </article>
    </section>

    <div class="footer">
      <span>Generated hourly from SenseCraft HMI</span>
      <span>Static v2 · data retained: ${RETENTION_DAYS} days</span>
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

  const payload = await fetchWithRetry(ENDPOINT, {
    headers: {
      "Api-Key": process.env.SENSECRAFT_API_KEY,
      "Accept": "application/json"
    }
  });

  if (payload.code !== 200 || !payload.result) {
    throw new Error(
      `Unexpected SenseCraft response: ${JSON.stringify(payload)}`
    );
  }

  const result = payload.result;
  const rawStatus = Number(result?.deviceStatus?.status);
  const intervalSeconds = Number(result?.dataaccess?.interval);

  const reading = {
    timestamp: new Date().toISOString(),
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

    rawStatus:
      Number.isFinite(rawStatus)
        ? rawStatus
        : null,

    refreshIntervalMinutes:
      Number.isFinite(intervalSeconds)
        ? Math.round(intervalSeconds / 60)
        : null,

    deepSleepDisabled:
      result?.power?.deep_sleep_disabled === undefined
        ? null
        : Number(result.power.deep_sleep_disabled)
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
    "battery",
    "charging",
    "temperature",
    "humidity",
    "refreshIntervalMinutes",
    "deepSleepDisabled"
  ];

  const csvRows = history.readings.map(item => [
    item.timestamp,
    item.deviceId ?? "",
    item.status ?? "Unknown",
    item.rawStatus ?? "",
    item.battery ?? "",
    item.charging ?? "",
    item.temperature ?? "",
    item.humidity ?? "",
    item.refreshIntervalMinutes ?? "",
    item.deepSleepDisabled ?? ""
  ]);

  const csvContent = [
    csvHeader.map(csvEscape).join(","),
    ...csvRows.map(row =>
      row.map(csvEscape).join(",")
    )
  ].join("\n") + "\n";

  fs.writeFileSync(CSV_FILE, csvContent, "utf8");

  fs.writeFileSync(
    DASHBOARD_FILE,
    generateStaticDashboard(history),
    "utf8"
  );

  console.log("Saved E1002 reading:", reading);
  console.log(
    `E1002 reports refresh interval: ${reading.refreshIntervalMinutes} minutes.`
  );
  console.log(
    `Generated fully static dashboard: ${DASHBOARD_FILE}`
  );
  console.log(
    `Retaining ${RETENTION_DAYS} days of history.`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
