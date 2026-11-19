import type { CvFile } from "./types.js";

export function buildPrompt(input: {
  cv: CvFile;
  jobUrl: string;
  pastedDescription?: string;
  forceCv?: boolean;
}): string {
  const paste = input.pastedDescription?.trim()
    ? `\nThe user also pasted this posting text. Use it when the fetched page is thin, blocked, or login-walled. Do not ignore a fetched page that has the real description.\n\n--- PASTED POSTING ---\n${input.pastedDescription.trim()}\n--- END PASTED POSTING ---\n`
    : "";
  const skipRule = input.forceCv
    ? "- The user forced CV generation. Include a tailoredCv for every recommendation, including Skip. Keep the recommendation honest; forcing the CV does not change the fit. On Skip, still omit ATS keywords and the cover-letter outline, but include a CV adaptations section that describes the edits in tailoredCv."
    : "- On Skip, do not include ATS keywords, CV adaptations, or a cover-letter outline, and omit tailoredCv.";
  const tailoredScope = input.forceCv ? "every recommendation, because the user forced it" : "Apply and Maybe apply only";

  return `You are running the CV cross-check. Decide whether Joel should invest in applying. Never submit or start an application.

Job URL: ${input.jobUrl}
Source CV file: ${input.cv.path}

Hard rules:
- Never apply. Never click Apply, Easy Apply, Submit, Next, or Send. Never fill an application form, upload a CV, create an account, or message a recruiter.
- Read the posting with the fetch_job_page tool only. GET reading is allowed. Do not use any other tool to open the page.
- Use only experience that appears in the CV text below. Do not invent jobs, titles, dates, metrics, employers, or technologies.
- If the posting cannot be read and there is no pasted description, call submit_report with blocked=true and a short blockedReason. Do not guess requirements.
- Pick exactly one recommendation: Apply, Maybe apply, or Skip.
  - Apply: must-haves are mostly evidenced in the CV; gaps are positioning or keywords, not missing core experience.
  - Maybe apply: mixed; some must-haves are partial or transferable, and a tailored CV could make applying reasonable.
  - Skip: missing core must-haves, wrong seniority or domain with no real evidence, or a blocker a rewrite cannot fix. Do not inflate fit.
${skipRule}
- On Apply or Maybe apply, include those sections and a tailoredCv that only reorders and rephrases facts already in the CV.

CV header is fixed. Do not change the person's name or contact line.
Name: ${input.cv.name}
Current headline: ${input.cv.headline}
Contacts: ${input.cv.contacts}

Tailored CV rules (${tailoredScope}):
- The PDF is one A4 page. It must fill that page from the header through education, and it must not continue onto a second page.
- Do not put a location or a work arrangement on the tailored CV. No city, country, or labels such as Hybrid, Remote, On-site, Full-time, or B2B, including in the headline and beside an employer. Leaving those off is the default. It is not a deletion, so do not ask for approval to drop them.
- headline is a role title only. It may shift only by using words already true in the CV. Do not append a place or a work arrangement.
- experience: company, title, dates, and bullets only. Leave location as an empty string.
- summary may be rewritten toward this role, using only facts from the CV.
- skills: reorder so the role's stack comes first. Every item must be copied from the CV. Do not add tools that are not listed.
- experience: keep every real employer. Reorder bullets so the most relevant come first. Rephrase toward the posting's vocabulary only when the fact is already in the CV. Do not add metrics.
- education: copy from the CV.
- Keep enough role-relevant summary and bullets that the page is full. A sparse page is wrong.
- Deleting information requires approval first. A deletion is omitting a source fact: an employer, role, date, bullet, metric, skill, or school. Reordering and rephrasing are not deletions.
- Before you omit any source fact, call request_deletion_approval with those facts and why each one has to go. Wait for the result. Omit only facts marked APPROVED. If a fact is DENIED, keep it.
- Delete only when the CV cannot fit on one page without it, and only the smallest set. Do not delete just to tailor.
- List every omitted source fact in omittedFacts, using the same fact text you submitted for approval. If you omitted nothing, pass an empty omittedFacts array.
- The CV adaptations section must describe the edits you actually made in tailoredCv, including any approved deletions.

Call submit_report once, then stop. Your final message must be only the match report markdown, with no preamble.

Report markdown (omit the Tracker section; the program adds it):

# Match report: {Role} @ {Company}

**Recommendation:** Apply | Maybe apply | Skip (long shot)
**Why:** {2–4 sentences}

## Role snapshot
- Location / remote:
- Seniority:
- Stack / domain:

## Must-haves
| Requirement | CV evidence | Met / Partial / Missing |

## Nice-to-haves
| Requirement | CV evidence | Met / Partial / Missing |

## Blockers
- {or "None"}

## Source CV
- ${input.cv.path}

## ATS keywords to add (only if true)
- {omit this entire section on Skip}

## CV adaptations
- ${input.forceCv ? "{edits made in tailoredCv}" : "{omit this entire section on Skip}"}

## Cover letter outline
- {omit this entire section on Skip}

## Job posting snapshot
{short extract of the posting, at most 1500 characters}

${paste}
--- CV TEXT ---
${input.cv.text}
--- END CV TEXT ---
`;
}
