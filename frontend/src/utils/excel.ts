import * as XLSX from 'xlsx';

/** Download any 2-D array as an .xlsx file */
export function exportToExcel(
  rows: (string | number | null | undefined)[][],
  filename: string,
  sheetName = 'Sheet1',
) {
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Auto-width columns
  const colWidths = rows[0]?.map((_, ci) =>
    Math.min(40, Math.max(10, ...rows.map(r => String(r[ci] ?? '').length + 2)))
  );
  if (colWidths) ws['!cols'] = colWidths.map(w => ({ wch: w }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/** Export multiple sheets */
export function exportToExcelMultiSheet(
  sheets: { name: string; rows: (string | number | null | undefined)[][] }[],
  filename: string,
) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const colWidths = rows[0]?.map((_, ci) =>
      Math.min(40, Math.max(10, ...rows.map(r => String(r[ci] ?? '').length + 2)))
    );
    if (colWidths) ws['!cols'] = colWidths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); // Excel sheet name limit
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

/** Parse an uploaded Excel/CSV file → array of objects keyed by header row */
export function parseExcelFile(file: File): Promise<Record<string, string | number>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, {
          defval: '',
          raw: false,
        });
        resolve(json);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
