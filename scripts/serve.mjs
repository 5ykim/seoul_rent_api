import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

import { onRequestGet as handleRentRequest } from "../functions/api/rent.js";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT) || 4173;
const initialApiKey = await loadLocalApiKey();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/api/rent" && process.env.PREVIEW_MOCK === "1") {
    const year = Number(requestUrl.searchParams.get("year"));
    const offset = year - 2022;
    const mock = {
      year,
      district: requestUrl.searchParams.get("cggName"),
      neighborhoodCode: requestUrl.searchParams.get("stdgCode"),
      buildingType: requestUrl.searchParams.get("buildingType"),
      tradeCount: 176 + offset * 13,
      averageDeposit: 42000 + offset * 3100,
      averageArea: 63.4,
      averagePricePerM2: 650 + offset * 42,
    };

    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(mock));
    return;
  }

  if (pathname === "/api/rent") {
    const functionResponse = await handleRentRequest({
      request: new Request(requestUrl),
      env: { SEOUL_API_KEY: await loadLocalApiKey() },
    });
    const headers = Object.fromEntries(functionResponse.headers.entries());
    response.writeHead(functionResponse.status, headers);
    response.end(Buffer.from(await functionResponse.arrayBuffer()));
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = join(root, normalize(relativePath));

  if (
    !filePath.startsWith(root) ||
    pathname.startsWith("/.") ||
    pathname.startsWith("/functions/") ||
    pathname.startsWith("/scripts/") ||
    pathname.startsWith("/test/")
  ) {
    response.writeHead(404).end("Not found");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local preview: http://127.0.0.1:${port}`);
  console.log(
    initialApiKey
      ? "서울 API 키를 안전하게 불러왔습니다."
      : "서울 API 키가 없습니다. .dev.vars 파일을 만들면 실제 조회를 테스트할 수 있습니다.",
  );
});

async function loadLocalApiKey() {
  for (const fileName of [".dev.vars", ".env"]) {
    try {
      const contents = await readFile(join(root, fileName), "utf8");
      const line = contents
        .split(/\r?\n/)
        .find((entry) => /^\s*SEOUL_API_KEY\s*=/.test(entry));

      if (!line) continue;

      return line
        .replace(/^\s*SEOUL_API_KEY\s*=\s*/, "")
        .trim()
        .replace(/^(["'])(.*)\1$/, "$2");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return "";
}

