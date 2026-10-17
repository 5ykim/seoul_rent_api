import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, projectRoot), "utf8"));
}

function collectPositions(coordinates, positions = []) {
  if (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    coordinates.every((value) => typeof value === "number")
  ) {
    positions.push(coordinates);
    return positions;
  }

  if (Array.isArray(coordinates)) {
    coordinates.forEach((item) => collectPositions(item, positions));
  }

  return positions;
}

test("서울 법정동 경계가 코드와 웹 지도 형식을 갖춘다", async () => {
  const geojson = await readJson("data/seoul-legal-dongs.geojson");

  assert.equal(geojson.type, "FeatureCollection");
  assert.match(geojson.source, /법정구역정보/);
  assert.equal(geojson.coordinateReferenceSystem, "EPSG:4326");
  assert.ok(geojson.features.length >= 400);

  const codes = geojson.features.map((feature) => {
    assert.ok(["Polygon", "MultiPolygon"].includes(feature.geometry?.type));
    assert.match(feature.properties?.code ?? "", /^11\d{8}$/);
    assert.equal(feature.properties.code.slice(0, 5), feature.properties.districtCode);
    return feature.properties.code;
  });

  assert.equal(new Set(codes).size, codes.length, "법정동 코드가 중복되면 안 됩니다.");
});

test("앱의 403개 법정동 선택 항목이 지도 경계와 모두 연결된다", async () => {
  const [geojson, regions] = await Promise.all([
    readJson("data/seoul-legal-dongs.geojson"),
    readJson("data/regions.json"),
  ]);
  const mapCodes = new Set(
    geojson.features.map((feature) => feature.properties.code),
  );
  const regionCodes = regions.flatMap((district) =>
    district.neighborhoods.map(
      (neighborhood) => `${district.code}${neighborhood.code}`,
    ),
  );
  const missingCodes = regionCodes.filter((code) => !mapCodes.has(code));

  assert.equal(regionCodes.length, 403);
  assert.deepEqual(missingCodes, []);
});

test("법정동 지도 좌표가 서울 범위의 경위도이다", async () => {
  const geojson = await readJson("data/seoul-legal-dongs.geojson");
  const positions = geojson.features.flatMap((feature) =>
    collectPositions(feature.geometry.coordinates),
  );
  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);

  assert.ok(Math.min(...longitudes) >= 126.7);
  assert.ok(Math.max(...longitudes) <= 127.3);
  assert.ok(Math.min(...latitudes) >= 37.4);
  assert.ok(Math.max(...latitudes) <= 37.8);
});
