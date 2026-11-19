import assert from "node:assert/strict";
import test from "node:test";
import { assertCvText, parseCvHeader } from "../src/cv.ts";

test("assertCvText rejects a raw PDF dump", () => {
  assert.throws(() => assertCvText("%PDF-1.4\n1 0 obj", "/tmp/Joel_Silva_CV.pdf"), /Could not read the text/);
});

test("parseCvHeader drops location from the headline", () => {
  const header = parseCvHeader("JOEL SILVA\nFrontend Engineer - Warsaw, Poland\njoel@example.com");
  assert.equal(header.name, "JOEL SILVA");
  assert.equal(header.headline, "Frontend Engineer");
  assert.equal(header.contacts, "joel@example.com");
});

test("assertCvText keeps extracted CV text", () => {
  const text = "JOEL SILVA\nFrontend Engineer\neDreams";
  assert.equal(assertCvText(text, "cv.pdf"), text);
});
