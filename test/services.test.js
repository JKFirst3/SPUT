import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { ComparisonService } from "../server/comparison-service.js";
import { DatasetStore } from "../server/dataset-store.js";
import { ExportService } from "../server/export-service.js";
import { ProjectRepository } from "../server/project-repository.js";
import { TextAnalysisService } from "../server/text-analysis-service.js";

const question = { id: "q1", number: 1, position: 1, displayCode: "Q1", prompt: "", label: "Was gefällt?", type: "single_choice", columns: [{ key: "c1", label: "Antwort" }] };
const dataset = (name, values) => ({ name, fileName: `${name}.xlsx`, participants: values.length, complete: values.length, completionRate: 1, countries: ["DE"], metadata: [], questions: [question], records: values.map((value) => ({ c1: value })), schema: { format: "Test" } });

test("DatasetStore owns session datasets and preserves explicit project ids", () => {
  const store = new DatasetStore();
  assert.equal(store.add(dataset("A", ["Ja"]), "study-a"), "study-a");
  assert.equal(store.get("study-a").name, "A");
  assert.equal(store.entries(["missing", "study-a"]).length, 1);
});

test("ProjectRepository persists and lists complete projects", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sput-project-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = new ProjectRepository(directory);
  await repository.initialize();
  const saved = await repository.save({ name: "Mein Projekt", activeStudyId: "a", studies: [{ id: "a", dataset: dataset("A", ["Ja"]), summaries: [] }] });
  const loaded = await repository.get(saved.id);
  assert.equal(loaded.name, "Mein Projekt");
  assert.equal(loaded.studies[0].dataset.records[0].c1, "Ja");
  assert.equal((await repository.list())[0].studyCount, 1);
});

test("ComparisonService compares studies without merging source records", () => {
  const first = dataset("Deutschland", ["Ja", "Nein"]);
  const second = dataset("USA", ["Ja", "Ja"]);
  const result = new ComparisonService().compare([{ id: "de", dataset: first }, { id: "us", dataset: second }]);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].studies[1].summary.distribution[0].count, 2);
  assert.equal(first.records.length, 2);
});

test("TextAnalysisService returns complete evidence-backed graph topics", () => {
  const answers = ["Die Bedienung ist schnell und einfach", "Bedienung schnell und einfach", "Die Bedienung wirkt kompliziert", ""];
  const result = new TextAnalysisService().analyze(answers);
  assert.deepEqual(result.answers, answers.slice(0, 3));
  assert.ok(result.themes.some((theme) => theme.label === "bedienung"));
  assert.ok(result.topics.some((topic) => topic.evidence.length > 0));
  assert.equal(result.quality.reviewRequired, true);
});

test("ExportService creates a readable xlsx and standalone report", async () => {
  const source = dataset("Export", ["Ja", "Nein"]);
  const buffer = await new ExportService().workbook(source);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Übersicht", "Fragen", "Rohdaten"]);
  assert.match(new ExportService().report(source, []), /SPUT Bericht/);
});

test("application exposes the semantic version from package.json", async () => {
  const { APP_VERSION } = await import("../server/index.js");
  const packageInfo = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(APP_VERSION, packageInfo.version);
});
