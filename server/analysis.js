import * as ss from "simple-statistics";
import jStat from "jstat";
import { isNonEmpty, toNumber, valueForQuestion } from "./parser.js";

const STOPWORDS = new Set(
  "aber alle als also am an auch auf aus bei bin bis bist da dadurch daher darum das dass dein deine dem den der des die dies diese doch dort du durch ein eine einer eines er es für hat hier ich im in ist ja kann kein keine mit muss nach nicht noch nun oder ohne sehr sein sind so über um und uns von vor war was weil wenn werden wie wieder wir wird wo zu zum zur the a an and are as at be because been but by can could did do does for from had has have how i if in into is it its may more most my no not of on one or our should so than that the their them then there they this to too up very was we were what when where which who why will with would you your".split(/\s+/),
);

function analysisNumber(value) {
  const direct = toNumber(value);
  if (direct !== null) return direct;
  const string = String(value ?? "").trim();
  const duration = string.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (duration) return Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  const range = string.match(/(-?\d+(?:[.,]\d+)?)\s*[-–]\s*(-?\d+(?:[.,]\d+)?)/);
  if (range) {
    const start = Number(range[1].replace(",", "."));
    const end = Number(range[2].replace(",", "."));
    return (start + end) / 2;
  }
  return null;
}

function categoryDistribution(values) {
  const valid = values.filter(isNonEmpty);
  const counts = new Map();
  for (const value of valid) {
    const label = String(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, percent: valid.length ? count / valid.length : 0 }))
    .sort((a, b) => b.count - a.count);
}

function numericSummary(values) {
  const numbers = values.map(analysisNumber).filter((value) => value !== null);
  if (!numbers.length) return null;
  return {
    n: numbers.length,
    mean: ss.mean(numbers),
    median: ss.median(numbers),
    standardDeviation: numbers.length > 1 ? ss.sampleStandardDeviation(numbers) : 0,
    min: ss.min(numbers),
    max: ss.max(numbers),
  };
}

function tokenize(value) {
  return (
    String(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-zäöüß]{4,}/gi) ?? []
  ).filter((candidate) => !STOPWORDS.has(candidate));
}

