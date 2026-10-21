import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Laya } from "@receptron/laya";

const assets = new Map([
  ["/", ["./public/index.html", "text/html"]],
  ["/app.js", ["./public/app.js", "text/javascript"]],
  ["/style.css", ["./public/style.css", "text/css"]],
  ["/icons.js", ["./node_modules/lucide/dist/umd/lucide.js", "text/javascript"]],
  ["/example.json", ["./request.json", "application/json"]],
]);

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

export function createPlaygroundServer(model) {
  let busy = false;
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
    const expectedHost = `127.0.0.1:${request.socket.localPort}`;
    if (request.headers.host !== expectedHost ||
        (request.headers.origin && request.headers.origin !== `http://${expectedHost}`)) {
      json(response, 403, { error: "Only same-origin localhost requests are allowed." });
      return;
    }
    const path = new URL(request.url, `http://${expectedHost}`).pathname;
    if (request.method === "GET" && path === "/api/health") {
      json(response, 200, { ready: true, busy, model: "laya", device: "cpu" });
      return;
    }
    if (request.method === "GET" && assets.has(path)) {
      const [file, type] = assets.get(path);
      try {
        const body = await readFile(new URL(file, import.meta.url));
        response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-cache" });
        response.end(body);
      } catch {
        json(response, 404, { error: "Asset not found." });
      }
      return;
    }
    if (request.method !== "POST" || path !== "/api/decide") {
      json(response, 404, { error: "Not found." });
      return;
    }
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      json(response, 415, { error: "Content-Type must be application/json." });
      return;
    }
    if (busy) {
      json(response, 409, { error: "A decision is already running. Try again shortly." });
      return;
    }
    let input;
    try {
      let length = 0;
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 65536) {
          json(response, 413, { error: "Request exceeds the 64 KB limit." });
          return;
        }
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!input || typeof input !== "object" || !Object.hasOwn(input, "state") ||
          !input.questions || typeof input.questions !== "object" ||
          Array.isArray(input.questions) || Object.keys(input.questions).length === 0) {
        throw new Error("Provide state and a non-empty questions object.");
      }
      for (const question of Object.values(input.questions)) {
        if (!question || !["choice", "score", "noul"].includes(question.type) ||
            typeof question.instructions !== "string" || !question.instructions.trim()) {
          throw new Error("Each question needs a choice, score, or noul type and instructions.");
        }
      }
    } catch (error) {
      json(response, 400, { error: error instanceof SyntaxError ? "Invalid JSON request." : error.message });
      return;
    }
    if (busy) {
      json(response, 409, { error: "A decision is already running. Try again shortly." });
      return;
    }
    busy = true;
    try {
      const start = performance.now();
      const result = await model.systemOne(input.state, input.questions);
      json(response, 200, { ...result, duration_ms: Math.round(performance.now() - start) });
    } catch (error) {
      json(response, 422, { error: error.message });
    } finally {
      busy = false;
    }
  });
}

async function main() {
  console.log("Loading Laya on CPU...");
  const model = await Laya.load({
    cacheDir: fileURLToPath(new URL("./.cache/laya", import.meta.url)),
    executionProviders: ["cpu"],
    sessionOptions: { intraOpNumThreads: Math.min(4, availableParallelism()) },
  });
  const server = createPlaygroundServer(model);
  for (let port = 3000; port < 3010; port++) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
      console.log(`Laya playground: http://127.0.0.1:${port}`);
      const stop = () => server.close(async () => { await model.close(); });
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE") { await model.close(); throw error; }
    }
  }
  await model.close();
  throw new Error("Ports 3000-3009 are all in use.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}