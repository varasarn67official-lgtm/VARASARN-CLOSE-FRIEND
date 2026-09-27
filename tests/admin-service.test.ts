import { describe, expect, it } from 'vitest'
import { AdminService } from '../src/services/admin'

describe('AdminService', () => {
  it('uses owner-only RPCs to list verified accounts and grant administrator access', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({
      rpc: async (name, args) => {
        calls.push({ name, args })
        if (name === 'list_verified_accounts') {
          return { data: [{ id: 'user-b', name: 'B', email: 'b@example.com' }], error: null }
        }
        return { data: null, error: null }
      },
    })

    await expect(service.listVerifiedAccounts()).resolves.toEqual([
      { id: 'user-b', name: 'B', email: 'b@example.com' },
    ])
    await expect(service.grantAdministrator('user-b')).resolves.toBeUndefined()
    expect(calls).toEqual([
      { name: 'list_verified_accounts', args: undefined },
      { name: 'grant_administrator', args: { p_user_id: 'user-b' } },
    ])
  })

  it('normalizes a course code before using the administrator create RPC', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: null } } })

    await service.createCourse({ code: ' jc 101 ', nameTh: 'การเขียนข่าว', categoryId: 'category-1' })

    expect(calls).toEqual([{
      name: 'create_course',
      args: { p_code: 'JC101', p_name_th: 'การเขียนข่าว', p_category_id: 'category-1' },
    }])
  })

  it('uses the category RPCs for administrator-managed categories', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'list_categories' ? [{ id: 'cat-1', name: 'วิชาแกน' }] : null, error: null } } })
    await expect(service.listCategories()).resolves.toEqual([{ id: 'cat-1', name: 'วิชาแกน' }])
    await service.createCategory(' วิชาเลือก ')
    expect(calls).toEqual([{ name: 'list_categories', args: undefined }, { name: 'create_category', args: { p_name: 'วิชาเลือก' } }])
  })

  it('uses the protected course update and archive RPCs', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: null } } })
    await service.updateCourse('course-1', { code: ' jc 202 ', nameTh: 'ข่าวเชิงลึก', categoryId: 'category-2' })
    await service.archiveCourse('course-1')
    expect(calls).toEqual([
      { name: 'update_course', args: { p_course_id: 'course-1', p_code: 'JC202', p_name_th: 'ข่าวเชิงลึก', p_category_id: 'category-2' } },
      { name: 'archive_course', args: { p_course_id: 'course-1' } },
    ])
  })

  it('previews and confirms a course merge through administrator RPCs', async () => {
    const calls: string[] = []
    const service = new AdminService({ rpc: async (name) => { calls.push(name); return { data: name === 'preview_course_merge' ? [{ source_code: 'JC1', target_code: 'JC2', offerings_to_move: 2, reviews_preserved: 3 }] : null, error: null } } })
    await expect(service.previewCourseMerge('source', 'target')).resolves.toMatchObject({ source_code: 'JC1', offerings_to_move: 2 })
    await service.mergeCourse('source', 'target')
    expect(calls).toEqual(['preview_course_merge', 'merge_course'])
  })

  it('uses only moderation-state RPCs and requires a reason', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'list_moderation_reviews' ? [{ id: 'review-1', rating: 1, text: 'x', author_active: true, moderation_state: 'visible', created_at: '2026-01-01' }] : null, error: null } } })
    await expect(service.listModerationReviews('visible')).resolves.toHaveLength(1)
    await expect(service.moderateReview('review-1', 'hidden', '  ')).rejects.toThrow('กรุณาระบุเหตุผล')
    await service.moderateReview('review-1', 'hidden', 'ไม่เกี่ยวข้อง')
    expect(calls).toEqual([
      { name: 'list_moderation_reviews', args: { p_state: 'visible' } },
      { name: 'moderate_review', args: { p_review_id: 'review-1', p_state: 'hidden', p_reason: 'ไม่เกี่ยวข้อง' } },
    ])
  })

  it('reads a review\'s moderation audit through the administrator RPC, naming the actor but never the author', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: [{ id: 'audit-1', prior_state: 'visible', new_state: 'hidden', reason: 'สแปม', actor_name: 'ผู้ดูแล ก', created_at: '2026-09-23' }], error: null } } })
    const entries = await service.listModerationAudit('review-1')
    expect(entries).toEqual([{ id: 'audit-1', priorState: 'visible', newState: 'hidden', reason: 'สแปม', actorName: 'ผู้ดูแล ก', createdAt: '2026-09-23' }])
    expect(Object.keys(entries[0]!)).not.toContain('authorUserId')
    expect(calls).toEqual([{ name: 'list_review_moderation_audit', args: { p_review_id: 'review-1' } }])
  })

  it('submits structured offering rows only through the administrator batch RPC', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: [{ created_count: 1, updated_count: 0, existing_count: 0 }], error: null } } })
    await expect(service.bulkImportOfferings([{ courseCode: 'JC100', academicYear: 2569, semester: '1', section: '2', dayOfWeek: 2, startsAt: '09:00', endsAt: '11:00' }])).resolves.toEqual({ created_count: 1, updated_count: 0, existing_count: 0 })
    await expect(service.bulkImportOfferings([])).rejects.toThrow('อย่างน้อยหนึ่ง')
    expect(calls[0]?.name).toBe('bulk_import_offerings')
  })

  it('previews a bulk offering import through the administrator preflight RPC without normalizing rows client-side', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({
      rpc: async (name, args) => {
        calls.push({ name, args })
        return {
          data: [
            { row_number: 1, course_code: 'JC100', academic_year: 2569, semester: '1', section: '2', instructor_name: 'อาจารย์เอ', day_of_week: 2, starts_at: '09:00', ends_at: '11:00', valid: true, action: 'create', reason: null, offering_id: null },
            { row_number: 2, course_code: 'ZZUNKNOWN', academic_year: 2569, semester: '1', section: '1', instructor_name: null, day_of_week: 1, starts_at: '09:00', ends_at: '10:00', valid: false, action: null, reason: 'unknown course', offering_id: null },
          ],
          error: null,
        }
      },
    })
    const rows = [{ courseCode: ' jc 100 ', academicYear: 2569 }]
    await expect(service.previewOfferingImport(rows)).resolves.toEqual([
      { rowNumber: 1, courseCode: 'JC100', academicYear: 2569, semester: '1', section: '2', instructorName: 'อาจารย์เอ', dayOfWeek: 2, startsAt: '09:00', endsAt: '11:00', valid: true, action: 'create', reason: null, offeringId: null },
      { rowNumber: 2, courseCode: 'ZZUNKNOWN', academicYear: 2569, semester: '1', section: '1', instructorName: null, dayOfWeek: 1, startsAt: '09:00', endsAt: '10:00', valid: false, action: null, reason: 'unknown course', offeringId: null },
    ])
    expect(calls).toEqual([{ name: 'preview_offering_import', args: { p_rows: rows } }])
  })

  it('uses the administrator RPCs to list and resolve offering proposals without exposing proposer identity', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'list_pending_offering_proposals' ? [{ id: 'proposal-1', course_code: 'JC100', academic_year: 2569, semester: '1', section: '2', instructor_name: 'อาจารย์เอ' }] : null, error: null } } })
    const pending = await service.listPendingOfferingProposals()
    expect(pending).toEqual([{ id: 'proposal-1', course_code: 'JC100', academic_year: 2569, semester: '1', section: '2', instructor_name: 'อาจารย์เอ' }])
    expect(pending[0]).not.toHaveProperty('proposer_user_id')
    await service.resolveOfferingProposal('proposal-1', true)
    await service.resolveOfferingProposal('proposal-1', false)
    expect(calls).toEqual([
      { name: 'list_pending_offering_proposals', args: undefined },
      { name: 'resolve_offering_proposal', args: { p_proposal_id: 'proposal-1', p_approve: true } },
      { name: 'resolve_offering_proposal', args: { p_proposal_id: 'proposal-1', p_approve: false } },
    ])
  })

  it('lists a course\'s approved offerings and corrects one through the administrator update RPC', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new AdminService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'list_approved_offerings' ? [{ id: 'offering-1', section: '1', academic_year: 2569, semester: '1', instructor_name: 'อาจารย์เอ' }] : null, error: null } } })
    await expect(service.listOfferings('course-1')).resolves.toEqual([{ id: 'offering-1', section: '1', academic_year: 2569, semester: '1', instructor_name: 'อาจารย์เอ' }])
    await service.updateOffering('offering-1', { courseId: 'course-1', academicYear: 2569, semester: ' 1 ', section: ' 2 ', instructorName: ' อาจารย์บี ', day: 3, startsAt: '10:00', endsAt: '12:00' })
    expect(calls).toEqual([
      { name: 'list_approved_offerings', args: { p_course_id: 'course-1' } },
      { name: 'update_offering', args: { p_offering_id: 'offering-1', p_academic_year: 2569, p_semester: '1', p_section: '2', p_instructor_name: 'อาจารย์บี', p_day: 3, p_starts: '10:00', p_ends: '12:00' } },
    ])
  })
})
