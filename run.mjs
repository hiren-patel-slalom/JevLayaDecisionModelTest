import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Laya, ensureBundle } from "@receptron/laya";

const { values, positionals } = parseArgs({
  options: { "download-only": { type: "boolean", default: false } },
  allowPositionals: true,
});

const options = {
  cacheDir: fileURLToPath(new URL("./.cache/laya", import.meta.url)),
};

try {
  if (values["download-only"]) {
    await ensureBundle(options);
    console.error(`Model downloaded to ${options.cacheDir}`);
  } else {
    if (positionals.length > 1) {
      throw new Error("Usage: npm run decide -- [request.json]");
    }
    const inputPath = positionals[0] ?? new URL("./request.json", import.meta.url);
    const request = JSON.parse(await readFile(inputPath, "utf8"));
    if (!Object.hasOwn(request, "state") || !request.questions ||
        typeof request.questions !== "object" || Array.isArray(request.questions) ||
        Object.keys(request.questions).length === 0) {
      throw new Error("Input must contain state and a non-empty questions object.");
    }

    console.error("Loading Laya on CPU; the first run downloads about 1.7 GB.");
    const loadStart = performance.now();
    const laya = await Laya.load({
      ...options,
      executionProviders: ["cpu"],
      sessionOptions: { intraOpNumThreads: Math.min(4, availableParallelism()) },
    });
    console.error(`Model loaded in ${((performance.now() - loadStart) / 1000).toFixed(2)} s.`);
    try {
      const start = performance.now();
      const result = await laya.systemOne(request.state, request.questions);
      console.log(JSON.stringify(result, null, 2));
      console.error(`Decision time: ${(performance.now() - start).toFixed(1)} ms (not including model load).`);
    } finally {
      await laya.close();
    }
  }
} catch (error) {
  console.error(`Laya failed: ${error.message}`);
  process.exitCode = 1;
}