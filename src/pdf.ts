import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CHROME, chromeArgs } from "./chrome.js";
import { PAGE_HEIGHT_MM } from "./page-fit.js";
import { withoutLocationAndWorkType } from "./tailor.js";
import type { CvFile, TailoredCv } from "./types.js";

const execFileAsync = promisify(execFile);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface CvLayout {
  measure?: boolean;
  multiPage?: boolean;
  scale?: number;
}

function layoutClass(layout: CvLayout): string {
  if (layout.measure || layout.multiPage) return "measure";
  if (layout.scale !== undefined && layout.scale < 0.999) return "scale";
  return "spread";
}

export function renderCvHtml(cv: CvFile, tailored: TailoredCv, layout: CvLayout = {}): string {
  const headline = withoutLocationAndWorkType(tailored.headline.trim() || cv.headline);
  const skills = tailored.skills
    .map(
      (group) =>
        `<p class="skill"><strong>${escapeHtml(group.label)}:</strong> ${escapeHtml(group.items)}</p>`,
    )
    .join("");

  const experience = tailored.experience
    .map((entry) =>
      entry.roles
        .map((role, index) => {
          const bullets = role.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("");
          const company =
            index === 0
              ? `<div class="job-line"><strong>${escapeHtml(withoutLocationAndWorkType(entry.company))}</strong></div>`
              : "";
          return `<div class="role-block">
            ${company}
            <div class="role-line"><span>${escapeHtml(role.title)}</span><span>${escapeHtml(role.dates)}</span></div>
            <ul>${bullets}</ul>
          </div>`;
        })
        .join(""),
    )
    .join("");

  const education = tailored.education
    .map(
      (entry) => `<div class="role-line"><span><strong>${escapeHtml(entry.school)}</strong> — ${escapeHtml(entry.detail)}</span><span>${escapeHtml(entry.dates)}</span></div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(cv.name)}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    .sheet {
      width: 210mm;
      height: ${PAGE_HEIGHT_MM}mm;
      overflow: hidden;
      color: #1c1c1c;
      font: 9.5pt/1.34 "Helvetica Neue", Helvetica, Arial, sans-serif;
    }
    .page { width: 210mm; padding: 9mm 12mm 10mm; }
    body.spread .page {
      height: ${PAGE_HEIGHT_MM}mm;
      display: flex;
      flex-direction: column;
    }
    body.scale .page {
      zoom: var(--fit);
      width: calc(210mm / var(--fit));
    }
    body.measure .sheet { height: auto; overflow: visible; }
    body.measure .page { height: auto; }
    h1 { margin: 0; font-size: 16pt; letter-spacing: 0.03em; font-weight: 700; line-height: 1.05; }
    .headline { margin: 2px 0 2px; font-size: 10.5pt; line-height: 1.2; }
    .contacts { margin: 0; font-size: 8.5pt; color: #333; line-height: 1.25; }
    h2 { margin: 8px 0 3px; font-size: 9.5pt; letter-spacing: 0.07em; text-transform: uppercase; border-bottom: 1px solid #222; padding-bottom: 1px; line-height: 1.2; }
    p { margin: 0; }
    .skill { margin: 0; }
    body.spread .experience { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
    body.spread .roles { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: space-between; }
    .job-line, .role-line { display: flex; justify-content: space-between; gap: 12px; }
    .role { margin-top: 1px; }
    ul { margin: 1px 0 0; padding-left: 14px; }
    li { margin: 0 0 1px; }
    ${
      layout.multiPage
        ? `@page { margin: 9mm 0 10mm; }
    .page { padding-top: 0; padding-bottom: 0; }
    .role-block { break-inside: avoid; }`
        : ""
    }
  </style>
</head>
<body class="${layoutClass(layout)}" style="--fit: ${(layout.scale ?? 1).toFixed(4)}">
  <div class="sheet">
    <div class="page">
    <header>
      <h1>${escapeHtml(cv.name)}</h1>
      <p class="headline">${escapeHtml(headline)}</p>
      <p class="contacts">${escapeHtml(cv.contacts)}</p>
    </header>
    <section>
      <h2>Summary</h2>
      <p>${escapeHtml(tailored.summary)}</p>
    </section>
    <section>
      <h2>Technical skills</h2>
      ${skills}
    </section>
    <section class="experience">
      <h2>Work experience</h2>
      <div class="roles">${experience}</div>
    </section>
    <section>
      <h2>Education</h2>
      ${education}
    </section>
    </div>
  </div>
  ${
    layout.measure
      ? `<script>
    const page = document.querySelector(".page");
    const width = page.getBoundingClientRect().width;
    const pagePx = ${PAGE_HEIGHT_MM} * (width / 210);
    const ratio = pagePx > 0 ? page.scrollHeight / pagePx : 0;
    document.body.setAttribute("data-content-ratio", ratio.toFixed(4));
  </script>`
      : ""
  }
</body>
</html>`;
}

export async function measureContentRatio(html: string): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), "cv-check-"));
  const htmlPath = path.join(dir, "cv.html");
  try {
    await writeFile(htmlPath, html, "utf8");
    const { stdout } = await execFileAsync(
      CHROME,
      chromeArgs(["--virtual-time-budget=3000", "--dump-dom", pathToFileURL(htmlPath).href]),
      { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
    );
    const match = stdout.match(/data-content-ratio="([0-9.]+)"/);
    const ratio = match ? Number(match[1]) : Number.NaN;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      throw new Error("Could not measure the tailored CV against one A4 page.");
    }
    return ratio;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function writeCvPdf(html: string, pdfPath: string): Promise<void> {
  const htmlPath = pdfPath.replace(/\.pdf$/i, ".html");
  await writeFile(htmlPath, html, "utf8");
  await execFileAsync(
    CHROME,
    chromeArgs([
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(path.resolve(htmlPath)).href,
    ]),
    { timeout: 30000 },
  );
  await unlink(htmlPath);
}
