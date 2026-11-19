import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { measureContentRatio, renderCvHtml, writeCvPdf } from "../src/pdf.ts";
import { pageFit } from "../src/page-fit.ts";
import type { CvFile, TailoredCv } from "../src/types.ts";

const cv: CvFile = {
  path: "/tmp/Joel_Silva_CV.txt",
  text: "JOEL SILVA",
  name: "JOEL SILVA",
  headline: "Frontend Engineer",
  contacts: "joel@example.com",
};

function draft(bullets: string[]): TailoredCv {
  return {
    headline: "Frontend Engineer",
    summary: "Builds product interfaces.",
    skills: [{ label: "Languages", items: "TypeScript, React" }],
    experience: [
      {
        company: "eDreams",
        location: "Porto",
        roles: [{ title: "Software Engineer", dates: "2024 – Present", bullets }],
      },
    ],
    education: [{ school: "IPVC", detail: "BSc Computer Science", dates: "2019 – 2022" }],
  };
}

function pdfPageCount(bytes: Buffer): number {
  const matches = bytes.toString("latin1").match(/\/Type\s*\/Page(?![s])/g);
  return matches?.length ?? 0;
}

test("spread layout is a fixed A4 sheet and measure mode records the ratio", () => {
  const html = renderCvHtml(cv, {
    ...draft(["Shipped the search bar."]),
    headline: "Software Engineer - Warsaw, Poland",
    experience: [
      {
        company: "eDreams",
        location: "Porto, Portugal (Hybrid)",
        roles: [{ title: "Software Engineer", dates: "2024 – Present", bullets: ["Shipped the search bar."] }],
      },
    ],
  });
  assert.match(html, /class="spread"/);
  assert.match(html, /height: 297mm/);
  assert.match(html, /Software Engineer/);
  assert.match(html, /eDreams/);
  assert.doesNotMatch(html, /Warsaw|Poland|Porto|Portugal|Hybrid/);
  const measured = renderCvHtml(cv, draft(["Shipped the search bar."]), { measure: true });
  assert.match(measured, /class="measure"/);
  assert.match(measured, /data-content-ratio/);
});

test("a tailored CV stays on one page and a short one is measured under a full page", async () => {
  const shortHtml = renderCvHtml(cv, draft(["Shipped the search bar."]), { measure: true });
  const shortRatio = await measureContentRatio(shortHtml);
  assert.ok(shortRatio < 1, `expected a short CV to be under one page, got ${shortRatio}`);
  assert.equal(pageFit(shortRatio).mode, "spread");

  const longBullets = Array.from({ length: 18 }, (_, index) => {
    return `Owned a product surface and shipped an improvement that customers could see in week ${index + 1}.`;
  });
  const longDraft = draft(longBullets);
  const ratio = await measureContentRatio(renderCvHtml(cv, longDraft, { measure: true }));
  const fit = pageFit(ratio);
  assert.equal(fit.fits, true, `expected the sample to still fit, ratio ${ratio}`);
  const pdfPath = path.join(process.cwd(), "tmp", "one-page.pdf");
  await mkdir(path.dirname(pdfPath), { recursive: true });
  await writeCvPdf(renderCvHtml(cv, longDraft, { scale: fit.scale }), pdfPath);
  const pages = pdfPageCount(await readFile(pdfPath));
  assert.equal(pages, 1);

  const huge = draft(
    Array.from({ length: 80 }, (_, index) => {
      return `Owned a product surface and shipped an improvement that customers could see in week ${index + 1}, with a second clause so the line wraps.`;
    }),
  );
  const hugeRatio = await measureContentRatio(renderCvHtml(cv, huge, { measure: true }));
  assert.equal(pageFit(hugeRatio).fits, false);
});

test("a forced CV that does not fit runs onto a second page instead of being cut off", async () => {
  const huge = draft(
    Array.from({ length: 80 }, (_, index) => {
      return `Owned a product surface and shipped an improvement that customers could see in week ${index + 1}, with a second clause so the line wraps.`;
    }),
  );
  const html = renderCvHtml(cv, huge, { multiPage: true });
  assert.match(html, /class="measure"/);
  assert.doesNotMatch(html, /data-content-ratio/);
  const pdfPath = path.join(process.cwd(), "tmp", "multi-page.pdf");
  await mkdir(path.dirname(pdfPath), { recursive: true });
  await writeCvPdf(html, pdfPath);
  assert.ok(pdfPageCount(await readFile(pdfPath)) > 1);
});
