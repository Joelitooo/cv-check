#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Cursor } from "@cursor/sdk";
import { DEFAULT_MODEL, runCheck, type CheckOutcome } from "./check.js";
import { findLatestCv } from "./cv.js";
import type { DeletionDecision, DeletionRequest } from "./deletions.js";
import { TRACKER_CSV } from "./tracker.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const indexHtml = fileURLToPath(new URL("../web/index.html", import.meta.url));
const runsRoot = fileURLToPath(new URL("../.runs", import.meta.url));

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // .env is optional; CURSOR_API_KEY can come from the shell
}

type RunEvent =
  | { type: "log"; message: string }
  | { type: "approval"; id: number; items: DeletionRequest[] }
  | { type: "approval-resolved"; id: number }
  | { type: "outcome"; outcome: CheckOutcome }
  | { type: "error"; message: string };

interface PendingApproval {
  id: number;
  items: DeletionRequest[];
  resolve: (decisions: DeletionDecision[]) => void;
}

interface Run {
  id: string;
  events: RunEvent[];
  clients: Set<ServerResponse>;
  pending?: PendingApproval;
  outcome?: CheckOutcome;
  finished: boolean;
}

const runs = new Map<string, Run>();
let activeRun: Run | undefined;
let nextApprovalId = 1;
let modelCache: { id: string; name: string }[] | undefined;

function emit(run: Run, event: RunEvent): void {
  run.events.push(event);
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of run.clients) client.write(frame);
}

function finish(run: Run): void {
  run.finished = true;
  if (activeRun === run) activeRun = undefined;
  for (const client of run.clients) client.end();
  run.clients.clear();
}

