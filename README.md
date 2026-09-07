# E1002 Sensor Tracker

A monitoring, history, dashboard, and troubleshooting project for a **Seeed Studio reTerminal E1002** running **SenseCraft HMI**.

The repository records battery, temperature, humidity, sleep/online status, and SenseCraft cloud-contact information. It retains the history in GitHub and serves:

1. a direct **800 × 480 `health.bmp`** for the physical E1002;
2. a generated static `index.html` used as the deterministic BMP render source and browser preview;
3. a richer `homeassistant.html` history dashboard.

The project was also used to diagnose and resolve the earlier E1002 battery-drain / wake-sleep problem.

---

# Current status

**Status: stable / battery-drain issue resolved**

Current working device configuration:

```text
Firmware:       SenseCraft HMI v1.1.4
Deep sleep:     Enabled
Refresh:        60 minutes
Wi-Fi:          2.4 GHz
Access point:   Fixed nearby node
Result:         Stable
```

SenseCraft HMI **v1.1.5** was the leading cause of the earlier intermittent wake/sleep, connectivity, and excessive battery-drain behaviour on this E1002.

Rolling back to **v1.1.4** restored:

- automatic wake cycles;
- scheduled display refresh;
- SenseCraft telemetry reporting;
- return to deep sleep;
- normal battery consumption.

Current recommendation:

> Remain on SenseCraft HMI v1.1.4 until a later release is specifically verified to resolve the regression.

---

# Production URLs

## Physical E1002 — direct BMP

Use this URL in **SenseCraft HMI**:

```text
https://vasanthan1276.github.io/e1002-sensor-tracker/health.bmp
```

Production resolution:

```text
800 × 480
```

The physical E1002 should use `health.bmp`.

## Browser / diagnostic E1002 preview

```text
https://vasanthan1276.github.io/e1002-sensor-tracker/
```

or:

```text
https://vasanthan1276.github.io/e1002-sensor-tracker/index.html
```

`index.html` is the generated source that GitHub Actions renders into `health.bmp`.

## Home Assistant

```text
https://vasanthan1276.github.io/e1002-sensor-tracker/homeassistant.html
```

The Home Assistant page remains HTML because it is intentionally interactive and supports selectable history periods.

---

# BMP-first E1002 architecture

From September 2026 onward, physical E1002 pages follow the common project standard:

```text
SenseCraft APIs
      ↓
GitHub Actions
      ↓
Retained sensor history
      ↓
Generated static index.html
      ↓
Headless Chromium at 800×480
      ↓
health.bmp
      ↓
SenseCraft HMI
      ↓
reTerminal E1002
```

The physical E1002 does **not** need to:

- call the SenseCraft API to build the Health Monitor;
- process the retained history;
- calculate chart ranges;
- generate SVG trend charts;
- execute JavaScript;
- wait for dynamic page rendering.

All of that work happens in GitHub.

---

# What this repository does

The repository performs five main jobs:

1. polls SenseCraft for the E1002's latest telemetry;
2. records approximately one year of history;
3. tracks device status and last cloud contact;
4. generates the static 800×480 Health Monitor source;
5. renders the finished Health Monitor to `health.bmp`.

The GitHub capture workflow is independent of the E1002's own wake cycle.

GitHub checks several times per hour, while the capture script normally saves approximately one reading per hour.

---

# Repository structure

Important files:

```text
e1002-sensor-tracker/
│
├── .github/
│   └── workflows/
│       └── capture-e1002-history.yml
│
├── data/
│   ├── sensor-history.json
│   └── e1002-status-history.csv
│
├── scripts/
│   ├── e1002-health-v2.mjs
│   ├── render-e1002-bmp.mjs
│   └── png_to_bmp.py
│
├── health.bmp
├── index.html
├── homeassistant.html
└── README.md
```

---

# Main capture and dashboard generator

Main script:

```text
scripts/e1002-health-v2.mjs
```

It:

- calls the SenseCraft telemetry API;
- calls the SenseCraft device-list API;
- normalizes device status;
- records battery percentage;
- records charging state;
- records temperature;
- records humidity;
- records device/cloud timing information;
- records `lastSeen`;
- records `lastSeenAgeMinutes`;
- retains approximately 366 days of history;
- regenerates the static E1002 Health Monitor in `index.html`.

Although the filename contains `v2`, the current visual output is the newer **Static v3** Health Monitor.

Do not normally edit generated `index.html` directly.

Make persistent E1002 dashboard changes in:

```text
scripts/e1002-health-v2.mjs
```

---

# GitHub Actions capture workflow

Workflow:

```text
.github/workflows/capture-e1002-history.yml
```

Workflow name:

```text
Capture E1002 Sensor History
```

Scheduled opportunities:

```cron
7,22,37,52 * * * *
```

