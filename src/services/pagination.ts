export type PageResult<T> = { data: T[] | null; error: { message: string } | null; count?: number | null }

/**
 * The Neon Data API caps any single RETURNS TABLE response server-side (confirmed: still 100
 * rows with an explicit `?offset=0&limit=5000` on the request -- this is a hard per-request
 * cap, not a client-overridable default), so listing more rows than that needs multiple
 * requests. `range()` only exists on the real postgrest-js query builder, not on the
 * plain-Promise mocks tests use for `rpc()` -- this no-ops there instead of throwing, so the
 * same `makeQuery` callback works against both.
 */
export function withRange<T>(query: T, from: number, to: number): T {
  return typeof (query as { range?: unknown })?.range === 'function'
    ? (query as unknown as { range(from: number, to: number): T }).range(from, to)
    : query
}

/**
 * Fetches every row of a paginated RPC by following up the first page with just enough
 * parallel requests to cover the rest, using the exact total from `count: 'exact'` (a
 * `Content-Range`-derived count PostgREST-compatible APIs return alongside the first page,
 * not a second round trip) rather than probing page by page until an empty page comes back.
 * The server's actual per-request cap is read from the first page's length, since it may
 * differ from `requestSize` (as it does here: requesting 5000 still only returns 100).
 */
export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
  requestSize = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const first = await makeQuery(0, requestSize - 1)
  if (first.error) return { data: [], error: first.error }
  const rows: T[] = [...(first.data ?? [])]
  const pageSize = rows.length
  const total = typeof first.count === 'number' ? first.count : rows.length
  if (pageSize === 0 || rows.length >= total) return { data: rows, error: null }

  const pages: Array<Promise<PageResult<T>>> = []
  for (let from = pageSize; from < total; from += pageSize) pages.push(Promise.resolve(makeQuery(from, from + pageSize - 1)))
  for (const page of await Promise.all(pages)) {
    if (page.error) return { data: rows, error: page.error }
    rows.push(...(page.data ?? []))
  }
  return { data: rows, error: null }
}
