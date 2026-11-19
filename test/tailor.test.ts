import assert from "node:assert/strict";
import test from "node:test";
import {
  filterTailoredCv,
  normalizeRecommendation,
  resolveHeadline,
  withoutLocationAndWorkType,
} from "../src/tailor.ts";
import type { TailoredCv } from "../src/types.ts";

const CV = `
JOEL SILVA
Frontend Engineer
React, TypeScript, GraphQL
eDreams — Porto
• increased search bar clicks by 112%
IPVC — Instituto Politécnico de Viana do Castelo
BSc in Computer Science
`;

test("normalizeRecommendation maps the three outcomes", () => {
  assert.equal(normalizeRecommendation("Apply"), "Apply");
  assert.equal(normalizeRecommendation("Maybe apply"), "Maybe apply");
  assert.equal(normalizeRecommendation("Skip (long shot)"), "Skip");
  assert.equal(normalizeRecommendation("nope"), undefined);
});

test("filterTailoredCv drops invented employers, skills, and metrics", () => {
  const draft: TailoredCv = {
    headline: "Staff Frontend Engineer",
    summary: "Builds React apps.",
    skills: [{ label: "Languages", items: "TypeScript, Rust" }],
    experience: [
      {
        company: "eDreams",
        location: "Porto",
        roles: [
          {
            title: "Software Engineer",
            dates: "Oct 2025 – Present",
            bullets: ["increased search bar clicks by 112%", "cut costs by 80%"],
          },
        ],
      },
      {
        company: "Invented Labs",
        location: "Remote",
        roles: [{ title: "Staff", dates: "2020", bullets: ["built a platform"] }],
      },
    ],
    education: [{ school: "IPVC", detail: "BSc", dates: "2019 – 2022" }],
  };

  const { cv, warnings } = filterTailoredCv(CV, draft);
  assert.deepEqual(
    cv.skills.map((group) => group.items),
    ["TypeScript"],
  );
  assert.equal(cv.experience.length, 1);
  assert.equal(cv.experience[0].location, "");
  assert.deepEqual(cv.experience[0].roles[0].bullets, ["increased search bar clicks by 112%"]);
  assert.equal(cv.education.length, 1);
  assert.ok(warnings.some((warning) => warning.message.includes("Rust")));
  assert.ok(warnings.some((warning) => warning.message.includes("Invented Labs")));
  assert.equal(resolveHeadline(CV, "Staff Frontend Engineer", "Frontend Engineer"), "Frontend Engineer");
  assert.equal(resolveHeadline(CV, "Frontend Engineer", "Frontend Engineer"), "Frontend Engineer");
});

test("location and work type are removed from headlines and employers", () => {
  assert.equal(withoutLocationAndWorkType("Software Engineer - Warsaw, Poland"), "Software Engineer");
  assert.equal(withoutLocationAndWorkType("Frontend Engineer — Warsaw, Poland"), "Frontend Engineer");
  assert.equal(withoutLocationAndWorkType("Software Engineer - Remote"), "Software Engineer");
  assert.equal(withoutLocationAndWorkType("eDreams — Porto, Portugal (Hybrid)"), "eDreams");
  assert.equal(
    withoutLocationAndWorkType("Frontend Engineer - React and TypeScript"),
    "Frontend Engineer - React and TypeScript",
  );

  const { cv } = filterTailoredCv(CV, {
    headline: "Software Engineer - Warsaw, Poland",
    summary: "Builds React apps.",
    skills: [],
    experience: [
      {
        company: "eDreams — Porto, Portugal (Hybrid)",
        location: "Porto, Portugal (Hybrid)",
        roles: [
          {
            title: "Software Engineer",
            dates: "Oct 2025 – Present",
            bullets: ["increased search bar clicks by 112%"],
          },
        ],
      },
    ],
    education: [],
  });
  assert.equal(cv.headline, "Software Engineer");
  assert.equal(cv.experience[0].company, "eDreams");
  assert.equal(cv.experience[0].location, "");
});
