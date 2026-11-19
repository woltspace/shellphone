// A CSV (or TSV) file read into rows the way spreadsheets read it (RFC 4180): a quoted field may hold the separator,
// a line break, or a doubled "" for one quote. Used by the file viewer to show the file as a table.
//   node --test web/tests/csv.test.mjs
export function parseCsv(text, sep = ",", max = 500) {
  const rows = []; let row = [], cell = "", quoted = false, i = 0;
  const s = text.replace(/^﻿/, "");
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { quoted = true; i++; continue; }
    if (ch === sep) { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(cell); rows.push(row); row = []; cell = "";
      if (rows.length >= max) return rows;
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1; continue;
    }
    cell += ch; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
