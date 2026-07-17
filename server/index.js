import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { analyzeVariables, summarizeQuestion } from "./analysis.js";
import { combineDatasets } from "./combine.js";
import { geographyForDataset } from "./geography.js";
import { parseUserTestingExport } from "./parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const uploadDir = path.join(root, ".uploads");
const savedViewsDir = path.join(root, ".saved-views");
await fs.mkdir(uploadDir, { recursive: true });
await fs.mkdir(savedViewsDir, { recursive: true });

const app = express();
const runFile = promisify(execFile);
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    callback(null, /\.xlsx$/i.test(file.originalname));
  },
});
const datasets = new Map();

function safeFileName(value, fallback = "ansicht") {
  return String(value || fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || fallback;
}

async function runAppleScript(lines) {
  const { stdout } = await runFile("osascript", lines.flatMap((line) => ["-e", line]));
  return stdout.trim();
}

app.use(express.json({ limit: "1mb" }));
app.use("/vendor/chart.js", express.static(path.join(root, "node_modules/chart.js/dist")));
app.use("/vendor/d3", express.static(path.join(root, "node_modules/d3/dist")));
app.use("/vendor/topojson", express.static(path.join(root, "node_modules/topojson-client/dist")));
app.use("/vendor/world-atlas", express.static(path.join(root, "node_modules/world-atlas")));
app.use(express.static(path.join(root, "public")));

app.post("/api/import", upload.single("file"), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: "Bitte eine XLSX-Datei auswählen." });
  try {
    const dataset = await parseUserTestingExport(request.file.path, request.file.originalname);
    const id = crypto.randomUUID();
    datasets.set(id, dataset);
    const summaries = dataset.questions.map((question) => ({
      questionId: question.id,
      ...summarizeQuestion(dataset, question),
    }));
    response.json({ id, dataset: { ...dataset, geography: geographyForDataset(dataset) }, summaries });
  } catch (error) {
    response.status(422).json({ error: error.message });
  } finally {
    await fs.unlink(request.file.path).catch(() => {});
  }
});

app.post("/api/combine", (request, response) => {
  const ids = [...new Set(request.body.ids ?? [])];
  const entries = ids.map((id) => ({ id, dataset: datasets.get(id) })).filter((entry) => entry.dataset);
  if (entries.length < 2) return response.status(422).json({ error: "Bitte mindestens zwei geladene Studien auswählen." });
  try {
    const combined = combineDatasets(entries, request.body.name);
    const id = crypto.randomUUID();
    datasets.set(id, combined.dataset);
    response.json({
      id,
      dataset: { ...combined.dataset, geography: geographyForDataset(combined.dataset) },
      summaries: combined.summaries,
    });
  } catch (error) {
    response.status(422).json({ error: error.message });
  }
});

app.post("/api/datasets/:id/analyze", (request, response) => {
  const dataset = datasets.get(request.params.id);
  if (!dataset) return response.status(404).json({ error: "Datensatz nicht gefunden. Bitte erneut importieren." });
  try {
    response.json(
      analyzeVariables(dataset, request.body.x, request.body.y, request.body.method, {
        xKind: request.body.xKind,
        yKind: request.body.yKind,
      }),
    );
  } catch (error) {
    response.status(422).json({ error: error.message });
  }
});

app.get("/api/datasets/:id", (request, response) => {
  const dataset = datasets.get(request.params.id);
  if (!dataset) return response.status(404).json({ error: "Datensatz nicht gefunden." });
  response.json({
    id: request.params.id,
    dataset: { ...dataset, geography: geographyForDataset(dataset) },
    summaries: dataset.questions.map((question) => ({
      questionId: question.id,
      ...summarizeQuestion(dataset, question),
    })),
  });
});

app.patch("/api/datasets/:id/schema", (request, response) => {
  const dataset = datasets.get(request.params.id);
  if (!dataset) return response.status(404).json({ error: "Datensatz nicht gefunden." });
  try {
    const edits = new Map((request.body.questions ?? []).map((question) => [question.id, question]));
    const updatedQuestions = [];
    for (const question of dataset.questions) {
      const edit = edits.get(question.id);
      if (edit?.included === false) continue;
      const oldColumns = question.columns;
      const optionEdits = new Map((edit?.optionEdits ?? []).map((option) => [option.key, option.label]));
      const choiceEdits = new Map((edit?.choices ?? []).map((choice) => [choice.source, choice.label]));
      const editedColumns = oldColumns.map((column) => {
        const nextLabel = String(optionEdits.get(column.key) ?? choiceEdits.get(column.label) ?? column.label).trim() || column.label;
        if (nextLabel !== column.label) {
          dataset.records.forEach((record) => {
            if (record[column.key] === column.label) record[column.key] = nextLabel;
          });
        }
        return { ...column, label: nextLabel };
      });
      if (choiceEdits.size) {
        dataset.records.forEach((record) => {
          editedColumns.forEach((column) => {
            const replacement = choiceEdits.get(record[column.key]);
            if (replacement) record[column.key] = replacement;
          });
        });
      }
      const choiceLabels = [...choiceEdits.values()].filter(Boolean);
      updatedQuestions.push({
        ...question,
        prompt: String(edit?.prompt ?? question.prompt).trim() || question.prompt,
        label: String(edit?.label ?? question.label).trim() || question.label,
        type: edit?.type ?? question.type,
        columns: editedColumns,
        review: {
          ...(question.review ?? {}),
          choices: choiceLabels.length ? choiceLabels : question.review?.choices ?? [],
        },
      });
    }
    let questionCounter = 0;
    let instructionCounter = 0;
    dataset.questions = updatedQuestions.map((question, index) => {
      const isInstruction = question.type === "instruction";
      const number = isInstruction ? ++instructionCounter : ++questionCounter;
      return {
        ...question,
        id: `${isInstruction ? "a" : "q"}${number}`,
        number,
        position: index + 1,
        displayCode: `${isInstruction ? "A" : "Q"}${number}`,
        columns: question.columns.map((column) => ({ ...column, questionNumber: number })),
      };
    });
    if (request.body.name?.trim()) dataset.name = request.body.name.trim();
    const summaries = dataset.questions.map((question) => ({
      questionId: question.id,
      ...summarizeQuestion(dataset, question),
    }));
    response.json({ dataset: { ...dataset, geography: geographyForDataset(dataset) }, summaries });
  } catch (error) {
    response.status(422).json({ error: error.message });
  }
});

