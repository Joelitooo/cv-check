import type { Recommendation, TailoredCv } from "./types.js";

export function normalizeRecommendation(value: string): Recommendation | undefined {
  const text = value.trim().toLowerCase();
  if (text.startsWith("skip")) return "Skip";
  if (text.startsWith("maybe")) return "Maybe apply";
  if (text === "apply" || text.startsWith("apply")) return "Apply";
  return undefined;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#]+/g, "");
}

export function companyAllowed(cvText: string, company: string): boolean {
  const source = cvText.toLowerCase();
  const cleaned = company.toLowerCase().trim();
  if (!cleaned) return false;
  if (source.includes(cleaned)) return true;
  const brand = cleaned.split(/[^a-z0-9]+/).find((token) => token.length >= 4);
  return brand ? source.includes(brand) : false;
}

export function skillAllowed(cvText: string, item: string): boolean {
  const needle = norm(item);
  if (needle.length < 2) return false;
  return norm(cvText).includes(needle);
}

function numbersOf(value: string): string[] {
  return value.match(/\d+(?:\.\d+)?%?/g) ?? [];
}

const HEADLINE_STOPWORDS = new Set([
  "with",
  "and",
  "for",
  "the",
  "from",
  "into",
  "over",
  "plus",
  "using",
  "across",
]);

const WORK_TYPE_PARENS =
  /\s*\((?:hybrid|remote|on-?site|onsite|in-?office|full-?time|part-?time|contract|freelance|b2b)\)/gi;

const ROLE_OR_SKILL_WORDS = new Set([
  "engineer",
  "developer",
  "software",
  "frontend",
  "backend",
  "fullstack",
  "full",
  "stack",
  "product",
  "design",
  "react",
  "typescript",
  "javascript",
  "node",
  "senior",
  "staff",
  "lead",
  "web",
  "mobile",
  "platform",
  "systems",
  "quality",
  "data",
  "intern",
  "associate",
]);

const CONNECTORS = new Set(["and", "with", "for", "the", "in", "of", "to", "a", "an"]);

function wordKey(word: string): string {
  return word.replace(/[^A-Za-z]/g, "").toLowerCase();
}

function isLocationOrWorkType(tail: string): boolean {
  if (/\b(?:hybrid|remote|on-?site|onsite|in-?office|full-?time|part-?time|contract|freelance|b2b)\b/i.test(tail)) {
    return true;
  }
  const words = tail.split(/[\s,]+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (words.some((word) => CONNECTORS.has(wordKey(word)) || ROLE_OR_SKILL_WORDS.has(wordKey(word)))) {
    return false;
  }
  return words.every((word) => /^[A-Z]/.test(word));
}

export function withoutLocationAndWorkType(value: string): string {
  const text = value.replace(WORK_TYPE_PARENS, "").replace(/[ \t]{2,}/g, " ").trim();
  const match = text.match(/^(.*?)(?:\s+[—–]\s+|\s+-\s+|\s+\|\s+)(.+)$/);
  if (!match) return text;
  return isLocationOrWorkType(match[2].trim()) ? match[1].trim() : text;
}

export function resolveHeadline(cvText: string, headline: string, fallback: string): string {
  const candidate = withoutLocationAndWorkType(headline);
  if (!candidate) return withoutLocationAndWorkType(fallback);
  const source = cvText.toLowerCase();
  const words = candidate
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[^a-z]/g, ""))
    .filter((word) => word.length > 3 && !HEADLINE_STOPWORDS.has(word));
  const allowed = words.every((word) => source.includes(word));
  return allowed ? candidate : withoutLocationAndWorkType(fallback);
}

export function bulletAllowed(cvText: string, bullet: string): boolean {
  const source = cvText.toLowerCase();
  return numbersOf(bullet).every((number) => source.includes(number.toLowerCase()));
}

export interface TailorWarning {
  message: string;
}

export function filterTailoredCv(
  cvText: string,
  draft: TailoredCv,
): { cv: TailoredCv; warnings: TailorWarning[] } {
  const warnings: TailorWarning[] = [];

  const skills = draft.skills
    .map((group) => {
      const items = group.items
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => {
          if (skillAllowed(cvText, item)) return true;
          warnings.push({ message: `Dropped skill not in the CV: ${item}` });
          return false;
        });
      return { label: group.label.trim(), items: items.join(", ") };
    })
    .filter((group) => group.label && group.items);

  const experience = draft.experience
    .filter((entry) => {
      if (companyAllowed(cvText, entry.company)) return true;
      warnings.push({ message: `Dropped employer not in the CV: ${entry.company}` });
      return false;
    })
    .map((entry) => ({
      company: entry.company.trim(),
      location: entry.location.trim(),
      roles: entry.roles
        .map((role) => ({
          title: role.title.trim(),
          dates: role.dates.trim(),
          bullets: role.bullets
            .map((bullet) => bullet.trim())
            .filter(Boolean)
            .filter((bullet) => {
              if (bulletAllowed(cvText, bullet)) return true;
              warnings.push({ message: `Dropped bullet with a metric that is not in the CV: ${bullet}` });
              return false;
            }),
        }))
        .filter((role) => role.title && role.bullets.length > 0),
    }))
    .filter((entry) => entry.roles.length > 0);

  const education = draft.education.filter((entry) => {
    if (companyAllowed(cvText, entry.school)) return true;
    warnings.push({ message: `Dropped school not in the CV: ${entry.school}` });
    return false;
  });

  return {
    cv: {
      headline: withoutLocationAndWorkType(draft.headline),
      summary: draft.summary.trim(),
      skills,
      experience: experience.map((entry) => ({
        ...entry,
        company: withoutLocationAndWorkType(entry.company),
        location: "",
      })),
      education,
    },
    warnings,
  };
}
