import type { RpcClient } from './reviews'

export type TimetableEntry = {
  offering_id: string | null
  review_id: string | null
  legacy_entry_id?: string | null
  source: 'official' | 'reported' | 'legacy'
  course_code: string
  course_name: string
  section: string
  day_of_week: number
  starts_at: string
  ends_at: string
  instructor_name: string | null
}

export class TimetableService {
  constructor(private readonly client: RpcClient) {}
  async list() {
    const [official, reported, legacy] = await Promise.all([this.client.rpc('list_my_timetable'), this.client.rpc('list_my_reported_timetable'), this.client.rpc('list_my_legacy_timetable')])
    if (official.error) throw new Error(official.error.message)
    if (reported.error) throw new Error(reported.error.message)
    if (legacy.error) throw new Error(legacy.error.message)
    return [...((official.data ?? []) as TimetableEntry[]).map((entry) => ({ ...entry, source: 'official' as const, review_id: null })),
      ...((reported.data ?? []) as TimetableEntry[]).map((entry) => ({ ...entry, source: 'reported' as const, offering_id: null })),
      ...((legacy.data ?? []) as Array<Omit<TimetableEntry, 'source' | 'offering_id' | 'review_id'> & { legacy_entry_id: string }>).map((entry) => ({ ...entry, source: 'legacy' as const, offering_id: null, review_id: null }))]
  }
  async add(offeringId: string) { const { error } = await this.client.rpc('add_my_timetable_offering', { p_offering_id: offeringId }); if (error) throw new Error(error.message) }
  async remove(offeringId: string) { const { error } = await this.client.rpc('remove_my_timetable_offering', { p_offering_id: offeringId }); if (error) throw new Error(error.message) }
  async clear() { const { error } = await this.client.rpc('clear_my_timetable'); if (error) throw new Error(error.message) }
  async replace(offeringId: string) { const { error } = await this.client.rpc('replace_my_timetable_offering', { p_offering_id: offeringId }); if (error) throw new Error(error.message) }
  async addReview(reviewId: string) { const { error } = await this.client.rpc('add_my_timetable_review', { p_review_id: reviewId }); if (error) throw new Error(error.message) }
  async removeLegacy(legacyEntryId: string) { const { error } = await this.client.rpc('remove_my_legacy_timetable_entry', { p_legacy_entry_id: legacyEntryId }); if (error) throw new Error(error.message) }
  async removeReview(reviewId: string) { const { error } = await this.client.rpc('remove_my_timetable_review', { p_review_id: reviewId }); if (error) throw new Error(error.message) }
}
