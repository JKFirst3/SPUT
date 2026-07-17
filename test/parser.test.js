import assert from "node:assert/strict";
import test from "node:test";
import { analyzeVariables } from "../server/analysis.js";
import { combineDatasets } from "../server/combine.js";
import { geographyForDataset } from "../server/geography.js";
import { parseUserTestingExport } from "../server/parser.js";

const fixture =
  process.env.SPUT_FIXTURE ??
  "/Users/jkploch/Downloads/User-Testing_Test-data_Premium_Service_-_1_-_US.xlsx";

test("parses the three-row UserTesting survey schema", async () => {
  const dataset = await parseUserTestingExport(fixture, "premium.xlsx");
  assert.equal(dataset.testType, "survey");
  assert.equal(dataset.participants, 102);
  assert.equal(dataset.questions.length, 13);
  assert.ok(dataset.metadata.some((column) => column.label === "Alter"));
  assert.ok(dataset.questions.some((question) => question.type === "text"));
  assert.ok(dataset.questions.some((question) => question.type === "matrix"));
  assert.equal(dataset.questions[0].type, "instruction");
  assert.equal(dataset.questions[0].displayCode, "A1");
  assert.equal(dataset.questions[1].displayCode, "Q1");
});

test("links ranking positions to their textual options", async () => {
  const dataset = await parseUserTestingExport(
    "/Users/jkploch/Downloads/User-Testing_Test-data_Robot_Heroes_International.xlsx",
    "robot-heroes.xlsx",
  );
  const ranking = dataset.questions.find((question) => question.label.includes("Which of the solutions do you prefer"));
  assert.equal(ranking.type, "ranking");
  assert.deepEqual(ranking.columns.map((column) => column.label), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(ranking.review.choices.length, 7);
  assert.ok(ranking.review.choices.every((choice) => !/^\d+$/.test(choice)));
});

test("runs descriptive and bivariate analysis", async () => {
  const dataset = await parseUserTestingExport(fixture, "premium.xlsx");
  const age = dataset.metadata.find((column) => column.label === "Alter");
  const gender = dataset.metadata.find((column) => column.label === "Geschlecht");
  const descriptive = analyzeVariables(dataset, age.key);
  const cross = analyzeVariables(dataset, age.key, gender.key, "crosstab");
  assert.equal(descriptive.method, "descriptive");
  assert.ok(descriptive.distribution.length > 0);
  assert.equal(cross.method, "crosstab");
  assert.ok(cross.n > 0);
});

test("analyzes individual raw columns used by the UI compatibility filter", async () => {
  const dataset = await parseUserTestingExport(fixture, "premium.xlsx");
  const matrix = dataset.questions.find((question) => question.type === "matrix");
  assert.ok(matrix);
  const x = matrix.columns[0];
  const y = matrix.columns[1];
  const correlation = analyzeVariables(dataset, `column:${x.key}`, `column:${y.key}`, "pearson");
  assert.equal(correlation.method, "pearson");
  assert.ok(correlation.n >= 3);
});

test("calculates chi-square and Cramer's V for categorical variables", async () => {
  const dataset = await parseUserTestingExport(fixture, "premium.xlsx");
  const age = dataset.metadata.find((column) => column.label === "Alter");
  const gender = dataset.metadata.find((column) => column.label === "Geschlecht");
  const result = analyzeVariables(
    dataset,
    `column:${age.key}`,
    `column:${gender.key}`,
    "crosstab",
    { xKind: "categorical", yKind: "categorical" },
  );
  assert.equal(result.method, "crosstab");
  assert.ok(result.statistic >= 0);
  assert.ok(result.pValue >= 0 && result.pValue <= 1);
  assert.ok(result.cramersV >= 0 && result.cramersV <= 1);
});

test("dispatches grouped numeric data and segments text", async () => {
  const dataset = await parseUserTestingExport(fixture, "premium.xlsx");
  const gender = dataset.metadata.find((column) => column.label === "Geschlecht");
  const matrix = dataset.questions.find((question) => question.type === "matrix");
  const textQuestion = dataset.questions.find((question) => question.type === "text");
  const testResult = analyzeVariables(
    dataset,
    `column:${gender.key}`,
    `column:${matrix.columns[0].key}`,
    "auto",
    { xKind: "categorical", yKind: "numeric" },
  );
  const textResult = analyzeVariables(
    dataset,
    `column:${textQuestion.columns[0].key}`,
    `column:${gender.key}`,
    "auto",
    { xKind: "text", yKind: "categorical" },
  );
  assert.equal(testResult.method, "anova");
  assert.ok(testResult.groups.length === 3);
  assert.ok(testResult.pValue >= 0 && testResult.pValue <= 1);
  assert.equal(textResult.method, "text_segment");
  assert.ok(textResult.segments.length > 0);

  const binaryDataset = {
    ...dataset,
    records: dataset.records.filter((record) => ["Weiblich", "Männlich"].includes(record[gender.key])),
  };
  const binaryResult = analyzeVariables(
    binaryDataset,
    `column:${gender.key}`,
    `column:${matrix.columns[0].key}`,
    "auto",
    { xKind: "categorical", yKind: "numeric" },
  );
  assert.equal(binaryResult.method, "ttest");
  assert.equal(binaryResult.groups.length, 2);
});

test("combines repeated studies and preserves their source", async () => {
  const first = await parseUserTestingExport(fixture, "premium-us.xlsx");
  const second = await parseUserTestingExport(fixture, "premium-copy.xlsx");
  const combined = combineDatasets([{ id: "one", dataset: first }, { id: "two", dataset: second }]);
  const studyColumn = combined.dataset.metadata.find((column) => column.label === "Studie");
  assert.equal(combined.dataset.participants, first.participants + second.participants);
  assert.ok(studyColumn);
  assert.deepEqual(
    new Set(combined.dataset.records.map((record) => record[studyColumn.key])),
    new Set([first.name, second.name]),
  );
  assert.equal(combined.dataset.questions.length, first.questions.length);
});

test("prepares geographic region points when region data exists", async () => {
  const dataset = await parseUserTestingExport(fixture, "premium.xlsx");
  const geography = geographyForDataset(dataset);
  assert.ok(geography.length > 0);
  assert.ok(geography.every((entry) => Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude)));
});

