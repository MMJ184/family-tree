type CsvValue = string | number | null;

/**
 * One CSV cell. Text starting with = + - @ (or a tab / carriage return) is
 * prefixed with a single quote, so spreadsheets do not run it as a formula.
 */
export function csvCell(v: CsvValue): string {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/**
 * Turns text into a file-name part. Letters of any script (Arabic included) are
 * kept; only characters that are unsafe in file names are dropped, and spaces
 * become dashes.
 */
export function fileSlug(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are unsafe in file names.
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
  );
}

/** Builds a CSV with a UTF-8 BOM so Excel opens Arabic text correctly, and downloads it. */
export function downloadCsv(filename: string, header: string[], rows: CsvValue[][]): void {
  const body = buildCsv(header, rows);
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
