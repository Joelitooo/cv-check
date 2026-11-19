import { mkdir } from "node:fs/promises";
import path from "node:path";
import { analyzeJob } from "./agent.js";
import { loadCv } from "./cv.js";
import type { DeletionDecision, DeletionRequest } from "./deletions.js";
import { pageFit, pageOverflowPercent, type PageFit } from "./page-fit.js";
import { measureContentRatio, writeCvPdf, renderCvHtml, type CvLayout } from "./pdf.js";
import { filterTailoredCv, resolveHeadline } from "./tailor.js";
import {
  allocateJobDir,
  appendTrackerRow,
  findDuplicateByRole,
  findDuplicateByUrl,
  readTracker,
  writeMatchReport,
  type DuplicateMatch,
} from "./tracker.js";
import { normalizeJobUrl } from "./url.js";
import type { CvFile, Recommendation, TailoredCv } from "./types.js";

export const DEFAULT_MODEL = "grok-4.7";

export interface CheckOptions {
  url: string;
  model?: string;
  force?: boolean;
  forceCv?: boolean;
  pastedDescription?: string;
  cvPath?: string;
  apiKey?: string;
  runsRoot: string;
}

export interface CheckHooks {
  log: (message: string) => void;
  approveDeletions: (items: DeletionRequest[]) => Promise<DeletionDecision[]>;
}

export type CheckOutcome =
  | { kind: "duplicate"; jobUrl: string; duplicate: DuplicateMatch }
  | { kind: "blocked"; jobUrl: string; reason: string }
  | {
      kind: "done";
      jobUrl: string;
      company: string;
      role: string;
      recommendation: Recommendation;
      markdown: string;
      reportPath?: string;
      pdfPath?: string;
      notes: string[];
    };

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function prepareTailoredCv(
  cv: CvFile,
  draft: TailoredCv,
  allowSparse = false,
): { cv: TailoredCv; warnings: { message: string }[]; headlineReplaced: boolean } | null {
  const filtered = filterTailoredCv(cv.text, draft);
  const headline = resolveHeadline(cv.text, filtered.cv.headline, cv.headline);
  const headlineReplaced = headline !== filtered.cv.headline;
  filtered.cv.headline = headline;
  if (!allowSparse && (filtered.cv.experience.length === 0 || !filtered.cv.summary.trim())) return null;
  return { cv: filtered.cv, warnings: filtered.warnings, headlineReplaced };
}

function trackerNote(row: string, report: string): string {
  return `\n## Tracker\n- Main sheet row: ${row}\n- Job sheet: ${report}\n`;
}

