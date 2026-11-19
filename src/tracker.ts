import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const TRACKER_CSV =
  "/Users/joelito/Documents/SOT/Spreadsheet of doom & despair - main.csv";

export const REPORTS_ROOT = "/Users/joelito/Documents";

export interface TrackerRow {
  cells: string[];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function columnIndex(headers: string[], name: string): number {
  const target = name.trim().toLowerCase();
  return headers.findIndex((header) => header.trim().toLowerCase() === target);
}

export interface DuplicateMatch {
  company: string;
  title: string;
  recommendation: string;
  analyzedOn: string;
  report: string;
  url: string;
}

export function findDuplicateByUrl(
  table: string[][],
  normalizedUrl: string,
  normalize: (url: string) => string,
): DuplicateMatch | undefined {
  if (table.length === 0) return undefined;
  const headers = table[0];
  const urlIndex = columnIndex(headers, "Job URL");
  if (urlIndex < 0) return undefined;

  const companyIndex = columnIndex(headers, "Company");
  const titleIndex = columnIndex(headers, "Title");
  const recommendationIndex = columnIndex(headers, "Recommendation");
  const analyzedIndex = columnIndex(headers, "Analyzed on");
  const reportIndex = columnIndex(headers, "Report");

  for (const cells of table.slice(1)) {
    const rawUrl = cells[urlIndex]?.trim() ?? "";
    if (!rawUrl) continue;
    let normalized = rawUrl;
    try {
      normalized = normalize(rawUrl);
    } catch {
      normalized = rawUrl;
    }
    if (normalized !== normalizedUrl) continue;
    return {
      company: cells[companyIndex] ?? "",
      title: cells[titleIndex] ?? "",
      recommendation: cells[recommendationIndex] ?? "",
      analyzedOn: cells[analyzedIndex] ?? "",
      report: cells[reportIndex] ?? "",
      url: rawUrl,
    };
  }
  return undefined;
}

export function findDuplicateByRole(
  table: string[][],
  company: string,
  role: string,
): DuplicateMatch | undefined {
  if (table.length === 0) return undefined;
  const headers = table[0];
  const companyIndex = columnIndex(headers, "Company");
  const titleIndex = columnIndex(headers, "Title");
  if (companyIndex < 0 || titleIndex < 0) return undefined;

  const urlIndex = columnIndex(headers, "Job URL");
  const recommendationIndex = columnIndex(headers, "Recommendation");
  const analyzedIndex = columnIndex(headers, "Analyzed on");
  const reportIndex = columnIndex(headers, "Report");
  const companyKey = company.trim().toLowerCase();
  const roleKey = role.trim().toLowerCase();

  for (const cells of table.slice(1)) {
    if ((cells[companyIndex] ?? "").trim().toLowerCase() !== companyKey) continue;
    if ((cells[titleIndex] ?? "").trim().toLowerCase() !== roleKey) continue;
    return {
      company: cells[companyIndex] ?? "",
      title: cells[titleIndex] ?? "",
      recommendation: cells[recommendationIndex] ?? "",
      analyzedOn: cells[analyzedIndex] ?? "",
      report: cells[reportIndex] ?? "",
      url: cells[urlIndex] ?? "",
    };
  }
  return undefined;
}

export function jobFolderName(company: string, role: string): string {
  const raw = `${company} ${role}`
    .replace(/[\\/:*?"<>|[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (raw || "job").slice(0, 80);
}

export async function readTracker(csvPath = TRACKER_CSV): Promise<string[][]> {
  const text = await readFile(csvPath, "utf8");
  return parseCsv(text);
}

export async function appendTrackerRow(
  fields: {
    company: string;
    role: string;
    jobUrl: string;
    recommendation: string;
    analyzedOn: string;
    report: string;
  },
  csvPath = TRACKER_CSV,
): Promise<void> {
  const text = await readFile(csvPath, "utf8");
  const table = parseCsv(text);
  if (table.length === 0) {
    throw new Error(`Tracker CSV has no header row: ${csvPath}`);
  }
  const headers = table[0];
  const row = headers.map(() => "");
  const set = (name: string, value: string) => {
    const index = columnIndex(headers, name);
    if (index >= 0) row[index] = value;
  };

  set("Company", fields.company);
  set("Title", fields.role);
  set("Job URL", fields.jobUrl);
  set("Recommendation", fields.recommendation);
  set("Analyzed on", fields.analyzedOn);
  set("Report", fields.report);

  const line = row.map(escapeCsvField).join(",");
  const prefix = text.endsWith("\n") || text.length === 0 ? text : `${text}\n`;
  await writeFile(csvPath, `${prefix}${line}\n`, "utf8");
}

export async function allocateJobDir(
  company: string,
  role: string,
  reportsRoot = REPORTS_ROOT,
): Promise<{ folder: string; reportPath: string; relativeReport: string }> {
  let folder = jobFolderName(company, role);
  let dir = path.join(reportsRoot, folder);
  try {
    await stat(path.join(dir, "match-report.md"));
    folder = `${folder} ${new Date().toISOString().slice(0, 10)}`.slice(0, 100);
    dir = path.join(reportsRoot, folder);
  } catch {
    // first report for this folder name
  }
  await mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, "match-report.md");
  return {
    folder,
    reportPath,
    relativeReport: `${folder}/match-report.md`,
  };
}

export async function writeMatchReport(reportPath: string, markdown: string): Promise<void> {
  await writeFile(reportPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
}
