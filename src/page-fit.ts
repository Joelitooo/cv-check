export const PAGE_HEIGHT_MM = 297;
export const MIN_PAGE_FIT = 0.82;

export interface PageFit {
  mode: "spread" | "scale";
  scale: number;
  fits: boolean;
}

export function pageFit(contentToPage: number): PageFit {
  if (!Number.isFinite(contentToPage) || contentToPage <= 0) {
    throw new Error(`Invalid page measurement: ${contentToPage}`);
  }
  if (contentToPage <= 1) return { mode: "spread", scale: 1, fits: true };
  const scale = (1 / contentToPage) * 0.995;
  if (scale < MIN_PAGE_FIT) return { mode: "scale", scale: MIN_PAGE_FIT, fits: false };
  return { mode: "scale", scale, fits: true };
}

export function pageOverflowPercent(contentToPage: number): number {
  return Math.max(0, Math.round((contentToPage - 1) * 100));
}