function themes(values, limit = 12) {
  const counts = new Map();
  for (const value of values.filter(isNonEmpty)) {
    for (const word of new Set(tokenize(value))) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function textOverview(values) {
  const valid = values.filter(isNonEmpty).map(String);
  const wordCounts = valid.map((value) => tokenize(value).length);
  return {
    n: valid.length,
    themes: themes(valid, 15),
    answers: valid,
    averageWords: wordCounts.length ? ss.mean(wordCounts) : 0,
  };
}

export function summarizeQuestion(dataset, question) {
  if (question.type === "instruction") {
    return { distribution: [], numeric: null, themes: [], instruction: true };
  }
  if (question.type === "multiple_choice") {
    const values = dataset.records.flatMap((record) => selectionsForRecord(question, record));
    return { distribution: categoryDistribution(values), numeric: null, themes: [] };
  }
  if (question.type === "ranking") {
    const ranks = new Map();
    question.columns.forEach((column) => {
      const rank = Number(column.label);
      dataset.records.forEach((record) => {
        const choice = record[column.key];
        if (!isNonEmpty(choice) || !Number.isFinite(rank)) return;
        if (!ranks.has(choice)) ranks.set(choice, []);
        ranks.get(choice).push(rank);
      });
    });
    return {
      series: [...ranks.entries()]
        .map(([label, values]) => ({
          label,
          numeric: numericSummary(values),
          distribution: categoryDistribution(values),
        }))
        .sort((a, b) => (a.numeric?.mean ?? Infinity) - (b.numeric?.mean ?? Infinity)),
      ranking: true,
    };
  }
  if (question.columns.length > 1 && question.type === "matrix") {
    return {
      series: question.columns.map((column) => {
        const values = dataset.records.map((record) => record[column.key]);
        return { label: column.label, numeric: numericSummary(values), distribution: categoryDistribution(values) };
      }),
    };
  }
  const values = dataset.records.map((record) => valueForQuestion(dataset, question, record));
  return {
    distribution: categoryDistribution(values),
    numeric: numericSummary(values),
    themes: question.type === "text" ? themes(values) : [],
  };
}

function variable(dataset, id) {
  if (id.startsWith("column:")) {
    const key = id.slice("column:".length);
    const metadata = dataset.metadata.find((candidate) => candidate.key === key);
    if (metadata) return { id, label: metadata.label, values: dataset.records.map((record) => record[key]) };
    for (const question of dataset.questions) {
      const column = question.columns.find((candidate) => candidate.key === key);
      if (column) {
        return {
          id,
          label: column.label === "Antwort" ? question.label : `${question.label} – ${column.label}`,
          values: dataset.records.map((record) => record[key]),
        };
      }
    }
  }
  const question = dataset.questions.find((candidate) => candidate.id === id);
  if (question) {
    const selections = ["single_choice", "multiple_choice"].includes(question.type)
      ? dataset.records.map((record) => selectionsForRecord(question, record))
      : null;
    return {
      id,
      label: question.label,
      question,
      selections,
      values: dataset.records.map((record, index) => {
        if (question.type === "single_choice") return selections[index][0] ?? "";
        const value = valueForQuestion(dataset, question, record);
        return Array.isArray(value) ? value.filter(isNonEmpty).join(", ") : value;
      }),
    };
  }
  const metadata = dataset.metadata.find((candidate) => candidate.key === id);
  if (metadata) return { id, label: metadata.label, values: dataset.records.map((record) => record[metadata.key]) };
  throw new Error("Variable nicht gefunden.");
}

function selectionsForRecord(question, record) {
  const selected = [];
  const add = (value) => {
    const label = String(value ?? "").trim();
    if (label && label !== "—" && !selected.includes(label)) selected.push(label);
  };
  for (const column of question.columns) {
    const value = record[column.key];
    if (!isNonEmpty(value)) continue;
    if (/^(Antwort|Answer|Response)$/i.test(column.label)) {
      add(value);
    } else if (/^(Andere|Other|Other answer)$/i.test(column.label)) {
      add("Andere");
    } else {
      add(column.label);
    }
  }
  return selected;
}

function selectionOptions(variable) {
  if (variable.selections) {
    const preferred = variable.question?.review?.choices ?? [];
    const observed = [...new Set(variable.selections.flat())];
    return [...preferred, ...observed.filter((value) => !preferred.includes(value))];
  }
  return categoryDistribution(variable.values).map((item) => item.label);
}

function binaryAssociation(aSelections, bSelections, aOption, bOption) {
  let both = 0;
  let aOnly = 0;
  let bOnly = 0;
  let neither = 0;
  for (let index = 0; index < aSelections.length; index += 1) {
    const hasA = aSelections[index].includes(aOption);
    const hasB = bSelections[index].includes(bOption);
    if (hasA && hasB) both += 1;
    else if (hasA) aOnly += 1;
    else if (hasB) bOnly += 1;
    else neither += 1;
  }
  const matrix = [[both, aOnly], [bOnly, neither]];
  const test = chiSquareTest(matrix);
  const denominator = Math.sqrt((both + aOnly) * (bOnly + neither) * (both + bOnly) * (aOnly + neither));
  const phi = denominator ? (both * neither - aOnly * bOnly) / denominator : 0;
  return { aOption, bOption, both, phi, pValue: test.pValue };
}

function multiResponseAnalysis(x, y) {
  const xSelections = x.selections ?? x.values.map((value) => (isNonEmpty(value) ? [String(value)] : []));
  const ySelections = y.selections ?? y.values.map((value) => (isNonEmpty(value) ? [String(value)] : []));
  const xOptions = selectionOptions(x);
  const yOptions = selectionOptions(y);
  const validIndexes = xSelections
    .map((values, index) => (values.length && ySelections[index].length ? index : null))
    .filter((index) => index !== null);
  const matrix = xOptions.map((xOption) =>
    yOptions.map((yOption) =>
      validIndexes.filter((index) => xSelections[index].includes(xOption) && ySelections[index].includes(yOption)).length,
    ),
  );
  const bases = yOptions.map((yOption) => validIndexes.filter((index) => ySelections[index].includes(yOption)).length);
  const rates = matrix.map((row) => row.map((count, index) => (bases[index] ? count / bases[index] : 0)));
  const associations = xOptions
    .flatMap((xOption) => yOptions.map((yOption) => binaryAssociation(xSelections, ySelections, xOption, yOption)))
    .filter((association) => association.both > 0)
    .sort((a, b) => Math.abs(b.phi) - Math.abs(a.phi))
    .slice(0, 12);
  return {
    method: "multi_response",
    x: { id: x.id, label: x.label, multiple: x.question?.type === "multiple_choice" },
    y: { id: y.id, label: y.label, multiple: y.question?.type === "multiple_choice" },
    n: validIndexes.length,
    rows: xOptions,
    columns: yOptions,
    matrix,
    rates,
    bases,
    associations,
  };
}

function chiSquareTest(matrix) {
  const rowTotals = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
  const columnTotals = matrix[0].map((_, index) => matrix.reduce((sum, row) => sum + row[index], 0));
  const n = rowTotals.reduce((sum, value) => sum + value, 0);
  let statistic = 0;
  let lowExpectedCells = 0;
  matrix.forEach((row, rowIndex) =>
    row.forEach((observed, columnIndex) => {
      const expected = (rowTotals[rowIndex] * columnTotals[columnIndex]) / n;
      if (expected < 5) lowExpectedCells += 1;
      if (expected > 0) statistic += ((observed - expected) ** 2) / expected;
    }),
  );
  const degreesOfFreedom = (matrix.length - 1) * (matrix[0].length - 1);
  const pValue = degreesOfFreedom > 0 ? 1 - jStat.chisquare.cdf(statistic, degreesOfFreedom) : 1;
  const denominator = n * Math.min(matrix.length - 1, matrix[0].length - 1);
  return {
    statistic,
    degreesOfFreedom,
    pValue,
    cramersV: denominator > 0 ? Math.sqrt(statistic / denominator) : 0,
    lowExpectedCells,
    totalCells: matrix.length * matrix[0].length,
  };
}

function groupSummary(label, values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const mean = ss.mean(sorted);
  const standardDeviation = n > 1 ? ss.sampleStandardDeviation(sorted) : 0;
  const standardError = n > 1 ? standardDeviation / Math.sqrt(n) : 0;
  const critical = n > 1 ? jStat.studentt.inv(0.975, n - 1) : 0;
  return {
    label,
    n,
    mean,
    median: ss.median(sorted),
    standardDeviation,
    ciLow: mean - critical * standardError,
    ciHigh: mean + critical * standardError,
    min: ss.min(sorted),
    q1: ss.quantileSorted(sorted, 0.25),
    q3: ss.quantileSorted(sorted, 0.75),
    max: ss.max(sorted),
  };
}

function welchTTest(groups) {
  const [a, b] = groups;
  const varianceA = a.standardDeviation ** 2;
  const varianceB = b.standardDeviation ** 2;
  const standardErrorSquared = varianceA / a.n + varianceB / b.n;
  const statistic = (a.mean - b.mean) / Math.sqrt(standardErrorSquared);
  const degreesOfFreedom =
    standardErrorSquared ** 2 /
    ((varianceA / a.n) ** 2 / (a.n - 1) + (varianceB / b.n) ** 2 / (b.n - 1));
  const pValue = 2 * (1 - jStat.studentt.cdf(Math.abs(statistic), degreesOfFreedom));
  const pooledStandardDeviation = Math.sqrt(
    ((a.n - 1) * varianceA + (b.n - 1) * varianceB) / (a.n + b.n - 2),
  );
  return {
    statistic,
    degreesOfFreedom,
    pValue,
    effectSize: pooledStandardDeviation ? (a.mean - b.mean) / pooledStandardDeviation : 0,
  };
}

function anova(groups, rawGroups) {
  const all = rawGroups.flatMap((group) => group.values);
  const grandMean = ss.mean(all);
  const between = rawGroups.reduce((sum, group) => sum + group.values.length * (ss.mean(group.values) - grandMean) ** 2, 0);
  const within = rawGroups.reduce(
    (sum, group) => sum + group.values.reduce((inner, value) => inner + (value - ss.mean(group.values)) ** 2, 0),
    0,
  );
  const dfBetween = groups.length - 1;
  const dfWithin = all.length - groups.length;
  const statistic = (between / dfBetween) / (within / dfWithin);
  return {
    statistic,
    dfBetween,
    dfWithin,
    pValue: 1 - jStat.centralF.cdf(statistic, dfBetween, dfWithin),
    effectSize: between / (between + within),
  };
}

function groupedNumeric(category, numeric) {
  const map = new Map();
  category.values.forEach((categoryValue, index) => {
    const value = analysisNumber(numeric.values[index]);
    if (!isNonEmpty(categoryValue) || value === null) return;
    const label = String(categoryValue);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(value);
  });
  return [...map.entries()]
    .filter(([, values]) => values.length >= 1)
    .map(([label, values]) => ({ label, values }));
}

function textSegmentation(textVariable, segmentVariable, segmentKind) {
  const entries = textVariable.values
    .map((value, index) => ({ text: value, segment: segmentVariable.values[index], numeric: analysisNumber(segmentVariable.values[index]) }))
    .filter((entry) => isNonEmpty(entry.text) && isNonEmpty(entry.segment));
  let segments;
  if (segmentKind === "numeric") {
    const numeric = entries.filter((entry) => entry.numeric !== null).sort((a, b) => a.numeric - b.numeric);
    if (!numeric.length) throw new Error("Die Segmentvariable enthält keine auswertbaren Zahlen.");
    const q1 = numeric[Math.floor((numeric.length - 1) * 0.25)].numeric;
    const q2 = numeric[Math.floor((numeric.length - 1) * 0.5)].numeric;
    const q3 = numeric[Math.floor((numeric.length - 1) * 0.75)].numeric;
    const bins = [
      { label: `≤ ${q1}`, test: (value) => value <= q1 },
      { label: `${q1}–${q2}`, test: (value) => value > q1 && value <= q2 },
      { label: `${q2}–${q3}`, test: (value) => value > q2 && value <= q3 },
      { label: `> ${q3}`, test: (value) => value > q3 },
    ];
    segments = bins.map((bin) => ({
      label: bin.label,
      values: numeric.filter((entry) => bin.test(entry.numeric)).map((entry) => entry.text),
    }));
  } else {
    const topSegments = categoryDistribution(entries.map((entry) => entry.segment)).slice(0, 8).map((item) => item.label);
    segments = topSegments.map((label) => ({
      label,
      values: entries.filter((entry) => String(entry.segment) === label).map((entry) => entry.text),
    }));
  }
  return segments
    .filter((segment) => segment.values.length)
    .map((segment) => ({ label: segment.label, n: segment.values.length, words: themes(segment.values, 10) }));
}

export function analyzeVariables(dataset, xId, yId, method = "auto", kinds = {}) {
  const x = variable(dataset, xId);
  const y = yId ? variable(dataset, yId) : null;
  if (!y) {
    if (kinds.xKind === "text") {
      return {
        method: "text_overview",
        x: { id: x.id, label: x.label },
        ...textOverview(x.values),
      };
    }
    if (x.question?.type === "single_choice") {
      return {
        method: "descriptive",
        x: { id: x.id, label: x.label },
        distribution: categoryDistribution(x.values),
        numeric: null,
      };
    }
    if (x.question?.columns.length > 1) {
      const summary = summarizeQuestion(dataset, x.question);
      return {
        method: "question_summary",
        x: { id: x.id, label: x.label },
        questionType: x.question.type,
        ...summary,
      };
    }
    return { method: "descriptive", x, distribution: categoryDistribution(x.values), numeric: numericSummary(x.values) };
  }

  const xKind = kinds.xKind ?? "auto";
  const yKind = kinds.yKind ?? "auto";
  if (xKind === "text" || yKind === "text" || method === "text_segment") {
    const textVariable = xKind === "text" ? x : y;
    const segmentVariable = xKind === "text" ? y : x;
    const segmentKind = xKind === "text" ? yKind : xKind;
    return {
      method: "text_segment",
      text: { id: textVariable.id, label: textVariable.label },
      segment: { id: segmentVariable.id, label: segmentVariable.label },
      segments: textSegmentation(textVariable, segmentVariable, segmentKind),
    };
  }

  if (
    method === "group_compare" ||
    (method === "auto" && [xKind, yKind].includes("numeric") && [xKind, yKind].includes("categorical"))
  ) {
    const category = xKind === "categorical" ? x : y;
    const numeric = xKind === "numeric" ? x : y;
    const rawGroups = groupedNumeric(category, numeric);
    if (rawGroups.length < 2) throw new Error("Für den Gruppenvergleich werden mindestens zwei Gruppen mit numerischen Werten benötigt.");
    const groups = rawGroups.map((group) => groupSummary(group.label, group.values));
    if (groups.length === 2 && groups.some((group) => group.n < 2)) {
      throw new Error("Für den t-Test werden in beiden Gruppen mindestens zwei gültige Werte benötigt.");
    }
    const test = groups.length === 2 ? welchTTest(groups) : anova(groups, rawGroups);
    return {
      method: groups.length === 2 ? "ttest" : "anova",
      category: { id: category.id, label: category.label },
      numeric: { id: numeric.id, label: numeric.label },
      groups,
      ...test,
    };
  }

  if (
    xKind === "categorical" &&
    yKind === "categorical" &&
    (x.question?.type === "multiple_choice" || y.question?.type === "multiple_choice")
  ) {
    return multiResponseAnalysis(x, y);
  }

  const pairs = x.values
    .map((xValue, index) => ({ xRaw: xValue, yRaw: y.values[index], x: analysisNumber(xValue), y: analysisNumber(y.values[index]) }))
    .filter((pair) => isNonEmpty(pair.xRaw) && isNonEmpty(pair.yRaw));
  const numericPairs = pairs.filter((pair) => pair.x !== null && pair.y !== null);
  const selectedMethod =
    method === "auto" ? (xKind === "numeric" && yKind === "numeric" ? "pearson" : "crosstab") : method;

  if (["pearson", "spearman"].includes(selectedMethod)) {
    if (numericPairs.length < 3) throw new Error("Für eine Korrelation werden mindestens drei numerische Paare benötigt.");
    const xValues = numericPairs.map((pair) => pair.x);
    const yValues = numericPairs.map((pair) => pair.y);
    const coefficient =
      selectedMethod === "spearman" ? ss.sampleRankCorrelation(xValues, yValues) : ss.sampleCorrelation(xValues, yValues);
    return {
      method: selectedMethod,
      x: { id: x.id, label: x.label },
      y: { id: y.id, label: y.label },
      n: numericPairs.length,
      coefficient,
      points: numericPairs.map((pair) => ({ x: pair.x, y: pair.y })),
    };
  }

  const rows = [...new Set(pairs.map((pair) => String(pair.xRaw)))];
  const columns = [...new Set(pairs.map((pair) => String(pair.yRaw)))];
  const matrix = rows.map((row) =>
    columns.map((column) => pairs.filter((pair) => String(pair.xRaw) === row && String(pair.yRaw) === column).length),
  );
  return {
    method: "crosstab",
    x: { id: x.id, label: x.label },
    y: { id: y.id, label: y.label },
    n: pairs.length,
    rows,
    columns,
    matrix,
    ...chiSquareTest(matrix),
  };
}
