const GROUPS = new Set([
  "active",
  "stations",
  "starlink",
  "visual",
  "fengyun-1c-debris",
]);

const UPSTREAM = "https://celestrak.org/NORAD/elements/gp.php";

const CACHE = new Map();

const REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours
const TIMEOUT_MS = 15000;

// --------------------------------------------------
// TLE CHECKSUM VALIDATION
// --------------------------------------------------

function checksumOk(line) {
  if (!line || line.length < 69) return false;

  let sum = 0;

  for (let i = 0; i < 68; i++) {
    const c = line[i];

    if (c >= "0" && c <= "9") {
      sum += Number(c);
    } else if (c === "-") {
      sum += 1;
    }
  }

  return Number(line[68]) === sum % 10;
}

// --------------------------------------------------
// TLE EPOCH VALIDATION
// --------------------------------------------------

function validEpoch(line1) {
  return /^\d{1,2}\d{3}\.\d{8}$/.test(line1.slice(18, 32));
}

// --------------------------------------------------
// PARSE RAW TLE
// --------------------------------------------------

function parseTLE(text) {
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const records = [];

  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].startsWith("1 ")) {
      continue;
    }

    const line1 = lines[i];
    const line2 = lines[i + 1];

    if (!line2.startsWith("2 ")) {
      continue;
    }

    if (!checksumOk(line1)) {
      continue;
    }

    if (!checksumOk(line2)) {
      continue;
    }

    if (!validEpoch(line1)) {
      continue;
    }

    const name =
      i > 0 &&
      !lines[i - 1].startsWith("1 ") &&
      !lines[i - 1].startsWith("2 ")
        ? lines[i - 1]
        : `NORAD ${line1.slice(2, 7).trim()}`;

    records.push({
      name,
      line1,
      line2,
    });

    i++;
  }

  return records;
}

// --------------------------------------------------
// CONVERT RECORDS BACK TO RAW TLE TEXT
// --------------------------------------------------

function recordsToTLE(records) {
  return records
    .map((record) => `${record.name}\n${record.line1}\n${record.line2}`)
    .join("\n");
}

// --------------------------------------------------
// TLE EPOCH → DATE
// --------------------------------------------------

function epochToDate(line1) {
  const yy = Number(line1.slice(18, 20));
  const day = Number(line1.slice(20, 32));

  const year = yy >= 57 ? 1900 + yy : 2000 + yy;

  return new Date(Date.UTC(year, 0, 1) + (day - 1) * 86400000);
}

// --------------------------------------------------
// CATALOG STATISTICS
// --------------------------------------------------

function stats(records) {
  const now = Date.now();

  const ages = records
    .map((record) => {
      const epoch = epochToDate(record.line1);

      return (now - epoch.getTime()) / 3600000;
    })
    .filter(Number.isFinite);

  if (!ages.length) {
    return {
      oldestEpoch: null,
      newestEpoch: null,
      medianAgeHours: null,
      worstAgeHours: null,
    };
  }

  const sorted = [...ages].sort((a, b) => a - b);

  const median =
    sorted.length % 2
      ? sorted[Math.floor(sorted.length / 2)]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const epochs = records
    .map((record) => epochToDate(record.line1))
    .sort((a, b) => a - b);

  return {
    oldestEpoch: epochs[0].toISOString(),

    newestEpoch: epochs[epochs.length - 1].toISOString(),

    medianAgeHours: Number(median.toFixed(2)),

    worstAgeHours: Number(Math.max(...ages).toFixed(2)),
  };
}

// --------------------------------------------------
// FETCH CELESTRAK
// --------------------------------------------------

async function fetchUpstream(group) {
  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${UPSTREAM}?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;

    const response = await fetch(url, {
      signal: controller.signal,

      headers: {
        "User-Agent":
          "SatTracker/Phase3 (+https://github.com/Tirthkush/Satellite-Tracker)",
      },
    });

    // Fast-fail rate limiting / blocking
    if (response.status === 403 || response.status === 429) {
      throw new Error(`UPSTREAM_${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`UPSTREAM_HTTP_${response.status}`);
    }

    const text = await response.text();

    const records = parseTLE(text);

    if (!records.length) {
      throw new Error("MALFORMED_TLE_PAYLOAD");
    }

    return {
      records,
      rawText: recordsToTLE(records),
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------
// VERCEL SERVERLESS FUNCTION
// --------------------------------------------------

export default async function handler(req, res) {
  const group = req.query.group;

  // ------------------------------------------------
  // Validate group
  // ------------------------------------------------

  if (!GROUPS.has(group)) {
    return res.status(400).json({
      error: "UNSUPPORTED_GROUP",

      group,
    });
  }

  const now = Date.now();

  const existing = CACHE.get(group);

  const forceRefresh = req.query.refresh === "1";

  const due = !existing || now - existing.fetchedAtMs >= REFRESH_MS;

  // ------------------------------------------------
  // USE SCHEDULED CACHE
  // ------------------------------------------------

  if (!due && !forceRefresh) {
    return res.status(200).json({
      source: "CelesTrak GP API",

      feed: group,

      status: "SCHEDULED CACHE",

      rawText: existing.rawText,

      fetchTimeUtc: existing.fetchedAt,

      upstreamFetchTimeUtc: existing.fetchedAt,

      nextRefreshUtc: new Date(
        existing.fetchedAtMs + REFRESH_MS,
      ).toISOString(),

      objectCount: existing.records.length,

      ...existing.stats,

      records: existing.records,
    });
  }

  // ------------------------------------------------
  // FETCH FRESH DATA
  // ------------------------------------------------

  try {
    const result = await fetchUpstream(group);

    const payload = {
      records: result.records,

      rawText: result.rawText,

      fetchedAt: result.fetchedAt,

      fetchedAtMs: Date.parse(result.fetchedAt),

      stats: stats(result.records),
    };

    CACHE.set(group, payload);

    return res.status(200).json({
      source: "CelesTrak GP API",

      feed: group,

      status: "LIVE CATALOG",

      rawText: payload.rawText,

      fetchTimeUtc: payload.fetchedAt,

      upstreamFetchTimeUtc: payload.fetchedAt,

      nextRefreshUtc: new Date(
        payload.fetchedAtMs + REFRESH_MS,
      ).toISOString(),

      objectCount: payload.records.length,

      ...payload.stats,

      records: payload.records,
    });
  } catch (error) {
    // ------------------------------------------------
    // FALL BACK TO LAST GOOD CACHE
    // ------------------------------------------------

    if (existing) {
      return res.status(200).json({
        source: "CelesTrak GP API",

        feed: group,

        status: "SCHEDULED CACHE",

        rawText: existing.rawText,

        fallbackReason: error.message,

        fetchTimeUtc: existing.fetchedAt,

        upstreamFetchTimeUtc: existing.fetchedAt,

        nextRefreshUtc: new Date(
          existing.fetchedAtMs + REFRESH_MS,
        ).toISOString(),

        objectCount: existing.records.length,

        ...existing.stats,

        records: existing.records,
      });
    }

    // ------------------------------------------------
    // NO CACHE AVAILABLE
    // ------------------------------------------------

    return res.status(502).json({
      error: "UPSTREAM_UNAVAILABLE",

      reason: error.message,

      group,
    });
  }
}
