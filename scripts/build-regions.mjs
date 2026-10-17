import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const [, , sourcePath, outputPath = "data/regions.json"] = process.argv;

if (!sourcePath) {
  console.error("사용법: node scripts/build-regions.mjs <seoul_rent_2026.csv 경로> [출력 경로]");
  process.exit(1);
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

const districts = new Map();
const input = createInterface({
  input: createReadStream(resolve(sourcePath), { encoding: "utf8" }),
  crlfDelay: Infinity,
});

let isHeader = true;

for await (const rawLine of input) {
  if (isHeader) {
    isHeader = false;
    continue;
  }

  const line = rawLine.replace(/^\uFEFF/, "");
  const [, cggCode, cggName, stdgCode, stdgName] = parseCsvLine(line);

  if (!cggCode || !cggName || !stdgCode || !stdgName) continue;

  if (!districts.has(cggCode)) {
    districts.set(cggCode, {
      code: cggCode,
      name: cggName,
      neighborhoods: new Map(),
    });
  }

  districts.get(cggCode).neighborhoods.set(stdgCode, {
    code: stdgCode,
    name: stdgName,
  });
}

const collator = new Intl.Collator("ko-KR");
const result = [...districts.values()]
  .map((district) => ({
    code: district.code,
    name: district.name,
    neighborhoods: [...district.neighborhoods.values()].sort((a, b) =>
      collator.compare(a.name, b.name),
    ),
  }))
  .sort((a, b) => collator.compare(a.name, b.name));

const destination = resolve(outputPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, "utf8");

const neighborhoodCount = result.reduce(
  (total, district) => total + district.neighborhoods.length,
  0,
);

console.log(`자치구 ${result.length}개, 법정동 ${neighborhoodCount}개를 저장했습니다.`);

