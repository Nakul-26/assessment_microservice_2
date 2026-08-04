import ExcelJS from 'exceljs';

// Mirrors the shape XLSX.utils.sheet_to_json used to return (array of row objects keyed
// by header text) so callers built around that shape don't need to change.
export async function readWorkbookRows(arrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  // exceljs rows/columns are 1-indexed and row.values[0] is always empty - slice it off.
  const headers = worksheet.getRow(1).values.slice(1).map((h) => String(h ?? ''));
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values.slice(1);
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = values[i] ?? '';
    });
    rows.push(obj);
  });
  return rows;
}

export async function downloadRowsAsExcel(filename, sheetName, rows, { autoSizeColumns = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  if (rows.length) {
    const keys = Object.keys(rows[0]);
    worksheet.columns = keys.map((key) => ({ header: key, key }));
    worksheet.addRows(rows);
    if (autoSizeColumns) {
      worksheet.columns.forEach((col) => {
        const maxLen = Math.max(col.header.length, ...rows.map((r) => String(r[col.key] ?? '').length));
        col.width = maxLen + 2;
      });
    }
  }
  await triggerBrowserDownload(workbook, filename);
}

export async function downloadAoaAsExcel(filename, sheetName, aoaRows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  aoaRows.forEach((row) => worksheet.addRow(row));
  await triggerBrowserDownload(workbook, filename);
}

async function triggerBrowserDownload(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
