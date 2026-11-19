import { Agent, CursorAgentError } from "@cursor/sdk";
import {
  factKey,
  formatApprovalResult,
  unapprovedOmissions,
  type DeletionDecision,
  type DeletionRequest,
} from "./deletions.js";

export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "AgentRunError";
  }
}
import { fetchJobPage } from "./page.js";
import { buildPrompt } from "./prompt.js";
import { normalizeRecommendation } from "./tailor.js";
import type { AnalysisResult, CvFile, TailoredCv } from "./types.js";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTailoredCv(value: unknown): TailoredCv | undefined {
  if (!value || typeof value !== "object") return undefined;
  const draft = value as TailoredCv;
  if (!Array.isArray(draft.skills) || !Array.isArray(draft.experience)) return undefined;
  return {
    headline: asString(draft.headline),
    summary: asString(draft.summary),
    skills: draft.skills.map((group) => ({
      label: asString(group?.label),
      items: asString(group?.items),
    })),
    experience: draft.experience.map((entry) => ({
      company: asString(entry?.company),
      location: asString(entry?.location),
      roles: Array.isArray(entry?.roles)
        ? entry.roles.map((role) => ({
            title: asString(role?.title),
            dates: asString(role?.dates),
            bullets: Array.isArray(role?.bullets) ? role.bullets.map((bullet) => asString(bullet)) : [],
          }))
        : [],
    })),
    education: Array.isArray(draft.education)
      ? draft.education.map((entry) => ({
          school: asString(entry?.school),
          detail: asString(entry?.detail),
          dates: asString(entry?.dates),
        }))
      : [],
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item).trim()).filter(Boolean);
}

function asDeletions(value: unknown): DeletionRequest[] {
  if (!Array.isArray(value)) return [];
  const items: DeletionRequest[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { fact?: unknown; reason?: unknown };
    const fact = asString(record.fact).trim();
    if (!fact) continue;
    items.push({ fact, reason: asString(record.reason).trim() || "Not given." });
  }
  return items;
}

function readResult(args: Record<string, unknown>): AnalysisResult {
  const recommendation = normalizeRecommendation(asString(args.recommendation));
  const blocked = args.blocked === true;
  if (!blocked && !recommendation) {
    throw new Error(`Agent returned an unknown recommendation: ${asString(args.recommendation)}`);
  }
  return {
    blocked,
    blockedReason: asString(args.blockedReason) || undefined,
    company: asString(args.company),
    role: asString(args.role),
    location: asString(args.location),
    seniority: asString(args.seniority),
    recommendation: recommendation ?? "Skip",
    why: asString(args.why),
    reportMarkdown: asString(args.reportMarkdown),
    tailoredCv: asTailoredCv(args.tailoredCv),
  };
}

const MAX_TAILOR_ATTEMPTS = 2;