test("summarizes a multi-column question as one complete question", async () => {
  const dataset = await parseUserTestingExport(fixture, "premium.xlsx");
  const matrix = dataset.questions.find((question) => question.type === "matrix");
  const result = analyzeVariables(dataset, matrix.id);
  assert.equal(result.method, "question_summary");
  assert.equal(result.series.length, matrix.columns.length);
});

test("keeps numbers inside free text out of numeric statistics", async () => {
  const dataset = await parseUserTestingExport(
    "/Users/jkploch/Downloads/User-Testing_Test-data_Robot_Heroes_International.xlsx",
    "robot-heroes.xlsx",
  );
  const textQuestion = dataset.questions.find((question) => question.type === "text");
  const result = analyzeVariables(dataset, textQuestion.id, null, "auto", { xKind: "text" });
  assert.equal(result.method, "text_overview");
  assert.ok(result.n > 0);
  assert.ok(result.themes.length > 0);
  assert.equal("numeric" in result, false);
});

test("treats single-choice questions as one categorical variable", async () => {
  const dataset = await parseUserTestingExport(
    "/Users/jkploch/Downloads/User-Testing_Test-data_Robot_Heroes_International.xlsx",
    "robot-heroes.xlsx",
  );
  const first = dataset.questions.find((question) => question.id === "q1");
  const second = dataset.questions.find((question) => question.id === "q2");
  const descriptive = analyzeVariables(dataset, first.id, null, "auto", { xKind: "categorical" });
  const relationship = analyzeVariables(
    dataset,
    first.id,
    second.id,
    "auto",
    { xKind: "categorical", yKind: "categorical" },
  );
  assert.equal(descriptive.method, "descriptive");
  assert.ok(descriptive.distribution.some((item) => item.label.includes("washing machine")));
  assert.equal(relationship.method, "crosstab");
  assert.ok(relationship.n > 0);
});

test("compares multiple-choice selections with demographics and other questions", async () => {
  const dataset = await parseUserTestingExport(
    "/Users/jkploch/Downloads/User-Testing_Test-data_Robot_Heroes_International.xlsx",
    "robot-heroes.xlsx",
  );
  const age = dataset.metadata.find((column) => column.label === "Alter");
  const multiple = dataset.questions.filter((question) => question.type === "multiple_choice");
  const byAge = analyzeVariables(
    dataset,
    multiple[0].id,
    `column:${age.key}`,
    "auto",
    { xKind: "categorical", yKind: "categorical" },
  );
  const questionPair = analyzeVariables(
    dataset,
    multiple[0].id,
    multiple[1].id,
    "auto",
    { xKind: "categorical", yKind: "categorical" },
  );
  assert.equal(byAge.method, "multi_response");
  assert.ok(byAge.rows.length > 1);
  assert.ok(byAge.columns.length > 1);
  assert.equal(questionPair.method, "multi_response");
  assert.ok(questionPair.matrix.flat().some((value) => value > 0));
  assert.ok(questionPair.associations.length > 0);
});

test("detects both supplied current and legacy multi-country exports", async () => {
  const legacy = await parseUserTestingExport(
    "/Users/jkploch/Downloads/202505_Zusammenstellung_Usertesting_Voice_Akzeptanz_RAW 1 1.xlsx",
    "legacy.xlsx",
  );
  const current = await parseUserTestingExport(
    "/Users/jkploch/Downloads/User-Testing_Test-data_250515_voice_commands_in_household_appliances 1 1.xlsx",
    "current.xlsx",
  );
  assert.equal(legacy.schema.mode, "legacy_multisheet");
  assert.equal(current.schema.mode, "current_single_sheet");
  assert.equal(legacy.countries.length, 6);
  assert.ok(legacy.participants > current.participants);
  assert.equal(legacy.questions.length, current.questions.length);
});
