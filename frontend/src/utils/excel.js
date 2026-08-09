import ExcelJS from 'exceljs';

// Formula-injection guard: a cell value starting with =, +, -, or @ is interpreted as a
// formula by Excel/LibreOffice/Sheets when the file is opened, so any client-controlled
// exported field (e.g. a self-signup user's `name`, only checked for truthiness — see
// college.service.js's signup()) could otherwise run an arbitrary formula on whoever opens
// the export. A leading apostrophe forces the cell to render as literal text everywhere.
const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];

function sanitizeCellValue(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return FORMULA_TRIGGER_CHARS.includes(value[0]) ? `'${value}` : value;
}

function sanitizeRow(row) {
  if (Array.isArray(row)) return row.map(sanitizeCellValue);
  const sanitized = {};
  for (const [key, value] of Object.entries(row)) {
    sanitized[key] = sanitizeCellValue(value);
  }
  return sanitized;
}

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
    worksheet.addRows(rows.map(sanitizeRow));
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
  aoaRows.forEach((row) => worksheet.addRow(sanitizeRow(row)));
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
