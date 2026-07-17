import ExcelJS from "exceljs";

const EMPTY = new Set(["", "—", "-", "–", "null", "undefined"]);

function text(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value) return String(value.text ?? "").trim();
    if ("result" in value) return String(value.result ?? "").trim();
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
  }
  return String(value).trim();
}

function directCellText(cell) {
  if (cell.isMerged && cell.master.address !== cell.address) return "";
  return text(cell.value);
}

function isPresent(value) {
  return !EMPTY.has(text(value).toLowerCase());
}

function slug(value, fallback) {
  const normalized = text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return normalized || fallback;
}

function secondsFromDuration(value) {
  const match = text(value).match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = text(value).replace(/\s/g, "").replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return Number(normalized);
  const matches = normalized.match(/-?\d+(?:\.\d+)?/g);
  return matches?.length === 1 ? Number(matches[0]) : null;
}

function looksLikeFreeText(question, values) {
  const strings = values.filter(isPresent).map(text);
  if (!strings.length) return false;
  const uniqueRatio = new Set(strings.map((value) => value.toLowerCase())).size / strings.length;
  const averageLength = strings.reduce((sum, value) => sum + value.length, 0) / strings.length;
  const sentenceRatio = strings.filter((value) => /\s/.test(value) && (value.split(/\s+/).length >= 5 || /[.!?]/.test(value))).length / strings.length;
  const openPrompt = /kommentar|vorschl|feedback|beschreib|begr[uü]nd|erkl[aä]r|warum|weshalb|eigene[nr]? worte|freitext|comment|suggest|describe|explain|why|anything else|tell us/i.test(question.prompt);
  return uniqueRatio >= 0.45 && (openPrompt || averageLength >= 28 || sentenceRatio >= 0.35);
}

function inferQuestionType(question, records) {
  const columns = question.columns;
  const prompt = question.prompt.toLowerCase();
  const values = columns.flatMap((column) =>
    records.map((record) => record[column.key]).filter(isPresent),
  );
  const numericValues = values.map(numeric).filter((value) => value !== null);
  const numericRatio = values.length ? numericValues.length / values.length : 0;
  const unique = new Set(values.map(text));

  if (values.length === 0) return "instruction";
  if (/net promoter|\bnps\b/.test(prompt)) return "nps";
  if (columns.length > 1) {
    const rankLabels = columns.map((column) => Number(column.label));
    const hasSequentialRanks =
      rankLabels.every(Number.isInteger) &&
      [...rankLabels].sort((a, b) => a - b).every((value, index) => value === index + 1);
    const rankedRows = records
      .map((record) => columns.map((column) => text(record[column.key])).filter(isPresent))
      .filter((row) => row.length > 1);
    if (
      hasSequentialRanks &&
      rankedRows.length > 0 &&
      rankedRows.filter((row) => new Set(row).size === row.length).length / rankedRows.length > 0.8
    ) {
      return "ranking";
    }
    const selectedLabels = columns.filter((column) => {
      const columnValues = records.map((record) => record[column.key]).filter(isPresent);
      return columnValues.length > 0 &&
        columnValues.filter((value) => text(value) === column.label).length / columnValues.length > 0.7;
    }).length;
    if (selectedLabels >= Math.max(1, columns.length / 2)) return "multiple_choice";
    if (numericRatio > 0.8) {
      const rowNumeric = records
        .map((record) => columns.map((column) => numeric(record[column.key])).filter((v) => v !== null))
        .filter((row) => row.length > 1);
      const looksRanked =
        rowNumeric.length > 0 &&
        rowNumeric.filter((row) => new Set(row).size === row.length).length / rowNumeric.length > 0.8;
      return looksRanked ? "ranking" : "matrix";
    }
    return "multiple_choice";
  }

  if (numericRatio <= 0.2 && looksLikeFreeText(question, values)) return "text";
  if (numericRatio > 0.8) {
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    if (min >= 0 && max <= 10 && (/wahrscheinlich|likely|recommend|empfehl/.test(prompt) || max === 10)) {
      return "scale";
    }
    return unique.size <= 12 ? "scale" : "numeric";
  }
  if (unique.size <= 15 || unique.size / Math.max(values.length, 1) < 0.22) return "single_choice";
  return "text";
}

function displayLabel(prompt) {
  return prompt.replace(/^Q\d+\.\s*/i, "").replace(/\s+/g, " ").trim();
}

