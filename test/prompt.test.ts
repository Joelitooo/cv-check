import assert from "node:assert/strict";
import test from "node:test";
import { buildPrompt } from "../src/prompt.ts";
import type { CvFile } from "../src/types.ts";

const cv: CvFile = {
  path: "/tmp/Joel_Silva_CV.txt",
  text: "JOEL SILVA\nFrontend Engineer\nReact",
  name: "JOEL SILVA",
  headline: "Frontend Engineer",
  contacts: "joel@example.com",
};

test("the tailored CV prompt requires one full page and deletion approval", () => {
  const prompt = buildPrompt({ cv, jobUrl: "https://example.com/jobs/1" });
  assert.match(prompt, /one A4 page/);
  assert.match(prompt, /must fill that page/);
  assert.match(prompt, /must not continue onto a second page/);
  assert.match(prompt, /Leave location as an empty string/);
  assert.match(prompt, /It is not a deletion/);
  assert.match(prompt, /request_deletion_approval/);
  assert.match(prompt, /Omit only facts marked APPROVED/);
  assert.doesNotMatch(prompt, /drop the least relevant bullets/);
  assert.match(prompt, /On Skip, do not include ATS keywords, CV adaptations, or a cover-letter outline, and omit tailoredCv/);
});

test("forcing the CV asks for a tailoredCv on Skip without changing the recommendation", () => {
  const prompt = buildPrompt({ cv, jobUrl: "https://example.com/jobs/1", forceCv: true });
  assert.match(prompt, /Include a tailoredCv for every recommendation, including Skip/);
  assert.match(prompt, /Keep the recommendation honest/);
  assert.doesNotMatch(prompt, /and omit tailoredCv/);
  assert.match(prompt, /Use only experience that appears in the CV text below/);
});
