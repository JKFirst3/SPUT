import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

export function createDemoWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Daten");
  sheet.addRows([
    ["Teilnehmende", null, "Fragen"],
    [null, null, "Q1. Welches Layout bevorzugst du?", "Q2. Was würdest du verbessern?", "Q3. Bewerte die Übersicht", null, "Q4. Ordne die Funktionen nach Wichtigkeit", null],
    ["Teilnehmer-ID", "Alter", "Antwort", "Antwort", "Navigation", "Lesbarkeit", "1", "2"],
    ["DEMO-01", "18–24", "Kompakt", "Ich wünsche mir größere Symbole.", 4, 5, "Suche", "Filter"],
    ["DEMO-02", "25–34", "Geräumig", "Der Kontrast könnte kräftiger sein.", 3, 5, "Filter", "Suche"],
    ["DEMO-03", "25–34", "Kompakt", "Die Navigation gefällt mir.", 4, 4, "Suche", "Filter"],
    ["DEMO-04", "35–44", "Geräumig", "Eine kurze Anleitung würde helfen.", 2, 5, "Filter", "Suche"],
  ]);
  return workbook;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] ?? "SPUT-Beispiel.xlsx";
  const buffer = await createDemoWorkbook().xlsx.writeBuffer();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(output, buffer, { flag: "wx", mode: 0o600 });
  console.log(output);
}
