import type { RpcClient } from './reviews'
import { fetchAllRows, withRange } from './pagination'

export type VerifiedAccount = { id: string; name: string; email: string }
export type RoleAssignment = VerifiedAccount & { role: 'owner' | 'administrator'; grantedAt: string }
export type CourseDraft = { code: string; nameTh: string; categoryId: string }
export type Category = { id: string; name: string }
export type ManagedCourse = { id: string; code: string; name_th: string; category_id: string; category_name: string; status: string }
export type MergePreview = { source_code: string; target_code: string; offerings_to_move: number; reviews_preserved: number }
export type AcademicPeriod = { id: string; academic_year: number; semester: string }
export type OfferingDraft = { courseId: string; academicYear: number; semester: string; section: string; instructorName: string; day: number; startsAt: string; endsAt: string }
export type OfferingSummary = { id: string; section: string; academic_year: number; semester: string; instructor_name: string | null }
export type PendingProposal = { id: string; course_code: string; academic_year: number; semester: string; section: string; instructor_name: string | null }
export type ModerationReview = { id: string; rating: number; text: string; author_active: boolean; moderation_state: 'visible' | 'hidden' | 'removed'; created_at: string }
export type ModerationAuditEntry = { id: string; priorState: ModerationReview['moderation_state']; newState: ModerationReview['moderation_state']; reason: string; actorName: string; createdAt: string }
export type BulkOfferingRow = { courseCode: string; academicYear: number; semester: string; section: string; instructorName?: string; dayOfWeek: number; startsAt: string; endsAt: string }
export type BulkOfferingResult = { created_count: number; updated_count: number; existing_count: number }
export type OfferingImportPreview = { rowNumber: number; courseCode: string; academicYear: number | null; semester: string; section: string; instructorName: string | null; dayOfWeek: number | null; startsAt: string; endsAt: string; valid: boolean; action: 'create' | 'update' | 'existing' | null; reason: string | null; offeringId: string | null }

export class AdminService {
  constructor(private readonly client: RpcClient) {}

  async listVerifiedAccounts(): Promise<VerifiedAccount[]> {
    const { data, error } = await this.client.rpc('list_verified_accounts')
    if (error) throw new Error(error.message)
    return (data ?? []) as VerifiedAccount[]
  }

  async listRoleAssignments(): Promise<RoleAssignment[]> {
    const { data, error } = await this.client.rpc('list_role_assignments')
    if (error) throw new Error(error.message)
    return ((data ?? []) as Array<{ user_id: string; name: string; email: string; role: 'owner' | 'administrator'; granted_at: string }>).map((member) => ({
      id: member.user_id,
      name: member.name,
      email: member.email,
      role: member.role,
      grantedAt: member.granted_at,
    }))
  }

  async grantAdministrator(userId: string): Promise<void> {
    await this.changeRole('grant_administrator', userId)
  }

  async revokeAdministrator(userId: string): Promise<void> {
    await this.changeRole('revoke_administrator', userId)
  }

  async createCourse(course: CourseDraft): Promise<void> {
    const { error } = await this.client.rpc('create_course', {
      p_code: course.code.toUpperCase().replace(/\s+/g, ''),
      p_name_th: course.nameTh.trim(),
      p_category_id: course.categoryId,
    })
    if (error) throw new Error(error.message)
  }

  async listCategories(): Promise<Category[]> {
    const { data, error } = await this.client.rpc('list_categories')
    if (error) throw new Error(error.message)
    return (data ?? []) as Category[]
  }

  async createCategory(name: string): Promise<void> {
    const { error } = await this.client.rpc('create_category', { p_name: name.trim() })
    if (error) throw new Error(error.message)
  }

  async updateCategory(categoryId: string, name: string): Promise<void> {
    const { error } = await this.client.rpc('update_category', { p_category_id: categoryId, p_name: name.trim() })
    if (error) throw new Error(error.message)
  }

  async archiveCourse(courseId: string): Promise<void> {
    const { error } = await this.client.rpc('archive_course', { p_course_id: courseId })
    if (error) throw new Error(error.message)
  }

  async listManageableCourses(): Promise<ManagedCourse[]> {
    const { data, error } = await fetchAllRows<ManagedCourse>((from, to) => withRange((this.client as any).rpc('list_manageable_courses', undefined, { count: 'exact' }), from, to))
    if (error) throw new Error(error.message)
    return data
  }

  async updateCourse(courseId: string, course: CourseDraft): Promise<void> {
    const { error } = await this.client.rpc('update_course', {
      p_course_id: courseId,
      p_code: course.code.toUpperCase().replace(/\s+/g, ''),
      p_name_th: course.nameTh.trim(),
      p_category_id: course.categoryId,
    })
    if (error) throw new Error(error.message)
  }

  async previewCourseMerge(sourceCourseId: string, targetCourseId: string): Promise<MergePreview> {
    const { data, error } = await this.client.rpc('preview_course_merge', { p_source_course_id: sourceCourseId, p_target_course_id: targetCourseId })
    if (error) throw new Error(error.message)
    const preview = (data as MergePreview[] | null)?.[0]
    if (!preview) throw new Error('ไม่พบข้อมูลสำหรับรวมรายวิชา')
    return preview
  }

