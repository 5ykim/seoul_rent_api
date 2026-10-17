import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const [, , ...inputPaths] = process.argv;

if (inputPaths.length < 2) {
  console.error(
    "사용법: node scripts/build-history.mjs <2022 CSV 또는 폴더> <2023 CSV 또는 폴더>",
  );
  process.exit(1);
}

const outputPath = resolve("data/historical-summary.js");
const targetYears = new Set(["2022", "2023"]);
const summaries = {};

for (const inputPath of inputPaths) {
  const filePath = await findCsv(resolve(inputPath));
  const encoding = await detectEncoding(filePath);
  const aggregates = new Map();
  let headers = null;
  let indexes = null;

  for await (const rawLine of decodeLines(filePath, encoding)) {
    const line = rawLine.replace(/^\uFEFF/, "").trimEnd();
    if (!line) continue;

    const values = parseCsvLine(line);

    if (!headers) {
      headers = values.map((value) => value.trim());
      indexes = getColumnIndexes(headers);
      continue;
    }

    const year = values[indexes.year]?.trim();
    const rentType = values[indexes.rentType]?.trim();
    const districtCode = values[indexes.districtCode]?.trim();
    const neighborhoodCode = values[indexes.neighborhoodCode]?.trim();
    const buildingType = values[indexes.buildingType]?.trim();
    const deposit = toNumber(values[indexes.deposit]);
    const area = toNumber(values[indexes.area]);

    if (
      !targetYears.has(year) ||
      rentType !== "전세" ||
      !districtCode ||
      !neighborhoodCode ||
      !buildingType ||
      deposit <= 0 ||
      area <= 0
    ) {
      continue;
    }

    addRow(aggregates, year, districtCode, neighborhoodCode, buildingType, deposit, area);
    addRow(aggregates, year, districtCode, neighborhoodCode, "전체", deposit, area);
  }

  for (const [key, value] of aggregates) {
    const [year, regionKey, buildingType] = key.split("|");
    summaries[year] ??= {};
    summaries[year][regionKey] ??= {};
    summaries[year][regionKey][buildingType] = {
      tradeCount: value.count,
      averageDeposit: round(value.deposit / value.count, 0),
      averageArea: round(value.area / value.count, 1),
      averagePricePerM2: round(value.pricePerM2 / value.count, 1),
    };
  }

  console.log(`${basename(filePath)} 집계를 완료했습니다.`);
}

const ordered = Object.fromEntries(
  Object.entries(summaries)
    .sort(([yearA], [yearB]) => yearA.localeCompare(yearB))
    .map(([year, regions]) => [
      year,
      Object.fromEntries(Object.entries(regions).sort(([a], [b]) => a.localeCompare(b))),
    ]),
);

await writeFile(
  outputPath,
  `// 서울 열린데이터광장 공식 연도별 파일을 집계한 값입니다.\nexport default ${JSON.stringify(ordered, null, 2)};\n`,
  "utf8",
);

const groupCount = Object.values(ordered).reduce(
  (total, regions) => total + Object.keys(regions).length,
  0,
);
console.log(`연도·지역 조합 ${groupCount}개를 ${outputPath}에 저장했습니다.`);

async function findCsv(inputPath) {
  const info = await stat(inputPath);
  if (info.isFile()) return inputPath;

  const entries = await readdir(inputPath, { withFileTypes: true });
  const csv = entries.find(
    (entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".csv",
  );

  if (!csv) throw new Error(`${inputPath}에서 CSV 파일을 찾지 못했습니다.`);
  return join(inputPath, csv.name);
}

async function detectEncoding(filePath) {
  const stream = createReadStream(filePath, { start: 0, end: 2 });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? "utf-8"
    : "euc-kr";
}

async function* decodeLines(filePath, encoding) {
  const decoder = new TextDecoder(encoding);
  let remainder = "";

  for await (const chunk of createReadStream(filePath)) {
    remainder += decoder.decode(chunk, { stream: true });
    const lines = remainder.split(/\r?\n/);
    remainder = lines.pop() ?? "";
    yield* lines;
  }

  remainder += decoder.decode();
  if (remainder) yield remainder;
}

function getColumnIndexes(headers) {
  const required = {
    year: "접수년도",
    districtCode: "자치구코드",
    neighborhoodCode: "법정동코드",
    rentType: "전월세구분",
    area: "임대면적",
    deposit: "보증금(만원)",
    buildingType: "건물용도",
  };
  const indexes = {};

  for (const [key, columnName] of Object.entries(required)) {
    const index = headers.indexOf(columnName);
    if (index < 0) throw new Error(`필수 열 ${columnName}을 찾지 못했습니다.`);
    indexes[key] = index;
  }

  return indexes;
}

function addRow(aggregates, year, districtCode, neighborhoodCode, buildingType, deposit, area) {
  const key = `${year}|${districtCode}-${neighborhoodCode}|${buildingType}`;
  const current = aggregates.get(key) ?? {
    count: 0,
    deposit: 0,
    area: 0,
    pricePerM2: 0,
  };

  current.count += 1;
  current.deposit += deposit;
  current.area += area;
  current.pricePerM2 += deposit / area;
  aggregates.set(key, current);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  values.push(current);
  return values;
}

function toNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(number) ? number : 0;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