function isGenericAnswerLabel(value) {
  return /^(antwort|answer|response)$/i.test(text(value));
}

function isOtherLabel(value) {
  return /^(andere|anderes|other|other answer)$/i.test(text(value));
}

function reviewDefinition(question, records) {
  const choices = [];
  const otherResponses = [];
  let hasOther = false;
  const addChoice = (value) => {
    const label = text(value);
    if (!label || label === "—" || isGenericAnswerLabel(label) || isOtherLabel(label)) return;
    if (!choices.includes(label)) choices.push(label);
  };

  for (const column of question.columns) {
    const values = [...new Set(records.map((record) => record[column.key]).filter(isPresent).map(text))];
    if (isOtherLabel(column.label)) {
      hasOther = true;
      values.forEach((value) => {
        if (!isOtherLabel(value)) otherResponses.push(value);
      });
      continue;
    }
    if (isGenericAnswerLabel(column.label)) values.forEach(addChoice);
    else if (/^\d+$/.test(column.label) && values.length) values.forEach(addChoice);
    else {
      addChoice(column.label);
      values.forEach((value) => {
        if (value !== column.label && !isOtherLabel(value)) addChoice(value);
      });
    }
  }

  return {
    choices,
    hasOther,
    otherResponses: [...new Set(otherResponses)].filter((value) => !choices.includes(value)).slice(0, 12),
  };
}

function parseSheet(sheet, sourceName) {
  if (!sheet || sheet.rowCount < 4) throw new Error("Keine unterstützte Datentabelle gefunden.");

  const maxColumn = sheet.columnCount;
  const areaRow = sheet.getRow(1);
  const promptRow = sheet.getRow(2);
  const headerRow = sheet.getRow(3);
  const columns = [];
  let currentArea = "";
  let currentPrompt = "";
  let questionNumber = 0;

  for (let columnIndex = 1; columnIndex <= maxColumn; columnIndex += 1) {
    const areaCell = directCellText(areaRow.getCell(columnIndex));
    const promptCell = directCellText(promptRow.getCell(columnIndex));
    const header = text(headerRow.getCell(columnIndex).value) || `Spalte ${columnIndex}`;
    if (areaCell) currentArea = areaCell;
    if (promptCell) {
      currentPrompt = promptCell;
      questionNumber += 1;
    }
    const isQuestion = currentArea === "Fragen" || /^Q\d+\./i.test(currentPrompt);
    columns.push({
      index: columnIndex,
      key: `c${columnIndex}`,
      area: currentArea || "Allgemein",
      prompt: isQuestion ? currentPrompt : "",
      questionNumber: isQuestion ? questionNumber : null,
      label: header,
    });
  }

  const records = [];
  for (let rowIndex = 4; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    if (!isPresent(row.getCell(1).value)) continue;
    const record = { _row: rowIndex };
    for (const column of columns) record[column.key] = text(row.getCell(column.index).value);
    records.push(record);
  }

  const metadata = columns.filter((column) => !column.prompt);
  const questionMap = new Map();
  for (const column of columns.filter((item) => item.prompt)) {
    const id = `q${column.questionNumber}`;
    if (!questionMap.has(id)) {
      questionMap.set(id, {
        id,
        number: column.questionNumber,
        prompt: column.prompt,
        label: displayLabel(column.prompt),
        columns: [],
      });
    }
    questionMap.get(id).columns.push(column);
  }
  const inferredQuestions = [...questionMap.values()].map((question, position) => {
    let type = inferQuestionType(question, records);
    const genericAnswerColumns = question.columns.filter((column) => isGenericAnswerLabel(column.label));
    const remainingColumns = question.columns.filter((column) => !isGenericAnswerLabel(column.label));
    if (
      genericAnswerColumns.length === 1 &&
      remainingColumns.every((column) => isOtherLabel(column.label))
    ) {
      const primaryValues = records.map((record) => record[genericAnswerColumns[0].key]).filter(isPresent);
      const otherValues = remainingColumns.flatMap((column) =>
        records.map((record) => record[column.key]).filter(isPresent),
      );
      if (primaryValues.length === 0 && otherValues.length === 0) {
        type = "instruction";
        return { ...question, position: position + 1, type, review: reviewDefinition(question, records) };
      }
      const unique = new Set(primaryValues.map(text));
      const numericRatio = primaryValues.length
        ? primaryValues.map(numeric).filter((value) => value !== null).length / primaryValues.length
        : 0;
      if (numericRatio <= 0.2 && looksLikeFreeText(question, primaryValues)) type = "text";
      else if (numericRatio > 0.8) type = unique.size <= 12 ? "scale" : "numeric";
      else if (unique.size <= 20 || unique.size / Math.max(primaryValues.length, 1) < 0.35) type = "single_choice";
      else type = "text";
    }
    return { ...question, position: position + 1, type, review: reviewDefinition(question, records) };
  });
  let questionCounter = 0;
  let instructionCounter = 0;
  const questions = inferredQuestions.map((question) => {
    const isInstruction = question.type === "instruction";
    const number = isInstruction ? ++instructionCounter : ++questionCounter;
    return {
      ...question,
      id: `${isInstruction ? "a" : "q"}${number}`,
      number,
      displayCode: `${isInstruction ? "A" : "Q"}${number}`,
    };
  });

  const keyByHeader = new Map(metadata.map((column) => [column.label, column.key]));
  const durationKey = keyByHeader.get("Dauer der Studie");
  const statusKey = keyByHeader.get("Status");
  const countryKey = keyByHeader.get("Land") ?? keyByHeader.get("Country");
  const durations = records.map((record) => secondsFromDuration(record[durationKey])).filter((v) => v !== null);
  const statuses = records.map((record) => record[statusKey]).filter(isPresent);
  const countries = [...new Set(records.map((record) => record[countryKey]).filter(isPresent))];
  const complete = statuses.filter((status) => /complete|abgeschlossen/i.test(status)).length;

  return {
    name: sourceName,
    fileName: sourceName,
    testType: "survey",
    testTypeConfidence: 0.98,
    sheetName: sheet.name,
    participants: records.length,
    complete,
    completionRate: statuses.length ? complete / statuses.length : 1,
    averageDurationSeconds: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null,
    countries,
    metadata,
    questions,
    records,
    schema: {
      headerRows: 3,
      columns: maxColumn,
      rows: sheet.rowCount,
      format: "UserTesting Survey Export",
    },
  };
}

