#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { AgentRunError } from "./agent.js";
import { DEFAULT_MODEL, runCheck } from "./check.js";
import { promptDeletionApprovals } from "./deletions.js";

function printHelp(): void {
  console.log(`cv-check <job-url> [options]

Run the CV cross-check in the terminal. Prints the match report.
Writes a tailored CV PDF when the recommendation is Apply or Maybe apply.
The PDF is one full A4 page. Removing a fact from the CV asks for approval first.
Does not submit applications.

Options:
  --force              Run again even if this URL or company + role is already logged
  --force-cv           Always write a tailored CV PDF: also on Skip, even if it is sparse
                       or runs onto a second page, and even if logged (implies --force)
  --model <id>         Cursor model (default: ${DEFAULT_MODEL})
  --description <file> Extra posting text when the page is login-walled
  --cv <file>          CV file (default: newest Joel_Silva_CV in ~/Documents/SOT)
  -h, --help           Show this help

Requires CURSOR_API_KEY from Cursor Dashboard → Integrations.
`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      force: { type: "boolean", default: false },
      "force-cv": { type: "boolean", default: false },
      model: { type: "string", default: DEFAULT_MODEL },
      description: { type: "string" },
      cv: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const rawUrl = positionals[0];
  if (!rawUrl) {
    printHelp();
    process.exit(1);
  }

  const pastedDescription = values.description
    ? await readFile(values.description, "utf8")
    : undefined;

  const outcome = await runCheck(
    {
      url: rawUrl,
      model: values.model,
      force: values.force,
      forceCv: values["force-cv"],
      pastedDescription,
      cvPath: values.cv,
      runsRoot: path.join(process.cwd(), ".runs"),
    },
    { log: (message) => console.error(message), approveDeletions: promptDeletionApprovals },
  );

  if (outcome.kind === "duplicate") {
    const { duplicate } = outcome;
    console.error(
      `Already logged: ${duplicate.company || "unknown company"} — ${duplicate.title || "unknown role"}`,
    );
    if (duplicate.recommendation) console.error(`Prior recommendation: ${duplicate.recommendation}`);
    if (duplicate.analyzedOn) console.error(`Analyzed on: ${duplicate.analyzedOn}`);
    if (duplicate.report) console.error(`Report: ${duplicate.report}`);
    console.error("Stopped. Pass --force to run again and add another row.");
    process.exit(3);
  }

  if (outcome.kind === "blocked") {
    console.error(outcome.reason);
    console.error("Paste the description into a text file and rerun with --description <file>.");
    process.exit(4);
  }

  console.log(outcome.markdown);
  for (const note of outcome.notes) console.error(note);
  if (outcome.pdfPath) {
    console.error(`PDF: ${outcome.pdfPath}`);
    console.error(`Report: ${outcome.reportPath}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof AgentRunError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
