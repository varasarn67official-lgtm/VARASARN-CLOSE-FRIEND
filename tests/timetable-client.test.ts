import { describe, expect, it } from 'vitest'
import { TimetableService } from '../src/services/timetable-client'
describe('TimetableService', () => {
  it('uses only self-scoped timetable RPCs', async () => { const calls: string[]=[]; const service=new TimetableService({rpc:async(name)=>{calls.push(name);return {data:[],error:null}}}); await service.list(); await service.clear(); expect(calls).toEqual(['list_my_timetable','list_my_reported_timetable','list_my_legacy_timetable','clear_my_timetable']) })

  it('adds, removes, and replaces selections through the self-scoped RPCs only', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new TimetableService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: null } } })
    await service.add('offering-1')
    await service.remove('offering-1')
    await service.replace('offering-2')
    await service.addReview('review-1')
    await service.removeReview('review-1')
    await service.removeLegacy('legacy-1')
    expect(calls).toEqual([
      { name: 'add_my_timetable_offering', args: { p_offering_id: 'offering-1' } },
      { name: 'remove_my_timetable_offering', args: { p_offering_id: 'offering-1' } },
      { name: 'replace_my_timetable_offering', args: { p_offering_id: 'offering-2' } },
      { name: 'add_my_timetable_review', args: { p_review_id: 'review-1' } },
      { name: 'remove_my_timetable_review', args: { p_review_id: 'review-1' } },
      { name: 'remove_my_legacy_timetable_entry', args: { p_legacy_entry_id: 'legacy-1' } },
    ])
  })

  it('surfaces a denial for an invalid selection instead of swallowing it', async () => {
    const service = new TimetableService({ rpc: async () => ({ data: null, error: { message: 'approved offering with meeting time required' } }) })
    await expect(service.add('offering-1')).rejects.toThrow('approved offering with meeting time required')
  })
})
