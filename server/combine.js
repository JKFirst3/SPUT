import { summarizeQuestion } from "./analysis.js";

function normalized(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^Q\d+\.\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function combineDatasets(entries, name = "Kombinierte Studie") {
  const metadataMap = new Map();
  const questionMap = new Map();
  let columnIndex = 1;

  const ensureMetadata = (label, area = "Studienvergleich") => {
    const id = normalized(label);
    if (!metadataMap.has(id)) {
      metadataMap.set(id, { index: columnIndex, key: `c${columnIndex}`, label, area, prompt: "" });
      columnIndex += 1;
    }
    return metadataMap.get(id);
  };

  ensureMetadata("Studie");
  ensureMetadata("Quelldatei");

  for (const { dataset } of entries) {
    dataset.metadata.forEach((column) => ensureMetadata(column.label, column.area));
    dataset.questions.forEach((question) => {
      const questionId = `position:${question.position ?? question.number}`;
      if (!questionMap.has(questionId)) {
        questionMap.set(questionId, {
          id: "",
          number: 0,
          prompt: question.prompt,
          label: question.label,
          type: question.type,
          columns: new Map(),
        });
      }
      const combinedQuestion = questionMap.get(questionId);
      question.columns.forEach((column, columnPosition) => {
        const columnId = `position:${columnPosition}`;
        if (!combinedQuestion.columns.has(columnId)) {
          combinedQuestion.columns.set(columnId, {
            index: columnIndex,
            key: `c${columnIndex}`,
            area: "Fragen",
            prompt: question.prompt,
            questionNumber: null,
            label: column.label,
          });
          columnIndex += 1;
        }
      });
    });
  }

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

  for (const { dataset } of entries) {
    const sourceMetadata = new Map(dataset.metadata.map((column) => [normalized(column.label), column]));
    const sourceQuestions = new Map(dataset.questions.map((question) => [`position:${question.position ?? question.number}`, question]));
    for (const sourceRecord of dataset.records) {
      const record = { _row: records.length + 4 };
      metadata.forEach((column) => {
        if (column.label === "Studie") record[column.key] = dataset.name;
        else if (column.label === "Quelldatei") record[column.key] = dataset.fileName;
        else {
          const source = sourceMetadata.get(normalized(column.label));
          record[column.key] = source ? sourceRecord[source.key] : "";
        }
      });
      questions.forEach((question) => {
        const sourceQuestion = sourceQuestions.get(`position:${question.position ?? question.number}`);
        question.columns.forEach((column, columnPosition) => {
          const source = sourceQuestion?.columns[columnPosition];
          record[column.key] = source ? sourceRecord[source.key] : "";
        });
      });
      records.push(record);
    }
  }

  const duration = metadata.find((column) => column.label === "Dauer der Studie");
  const status = metadata.find((column) => column.label === "Status");
  const country = metadata.find((column) => column.label === "Land");
  const durations = duration
    ? records
        .map((record) => String(record[duration.key]).match(/^(\d+):(\d{2}):(\d{2})$/))
        .filter(Boolean)
        .map((match) => Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]))
    : [];
  const complete = status
    ? records.filter((record) => /complete|abgeschlossen/i.test(record[status.key])).length
    : records.length;

  const dataset = {
    name,
    fileName: `${entries.length} kombinierte Exporte`,
    testType: "survey",
    testTypeConfidence: 0.96,
    sheetName: "Kombiniert",
    participants: records.length,
    complete,
    completionRate: records.length ? complete / records.length : 1,
    averageDurationSeconds: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null,
    countries: country ? [...new Set(records.map((record) => record[country.key]).filter(Boolean))] : [],
    metadata,
    questions,
    records,
    sources: entries.map(({ id, dataset: source }) => ({
      id,
      name: source.name,
      fileName: source.fileName,
      participants: source.participants,
      countries: source.countries,
    })),
    schema: {
      headerRows: 3,
      columns: columnIndex - 1,
      rows: records.length + 3,
      format: "Kombinierter UserTesting Survey Export",
    },
  };
  return {
    dataset,
    summaries: questions.map((question) => ({ questionId: question.id, ...summarizeQuestion(dataset, question) })),
  };
}
