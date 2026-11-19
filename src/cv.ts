import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withoutLocationAndWorkType } from "./tailor.js";
import type { CvFile } from "./types.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_CV_DIR = "/Users/joelito/Documents/SOT";

const CV_EXTENSIONS = new Set([".docx", ".pdf", ".md", ".txt"]);

export async function findLatestCv(dir = DEFAULT_CV_DIR): Promise<string> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    throw new Error(`CV folder not found: ${dir}`);
  }

  const candidates = names.filter((name) => {
    if (!name.startsWith("Joel_Silva_CV")) return false;
    return CV_EXTENSIONS.has(path.extname(name).toLowerCase());
  });

  if (candidates.length === 0) {
    throw new Error(`No Joel_Silva_CV file (.docx, .pdf, .md, .txt) in ${dir}`);
  }

  const ranked = await Promise.all(
    candidates.map(async (name) => {
      const full = path.join(dir, name);
      const info = await stat(full);
      return { full, mtimeMs: info.mtimeMs };
    }),
  );

  ranked.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return ranked[0].full;
}

const pdfTextScript = fileURLToPath(new URL("../scripts/pdf-text.swift", import.meta.url));

export function assertCvText(text: string, filePath: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("%PDF-")) {
    throw new Error(`Could not read the text of ${filePath}.`);
  }
  return trimmed;
}

export async function extractCvText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".txt") {
    return readFile(filePath, "utf8");
  }
  const macos = process.platform === "darwin";
  if (ext === ".pdf") {
    const [command, args] = macos
      ? ["swift", [pdfTextScript, filePath]]
      : ["pdftotext", ["-enc", "UTF-8", filePath, "-"]];
    const { stdout } = await execFileAsync(command, args, { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  }
  if (ext !== ".docx") {
    throw new Error(`Unsupported CV type: ${ext}`);
  }
  const [command, args] = macos
    ? ["textutil", ["-convert", "txt", "-stdout", filePath]]
    : ["docx2txt", [filePath, "-"]];
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

export function parseCvHeader(text: string): Pick<CvFile, "name" | "headline" | "contacts"> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    name: lines[0] ?? "Joel Silva",
    headline: withoutLocationAndWorkType(lines[1] ?? ""),
    contacts: lines[2] ?? "",
  };
}

export async function loadCv(filePath?: string): Promise<CvFile> {
  const resolved = filePath ?? (await findLatestCv());
  const text = assertCvText(await extractCvText(resolved), resolved);
  return { path: resolved, text, ...parseCvHeader(text) };
}
