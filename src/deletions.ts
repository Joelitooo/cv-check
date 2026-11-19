import { createInterface } from "node:readline/promises";

export interface DeletionRequest {
  fact: string;
  reason: string;
}

export interface DeletionDecision extends DeletionRequest {
  approved: boolean;
}

export function factKey(fact: string): string {
  return fact.toLowerCase().replace(/\s+/g, " ").trim();
}

export function unapprovedOmissions(omitted: string[], approved: ReadonlySet<string>): string[] {
  return omitted.filter((fact) => fact.trim() && !approved.has(factKey(fact)));
}

export function formatApprovalResult(items: DeletionDecision[]): string {
  if (items.length === 0) {
    return "No deletions were requested. Keep every source fact.";
  }
  const lines = items.map(
    (item) => `- ${item.approved ? "APPROVED" : "DENIED"}: ${item.fact}`,
  );
  return [
    "Deletion decisions. Omit only APPROVED facts. Keep every DENIED fact.",
    "List omitted facts in omittedFacts using the same fact text.",
    ...lines,
  ].join("\n");
}

export async function promptDeletionApprovals(items: DeletionRequest[]): Promise<DeletionDecision[]> {
  if (items.length === 0) return [];
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    console.error(
      "Deletion approval needs an interactive terminal. No facts were approved for removal.",
    );
    return items.map((item) => ({ ...item, approved: false }));
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    console.error("\nThe model wants to remove facts from the tailored CV. Nothing is removed without your approval.");
    const decisions: DeletionDecision[] = [];
    for (const item of items) {
      const answer = (
        await rl.question(
          `\nRemove this fact?\n  ${item.fact}\n  Why: ${item.reason}\nApprove? [y/N] `,
        )
      )
        .trim()
        .toLowerCase();
      const approved = answer === "y" || answer === "yes";
      decisions.push({ ...item, approved });
      console.error(approved ? "Approved." : "Kept.");
    }
    return decisions;
  } finally {
    rl.close();
  }
}
