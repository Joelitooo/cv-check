import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  appendTrackerRow,
  columnIndex,
  escapeCsvField,
  findDuplicateByUrl,
  jobFolderName,
  parseCsv,
} from "../src/tracker.ts";
import { normalizeJobUrl } from "../src/url.ts";

test("normalizeJobUrl strips tracking params and keeps the job id", () => {
  const raw =
    "https://www.LinkedIn.com/jobs/search-results/?currentJobId=444&utm_source=email&eBP=abc&refId=xyz";
  assert.equal(
    normalizeJobUrl(raw),
    "https://www.linkedin.com/jobs/search-results?currentJobId=444",
  );
});

test("parseCsv handles quotes and commas", () => {
  const rows = parseCsv('Company,Title\n"Acme, Inc",Engineer\n');
  assert.deepEqual(rows, [
    ["Company", "Title"],
    ["Acme, Inc", "Engineer"],
  ]);
  assert.equal(columnIndex(rows[0], "title"), 1);
});

test("findDuplicateByUrl matches a tracked posting after tracking params change", () => {
  const table = parseCsv(
    "Company,Title,Job URL,Recommendation\nAcme,Frontend,https://jobs.example.com/1?utm_source=x,Apply\n",
  );
  const match = findDuplicateByUrl(table, normalizeJobUrl("https://jobs.example.com/1?gh_src=abc"), normalizeJobUrl);
  assert.equal(match?.company, "Acme");
  assert.equal(match?.recommendation, "Apply");
});

test("appendTrackerRow leaves applied date and status empty", async () => {
  await mkdir(path.join(process.cwd(), ".runs"), { recursive: true });
  const dir = await mkdtemp(path.join(process.cwd(), ".runs", "test-"));
  const csvPath = path.join(dir, "tracker.csv");
  await writeFile(csvPath, "Company,Title,Date,Status,Reply,Job URL,Recommendation,Analyzed on,Report\n", "utf8");
  await appendTrackerRow(
    {
      company: "Acme",
      role: "Frontend Engineer",
      jobUrl: "https://jobs.example.com/1",
      recommendation: "Maybe apply",
      analyzedOn: "2026-10-09",
      report: "Acme Frontend Engineer/match-report.md",
    },
    csvPath,
  );
  const text = await readFile(csvPath, "utf8");
  const rows = parseCsv(text);
  assert.equal(rows[1][0], "Acme");
  assert.equal(rows[1][1], "Frontend Engineer");
  assert.equal(rows[1][2], "");
  assert.equal(rows[1][3], "");
  assert.equal(rows[1][6], "Maybe apply");
  assert.equal(jobFolderName("Acme", "Frontend/Engineer"), "Acme Frontend Engineer");
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  await rm(dir, { recursive: true, force: true });
});
