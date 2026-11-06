/**
 * Export utilities for financial reports
 * Supports: CSV, Word (DOCX), Text
 *
 * ⚠️ مسیر XLSX حذف شد (۱۸ اکتبر ۲۰۲۶): `generateXLSX` هیچ فراخواننده‌ای در
 * `src/` نداشت و تنها مصرف‌کنندهٔ بستهٔ `xlsx` بود. حذفش دو سود داشت:
 *   ۱) بستهٔ `xlsx` از درخت وابستگی رفت — یعنی `npm ci` و بیلد Docker دیگر
 *      به `cdn.sheetjs.com` وابسته نیستند (یک نقطهٔ شکست خارجی کمتر).
 *   ۲) دو CVE آن بسته (Prototype Pollution / ReDoS) دیگر حتی به‌عنوان
 *      وابستگی نصب‌شده وجود ندارد.
 * اگر روزی خروجی واقعی اکسل لازم شد، مسیر درست `src/lib/export-doc.ts` یا
 * یک route سروری است، نه بازگرداندن این تابع بدون مصرف‌کننده.
 */

import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import { csvQuote } from './csv-injection';

// سازگاری عقب‌رو: مصرف‌کنندگان قبلی از همین ماژول import می‌کردند.
export { csvFormulaPrefix } from './csv-injection';

export type ExportFormat = 'csv' | 'docx' | 'txt';

export interface ExportColumn {
  key: string;
  title: string;
  width?: number;
}

export interface ExportData {
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  title?: string;
  subtitle?: string;
  summary?: string;
}

/**
 * یک سلول متن را با گارد فرمول + نقل‌قول CSV برمی‌گرداند.
 * گاردِ تزریق در `csv-injection.ts` متمرکز است (تک‌منبع با مسیر سروری).
 */
export function csvCell(v: unknown): string {
  return csvQuote(v);
}

/** Generate CSV string */
export function generateCSV(data: ExportData): string {
  const { columns, rows } = data;
  const header = columns.map(c => csvCell(c.title)).join(',');
  const body = rows.map(row =>
    columns.map(c => csvCell(row[c.key] ?? '')).join(',')
  ).join('\n');
  return header + '\n' + body;
}

/** Generate DOCX document */
export async function generateDOCX(data: ExportData): Promise<Blob> {
  const { columns, rows, title, subtitle, summary } = data;
  
  const tableRows: TableRow[] = [
    new TableRow({
      children: columns.map(c => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: c.title, bold: true, size: 20 })] })],
        shading: { fill: '1F2937', color: 'FFFFFF' },
      })),
    }),
    ...rows.map(row => new TableRow({
      children: columns.map(c => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: String(row[c.key] ?? ''), size: 18 })] })],
      })),
    })),
  ];

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children: [
        ...(title ? [new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32, color: '1F2937' })], alignment: AlignmentType.CENTER })] : []),
        ...(subtitle ? [new Paragraph({ children: [new TextRun({ text: subtitle, size: 20, color: '6B7280' })], alignment: AlignmentType.CENTER })] : []),
        new Paragraph({ children: [new TextRun({ text: `تاریخ تولید: ${new Date().toLocaleString('fa-IR')}`, size: 18, color: '9CA3AF' })], alignment: AlignmentType.CENTER }),
        new Paragraph({ text: '' }), // spacer
        new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
        ...(summary ? [new Paragraph({ text: '' }), new Paragraph({ children: [new TextRun({ text: summary, size: 20, italics: true })] })] : []),
      ],
    }],
  });

  return Packer.toBlob(doc);
}

/** Generate plain text */
export function generateText(data: ExportData): string {
  const { columns, rows, title, subtitle, summary } = data;
  const colWidths = columns.map(c => Math.max(c.title.length, ...rows.map(r => String(r[c.key] ?? '').length)) + 2);
  
  const header = columns.map((c, i) => c.title.padEnd(colWidths[i])).join(' | ');
  const separator = columns.map((_, i) => '-'.repeat(colWidths[i])).join('-+-');
  const body = rows.map(row => 
    columns.map((c, i) => String(row[c.key] ?? '').padEnd(colWidths[i])).join(' | ')
  ).join('\n');

  let out = '';
  if (title) out += title + '\n';
  if (subtitle) out += subtitle + '\n';
  out += `Generated: ${new Date().toLocaleString('fa-IR')}\n\n`;
  out += header + '\n' + separator + '\n' + body + '\n';
  if (summary) out += '\n' + summary;
  return out;
}

/** Download file */
export function downloadFile(content: string | Blob | ArrayBuffer, filename: string, mimeType: string) {
  const blob = content instanceof Blob ? content : content instanceof ArrayBuffer ? new Blob([content], { type: mimeType }) : new Blob([content], { type: mimeType });
  saveAs(blob, filename);
}

/** Export with format selection */
export async function exportReport(data: ExportData, format: ExportFormat, baseFilename: string) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  const filename = `${baseFilename}_${timestamp}`;
  
  switch (format) {
    case 'csv': {
      const csv = generateCSV(data);
      downloadFile(csv, `${filename}.csv`, 'text/csv;charset=utf-8');
      break;
    }
    case 'docx': {
      const docx = await generateDOCX(data);
      downloadFile(docx, `${filename}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      break;
    }
    case 'txt': {
      const txt = generateText(data);
      downloadFile(txt, `${filename}.txt`, 'text/plain;charset=utf-8');
      break;
    }
  }
}

/** Quick export from HTML table */
export function exportTableToCSV(tableId: string, filename: string) {
  const table = document.getElementById(tableId) as HTMLTableElement;
  if (!table) return;
  
  const rows = Array.from(table.querySelectorAll('tr'));
  const csv = rows.map(row => 
    Array.from(row.querySelectorAll('th, td')).map(cell => 
      csvCell(cell.textContent ?? '')
    ).join(',')
  ).join('\n');
  
  downloadFile(csv, `${filename}_${Date.now()}.csv`, 'text/csv;charset=utf-8');
}