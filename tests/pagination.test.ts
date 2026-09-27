import { describe, expect, it } from 'vitest'
import { fetchAllRows, withRange } from '../src/services/pagination'

describe('withRange', () => {
  it('calls .range(from, to) on a query that supports it', () => {
    const calls: Array<[number, number]> = []
    const query = { range: (from: number, to: number) => { calls.push([from, to]); return 'ranged-result' } }
    const result = withRange(query, 100, 199)
    expect(calls).toEqual([[100, 199]])
    expect(result).toBe('ranged-result')
  })

  it('passes the query through unchanged when .range is not available, e.g. a plain test mock', () => {
    const plainPromise = Promise.resolve({ data: [], error: null })
    expect(withRange(plainPromise, 0, 4999)).toBe(plainPromise)
  })
})

describe('fetchAllRows', () => {
  it('returns the first page as-is when it already covers the reported total', async () => {
    const makeQuery = async (from: number, to: number) => {
      expect([from, to]).toEqual([0, 999])
      return { data: [{ id: 1 }, { id: 2 }], error: null, count: 2 }
    }
    const { data, error } = await fetchAllRows(makeQuery)
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('follows up with just enough parallel requests when the server caps a page below the reported total', async () => {
    // Mirrors the real bug: requesting 5000 rows still only returns 100, but `count` says 214.
    const calls: Array<[number, number]> = []
    const total = 214
    const pageSize = 100
    const makeQuery = async (from: number, to: number) => {
      calls.push([from, to])
      const page = Array.from({ length: Math.min(pageSize, total - from) }, (_, i) => ({ id: from + i }))
      return { data: page, error: null, count: total }
    }
    const { data, error } = await fetchAllRows(makeQuery, 5000)
    expect(error).toBeNull()
    expect(data).toHaveLength(total)
    expect(data.map((row) => row.id)).toEqual(Array.from({ length: total }, (_, i) => i))
    // One request to learn the real page size + count, then exactly enough follow-up pages -- not one request per row.
    expect(calls).toEqual([[0, 4999], [100, 199], [200, 299]])
  })

  it('stops and surfaces the error if a follow-up page fails, keeping the rows already fetched', async () => {
    const makeQuery = async (from: number) => {
      if (from === 0) return { data: [{ id: 1 }], error: null, count: 3 }
      return { data: null, error: { message: 'boom' } }
    }
    const { data, error } = await fetchAllRows(makeQuery, 1)
    expect(error).toEqual({ message: 'boom' })
    expect(data).toEqual([{ id: 1 }])
  })

  it('returns the error immediately if the first page fails', async () => {
    const makeQuery = async () => ({ data: null, error: { message: 'nope' } })
    const { data, error } = await fetchAllRows(makeQuery)
    expect(error).toEqual({ message: 'nope' })
    expect(data).toEqual([])
  })
})
