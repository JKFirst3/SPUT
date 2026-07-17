import ExcelJS from "exceljs";

function safe(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

export class ExportService {
  async workbook(dataset) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SPUT";
    const overview = workbook.addWorksheet("Übersicht");
    overview.addRows([
      ["SPUT Ergebnisexport"], ["Studie", dataset.name], ["Teilnehmende", dataset.participants],
      ["Vollständig", dataset.complete], ["Abschlussrate", dataset.completionRate],
      ["Länder", dataset.countries.join(", ")], ["Importformat", dataset.schema?.format ?? "Unbekannt"],
    ]);
    overview.getColumn(1).font = { bold: true };
    const questions = workbook.addWorksheet("Fragen");
    questions.columns = [
      { header: "Code", key: "code", width: 12 }, { header: "Frage", key: "label", width: 70 },
      { header: "Typ", key: "type", width: 22 }, { header: "Spalten", key: "columns", width: 50 },
    ];
    dataset.questions.forEach((question) => questions.addRow({ code: question.displayCode, label: question.label, type: question.type, columns: question.columns.map((c) => c.label).join(" | ") }));
    const raw = workbook.addWorksheet("Rohdaten");
    const columns = [...dataset.metadata, ...dataset.questions.flatMap((q) => q.columns)];
    raw.columns = columns.map((column) => ({ header: column.label, key: column.key, width: 24 }));
    dataset.records.forEach((record) => raw.addRow(record));
    [overview, questions, raw].forEach((sheet) => {
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B5BF4" } };
      sheet.autoFilter = sheet.rowCount > 1 && sheet.columnCount > 1 ? { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } } : undefined;
    });
    return workbook.xlsx.writeBuffer();
  }

  report(dataset, summaries) {
    const cards = dataset.questions.filter((q) => q.type !== "instruction").map((question) => {
      const summary = summaries.find((item) => item.questionId === question.id) ?? {};
      const entries = (summary.distribution ?? []).slice(0, 8);
      return `<section><h2>${safe(question.displayCode)} · ${safe(question.label)}</h2><p class="meta">${safe(question.type)} · ${entries.reduce((n, x) => n + x.count, 0)} Antworten</p>${entries.length ? `<table><tr><th>Antwort</th><th>Anzahl</th></tr>${entries.map((x) => `<tr><td>${safe(x.label)}</td><td>${x.count}</td></tr>`).join("")}</table>` : "<p>Detailanalyse und Originalantworten sind im Tool verfügbar.</p>"}</section>`;
    }).join("");
    return `<!doctype html><html lang="de"><meta charset="utf-8"><title>${safe(dataset.name)} – SPUT Bericht</title><style>body{font:15px system-ui;max-width:980px;margin:40px auto;color:#172033;padding:0 24px}header{padding:32px;background:#eef1ff;border-radius:18px}h1{margin:0 0 8px}section{break-inside:avoid;margin:28px 0;padding:22px;border:1px solid #dfe5ed;border-radius:14px}.meta{color:#657084}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:9px;border-bottom:1px solid #e8ecf2}@media print{body{margin:0}section{border-color:#bbb}}</style><body><header><h1>${safe(dataset.name)}</h1><p>${dataset.participants} Teilnehmende · ${safe(dataset.countries.join(", ") || "Keine Länderangabe")} · erstellt mit SPUT</p></header>${cards}<footer><p>Automatische Auswertungen können Fehler enthalten. Entscheidungen sollten anhand der Rohdaten und Originalantworten geprüft werden.</p></footer></body></html>`;
  }
}
