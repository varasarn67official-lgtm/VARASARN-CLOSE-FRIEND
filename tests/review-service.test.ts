import { describe, expect, it } from 'vitest'
import { ReviewService } from '../src/services/reviews'

describe('ReviewService', () => {
  it('uses only the anonymous review RPC for a signed-in reader', async () => {
    const calls: string[] = []
    const service = new ReviewService({
      rpc: async (name) => {
        calls.push(name)
        return { data: [{ id: 'review-1', rating: 5, text: 'มีประโยชน์มาก', created_at: '2026-01-01' }], error: null }
      },
    })

    await expect(service.listVisible('course-1')).resolves.toEqual([
      { id: 'review-1', rating: 5, text: 'มีประโยชน์มาก', createdAt: '2026-01-01' },
    ])
    expect(calls).toEqual(['list_visible_reviews'])
  })

  it('passes filters and maps student-reported context', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new ReviewService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: [{ id: 'review-1', rating: 4, text: 'ชัดเจน', created_at: '2026-01-01', section: '2', semester: '1', academic_year: 2569, instructor_name: 'อาจารย์ ก' }], error: null } } })
    await expect(service.listVisible('course-1', { rating: 4, semester: '1', academicYear: 2569 })).resolves.toMatchObject([{ section: '2', semester: '1', academicYear: 2569, instructorName: 'อาจารย์ ก' }])
    expect(calls[0]).toEqual({ name: 'list_visible_reviews', args: { p_course_id: 'course-1', p_rating: 4, p_semester: '1', p_academic_year: 2569 } })
  })

  it('rejects a blank review before reaching the data interface', async () => {
    const rpc = async () => ({ data: null, error: null })
    const service = new ReviewService({ rpc })

    await expect(service.create('course-1', { academicYear: 2569, semester: '1', section: '01', instructorName: 'อาจารย์ ก', dayOfWeek: 1, startsAt: '09:00', endsAt: '12:00' }, 4, '   ')).rejects.toThrow('กรุณาเขียนรีวิว')
  })

  it('rejects ratings outside the 1 to 5 range before reaching the data interface', async () => {
    const service = new ReviewService({ rpc: async () => ({ data: null, error: null }) })

    await expect(service.create('course-1', { academicYear: 2569, semester: '1', section: '01', instructorName: 'อาจารย์ ก', dayOfWeek: 1, startsAt: '09:00', endsAt: '12:00' }, 6, 'เนื้อหาดี')).rejects.toThrow('เลือกระดับคะแนน 1 ถึง 5')
  })

  it('submits review context without an offering id', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new ReviewService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: null } } })
    await service.create('course-1', { academicYear: 2568, semester: '2', section: ' Sec 01 ', instructorName: ' อาจารย์ ก ', dayOfWeek: 3, startsAt: '09:00', endsAt: '12:00' }, 5, ' ดีมาก ')
    expect(calls).toEqual([{ name: 'create_review', args: { p_course_id: 'course-1', p_academic_year: 2568, p_semester: '2', p_section: 'Sec 01', p_instructor_name: 'อาจารย์ ก', p_day: 3, p_starts: '09:00', p_ends: '12:00', p_rating: 5, p_text: 'ดีมาก' } }])
  })

  it('uses self-scoped lifecycle RPCs for a review author', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new ReviewService({ rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'list_my_reviews' ? [{ id: 'review-1', course_id: 'course-1', offering_id: null, rating: 4, text: 'เดิม', author_active: true, created_at: '2026-01-01' }] : null, error: null } } })
    await expect(service.listMine()).resolves.toMatchObject([{ courseId: 'course-1', offeringId: null, active: true }])
    await service.updateMine('review-1', 5, 'ปรับปรุง')
    await service.setMineActive('review-1', false)
    expect(calls).toEqual([
      { name: 'list_my_reviews', args: undefined },
      { name: 'update_my_review', args: { p_review_id: 'review-1', p_rating: 5, p_text: 'ปรับปรุง' } },
      { name: 'set_my_review_active', args: { p_review_id: 'review-1', p_active: false } },
    ])
  })

  it('lists an author\'s own review revision history through the self-scoped RPC', async () => {
    const calls: Array<{ name: string; args?: Record<string, unknown> }> = []
    const service = new ReviewService({
      rpc: async (name, args) => {
        calls.push({ name, args })
        return { data: [{ id: 'revision-1', rating: 4, text: 'เดิม', revised_at: '2026-01-01' }], error: null }
      },
    })
    await expect(service.listMyRevisions('review-1')).resolves.toEqual([{ id: 'revision-1', rating: 4, text: 'เดิม', revisedAt: '2026-01-01' }])
    expect(calls).toEqual([{ name: 'list_my_review_revisions', args: { p_review_id: 'review-1' } }])
  })
})
