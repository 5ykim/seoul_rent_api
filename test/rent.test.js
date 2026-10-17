import test from "node:test";
import assert from "node:assert/strict";

import { __test__, onRequestGet } from "../functions/api/rent.js";

test("전세이면서 선택한 주택유형의 평균만 계산한다", () => {
  const rows = [
    { RENT_SE: "전세", BLDG_USG: "아파트", GRFE: "30000", RENT_AREA: "60" },
    { RENT_SE: "전세", BLDG_USG: "아파트", GRFE: "50000", RENT_AREA: "100" },
    { RENT_SE: "월세", BLDG_USG: "아파트", GRFE: "1000", RENT_AREA: "20" },
    { RENT_SE: "전세", BLDG_USG: "오피스텔", GRFE: "20000", RENT_AREA: "40" },
  ];

  assert.deepEqual(__test__.summarizeRows(rows, "아파트"), {
    tradeCount: 2,
    averageDeposit: 40000,
    averageArea: 80,
    averagePricePerM2: 500,
  });
});

test("유효한 거래가 없으면 null 평균을 반환한다", () => {
  const rows = [
    { RENT_SE: "월세", BLDG_USG: "아파트", GRFE: "1000", RENT_AREA: "20" },
    { RENT_SE: "전세", BLDG_USG: "아파트", GRFE: "0", RENT_AREA: "0" },
  ];

  assert.deepEqual(__test__.summarizeRows(rows, "아파트"), {
    tradeCount: 0,
    averageDeposit: null,
    averageArea: null,
    averagePricePerM2: null,
  });
});

test("허용되지 않은 연도와 주택유형을 거부한다", () => {
  const invalidYear = new URLSearchParams({
    year: "2021",
    cggCode: "11680",
    cggName: "강남구",
    stdgCode: "10100",
    buildingType: "아파트",
  });
  const invalidType = new URLSearchParams({
    year: "2026",
    cggCode: "11680",
    cggName: "강남구",
    stdgCode: "10100",
    buildingType: "상가",
  });

  assert.throws(() => __test__.validateQuery(invalidYear), /2022년부터 2026년/);
  assert.throws(() => __test__.validateQuery(invalidType), /지원하지 않는 주택유형/);
});

test("Pages Function이 API 응답을 집계하여 JSON으로 반환한다", async (context) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(
      JSON.stringify({
        tbLnOpendataRentV: {
          list_total_count: 2,
          RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다" },
          row: [
            {
              RENT_SE: "전세",
              BLDG_USG: "아파트",
              GRFE: "30000",
              RENT_AREA: "60",
            },
            {
              RENT_SE: "전세",
              BLDG_USG: "아파트",
              GRFE: "50000",
              RENT_AREA: "100",
            },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const request = new Request(
    "https://example.com/api/rent?year=2026&cggCode=11680&cggName=%EA%B0%95%EB%82%A8%EA%B5%AC&stdgCode=10100&buildingType=%EC%95%84%ED%8C%8C%ED%8A%B8",
  );
  const response = await onRequestGet({
    request,
    env: { SEOUL_API_KEY: "test-key" },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.tradeCount, 2);
  assert.equal(payload.averageDeposit, 40000);
  assert.equal(payload.averagePricePerM2, 500);
  assert.match(requestedUrl, /tbLnOpendataRentV\/1\/1000\/2026\/11680/);
});

test("2022년은 API 키 없이 공식 연도별 파일 집계값을 반환한다", async () => {
  const request = new Request(
    "https://example.com/api/rent?year=2022&cggCode=11440&cggName=%EB%A7%88%ED%8F%AC%EA%B5%AC&stdgCode=10200&buildingType=%EC%95%84%ED%8C%8C%ED%8A%B8",
  );
  const response = await onRequestGet({ request, env: {} });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.year, 2022);
  assert.equal(payload.source, "annual-file");
  assert.ok(payload.tradeCount > 0);
  assert.ok(payload.averagePricePerM2 > 0);
});