app.get("/api/saved-views", async (_request, response) => {
  try {
    const files = (await fs.readdir(savedViewsDir)).filter((file) => file.endsWith(".json"));
    const views = await Promise.all(files.map(async (file) => {
      const filePath = path.join(savedViewsDir, file);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const payload = JSON.parse(raw);
        const stats = await fs.stat(filePath);
        return {
          id: file,
          name: payload.name ?? file.replace(/\.json$/i, ""),
          studyName: payload.study?.name ?? "Unbekannte Studie",
          studySignature: payload.study?.signature ?? "",
          filterCount: payload.filters?.length ?? 0,
          hiddenCount: payload.hiddenCards?.length ?? 0,
          updatedAt: stats.mtime.toISOString(),
        };
      } catch {
        return null;
      }
    }));
    response.json({ views: views.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/saved-views", async (request, response) => {
  try {
    const name = safeFileName(request.body.name, "SPUT_Ansicht");
    const payload = {
      ...request.body,
      name: request.body.name || name,
      savedAt: new Date().toISOString(),
    };
    const fileName = `${name}.json`;
    await fs.writeFile(path.join(savedViewsDir, fileName), JSON.stringify(payload, null, 2), "utf8");
    response.json({ id: fileName, path: `.saved-views/${fileName}` });
  } catch (error) {
    response.status(422).json({ error: error.message });
  }
});

app.get("/api/saved-views/:id", async (request, response) => {
  try {
    const fileName = path.basename(request.params.id);
    if (!fileName.endsWith(".json")) return response.status(404).json({ error: "Ansicht nicht gefunden." });
    const raw = await fs.readFile(path.join(savedViewsDir, fileName), "utf8");
    response.type("json").send(raw);
  } catch {
    response.status(404).json({ error: "Ansicht nicht gefunden." });
  }
});

app.delete("/api/saved-views/:id", async (request, response) => {
  try {
    const fileName = path.basename(request.params.id);
    if (!fileName.endsWith(".json")) return response.status(404).json({ error: "Ansicht nicht gefunden." });
    await fs.unlink(path.join(savedViewsDir, fileName));
    response.json({ deleted: true });
  } catch {
    response.status(404).json({ error: "Ansicht nicht gefunden." });
  }
});

app.post("/api/external/save-view", async (request, response) => {
  try {
    const suggestedName = `${safeFileName(request.body.name, "SPUT_Ansicht")}.json`;
    const filePath = await runAppleScript([
      `set outputFile to choose file name with prompt "SPUT Filteransicht speichern" default name "${suggestedName.replaceAll('"', '\\"')}"`,
      "POSIX path of outputFile",
    ]);
    if (!filePath) return response.status(499).json({ cancelled: true });
    await fs.writeFile(filePath.endsWith(".json") ? filePath : `${filePath}.json`, JSON.stringify(request.body.payload, null, 2), "utf8");
    response.json({ saved: true });
  } catch (error) {
    if (error.message?.includes("User canceled")) return response.status(499).json({ cancelled: true });
    response.status(422).json({ error: error.message });
  }
});

app.post("/api/external/load-view", async (_request, response) => {
  try {
    const filePath = await runAppleScript([
      'set inputFile to choose file with prompt "SPUT Filteransicht laden" of type {"json"}',
      "POSIX path of inputFile",
    ]);
    if (!filePath) return response.status(499).json({ cancelled: true });
    const raw = await fs.readFile(filePath, "utf8");
    response.type("json").send(raw);
  } catch (error) {
    if (error.message?.includes("User canceled")) return response.status(499).json({ cancelled: true });
    response.status(422).json({ error: error.message });
  }
});

app.get("/api/health", (_request, response) => response.json({ status: "ok", app: "SPUT" }));

app.use((_request, response) => response.sendFile(path.join(root, "public/index.html")));

const port = Number(process.env.PORT) || 4173;
app.listen(port, () => {
  console.log(`SPUT läuft auf http://localhost:${port}`);
});
