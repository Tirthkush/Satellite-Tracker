const GROUPS = new Set([
  "active",
  "stations",
  "starlink",
  "visual",
  "fengyun-1c-debris",
]);

const UPSTREAM =
  "https://celestrak.org/NORAD/elements/gp.php";

const CACHE = new Map();

const REFRESH_MS = 2 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000;


// --------------------------------------------------
// TLE CHECKSUM
// --------------------------------------------------

function checksumOk(line) {
  if (!line || line.length < 69) return false;

  let sum = 0;

  for (let i = 0; i < 68; i++) {
    const c = line[i];

    if (c >= "0" && c <= "9") {
      sum += Number(c);
    }

    if (c === "-") {
      sum += 1;
    }
  }

  return Number(line[68]) === sum % 10;
}


// --------------------------------------------------
// EPOCH VALIDATION
// --------------------------------------------------

function validEpoch(line1) {
  if (!line1 || line1.length < 32) {
    return false;
  }

  return /^\d{2}\d{3}\.\d{8}$/.test(
    line1.slice(18, 32)
  );
}


// --------------------------------------------------
// PARSE TLE
// --------------------------------------------------

function parseTLE(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const records = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const line1 = lines[i];
    const line2 = lines[i + 1];

    if (!line1.startsWith("1 ")) {
      continue;
    }

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

    let name = `NORAD ${line1
      .slice(2, 7)
      .trim()}`;

    if (i > 0) {
      const previous = lines[i - 1];

      if (
        !previous.startsWith("1 ") &&
        !previous.startsWith("2 ")
      ) {
        name = previous;
      }
    }

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
// RECORDS → TLE TEXT
// --------------------------------------------------

function recordsToTLE(records) {
  return records
    .map(
      (sat) =>
        `${sat.name}\n${sat.line1}\n${sat.line2}`
    )
    .join("\n");
}


// --------------------------------------------------
// EPOCH DATE
// --------------------------------------------------

function epochToDate(line1) {
  const yy = Number(
    line1.slice(18, 20)
  );

  const day = Number(
    line1.slice(20, 32)
  );

  const year =
    yy >= 57
      ? 1900 + yy
      : 2000 + yy;

  return new Date(
    Date.UTC(year, 0, 1) +
      (day - 1) * 86400000
  );
}


// --------------------------------------------------
// STATS
// --------------------------------------------------

function getStats(records) {
  if (!records.length) {
    return {
      oldestEpoch: null,
      newestEpoch: null,
      medianAgeHours: null,
      worstAgeHours: null,
    };
  }

  const now = Date.now();

  const dates = records
    .map((sat) =>
      epochToDate(sat.line1)
    )
    .filter((date) =>
      Number.isFinite(
        date.getTime()
      )
    )
    .sort(
      (a, b) =>
        a.getTime() -
        b.getTime()
    );

  const ages = dates.map(
    (date) =>
      (now - date.getTime()) /
      3600000
  );

  const sorted = [
    ...ages,
  ].sort((a, b) => a - b);

  const middle = Math.floor(
    sorted.length / 2
  );

  const median =
    sorted.length % 2
      ? sorted[middle]
      : (
          sorted[middle - 1] +
          sorted[middle]
        ) / 2;

  return {
    oldestEpoch:
      dates[0].toISOString(),

    newestEpoch:
      dates[
        dates.length - 1
      ].toISOString(),

    medianAgeHours:
      Number(
        median.toFixed(2)
      ),

    worstAgeHours:
      Number(
        Math.max(...ages)
          .toFixed(2)
      ),
  };
}


// --------------------------------------------------
// CELESTRAK FETCH
// --------------------------------------------------

async function fetchUpstream(group) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () =>
      controller.abort(),
    TIMEOUT_MS
  );

  try {
    const url =
      `${UPSTREAM}` +
      `?GROUP=${encodeURIComponent(group)}` +
      `&FORMAT=tle`;

    const response =
      await fetch(url, {
        method: "GET",

        signal:
          controller.signal,

        headers: {
          Accept:
            "text/plain",

          "User-Agent":
            "SatTracker/Phase3",
        },
      });

    if (!response.ok) {
      throw new Error(
        `CELESTRAK_HTTP_${response.status}`
      );
    }

    const text =
      await response.text();

    if (
      !text ||
      text.trim().length < 10
    ) {
      throw new Error(
        "EMPTY_CELESTRAK_RESPONSE"
      );
    }

    const records =
      parseTLE(text);

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
// RESPONSE
// --------------------------------------------------

function sendJSON(
  res,
  status,
  data
) {
  res.setHeader(
    "Content-Type",
    "application/json"
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

  return res
    .status(status)
    .json(data);
}


// --------------------------------------------------
// VERCEL HANDLER
// --------------------------------------------------

export default async function handler(
  req,
  res
) {

  // CORS
  if (req.method === "OPTIONS") {
    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, OPTIONS"
    );

    return res
      .status(204)
      .end();
  }


  // Only GET
  if (req.method !== "GET") {
    return sendJSON(
      res,
      405,
      {
        error:
          "METHOD_NOT_ALLOWED",
      }
    );
  }


  // Get group
  const group =
    Array.isArray(
      req.query.group
    )
      ? req.query.group[0]
      : req.query.group;


  // Validate group
  if (!GROUPS.has(group)) {
    return sendJSON(
      res,
      400,
      {
        error:
          "UNSUPPORTED_GROUP",

        group,

        supportedGroups:
          [...GROUPS],
      }
    );
  }


  const forceRefresh =
    req.query.refresh === "1";

  const existing =
    CACHE.get(group);

  const now =
    Date.now();


  // ------------------------------------------------
  // CACHE
  // ------------------------------------------------

  if (
    existing &&
    !forceRefresh &&
    now -
      existing.fetchedAtMs <
      REFRESH_MS
  ) {

    return sendJSON(
      res,
      200,
      {
        source:
          "CelesTrak GP API",

        feed:
          group,

        status:
          "SCHEDULED CACHE",

        rawText:
          existing.rawText,

        records:
          existing.records,

        fetchTimeUtc:
          existing.fetchedAt,

        upstreamFetchTimeUtc:
          existing.fetchedAt,

        nextRefreshUtc:
          new Date(
            existing.fetchedAtMs +
              REFRESH_MS
          ).toISOString(),

        objectCount:
          existing.records.length,

        ...existing.stats,
      }
    );
  }


  // ------------------------------------------------
  // FRESH CELESTRAK DATA
  // ------------------------------------------------

  try {

    const fresh =
      await fetchUpstream(
        group
      );

    CACHE.set(
      group,
      fresh
    );

    return sendJSON(
      res,
      200,
      {
        source:
          "CelesTrak GP API",

        feed:
          group,

        status:
          "LIVE CATALOG",

        rawText:
          fresh.rawText,

        records:
          fresh.records,

        fetchTimeUtc:
          fresh.fetchedAt,

        upstreamFetchTimeUtc:
          fresh.fetchedAt,

        nextRefreshUtc:
          new Date(
            fresh.fetchedAtMs +
              REFRESH_MS
          ).toISOString(),

        objectCount:
          fresh.records.length,

        ...fresh.stats,
      }
    );

  } catch (error) {

    // ------------------------------------------------
    // FALLBACK TO CACHE
    // ------------------------------------------------

    if (existing) {

      return sendJSON(
        res,
        200,
        {
          source:
            "CelesTrak GP API",

          feed:
            group,

          status:
            "SCHEDULED CACHE",

          rawText:
            existing.rawText,

          records:
            existing.records,

          fetchTimeUtc:
            existing.fetchedAt,

          upstreamFetchTimeUtc:
            existing.fetchedAt,

          nextRefreshUtc:
            new Date(
              existing.fetchedAtMs +
                REFRESH_MS
            ).toISOString(),

          objectCount:
            existing.records.length,

          fallbackReason:
            error.message,

          ...existing.stats,
        }
      );
    }


    // ------------------------------------------------
    // TOTAL FAILURE
    // ------------------------------------------------

    return sendJSON(
      res,
      502,
      {
        error:
          "UPSTREAM_UNAVAILABLE",

        reason:
          error.message,

        group,

        source:
          "CelesTrak GP API",
      }
    );
  }
}
