// Vercel Serverless Function
// Route: /api/catalog/[group]

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
  if (!line1 || line1.length < 32) return false;

  const epoch = line1.slice(18, 32);

  return /^\d{2}\d{3}\.\d{8}$/.test(epoch);
}

// --------------------------------------------------
// PARSE TLE DATA
// --------------------------------------------------

function parseTLE(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const records = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const line1 = lines[i].trim();
    const line2 = lines[i + 1].trim();

    if (!line1.startsWith("1 ")) continue;
    if (!line2.startsWith("2 ")) continue;

    if (!checksumOk(line1)) continue;
    if (!checksumOk(line2)) continue;
    if (!validEpoch(line1)) continue;

    const previous = i > 0 ? lines[i - 1].trim() : "";

    const name =
      previous &&
      !previous.startsWith("1 ") &&
      !previous.startsWith("2 ")
        ? previous
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
// CONVERT RECORDS BACK TO TLE TEXT
// --------------------------------------------------

function recordsToTLE(records) {
  return records
    .map(
      (record) =>
        `${record.name}\n${record.line1}\n${record.line2}`
    )
    .join("\n");
}

// --------------------------------------------------
// EPOCH → DATE
// --------------------------------------------------

function epochToDate(line1) {
  const yy = Number(line1.slice(18, 20));
  const day = Number(line1.slice(20, 32));

  const year = yy >= 57 ? 1900 + yy : 2000 + yy;

  return new Date(
    Date.UTC(year, 0, 1) +
      (day - 1) * 86400000
  );
}

// --------------------------------------------------
// BASIC DATA STATS
// --------------------------------------------------

function getStats(records) {
  const now = Date.now();

  const ages = records
    .map((record) => {
      const date = epochToDate(record.line1);
      return (now - date.getTime()) / 3600000;
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

  const sortedAges = [...ages].sort(
    (a, b) => a - b
  );

  const middle = Math.floor(
    sortedAges.length / 2
  );

  const medianAge =
    sortedAges.length % 2
      ? sortedAges[middle]
      : (
          sortedAges[middle - 1] +
          sortedAges[middle]
        ) / 2;

  const epochs = records
    .map((record) => epochToDate(record.line1))
    .filter(
      (date) =>
        !Number.isNaN(date.getTime())
    )
    .sort((a, b) => a - b);

  return {
    oldestEpoch: epochs.length
      ? epochs[0].toISOString()
      : null,

    newestEpoch: epochs.length
      ? epochs[epochs.length - 1].toISOString()
      : null,

    medianAgeHours: Number(
      medianAge.toFixed(2)
    ),

    worstAgeHours: Number(
      Math.max(...ages).toFixed(2)
    ),
  };
}

// --------------------------------------------------
// FETCH CELESTRAK
// --------------------------------------------------

async function fetchUpstream(group) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const url =
      `${UPSTREAM}?GROUP=${encodeURIComponent(group)}` +
      `&FORMAT=tle`;

    const response = await fetch(url, {
      method: "GET",

      signal: controller.signal,

      headers: {
        Accept: "text/plain",

        "User-Agent":
          "SatTracker/Live (+https://github.com/Tirthkush/Satellite-Tracker)",
      },
    });

    if (response.status === 403) {
      throw new Error(
        "CELESTRAK_HTTP_403"
      );
    }

    if (response.status === 429) {
      throw new Error(
        "CELESTRAK_HTTP_429"
      );
    }

    if (!response.ok) {
      throw new Error(
        `CELESTRAK_HTTP_${response.status}`
      );
    }

    const text = await response.text();

    if (
      !text ||
      text.trim().length < 10
    ) {
      throw new Error(
        "EMPTY_CELESTRAK_RESPONSE"
      );
    }

    const records = parseTLE(text);

    if (!records.length) {
      throw new Error(
        "NO_VALID_TLE_RECORDS"
      );
    }

    const fetchedAt =
      new Date().toISOString();

    return {
      records,

      rawText:
        recordsToTLE(records),

      fetchedAt,

      fetchedAtMs:
        Date.parse(fetchedAt),

      stats:
        getStats(records),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// --------------------------------------------------
// JSON RESPONSE
// --------------------------------------------------

function sendJson(res, status, body) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  return res
    .status(status)
    .json(body);
}

// --------------------------------------------------
// PUBLIC RESPONSE FORMAT
// --------------------------------------------------

function publicPayload(
  group,
  cached,
  status,
  extra = {}
) {
  return {
    source:
      "CelesTrak GP API",

    feed: group,

    status,

    rawText:
      cached.rawText,

    records:
      cached.records,

    fetchTimeUtc:
      cached.fetchedAt,

    upstreamFetchTimeUtc:
      cached.fetchedAt,

    nextRefreshUtc:
      new Date(
        cached.fetchedAtMs +
          REFRESH_MS
      ).toISOString(),

    objectCount:
      cached.records.length,

    ...cached.stats,

    ...extra,
  };
}

// --------------------------------------------------
// VERCEL HANDLER
// --------------------------------------------------

export default async function handler(
  req,
  res
) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type"
    );

    return res
      .status(204)
      .end();
  }

  // Only GET supported
  if (req.method !== "GET") {
    return sendJson(res, 405, {
      error:
        "METHOD_NOT_ALLOWED",

      allowed: ["GET"],
    });
  }

  // Get dynamic group
  const rawGroup =
    req.query?.group;

  const group =
    Array.isArray(rawGroup)
      ? rawGroup[0]
      : rawGroup;

  // Validate group
  if (!GROUPS.has(group)) {
    return sendJson(res, 400, {
      error:
        "UNSUPPORTED_GROUP",

      group:
        group || null,

      supportedGroups:
        [...GROUPS],
    });
  }

  const forceRefresh =
    String(
      req.query?.refresh || ""
    ) === "1";

  const now = Date.now();

  const existing =
    CACHE.get(group);

  // --------------------------------------------------
  // VALID CACHE
  // --------------------------------------------------

  const cacheValid =
    existing &&
    Number.isFinite(
      existing.fetchedAtMs
    ) &&
    now -
      existing.fetchedAtMs <
      REFRESH_MS;

  if (
    cacheValid &&
    !forceRefresh
  ) {
    return sendJson(
      res,
      200,

      publicPayload(
        group,
        existing,
        "SCHEDULED CACHE"
      )
    );
  }

  // --------------------------------------------------
  // FETCH LIVE DATA
  // --------------------------------------------------

  try {
    const fresh =
      await fetchUpstream(
        group
      );

    CACHE.set(
      group,
      fresh
    );

    return sendJson(
      res,
      200,

      publicPayload(
        group,
        fresh,
        "LIVE CATALOG"
      )
    );
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : String(error);

    // Use last successful cache
    // if CelesTrak temporarily fails.
    if (existing) {
      return sendJson(
        res,
        200,

        publicPayload(
          group,
          existing,
          "SCHEDULED CACHE",
          {
            fallbackReason:
              reason,
          }
        )
      );
    }

    // No cached data available.
    return sendJson(
      res,
      502,
      {
        error:
          "UPSTREAM_UNAVAILABLE",

        reason,

        group,

        source:
          "CelesTrak GP API",
      }
    );
  }
}