This gives four GitHub Actions opportunities each hour.

The existing capture script applies:

```text
MINIMUM_SPACING_MINUTES = 50
```

to normal scheduled runs, so retained history remains approximately hourly.

Manual `workflow_dispatch` runs remain available for testing.

---

# BMP generation flow

After the sensor/history generator creates `index.html`, the workflow runs:

```text
scripts/render-e1002-bmp.mjs
```

The renderer:

1. starts a temporary local static server inside GitHub Actions;
2. opens `index.html` in headless Chromium;
3. uses an exact 800×480 browser viewport;
4. forces the document canvas to 800×480 with hidden overflow;
5. waits for fonts to finish loading;
6. captures an explicit 800×480 image clip;
7. converts the intermediate PNG to BMP;
8. writes:

```text
health.bmp
```

The conversion script:

```text
scripts/png_to_bmp.py
```

checks that the source image is exactly:

```text
800 × 480
```

before saving the final RGB BMP.

---

# Files committed by the capture workflow

Normal generated/updated files include:

```text
data/sensor-history.json
data/e1002-status-history.csv
index.html
health.bmp
```

`homeassistant.html` is maintained separately because it is not regenerated by every sensor capture run.

---

# SenseCraft API information captured

The project records:

| Field | Purpose |
|---|---|
| `timestamp` | GitHub/API polling timestamp |
| `deviceId` | SenseCraft device ID |
| `status` | Normalized E1002 state |
| `rawStatus` | Raw SenseCraft status code |
| `statusSource` | API source used for status |
| `lastSeen` | Last SenseCraft cloud contact |
| `lastSeenAgeMinutes` | Age of the last device contact |
| `battery` | Battery percentage |
| `charging` | Charging state |
| `temperature` | E1002 temperature |
| `humidity` | E1002 humidity |
| `refreshIntervalMinutes` | Configured E1002 refresh interval |
| `deepSleepDisabled` | SenseCraft sleep setting |
| `targetDeepSleepEnabled` | Target deep-sleep state |

---

# Confirmed SenseCraft status mapping

For this E1002:

```text
raw 1 = Online
raw 3 = Sleep
raw 0 = Offline
```

Other values remain visible as:

```text
Unknown (N)
```

rather than being guessed.

---

# Important status finding

SenseCraft's visible `Online` label is not by itself proof that the E1002 has recently contacted the cloud.

During troubleshooting, SenseCraft could continue showing:

```text
Online
```

while:

- `lastSeen` remained unchanged;
- battery remained unchanged;
- temperature remained unchanged;
- humidity remained unchanged.

For troubleshooting, use:

```text
lastSeen
lastSeenAgeMinutes
```

together with the retained history.

---

# E1002 Health Monitor — Static v3

The physical Health Monitor is built from the latest retained readings.

It shows:

- latest battery percentage;
- latest temperature;
- latest humidity;
- battery trend;
- temperature trend;
- humidity trend;
- 24-hour change;
- 24-hour min/max range;
- latest status;
- latest cloud-contact time.

The page remains monochrome / e-paper friendly.

---

# Rolling 24-hour display

The E1002 charts use a rolling last 24 hours rather than the current calendar day.

This means the whole chart width contains useful history instead of leaving a large future/empty area early in the day.

Example:

```text
08 → 12 → 16 → 20 → 00 → 04 → 08
```

---

# Intelligent Y-axis scaling

Current minimum chart spans:

| Metric | Minimum span |
|---|---:|
| Battery | 10 percentage points |
| Temperature | 3 °C |
| Humidity | 15 percentage points |

The chart scale automatically expands around the visible data.

Battery and humidity remain bounded to their physical 0–100% range.

---

# Home Assistant dashboard

`homeassistant.html` provides the richer history experience.

Current periods:

- Last 24 hours
- Last 7 days
- Last 30 days
- Last 12 months

It shows:

- latest value;
- selected-period range;
- selected-period change;
- intelligently scaled charts;
- reduced point density on long ranges;
- firmware rollback marker;
- battery-life estimate.

The physical E1002 Health Monitor intentionally remains simpler.

---

# Firmware v1.1.4 marker

The Home Assistant battery chart includes a vertical marker for the rollback to:

```text
SenseCraft HMI v1.1.4
```

when that date is visible in the selected period.

This helps separate:

```text
earlier unstable / USB / v1.1.5 period
```

from:

```text
stable v1.1.4 period
```

---

# Battery-life estimate

The Home Assistant dashboard estimates remaining battery life from the stable v1.1.4 battery-only discharge trend.

It can show:

- estimated days to 10%;
- percentage points per day;
- estimate to 0%;
- maturity:
  - Early
  - Developing
  - Good

The estimate is intentionally **not shown on the physical E1002 Health Monitor**.

