import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CHROME, chromeArgs } from "./chrome.js";

const execFileAsync = promisify(execFile);

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function looksBlocked(text: string): boolean {
  if (text.length >= 800) return false;
  return /sign in|log in|login|enable javascript|captcha|access denied/i.test(text);
}

async function chromeText(url: string): Promise<string> {
  const { stdout } = await execFileAsync(
    CHROME,
    chromeArgs(["--virtual-time-budget=12000", "--dump-dom", url]),
    { maxBuffer: 12 * 1024 * 1024, timeout: 30000 },
  );
  return htmlToText(stdout);
}

export async function fetchJobPage(url: string): Promise<{ text: string; blocked: boolean }> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });
  const body = await response.text();
  let text = htmlToText(body);

  if (text.length < 500 || looksBlocked(text)) {
    try {
      const rendered = await chromeText(url);
      if (rendered.length > text.length) text = rendered;
    } catch {
      // keep the plain fetch text
    }
  }

  const blocked = looksBlocked(text) || text.length < 200;
  return { text: text.slice(0, 30000), blocked };
}
