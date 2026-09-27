export function normalizeCourseCode(value: unknown): string
export function sectionKey(section: string): string
export function normalizeRating(value: unknown): number | null
export function normalizeSemester(value: unknown): '1' | '2' | 'ฤดูร้อน' | null
export function normalizeYear(value: unknown): { year: number; converted: boolean } | null
export function normalizeTimestamp(value: unknown, offset?: string): string | null
export function normalizeLegacyReviews(
  rows: Record<string, unknown>[],
  options?: { catalog?: Set<string> | null; offset?: string; firstRow?: number },
): Record<string, unknown>