export async function analyzeJob(input: {
  cv: CvFile;
  jobUrl: string;
  model: string;
  apiKey: string;
  cwd: string;
  pastedDescription?: string;
  forceCv?: boolean;
  log?: (message: string) => void;
  approveDeletions?: (items: DeletionRequest[]) => Promise<DeletionDecision[]>;
  reviewTailoredCv?: (draft: TailoredCv) => Promise<string | null>;
}): Promise<AnalysisResult> {
  const log = input.log ?? ((message: string) => console.error(message));
  const slot: { submitted?: AnalysisResult; omittedFacts: string[] } = { omittedFacts: [] };
  const readSubmitted = (): AnalysisResult | undefined => slot.submitted;
  const approved = new Set<string>();

  const agent = await Agent.create({
    apiKey: input.apiKey,
    model: { id: input.model },
    name: "cv-check",
    disallowedTools: ["shell", "task"],
    local: {
      cwd: input.cwd,
      settingSources: [],
      customTools: {
        fetch_job_page: {
          description:
            "Read a public job posting page and return its text. Read-only. Never submits a form or application.",
          annotations: { readOnlyHint: true, openWorldHint: true },
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "Absolute http(s) URL of the posting" },
            },
            required: ["url"],
          },
          async execute(args) {
            const url = asString(args.url);
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
              return "Refused: only http(s) URLs can be read.";
            }
            const page = await fetchJobPage(url);
            if (page.blocked) {
              return `BLOCKED: the page did not return a readable job description.\n\n${page.text}`;
            }
            return page.text;
          },
        },
        request_deletion_approval: {
          description:
            "Ask the user before removing any source-CV fact from the tailored CV. Call this before submit_report whenever tailoredCv would omit an employer, role, date, bullet, metric, skill, or school. Rephrasing is not a deletion. Wait for APPROVED or DENIED. Omit only APPROVED facts.",
          inputSchema: {
            type: "object",
            properties: {
              deletions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    fact: {
                      type: "string",
                      description: "The source fact to remove, quoted from the CV",
                    },
                    reason: {
                      type: "string",
                      description: "Why this fact has to go so the CV can stay on one full page",
                    },
                  },
                  required: ["fact", "reason"],
                },
              },
            },
            required: ["deletions"],
          },
          async execute(args) {
            const items = asDeletions(args.deletions);
            const decisions = input.approveDeletions
              ? await input.approveDeletions(items)
              : items.map((item) => ({ ...item, approved: false }));
            for (const decision of decisions) {
              if (decision.approved) approved.add(factKey(decision.fact));
            }
            return formatApprovalResult(decisions);
          },
        },
        submit_report: {
          description: input.forceCv
            ? "Submit the finished match report. Call once, after any deletion approvals. The user forced CV generation: always include tailoredCv, even on Skip, and pass omittedFacts for every source fact left out of it."
            : "Submit the finished match report. Call once, after any deletion approvals. On Skip, omit tailoredCv and omit adaptation sections from reportMarkdown. On Apply or Maybe apply, pass omittedFacts for every source fact left out of tailoredCv.",
          inputSchema: {
            type: "object",
            properties: {
              blocked: { type: "boolean" },
              blockedReason: { type: "string" },
              company: { type: "string" },
              role: { type: "string" },
              location: { type: "string" },
              seniority: { type: "string" },
              recommendation: { type: "string", enum: ["Apply", "Maybe apply", "Skip"] },
              why: { type: "string" },
              reportMarkdown: { type: "string" },
              omittedFacts: {
                type: "array",
                items: { type: "string" },
                description:
                  "Source facts omitted from tailoredCv. Each must already be APPROVED by request_deletion_approval. Empty when nothing was removed.",
              },
              tailoredCv: {
                type: "object",
                properties: {
                  headline: { type: "string" },
                  summary: { type: "string" },
                  skills: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        items: { type: "string" },
                      },
                      required: ["label", "items"],
                    },
                  },
                  experience: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        company: { type: "string" },
                        location: {
                          type: "string",
                          description:
                            "Leave empty. City, country, and work arrangement are omitted from the CV.",
                        },
                        roles: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              title: { type: "string" },
                              dates: { type: "string" },
                              bullets: { type: "array", items: { type: "string" } },
                            },
                            required: ["title", "dates", "bullets"],
                          },
                        },
                      },
                      required: ["company", "roles"],
                    },
                  },
                  education: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        school: { type: "string" },
                        detail: { type: "string" },
                        dates: { type: "string" },
                      },
                      required: ["school", "detail", "dates"],
                    },
                  },
                },
                required: ["headline", "summary", "skills", "experience", "education"],
              },
            },
            required: ["company", "role", "recommendation", "why", "reportMarkdown"],
          },
          execute(args) {
            slot.omittedFacts = asStringArray(args.omittedFacts);
            slot.submitted = readResult(args);
            return "Report saved. Finish with the match report markdown only.";
          },
        },
      },
    },
  });

  try {
    let prompt = buildPrompt({
      cv: input.cv,
      jobUrl: input.jobUrl,
      pastedDescription: input.pastedDescription,
      forceCv: input.forceCv,
    });

    for (let attempt = 0; attempt < MAX_TAILOR_ATTEMPTS; attempt++) {
      slot.submitted = undefined;
      slot.omittedFacts = [];
      const run = await agent.send(prompt);
      log(`agent ${agent.agentId}`);
      log(`run ${run.id}`);

      for await (const event of run.stream()) {
        if (event.type === "tool_call") {
          log(`[tool] ${event.name}: ${event.status}`);
        }
      }

      const result = await run.wait();
      if (result.status === "error") {
        throw new AgentRunError(
          `run failed: ${result.id}${result.error?.message ? ` — ${result.error.message}` : ""}`,
          2,
        );
      }
      if (result.status === "cancelled") {
        throw new AgentRunError(`run cancelled: ${result.id}`, 2);
      }
      const submitted = readSubmitted();
      if (!submitted) {
        throw new Error("The agent finished without calling submit_report.");
      }
      if (!submitted.reportMarkdown.trim() && result.result?.trim()) {
        submitted.reportMarkdown = result.result.trim();
      }

      if (submitted.blocked) return submitted;
      if (!submitted.tailoredCv) {
        if (!input.forceCv || attempt === MAX_TAILOR_ATTEMPTS - 1) return submitted;
        log("CV generation is forced but the agent returned no CV draft. Asking for one.");
        prompt =
          "The user forced CV generation. Call submit_report again with the same report and a tailoredCv, even if the recommendation is Skip. Follow the tailored CV rules.";
        continue;
      }
      if (submitted.recommendation === "Skip" && !input.forceCv) return submitted;

      const unapproved = unapprovedOmissions(slot.omittedFacts, approved);
      const overflow = input.reviewTailoredCv ? await input.reviewTailoredCv(submitted.tailoredCv) : null;
      if (unapproved.length === 0 && !overflow) return submitted;

      if (attempt === MAX_TAILOR_ATTEMPTS - 1) {
        if (unapproved.length > 0) {
          if (input.forceCv) {
            log(`CV generation is forced, so the draft was kept even though it removes facts that were not approved: ${unapproved.join(" | ")}`);
          } else {
            submitted.tailoredCv = undefined;
            log("The draft still removes facts that were not approved. No tailored CV was written.");
          }
        }
        if (overflow && !input.forceCv) {
          log("The tailored CV is still too long for one page. No PDF was written.");
        }
        return submitted;
      }
      if (unapproved.length > 0) {
        log("The draft removes facts that were not approved. Asking the model to restore them or request approval.");
      }
      if (overflow) {
        log("The tailored CV is too long for one page. Asking the model to request approval before removing facts.");
      }

      const problems = [
        unapproved.length > 0
          ? `These facts were removed without approval: ${unapproved.join(" | ")}. Call request_deletion_approval for each one, or put them back. Omit only APPROVED facts.`
          : "",
        overflow ?? "",
        "Then call submit_report again. List every omitted source fact in omittedFacts, using the same fact text as the approval request. The PDF must be one full A4 page.",
      ].filter(Boolean);
      prompt = problems.join("\n\n");
    }

    if (!slot.submitted) throw new Error("The agent finished without calling submit_report.");
    return slot.submitted;
  } catch (error) {
    if (error instanceof CursorAgentError) {
      throw new AgentRunError(
        `startup failed: ${error.message}, retryable=${error.isRetryable}`,
        1,
      );
    }
    throw error;
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}