## Estimation rules

The estimator:

1. uses only data after the v1.1.4 rollback marker;
2. uses at most the most recent 72 hours;
3. excludes `charging=true`;
4. treats adjacent battery movements greater than 5 percentage points as a gauge/USB reset;
5. requires at least 12 hours and at least 6 clean samples;
6. uses linear regression rather than first-vs-last only;
7. uses estimated days remaining to 10% as the headline measure.

The estimate is a trend indicator rather than a precise battery-capacity measurement.

---

# Original troubleshooting problem

The E1002 experienced:

- unexpectedly rapid battery drain;
- intermittent `Offline` state;
- missed scheduled refreshes;
- stale `Online` indication;
- manual Wake occasionally restoring operation.

The issue had also occurred with smaller/single-page configurations, so page count was not considered the primary cause.

---

# Battery percentage behaviour

SenseCraft battery percentage can change noticeably when USB power is connected or removed.

Immediate large percentage jumps do not represent real battery-energy changes over a few seconds.

For battery trend analysis:

- compare readings under similar power conditions;
- prefer normal battery-only operation;
- treat USB connection as an active intervention;
- use the percentage mainly as a trend signal.

---

# Firmware v1.1.5 investigation

Variables tested or reduced included:

- fixed nearby Wi-Fi node;
- 2.4 GHz Wi-Fi;
- static E1002 pages;
- full firmware flash;
- 60-minute refresh;
- deep sleep enabled;
- successful serial wake cycles.

The intermittent problem continued on v1.1.5.

---

# Firmware rollback resolution

Controlled rollback:

```text
v1.1.5 → v1.1.4
```

After one initial manual Wake, the E1002 returned to the expected automatic cycle:

```text
Sleep
  ↓
Timer wake
  ↓
Wi-Fi / SenseCraft connection
  ↓
Page refresh
  ↓
Telemetry
  ↓
Sleep
```

Battery consumption returned to normal.

The battery-drain/wake-sleep issue is therefore considered resolved.

---

# Recommended operating configuration

Keep:

```text
Firmware:       v1.1.4
Deep sleep:     Enabled
Refresh:        60 minutes
Wi-Fi:          2.4 GHz
AP/node:        Fixed nearby node
```

Also:

- avoid unnecessary USB connections when evaluating battery behaviour;
- use GitHub history and `lastSeen` to confirm wake-cycle health;
- do not rely on SenseCraft `Online` alone;
- do not upgrade back to v1.1.5 simply to retest unless there is a specific reason.

---

# SenseCraft HMI setup

Use the direct production BMP:

```text
https://vasanthan1276.github.io/e1002-sensor-tracker/health.bmp
```

Target:

```text
Width:  800
Height: 480
```

## Important crop / copied-page note

When switching an existing SenseCraft page from HTML or PNG to direct BMP, an old page may retain crop/position/zoom settings.

If the preview shows:

- a large black region;
- partial content;
- vertical shifting;
- unexpected cropping;

create a **brand-new SenseCraft page** and test the BMP there first.

Do not modify the GitHub generator solely to compensate for stale SenseCraft crop settings unless `health.bmp` is also wrong when opened directly outside SenseCraft.

---

# Required GitHub secret

The capture workflow requires:

```text
SENSECRAFT_API_KEY
```

configured in repository Actions secrets.

Never place the API key directly in source files.

---

# Data retention

The capture script retains approximately:

```text
366 days
```

of sensor history.

Older readings are automatically removed as new readings are captured.

---

# Updating the physical E1002 dashboard

For lasting visual/layout changes, edit:

```text
scripts/e1002-health-v2.mjs
```

Then run:

```text
Capture E1002 Sensor History
```

The workflow will regenerate:

```text
index.html
health.bmp
```

Do not manually edit generated `index.html` for persistent changes.

---

# Updating Home Assistant

Edit:

```text
homeassistant.html
```

The Home Assistant page reads the retained JSON history and remains independent of the physical BMP output.

---

# E1002 project standard

The project-wide standard for physical E1002 content is now:

```text
Data/API source
      ↓
GitHub Actions
      ↓
Pre-rendered 800×480 BMP
      ↓
SenseCraft HMI
      ↓
reTerminal E1002
```

HTML remains appropriate for:

- Home Assistant;
- browser dashboards;
- administration;
- preview;
- deterministic image render sources.

But **physical E1002 production links should use direct BMP files wherever practical**.

---

# Current production links

```text
E1002 Health Monitor:
https://vasanthan1276.github.io/e1002-sensor-tracker/health.bmp

Browser preview:
https://vasanthan1276.github.io/e1002-sensor-tracker/

Home Assistant:
https://vasanthan1276.github.io/e1002-sensor-tracker/homeassistant.html
```
