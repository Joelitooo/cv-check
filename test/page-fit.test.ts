import assert from "node:assert/strict";
import test from "node:test";
import { MIN_PAGE_FIT, pageFit, pageOverflowPercent } from "../src/page-fit.ts";

test("a short CV spreads to fill one page", () => {
  assert.deepEqual(pageFit(0.72), { mode: "spread", scale: 1, fits: true });
  assert.deepEqual(pageFit(1), { mode: "spread", scale: 1, fits: true });
});

test("a slightly long CV scales down onto one page", () => {
  const fit = pageFit(1.1);
  assert.equal(fit.mode, "scale");
  assert.equal(fit.fits, true);
  assert.ok(fit.scale < 1);
  assert.ok(fit.scale >= MIN_PAGE_FIT);
});

test("a CV that cannot shrink to a readable size does not fit", () => {
  const fit = pageFit(1.6);
  assert.equal(fit.fits, false);
  assert.equal(fit.scale, MIN_PAGE_FIT);
  assert.equal(pageOverflowPercent(1.6), 60);
});
