import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlaygroundServer } from "./server.mjs";

test("local decision API validates input and returns model results", async (context) => {
  const model = { systemOne: async () => ({ answers: { route: { choice: "billing" } } }) };
  const server = createPlaygroundServer(model);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${base}/api/decide`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
  });
  for (const path of ["/", "/app.js", "/style.css", "/icons.js", "/example.json"]) {
    const asset = await fetch(`${base}${path}`);
    assert.equal(asset.status, 200);
    await asset.arrayBuffer();
  }
  assert.equal((await (await fetch(`${base}/api/health`)).json()).ready, true);
  assert.equal((await post("{")).status, 400);
  assert.equal((await post("null")).status, 400);
  assert.equal((await post('{"state":"test","questions":{}}')).status, 400);
  assert.equal((await post("{}", { Origin: "https://example.com" })).status, 403);
  assert.equal((await post("{}", { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post(JSON.stringify({ state: "x".repeat(65536) }))).status, 413);
  const response = await post(JSON.stringify({ state: "refund", questions: {
    route: { type: "choice", instructions: "Pick a department", criteria: ["billing", "sales"] },
  } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.answers.route.choice, "billing");
  assert.equal(typeof result.duration_ms, "number");
});

test("only one inference runs at a time and model errors release the lock", async (context) => {
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  const model = { systemOne: async () => {
    started();
    await new Promise((resolve) => { release = resolve; });
    throw new Error("Invalid criteria.");
  } };
  const server = createPlaygroundServer(model);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = () => fetch(`${base}/api/decide`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "test", questions: { check: { type: "noul", instructions: "Is this a test?" } } }),
  });
  const first = post();
  await began;
  const overlapping = await post();
  assert.equal(overlapping.status, 409);
  await overlapping.json();
  release();
  const failed = await first;
  assert.equal(failed.status, 422);
  assert.equal((await failed.json()).error, "Invalid criteria.");
  assert.equal((await (await fetch(`${base}/api/health`)).json()).busy, false);
});