import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const files = process.argv.slice(2);

for (const file of files) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  const sheets = workbook.worksheets.items;
  const result = { file, sheets: [] };

  for (const sheet of sheets) {
    const used = sheet.getUsedRange();
    if (!used) {
      result.sheets.push({ name: sheet.name, empty: true });
      continue;
    }
    const rowCount = used.rowCount;
    const columnCount = used.columnCount;
    const previewRows = Math.min(rowCount, 30);
    const previewCols = columnCount;
    const preview = sheet
      .getRangeByIndexes(used.rowIndex, used.columnIndex, previewRows, previewCols)
      .values;
    const groups = preview[0] ?? [];
    const prompts = preview[1] ?? [];
    const headers = preview[2] ?? [];
    const columns = headers.map((header, index) => {
      const values = preview
        .slice(3)
        .map((row) => row[index])
        .filter((value) => value !== null && value !== "" && value !== "—");
      return {
        index,
        group: groups[index] ?? null,
        prompt: prompts[index] ?? null,
        header,
        samples: [...new Set(values.map(String))].slice(0, 5),
      };
    });
    result.sheets.push({
      name: sheet.name,
      rowCount,
      columnCount,
      columns,
    });
  }

  console.log(JSON.stringify(result));
}
