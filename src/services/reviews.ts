export type RpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>
}

export type VisibleReview = { id: string; rating: number; text: string; createdAt: string; section?: string; semester?: string; academicYear?: number; instructorName?: string | null; dayOfWeek?: number | null; startsAt?: string | null; endsAt?: string | null }
export type ReviewFilters = { rating?: number; semester?: string; academicYear?: number }
export type ReportedClass = { academicYear: number; semester: string; section: string; instructorName: string; dayOfWeek: number; startsAt: string; endsAt: string }
export type MyReview = { id: string; courseId: string; offeringId: string | null; rating: number; text: string; active: boolean; createdAt: string }
export type ReviewRevision = { id: string; rating: number; text: string; revisedAt: string }

export class ReviewService {
  constructor(private readonly client: RpcClient) {}

  async listVisible(courseId: string, filters: ReviewFilters = {}): Promise<VisibleReview[]> {
    const { data, error } = await this.client.rpc('list_visible_reviews', { p_course_id: courseId, p_rating: filters.rating ?? null, p_semester: filters.semester ?? null, p_academic_year: filters.academicYear ?? null })
    if (error) throw new Error(error.message)
    return ((data ?? []) as Array<{ id: string; rating: number; text: string; created_at: string; section?: string; semester?: string; academic_year?: number; instructor_name?: string | null; day_of_week?: number | null; starts_at?: string | null; ends_at?: string | null }>).map((review) => ({
      id: review.id, rating: review.rating, text: review.text, createdAt: review.created_at,
      ...(review.section === undefined ? {} : { section: review.section, semester: review.semester, academicYear: review.academic_year, instructorName: review.instructor_name, dayOfWeek: review.day_of_week, startsAt: review.starts_at, endsAt: review.ends_at }),
    }))
  }

  async create(courseId: string, details: ReportedClass, rating: number, text: string): Promise<void> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('เลือกระดับคะแนน 1 ถึง 5')
    if (!text.trim()) throw new Error('กรุณาเขียนรีวิว')
    if (!Number.isInteger(details.academicYear) || details.academicYear < 2400 || details.academicYear > 2700 || !['1', '2', 'ฤดูร้อน'].includes(details.semester)) throw new Error('กรุณาเลือกเทอมและปีการศึกษา')
    if (!details.section.trim() || !details.instructorName.trim()) throw new Error('กรุณากรอกกลุ่มเรียนและอาจารย์ผู้สอน')
    if (!Number.isInteger(details.dayOfWeek) || details.dayOfWeek < 1 || details.dayOfWeek > 7 || !/^\d{2}:\d{2}$/.test(details.startsAt) || !/^\d{2}:\d{2}$/.test(details.endsAt) || details.endsAt <= details.startsAt) throw new Error('กรุณาเลือกวันและเวลาเรียนที่ถูกต้อง')
    const { error } = await this.client.rpc('create_review', { p_course_id: courseId, p_academic_year: details.academicYear, p_semester: details.semester, p_section: details.section.trim(), p_instructor_name: details.instructorName.trim(), p_day: details.dayOfWeek, p_starts: details.startsAt, p_ends: details.endsAt, p_rating: rating, p_text: text.trim() })
    if (error) throw new Error(error.message)
  }

  async listMine(): Promise<MyReview[]> {
    const { data, error } = await this.client.rpc('list_my_reviews')
    if (error) throw new Error(error.message)
    return ((data ?? []) as Array<{ id: string; course_id: string; offering_id: string | null; rating: number; text: string; author_active: boolean; created_at: string }>).map((review) => ({ id: review.id, courseId: review.course_id, offeringId: review.offering_id, rating: review.rating, text: review.text, active: review.author_active, createdAt: review.created_at }))
  }

  async updateMine(id: string, rating: number, text: string): Promise<void> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('เลือกระดับคะแนน 1 ถึง 5')
    if (!text.trim()) throw new Error('กรุณาเขียนรีวิว')
    const { error } = await this.client.rpc('update_my_review', { p_review_id: id, p_rating: rating, p_text: text.trim() })
    if (error) throw new Error(error.message)
  }

  async setMineActive(id: string, active: boolean): Promise<void> {
    const { error } = await this.client.rpc('set_my_review_active', { p_review_id: id, p_active: active })
    if (error) throw new Error(error.message)
  }

  async listMyRevisions(reviewId: string): Promise<ReviewRevision[]> {
    const { data, error } = await this.client.rpc('list_my_review_revisions', { p_review_id: reviewId })
    if (error) throw new Error(error.message)
    return ((data ?? []) as Array<{ id: string; rating: number; text: string; revised_at: string }>).map((revision) => ({ id: revision.id, rating: revision.rating, text: revision.text, revisedAt: revision.revised_at }))
  }
}