function startRun(input: {
  url: string;
  model: string;
  force: boolean;
  forceCv: boolean;
  description?: string;
}): Run {
  const run: Run = {
    id: String(Date.now()),
    events: [],
    clients: new Set(),
    finished: false,
  };
  runs.set(run.id, run);
  activeRun = run;

  const approveDeletions = (items: DeletionRequest[]): Promise<DeletionDecision[]> => {
    if (items.length === 0) return Promise.resolve([]);
    return new Promise((resolve) => {
      const id = nextApprovalId++;
      run.pending = {
        id,
        items,
        resolve: (decisions) => {
          run.pending = undefined;
          emit(run, { type: "approval-resolved", id });
          resolve(decisions);
        },
      };
      emit(run, { type: "approval", id, items });
    });
  };

  runCheck(
    {
      url: input.url,
      model: input.model,
      force: input.force,
      forceCv: input.forceCv,
      pastedDescription: input.description,
      runsRoot,
    },
    { log: (message) => emit(run, { type: "log", message }), approveDeletions },
  )
    .then((outcome) => {
      run.outcome = outcome;
      emit(run, { type: "outcome", outcome });
    })
    .catch((error: unknown) => {
      emit(run, { type: "error", message: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => finish(run));

  return run;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    throw new Error("Expected a JSON body.");
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1024 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk as Buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!parsed || typeof parsed !== "object") throw new Error("Expected a JSON object.");
  return parsed as Record<string, unknown>;
}

function isLocalRequest(req: IncomingMessage, port: number): boolean {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowed.has(req.headers.host ?? "")) return false;
  const origin = req.headers.origin;
  if (origin && !allowed.has(origin.replace(/^http:\/\//, ""))) return false;
  return true;
}

async function status(): Promise<Record<string, unknown>> {
  let cv: string | null = null;
  let cvError: string | null = null;
  try {
    cv = await findLatestCv();
  } catch (error) {
    cvError = error instanceof Error ? error.message : String(error);
  }
  return {
    cv,
    cvError,
    tracker: TRACKER_CSV,
    apiKey: Boolean(process.env.CURSOR_API_KEY?.trim()),
    canReveal: canReveal(),
    defaultModel: DEFAULT_MODEL,
    activeRun: activeRun?.id ?? null,
  };
}

async function models(): Promise<{ id: string; name: string }[]> {
  if (modelCache) return modelCache;
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) return [];
  const list = await Cursor.models.list({ apiKey });
  modelCache = list.map((model) => ({ id: model.id, name: model.displayName || model.id }));
  return modelCache;
}

function canReveal(): boolean {
  return process.platform === "darwin";
}

function reveal(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("open", ["-R", filePath], (error) => (error ? reject(error) : resolve()));
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  if (!isLocalRequest(req, port)) {
    sendJson(res, 403, { error: "Only local requests are allowed." });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(await readFile(indexHtml, "utf8"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, await status());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/models") {
    try {
      sendJson(res, 200, { models: await models() });
    } catch (error) {
      sendJson(res, 200, { models: [], error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runs") {
    if (activeRun) {
      sendJson(res, 409, { error: "A check is already running. Wait for it to finish.", runId: activeRun.id });
      return;
    }
    const body = await readJson(req);
    const jobUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!/^https?:\/\//i.test(jobUrl)) {
      sendJson(res, 400, { error: "Paste the full job posting link, starting with http:// or https://." });
      return;
    }
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
    const description =
      typeof body.description === "string" && body.description.trim() ? body.description : undefined;
    const run = startRun({
      url: jobUrl,
      model,
      force: body.force === true,
      forceCv: body.forceCv === true,
      description,
    });
    sendJson(res, 202, { runId: run.id });
    return;
  }

  if (parts[0] === "api" && parts[1] === "runs" && parts[2]) {
    const run = runs.get(parts[2]);
    if (!run) {
      sendJson(res, 404, { error: "Run not found. The server may have restarted." });
      return;
    }
    const action = parts[3];

    if (req.method === "GET" && !action) {
      sendJson(res, 200, { id: run.id, finished: run.finished });
      return;
    }

    if (req.method === "GET" && action === "events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      for (const event of run.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (run.finished) {
        res.end();
        return;
      }
      run.clients.add(res);
      req.on("close", () => run.clients.delete(res));
      return;
    }

    if (req.method === "POST" && action === "approvals") {
      const body = await readJson(req);
      const pending = run.pending;
      if (!pending || body.id !== pending.id) {
        sendJson(res, 409, { error: "That approval request is no longer waiting." });
        return;
      }
      const answers = Array.isArray(body.approved) ? body.approved : [];
      pending.resolve(pending.items.map((item, index) => ({ ...item, approved: answers[index] === true })));
      sendJson(res, 200, { ok: true });
      return;
    }

    const outcome = run.outcome?.kind === "done" ? run.outcome : undefined;

    if (req.method === "GET" && action === "pdf") {
      if (!outcome?.pdfPath) {
        sendJson(res, 404, { error: "This run did not write a PDF." });
        return;
      }
      res.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="Joel_Silva_CV.pdf"',
      });
      createReadStream(outcome.pdfPath).pipe(res);
      return;
    }

    if (req.method === "POST" && action === "reveal") {
      if (!canReveal()) {
        sendJson(res, 501, { error: "Show in Finder only works when the server runs directly on macOS." });
        return;
      }
      const target = outcome?.pdfPath ?? outcome?.reportPath;
      if (!target) {
        sendJson(res, 404, { error: "This run did not write any files." });
        return;
      }
      await reveal(target);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  sendJson(res, 404, { error: "Not found." });
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: "string", default: process.env.PORT ?? "4321" },
      host: { type: "string", default: process.env.HOST ?? "127.0.0.1" },
      "no-open": { type: "boolean", default: false },
    },
    strict: true,
  });
  const port = Number(values.port);

  const server = createServer((req, res) => {
    handle(req, res, port).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (res.headersSent) res.end();
      else sendJson(res, 500, { error: message });
    });
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Is cv-check web already running? Try --port 4322.`);
    } else {
      console.error(error.message);
    }
    process.exit(1);
  });

  server.listen(port, values.host, () => {
    const address = `http://localhost:${port}`;
    console.log(`cv-check web is running at ${address}`);
    console.log(`Project: ${projectRoot}`);
    if (!process.env.CURSOR_API_KEY?.trim()) {
      console.log("CURSOR_API_KEY is not set. Export it or put it in .env before running a check.");
    }
    console.log("Press Ctrl+C to stop.");
    if (!values["no-open"] && process.platform === "darwin") execFile("open", [address], () => {});
  });
}

main();
