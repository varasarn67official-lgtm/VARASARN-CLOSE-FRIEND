import { describe, expect, it } from 'vitest'
import { isWriteFunction } from '../scripts/api-write-classification.mjs'

// Pinned against the deployed api schema (verified read-only by reading every function body, not assumed)
// so a future migration that adds a function under a new name is caught by a failing test, not a silent
// freeze/unfreeze gap.
const READ_FUNCTIONS = [
  'list_academic_periods', 'list_approved_catalog', 'list_approved_offerings', 'current_access',
  'list_verified_accounts', 'list_role_assignments', 'list_categories', 'list_manageable_courses',
  'list_my_offering_proposals', 'list_my_timetable', 'list_my_reported_timetable', 'list_my_legacy_timetable', 'list_pending_offering_proposals',
  'list_approved_offering_meetings', 'preview_offering_import', 'list_my_reviews', 'preview_course_merge',
  'list_my_review_revisions', 'list_visible_reviews', 'list_moderation_reviews', 'list_review_moderation_audit',
]
const WRITE_FUNCTIONS = [
  'add_my_timetable_offering', 'add_my_timetable_review', 'archive_course', 'bulk_import_offerings', 'clear_my_timetable',
  'create_academic_period', 'create_category', 'create_course', 'create_offering', 'create_offering_proposal',
  'create_review', 'grant_administrator', 'import_legacy_reviews', 'migrate_legacy_timetable_entry', 'remove_my_legacy_timetable_entry', 'merge_course', 'moderate_review',
  'remove_my_timetable_offering', 'remove_my_timetable_review', 'replace_my_timetable_offering', 'resolve_offering_proposal',
  'revoke_administrator', 'set_my_review_active', 'update_category', 'update_course', 'update_my_review',
  'update_offering',
]

describe('api write classification', () => {
  it('matches every currently deployed read-only function', () => {
    for (const name of READ_FUNCTIONS) expect(isWriteFunction(name)).toBe(false)
  })

  it('matches every currently deployed write function', () => {
    for (const name of WRITE_FUNCTIONS) expect(isWriteFunction(name)).toBe(true)
  })

  it('classifies exactly the 45 known functions with no overlap or gap', () => {
    expect(READ_FUNCTIONS.length + WRITE_FUNCTIONS.length).toBe(48)
    expect(new Set([...READ_FUNCTIONS, ...WRITE_FUNCTIONS]).size).toBe(48)
  })
})
