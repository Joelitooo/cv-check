export const CHROME =
  process.env.CHROME_PATH?.trim() || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const extraArgs = (process.env.CHROME_ARGS ?? "").split(/\s+/).filter(Boolean);

export function chromeArgs(args: string[]): string[] {
  return ["--headless=new", "--disable-gpu", ...extraArgs, ...args];
}
