import historicalSummary from "../../data/historical-summary.js";

const SERVICE_NAME = "tbLnOpendataRentV";
const PAGE_SIZE = 1000;
const MAX_PAGES = 45;
const ALLOWED_YEARS = new Set(["2022", "2023", "2024", "2025", "2026"]);
const ALLOWED_BUILDING_TYPES = new Set([
  "전체",
  "아파트",
  "오피스텔",
  "연립다세대",
  "단독다가구",
]);

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const params = validateQuery(url.searchParams);

    if (params.year === "2022" || params.year === "2023") {
      return jsonResponse(
        {
          year: Number(params.year),
          district: params.cggName,
          neighborhoodCode: params.stdgCode,
          buildingType: params.buildingType,
          source: "annual-file",
          ...getHistoricalSummary(params),
        },
        200,
        {
          "Cache-Control": "public, max-age=3600, s-maxage=604800",
        },
      );
    }

    if (!env.SEOUL_API_KEY) {
      return jsonResponse(
        {
          error:
            "서울 열린데이터 API 키가 설정되지 않았습니다. 로컬에서는 .dev.vars, Cloudflare에서는 SEOUL_API_KEY Secret을 등록해 주세요.",
        },
        503,
      );
    }

    const rows = await fetchAllRowsForYear(env.SEOUL_API_KEY, params);
    const summary = summarizeRows(rows, params.buildingType);

    return jsonResponse(
      {
        year: Number(params.year),
        district: params.cggName,
        neighborhoodCode: params.stdgCode,
        buildingType: params.buildingType,
        source: "open-api",
        ...summary,
      },
      200,
      {
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    );
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "데이터를 불러오지 못했습니다.";

    return jsonResponse({ error: message }, status);
  }
}

function getHistoricalSummary(params) {
  const regionKey = `${params.cggCode}-${params.stdgCode}`;
  return (
    historicalSummary[params.year]?.[regionKey]?.[params.buildingType] ?? {
      tradeCount: 0,
      averageDeposit: null,
      averageArea: null,
      averagePricePerM2: null,
    }
  );
}

function validateQuery(searchParams) {
  const year = searchParams.get("year")?.trim() ?? "";
  const cggCode = searchParams.get("cggCode")?.trim() ?? "";
  const cggName = searchParams.get("cggName")?.trim() ?? "";
  const stdgCode = searchParams.get("stdgCode")?.trim() ?? "";
  const buildingType = searchParams.get("buildingType")?.trim() || "전체";

  if (!ALLOWED_YEARS.has(year)) {
    throw new RequestError("조회 연도는 2022년부터 2026년까지 선택할 수 있습니다.", 400);
  }

  if (!/^\d{5}$/.test(cggCode) || !/^\d{5}$/.test(stdgCode)) {
    throw new RequestError("자치구와 동 코드를 다시 확인해 주세요.", 400);
  }

  if (!cggName || cggName.length > 20) {
    throw new RequestError("자치구 이름을 다시 확인해 주세요.", 400);
  }

  if (!ALLOWED_BUILDING_TYPES.has(buildingType)) {
    throw new RequestError("지원하지 않는 주택유형입니다.", 400);
  }

  return { year, cggCode, cggName, stdgCode, buildingType };
}

async function fetchAllRowsForYear(apiKey, params) {
  const firstPage = await fetchPage(apiKey, params, 1, PAGE_SIZE);
  const totalCount = Number(firstPage.totalCount) || 0;

  if (totalCount <= PAGE_SIZE) return firstPage.rows;

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  if (totalPages > MAX_PAGES) {
    throw new RequestError(
      "선택한 동의 거래량이 너무 많아 한 번에 조회할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      422,
    );
  }

  const remainingRequests = [];

  for (let page = 2; page <= totalPages; page += 1) {
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalCount);
    remainingRequests.push(fetchPage(apiKey, params, start, end));
  }

  const remainingPages = await Promise.all(remainingRequests);
  return [firstPage, ...remainingPages].flatMap((page) => page.rows);
}

async function fetchPage(apiKey, params, start, end) {
  const segments = [
    apiKey,
    "json",
    SERVICE_NAME,
    start,
    end,
    params.year,
    params.cggCode,
    params.cggName,
    params.stdgCode,
  ].map((segment) => encodeURIComponent(String(segment)));

  const apiUrl = `http://openapi.seoul.go.kr:8088/${segments.join("/")}`;
  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new RequestError("서울 열린데이터 서버 응답이 원활하지 않습니다.", 502);
  }

  const responseText = await response.text();
  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch {
    if (/<CODE>INFO-200<\/CODE>/i.test(responseText)) {
      return { totalCount: 0, rows: [] };
    }

    throw new RequestError(
      "서울 열린데이터 API 연결이 일시적으로 원활하지 않습니다. 잠시 후 다시 시도해 주세요.",
      502,
    );
  }
  const service = payload[SERVICE_NAME];

  if (!service) {
    const result = payload.RESULT;

    if (result?.CODE === "INFO-200") {
      return { totalCount: 0, rows: [] };
    }

    throw new RequestError(
      result?.MESSAGE || "서울 열린데이터 응답 형식을 확인할 수 없습니다.",
      502,
    );
  }

  const resultCode = service.RESULT?.CODE;

  if (resultCode && resultCode !== "INFO-000") {
    if (resultCode === "INFO-200") return { totalCount: 0, rows: [] };
    throw new RequestError(service.RESULT.MESSAGE || "데이터 조회에 실패했습니다.", 502);
  }

  return {
    totalCount: service.list_total_count ?? 0,
    rows: Array.isArray(service.row) ? service.row : [],
  };
}

function summarizeRows(rows, buildingType) {
  const validRows = rows
    .filter((row) => row.RENT_SE?.trim() === "전세")
    .filter(
      (row) => buildingType === "전체" || row.BLDG_USG?.trim() === buildingType,
    )
    .map((row) => ({
      deposit: toNumber(row.GRFE),
      area: toNumber(row.RENT_AREA),
    }))
    .filter(({ deposit, area }) => deposit > 0 && area > 0);

  if (validRows.length === 0) {
    return {
      tradeCount: 0,
      averageDeposit: null,
      averageArea: null,
      averagePricePerM2: null,
    };
  }

  const totals = validRows.reduce(
    (accumulator, row) => {
      accumulator.deposit += row.deposit;
      accumulator.area += row.area;
      accumulator.pricePerM2 += row.deposit / row.area;
      return accumulator;
    },
    { deposit: 0, area: 0, pricePerM2: 0 },
  );

  return {
    tradeCount: validRows.length,
    averageDeposit: round(totals.deposit / validRows.length, 0),
    averageArea: round(totals.area / validRows.length, 1),
    averagePricePerM2: round(totals.pricePerM2 / validRows.length, 1),
  };
}

function toNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(number) ? number : 0;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

class RequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

export const __test__ = { getHistoricalSummary, summarizeRows, validateQuery };