export async function runCheck(options: CheckOptions, hooks: CheckHooks): Promise<CheckOutcome> {
  const { log } = hooks;
  const jobUrl = normalizeJobUrl(options.url);
  const cv = await loadCv(options.cvPath);
  log(`CV: ${cv.path}`);
  log(`Job: ${jobUrl}`);

  let table: string[][] = [];
  try {
    table = await readTracker();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read the local tracker CSV: ${message}`);
  }

  const forceCv = options.forceCv === true;
  const force = options.force === true || forceCv;
  const urlDuplicate = findDuplicateByUrl(table, jobUrl, normalizeJobUrl);
  if (urlDuplicate && !force) {
    return { kind: "duplicate", jobUrl, duplicate: urlDuplicate };
  }

  const apiKey = (options.apiKey ?? process.env.CURSOR_API_KEY)?.trim();
  if (!apiKey) {
    throw new Error(
      "Set CURSOR_API_KEY to a user API key from Cursor Dashboard → Integrations, then run the command again.",
    );
  }

  const runDir = path.join(options.runsRoot, String(Date.now()));
  await mkdir(runDir, { recursive: true });

  const layout: { fit: PageFit | null } = { fit: null };
  const analysis = await analyzeJob({
    cv,
    jobUrl,
    model: options.model || DEFAULT_MODEL,
    apiKey,
    cwd: runDir,
    pastedDescription: options.pastedDescription,
    forceCv,
    log,
    approveDeletions: hooks.approveDeletions,
    reviewTailoredCv: async (draft) => {
      const prepared = prepareTailoredCv(cv, draft);
      if (!prepared) return null;
      const ratio = await measureContentRatio(renderCvHtml(cv, prepared.cv, { measure: true }));
      layout.fit = pageFit(ratio);
      if (layout.fit.fits) return null;
      const over = pageOverflowPercent(ratio);
      return `The tailored CV is about ${over}% too long for one A4 page. It must stay on one page and still fill that page. Call request_deletion_approval with the smallest set of least relevant source facts to remove. Keep every fact the user denies. Do not remove so much that the page would be sparse.`;
    },
  });

  if (analysis.blocked) {
    return {
      kind: "blocked",
      jobUrl,
      reason: analysis.blockedReason || "The job page could not be read.",
    };
  }

  const roleDuplicate = findDuplicateByRole(table, analysis.company, analysis.role);
  const skipLog = Boolean(roleDuplicate) && !force && !urlDuplicate;

  let markdown = analysis.reportMarkdown.trim();
  if (!markdown.startsWith("# Match report")) {
    markdown = `# Match report: ${analysis.role} @ ${analysis.company}\n\n**Recommendation:** ${analysis.recommendation}\n**Why:** ${analysis.why}\n\n${markdown}`;
  }

  const notes: string[] = [];
  const done = (pdfPath?: string, reportPath?: string): CheckOutcome => ({
    kind: "done",
    jobUrl,
    company: analysis.company,
    role: analysis.role,
    recommendation: analysis.recommendation,
    markdown,
    reportPath,
    pdfPath,
    notes,
  });

  const tailored = await tailoredForPdf(cv, analysis, layout.fit, notes, forceCv);

  if (skipLog) {
    markdown += trackerNote(
      `skipped (duplicate). Prior recommendation: ${roleDuplicate?.recommendation || "unknown"}. Pass --force to add another row.`,
      roleDuplicate?.report || "not written",
    );
    if (tailored) {
      notes.push("No PDF written because this company and role are already logged. Pass --force to write one.");
    }
    return done();
  }

  if (!tailored) {
    markdown += trackerNote("not added. No tailored CV was written, so this job was left out of the local CSV.", "not written");
    notes.push("Not added to the local tracker because no tailored CV was written.");
    return done();
  }

  const written = await allocateJobDir(analysis.company, analysis.role);
  const pdfPath = path.join(path.dirname(written.reportPath), "Joel_Silva_CV.pdf");
  await writeCvPdf(renderCvHtml(cv, tailored.cv, tailored.layout), pdfPath);
  await appendTrackerRow({
    company: analysis.company,
    role: analysis.role,
    jobUrl,
    recommendation: analysis.recommendation,
    analyzedOn: today(),
    report: written.relativeReport,
  });
  markdown += trackerNote(
    "added to the local CSV. Google Sheet was not updated — this program cannot write to Sheets. Date applied and status were left empty.",
    written.reportPath,
  );
  await writeMatchReport(written.reportPath, markdown);
  return done(pdfPath, written.reportPath);
}

async function tailoredForPdf(
  cv: CvFile,
  analysis: { recommendation: Recommendation; tailoredCv?: TailoredCv },
  fit: PageFit | null,
  notes: string[],
  forceCv: boolean,
): Promise<{ cv: TailoredCv; layout: CvLayout } | null> {
  if (analysis.recommendation === "Skip" && !forceCv) {
    notes.push("No tailored CV. This is a long shot, so the CV was not rewritten.");
    return null;
  }

  if (!analysis.tailoredCv) {
    notes.push("No tailored CV. The report is above; the agent did not return a CV draft.");
    return null;
  }

  const prepared = prepareTailoredCv(cv, analysis.tailoredCv, forceCv);
  if (!prepared) {
    notes.push("No tailored CV. The draft did not keep enough experience that is actually in the source CV.");
    return null;
  }
  if (analysis.recommendation === "Skip") {
    notes.push("CV generation was forced. This is still a long shot; the CV was tailored anyway.");
  }
  if (prepared.cv.experience.length === 0 || !prepared.cv.summary.trim()) {
    notes.push("CV generation was forced. The draft kept little that is actually in the source CV, so the PDF is sparse.");
  }
  if (prepared.headlineReplaced) {
    notes.push("Kept the original CV headline. The draft headline used words that are not in the CV.");
  }
  for (const warning of prepared.warnings) {
    notes.push(warning.message);
  }

  if (forceCv) {
    fit = pageFit(await measureContentRatio(renderCvHtml(cv, prepared.cv, { measure: true })));
    if (!fit.fits) {
      notes.push("CV generation was forced. The tailored CV does not fit on one A4 page, so it runs onto a second page.");
      return { cv: prepared.cv, layout: { multiPage: true } };
    }
  }

  if (!fit || !fit.fits) {
    notes.push(
      "No PDF written. The tailored CV does not fit on one A4 page, so it was not allowed to run onto a second page.",
    );
    return null;
  }

  return { cv: prepared.cv, layout: { scale: fit.scale } };
}
