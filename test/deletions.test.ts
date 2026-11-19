import assert from "node:assert/strict";
import test from "node:test";
import { factKey, formatApprovalResult, unapprovedOmissions } from "../src/deletions.ts";

test("only approved facts count as allowed omissions", () => {
  const approved = new Set([factKey("  Led the search rewrite  ")]);
  assert.deepEqual(unapprovedOmissions(["Led the search rewrite", "Cut costs by 80%"], approved), [
    "Cut costs by 80%",
  ]);
});

test("approval text tells the model which facts it may remove", () => {
  const text = formatApprovalResult([
    { fact: "GraphQL federation", reason: "Least relevant", approved: true },
    { fact: "IPVC", reason: "Space", approved: false },
  ]);
  assert.match(text, /APPROVED: GraphQL federation/);
  assert.match(text, /DENIED: IPVC/);
  assert.match(text, /Omit only APPROVED/);
});