function normalized(value) {
  return text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^Q\d+\.\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function mergeCountrySheets(sheetDatasets, originalName) {
  const metadataMap = new Map();
  const questionMap = new Map();
  let columnIndex = 1;
  const ensureMetadata = (label, area = "Allgemein") => {
    const id = normalized(label);
    if (!metadataMap.has(id)) {
      metadataMap.set(id, { index: columnIndex, key: `c${columnIndex}`, label, area, prompt: "" });
      columnIndex += 1;
    }
    return metadataMap.get(id);
  };

  sheetDatasets.forEach((dataset) => {
    dataset.metadata.forEach((column) => ensureMetadata(column.label, column.area));
    dataset.questions.forEach((question) => {
      const id = `position:${question.position}`;
      if (!questionMap.has(id)) {
        questionMap.set(id, { ...question, columns: new Map() });
      }
      const mergedQuestion = questionMap.get(id);
      question.columns.forEach((column, position) => {
        if (!mergedQuestion.columns.has(position)) {
          mergedQuestion.columns.set(position, {
            index: columnIndex,
            key: `c${columnIndex}`,
            area: "Fragen",
            prompt: mergedQuestion.prompt,
            questionNumber: null,
            label: column.label,
          });
          columnIndex += 1;
        }
      });
    });
  });

  const metadata = [...metadataMap.values()];
  let questionCounter = 0;
  let instructionCounter = 0;
  const questions = [...questionMap.values()].map((question, index) => {
    const isInstruction = question.type === "instruction";
    const number = isInstruction ? ++instructionCounter : ++questionCounter;
    return {
      ...question,
      id: `${isInstruction ? "a" : "q"}${number}`,
      number,
      position: index + 1,
      displayCode: `${isInstruction ? "A" : "Q"}${number}`,
      columns: [...question.columns.values()].map((column) => ({ ...column, questionNumber: number })),
    };
  });
  const records = [];
  sheetDatasets.forEach((dataset) => {
    const sourceMetadata = new Map(dataset.metadata.map((column) => [normalized(column.label), column]));
    const sourceQuestions = new Map(dataset.questions.map((question) => [`position:${question.position}`, question]));
    dataset.records.forEach((sourceRecord) => {
      const record = { _row: records.length + 4 };
      metadata.forEach((column) => {
        const source = sourceMetadata.get(normalized(column.label));
        record[column.key] = source ? sourceRecord[source.key] : "";
      });
      questions.forEach((question) => {
        const sourceQuestion = sourceQuestions.get(`position:${question.position}`);
        question.columns.forEach((column, position) => {
          const source = sourceQuestion?.columns[position];
          record[column.key] = source ? sourceRecord[source.key] : "";
        });
      });
      records.push(record);
    });
  });
  // A legacy export is split into small country samples. Per-sheet cardinality can
  // therefore make open text look categorical (for example 14 unique answers in
  // 21 cases). Reclassify every question on the complete merged sample instead
  // of allowing the first country sheet to determine the final type.
  let mergedQuestionCounter = 0;
  let mergedInstructionCounter = 0;
  const mergedQuestions = questions.map((question) => {
    const type = inferQuestionType(question, records);
    const isInstruction = type === "instruction";
    const number = isInstruction ? ++mergedInstructionCounter : ++mergedQuestionCounter;
    return {
      ...question,
      id: `${isInstruction ? "a" : "q"}${number}`,
      number,
      displayCode: `${isInstruction ? "A" : "Q"}${number}`,
      type,
      review: reviewDefinition(question, records),
      columns: question.columns.map((column) => ({ ...column, questionNumber: number })),
    };
  });
  const duration = metadata.find((column) => column.label === "Dauer der Studie");
  const status = metadata.find((column) => column.label === "Status");
  const country = metadata.find((column) => /^(Land|Country)$/i.test(column.label));
  const durations = duration ? records.map((record) => secondsFromDuration(record[duration.key])).filter((value) => value !== null) : [];
  const complete = status ? records.filter((record) => /complete|abgeschlossen/i.test(record[status.key])).length : records.length;
  return {
    name: originalName.replace(/\.xlsx$/i, ""),
    fileName: originalName,
    testType: "survey",
    testTypeConfidence: 0.97,
    sheetName: sheetDatasets.map((dataset) => dataset.sheetName).join(", "),
    participants: records.length,
    complete,
    completionRate: records.length ? complete / records.length : 1,
    averageDurationSeconds: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    countries: country ? [...new Set(records.map((record) => record[country.key]).filter(isPresent))] : [],
    metadata,
    questions: mergedQuestions,
    records,
    schema: {
      headerRows: 3,
      columns: columnIndex - 1,
      rows: records.length + 3,
      format: "UserTesting Survey Export · Altes Länderformat",
      mode: "legacy_multisheet",
      sheets: sheetDatasets.map((dataset) => dataset.sheetName),
    },
  };
}

export async function parseUserTestingExport(filePath, originalName) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const dataSheet = workbook.worksheets.find((candidate) => candidate.name.toLowerCase() === "daten");
  if (dataSheet) {
    const dataset = parseSheet(dataSheet, originalName.replace(/\.xlsx$/i, ""));
    dataset.fileName = originalName;
    dataset.schema = { ...dataset.schema, mode: "current_single_sheet", sheets: [dataSheet.name] };
    return dataset;
  }
  const countrySheets = workbook.worksheets.filter((sheet) =>
    sheet.rowCount >= 4 && /teilnehmer[- ]?id|participant[- ]?id/i.test(text(sheet.getRow(3).getCell(1).value)),
  );
  if (!countrySheets.length) throw new Error("Keine unterstützte Datentabelle gefunden.");
  const parsedSheets = countrySheets.map((sheet) => parseSheet(sheet, sheet.name));
  return parsedSheets.length === 1
    ? { ...parsedSheets[0], name: originalName.replace(/\.xlsx$/i, ""), fileName: originalName, schema: { ...parsedSheets[0].schema, mode: "current_single_sheet", sheets: [parsedSheets[0].sheetName] } }
    : mergeCountrySheets(parsedSheets, originalName);
}

export function valueForQuestion(dataset, question, record) {
  if (question.columns.length === 1) return record[question.columns[0].key];
  return question.columns.map((column) => record[column.key]);
}

export function isNonEmpty(value) {
  return isPresent(value);
}

export function toNumber(value) {
  return numeric(value);
}

export function safeSlug(value, fallback = "variable") {
  return slug(value, fallback);
}
