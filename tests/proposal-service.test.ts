import { describe, expect, it } from 'vitest'
import { ProposalService } from '../src/services/proposals'

describe('ProposalService', () => {
  it('uses only the signed-in user proposal RPCs', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new ProposalService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'list_my_offering_proposals' ? [{ id: 'proposal-1', course_id: 'course-1', academic_year: 2569, semester: '1', section: '2', instructor_name: null, status: 'pending', created_at: '2026-01-01' }] : null, error: null } } })
    await service.create('course-1', 2569, ' 1 ', ' 2 ', ' อาจารย์ ')
    await expect(service.listMine()).resolves.toMatchObject([{ courseId: 'course-1', status: 'pending' }])
    expect(calls).toEqual([
      { name: 'create_offering_proposal', args: { p_course_id: 'course-1', p_academic_year: 2569, p_semester: '1', p_section: '2', p_instructor_name: 'อาจารย์' } },
      { name: 'list_my_offering_proposals', args: undefined },
    ])
  })
})