  async mergeCourse(sourceCourseId: string, targetCourseId: string): Promise<void> {
    const { error } = await this.client.rpc('merge_course', { p_source_course_id: sourceCourseId, p_target_course_id: targetCourseId })
    if (error) throw new Error(error.message)
  }

  async listAcademicPeriods(): Promise<AcademicPeriod[]> { const { data, error } = await this.client.rpc('list_academic_periods'); if (error) throw new Error(error.message); return (data ?? []) as AcademicPeriod[] }
  async createAcademicPeriod(year: number, semester: string): Promise<void> { const { error } = await this.client.rpc('create_academic_period', { p_academic_year: year, p_semester: semester.trim() }); if (error) throw new Error(error.message) }
  async createOffering(draft: OfferingDraft): Promise<void> { const { error } = await this.client.rpc('create_offering', { p_course_id: draft.courseId, p_academic_year: draft.academicYear, p_semester: draft.semester.trim(), p_section: draft.section.trim(), p_instructor_name: draft.instructorName.trim(), p_day: draft.day, p_starts: draft.startsAt, p_ends: draft.endsAt }); if (error) throw new Error(error.message) }
  async updateOffering(offeringId: string, draft: OfferingDraft): Promise<void> { const { error } = await this.client.rpc('update_offering', { p_offering_id: offeringId, p_academic_year: draft.academicYear, p_semester: draft.semester.trim(), p_section: draft.section.trim(), p_instructor_name: draft.instructorName.trim(), p_day: draft.day, p_starts: draft.startsAt, p_ends: draft.endsAt }); if (error) throw new Error(error.message) }
  async listOfferings(courseId: string): Promise<OfferingSummary[]> { const { data, error } = await this.client.rpc('list_approved_offerings', { p_course_id: courseId }); if (error) throw new Error(error.message); return (data ?? []) as OfferingSummary[] }
  async listPendingOfferingProposals(): Promise<PendingProposal[]> { const { data, error } = await this.client.rpc('list_pending_offering_proposals'); if (error) throw new Error(error.message); return (data ?? []) as PendingProposal[] }
  async resolveOfferingProposal(id: string, approve: boolean): Promise<void> { const { error } = await this.client.rpc('resolve_offering_proposal', { p_proposal_id: id, p_approve: approve }); if (error) throw new Error(error.message) }
  async listModerationReviews(state?: ModerationReview['moderation_state']): Promise<ModerationReview[]> { const { data, error } = await this.client.rpc('list_moderation_reviews', { p_state: state ?? null }); if (error) throw new Error(error.message); return (data ?? []) as ModerationReview[] }
  async listModerationAudit(reviewId: string): Promise<ModerationAuditEntry[]> { const { data, error } = await this.client.rpc('list_review_moderation_audit', { p_review_id: reviewId }); if (error) throw new Error(error.message); return ((data ?? []) as Array<{ id: string; prior_state: ModerationReview['moderation_state']; new_state: ModerationReview['moderation_state']; reason: string; actor_name: string; created_at: string }>).map((entry) => ({ id: entry.id, priorState: entry.prior_state, newState: entry.new_state, reason: entry.reason, actorName: entry.actor_name, createdAt: entry.created_at })) }
  async moderateReview(id: string, state: ModerationReview['moderation_state'], reason: string): Promise<void> { if (!reason.trim()) throw new Error('กรุณาระบุเหตุผล'); const { error } = await this.client.rpc('moderate_review', { p_review_id: id, p_state: state, p_reason: reason.trim() }); if (error) throw new Error(error.message) }
  async bulkImportOfferings(rows: BulkOfferingRow[]): Promise<BulkOfferingResult> { if (!rows.length) throw new Error('ต้องมีข้อมูลกลุ่มเรียนอย่างน้อยหนึ่งรายการ'); const { data, error } = await this.client.rpc('bulk_import_offerings', { p_rows: rows }); if (error) throw new Error(error.message); const result = (data as BulkOfferingResult[] | null)?.[0]; if (!result) throw new Error('ไม่พบผลการนำเข้า'); return result }
  async previewOfferingImport(rows: unknown[]): Promise<OfferingImportPreview[]> { const { data, error } = await this.client.rpc('preview_offering_import', { p_rows: rows }); if (error) throw new Error(error.message); return ((data ?? []) as Array<{ row_number: number; course_code: string; academic_year: number | null; semester: string; section: string; instructor_name: string | null; day_of_week: number | null; starts_at: string; ends_at: string; valid: boolean; action: OfferingImportPreview['action']; reason: string | null; offering_id: string | null }>).map((row) => ({ rowNumber: row.row_number, courseCode: row.course_code, academicYear: row.academic_year, semester: row.semester, section: row.section, instructorName: row.instructor_name, dayOfWeek: row.day_of_week, startsAt: row.starts_at, endsAt: row.ends_at, valid: row.valid, action: row.action, reason: row.reason, offeringId: row.offering_id })) }

  private async changeRole(name: string, userId: string): Promise<void> {
    const { error } = await this.client.rpc(name, { p_user_id: userId })
    if (error) throw new Error(error.message)
  }
}
