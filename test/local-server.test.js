import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { createDemoWorkbook } from "../scripts/demo-workbook.mjs";
import { startServer } from "../server/index.js";

test("protects the local API and imports and exports a synthetic study", async (t) => {
  const server = startServer(0);
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { address, port } = server.address();
  assert.equal(address, "127.0.0.1");
  const base = `http://${address}:${port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.match(health.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(health.headers.has("x-powered-by"), false);
  assert.equal((await fetch(`${base}/api/missing`)).status, 404);

  const wrongHost = await new Promise((resolve, reject) => {
    http.get(`${base}/api/health`, { headers: { Host: `rebind.example:${port}` } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(wrongHost, 403);
  const foreignOrigin = await fetch(`${base}/api/external/load-view`, {
    method: "POST",
    headers: { Origin: "https://example.org" },
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal((await fetch(`${base}/api/projects`, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);

  const form = new FormData();
  form.append("file", new Blob([await createDemoWorkbook().xlsx.writeBuffer()]), "demo.xlsx");
  const imported = await fetch(`${base}/api/import`, { method: "POST", body: form, headers: { Origin: base } });
  assert.equal(imported.status, 200);
  const { id, dataset } = await imported.json();
  assert.equal(dataset.participants, 4);
  assert.deepEqual(dataset.questions.map(({ type }) => type), ["single_choice", "text", "matrix", "ranking"]);
  const exported = await fetch(`${base}/api/datasets/${id}/export.xlsx`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-disposition"), /^attachment/);
  assert.ok((await exported.arrayBuffer()).byteLength > 0);
});
