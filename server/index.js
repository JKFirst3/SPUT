import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { analyzeVariables, summarizeQuestion } from "./analysis.js";
import { combineDatasets } from "./combine.js";
import { ComparisonService } from "./comparison-service.js";
import { DatasetStore } from "./dataset-store.js";
import { ExportService } from "./export-service.js";
import { geographyForDataset } from "./geography.js";
import { parseUserTestingExport } from "./parser.js";
import { ProjectRepository } from "./project-repository.js";
import { UpdateService } from "./update-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const uploadDir = path.join(root, ".uploads");
const savedViewsDir = path.join(root, ".saved-views");
const projectsDir = path.join(root, ".projects");
await fs.mkdir(uploadDir, { recursive: true, mode: 0o700 });
await fs.mkdir(savedViewsDir, { recursive: true, mode: 0o700 });
const packageInfo = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
export const APP_VERSION = packageInfo.version;

export const app = express();
const runFile = promisify(execFile);
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (_request, file, callback) => {
    callback(null, /\.xlsx$/i.test(file.originalname));
  },
});
const datasets = new DatasetStore();
const projects = new ProjectRepository(projectsDir);
const comparisons = new ComparisonService();
const exports = new ExportService();
const updates = new UpdateService({ currentVersion: APP_VERSION, repository: "JKFirst3/SPUT" });
await projects.initialize();

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

app.disable("x-powered-by");

app.use((request, response, next) => {
  const host = request.get("host")?.toLowerCase();
  const allowedHosts = ["127.0.0.1", "localhost"].flatMap((name) => [name, `${name}:${request.socket.localPort}`]);
  if (!allowedHosts.includes(host)) return response.status(403).json({ error: "SPUT ist nur über die lokale Adresse erreichbar." });

  response.set({
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  next();
});

app.use("/api", (request, response, next) => {
  const origin = request.get("origin");
  const site = request.get("sec-fetch-site");
  if ((origin && origin !== `http://${request.get("host").toLowerCase()}`) || site === "cross-site" || site === "same-site") {
    return response.status(403).json({ error: "Die SPUT-API akzeptiert nur Anfragen von der eigenen Oberfläche." });
  }
  response.set("Cache-Control", "no-store");
  next();
});

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
    const id = datasets.add(dataset);
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
  const entries = datasets.entries(ids);
  if (entries.length < 2) return response.status(422).json({ error: "Bitte mindestens zwei geladene Studien auswählen." });
  try {
    const combined = combineDatasets(entries, request.body.name);
    const id = datasets.add(combined.dataset);
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
    await fs.writeFile(path.join(savedViewsDir, fileName), JSON.stringify(payload, null, 2), { mode: 0o600 });
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

app.post("/api/compare", (request, response) => {
  try {
    response.json(comparisons.compare(datasets.entries(request.body.ids ?? [])));
  } catch (error) {
    response.status(422).json({ error: error.message });
  }
});

app.get("/api/projects", async (_request, response) => {
  try {
    response.json({ projects: await projects.list() });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/projects", async (request, response) => {
  try {
    const entries = datasets.entries(request.body.studyIds ?? []);
    if (!entries.length) return response.status(422).json({ error: "Das Projekt enthält noch keine Studien." });
    const studies = entries.map(({ id, dataset }) => ({
      id,
      dataset,
      summaries: dataset.questions.map((question) => ({ questionId: question.id, ...summarizeQuestion(dataset, question) })),
      combined: Boolean(dataset.sources),
    }));
    const project = await projects.save({
      id: request.body.id,
      name: request.body.name,
      studies,
      activeStudyId: request.body.activeStudyId,
    });
    response.json({ id: project.id, name: project.name, updatedAt: project.updatedAt });
  } catch (error) {
    response.status(422).json({ error: error.message });
  }
});

app.get("/api/projects/:id", async (request, response) => {
  try {
    const project = await projects.get(request.params.id);
    project.studies.forEach((study) => datasets.add(study.dataset, study.id));
    response.json(project);
  } catch (error) {
    response.status(404).json({ error: `Projekt konnte nicht geöffnet werden: ${error.message}` });
  }
});

app.get("/api/datasets/:id/export.xlsx", async (request, response) => {
  const dataset = datasets.get(request.params.id);
  if (!dataset) return response.status(404).json({ error: "Datensatz nicht gefunden." });
  const buffer = await exports.workbook(dataset);
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", `attachment; filename="${safeFileName(dataset.name, "SPUT_Export")}.xlsx"`);
  response.send(buffer);
});

app.get("/api/datasets/:id/report.html", (request, response) => {
  const dataset = datasets.get(request.params.id);
  if (!dataset) return response.status(404).json({ error: "Datensatz nicht gefunden." });
  const summaries = dataset.questions.map((question) => ({ questionId: question.id, ...summarizeQuestion(dataset, question) }));
  response.setHeader("Content-Disposition", `attachment; filename="${safeFileName(dataset.name, "SPUT_Bericht")}.html"`);
  response.type("html").send(exports.report(dataset, summaries));
});

app.get("/api/version", (_request, response) => response.json({ version: APP_VERSION }));
app.get("/api/updates/check", async (_request, response) => response.json(await updates.check()));

app.get("/api/health", (_request, response) => response.json({ status: "ok", app: "SPUT", version: APP_VERSION }));

app.use("/api", (_request, response) => response.status(404).json({ error: "API-Endpunkt nicht gefunden." }));
app.get("/", (_request, response) => response.sendFile(path.join(root, "public/index.html")));
app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error);
  if (error.code === "LIMIT_FILE_SIZE" || error.status === 413) {
    return response.status(413).json({ error: "Die Datei oder Anfrage ist zu groß." });
  }
  if (error instanceof multer.MulterError || error.status === 400) {
    return response.status(400).json({ error: "Die Anfrage oder Datei konnte nicht gelesen werden." });
  }
  console.error(error);
  response.status(500).json({ error: "Interner SPUT-Fehler." });
});

export function startServer(port = Number(process.env.PORT) || 4173) {
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`SPUT läuft auf http://localhost:${server.address().port}`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) startServer();
