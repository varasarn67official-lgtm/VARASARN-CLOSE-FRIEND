import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgSchema, text, time, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const appPrivate = pgSchema('app_private')

export const categories = appPrivate.table('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const courses = appPrivate.table('courses', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  nameTh: text('name_th').notNull(),
  categoryName: text('category_name').notNull(),
  categoryId: uuid('category_id').references(() => categories.id),
  status: text('status').notNull().default('approved'),
}, (table) => [
  check('courses_status_check', sql`${table.status} in ('approved', 'archived')`),
])

export const offerings = appPrivate.table('offerings', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseId: uuid('course_id').notNull().references(() => courses.id),
  academicYear: integer('academic_year').notNull(),
  semester: text('semester').notNull(),
  section: text('section').notNull(),
  instructorName: text('instructor_name'),
  status: text('status').notNull().default('approved'),
}, (table) => [
  check('offerings_status_check', sql`${table.status} in ('approved', 'pending', 'rejected')`),
  unique('offerings_course_period_section_unique').on(table.courseId, table.academicYear, table.semester, table.section),
])

export const reviews = appPrivate.table('reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  authorUserId: text('author_user_id'),
  courseId: uuid('course_id').notNull().references(() => courses.id),
  offeringId: uuid('offering_id').references(() => offerings.id),
  academicYear: integer('academic_year').notNull(),
  semester: text('semester').notNull(),
  section: text('section').notNull(),
  instructorName: text('instructor_name'),
  dayOfWeek: integer('day_of_week'),
  startsAt: time('starts_at'),
  endsAt: time('ends_at'),
  rating: integer('rating').notNull(),
  text: text('text').notNull(),
  authorActive: boolean('author_active').notNull().default(true),
  moderationVisible: boolean('moderation_visible').notNull().default(true),
  isLegacy: boolean('is_legacy').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('reviews_rating_check', sql`${table.rating} between 1 and 5`),
  check('reviews_text_check', sql`length(btrim(${table.text})) > 0`),
  check('reviews_reported_year_check', sql`${table.academicYear} between 2400 and 2700`),
  check('reviews_reported_semester_check', sql`${table.semester} in ('1', '2', 'ฤดูร้อน')`),
  check('reviews_reported_section_check', sql`length(btrim(${table.section})) > 0`),
  check('reviews_reported_time_check', sql`(${table.dayOfWeek} is null and ${table.startsAt} is null and ${table.endsAt} is null) or (${table.dayOfWeek} between 1 and 7 and ${table.startsAt} is not null and ${table.endsAt} > ${table.startsAt})`),
  unique('reviews_author_offering_unique').on(table.authorUserId, table.offeringId),
  uniqueIndex('reviews_author_course_class_unique').on(table.authorUserId, table.courseId, table.academicYear, table.semester, sql`lower(regexp_replace(btrim(${table.section}), '[[:space:]]+', '', 'g'))`).where(sql`${table.authorUserId} is not null`),
])

export const roleMemberships = appPrivate.table('role_memberships', {
  userId: uuid('user_id').primaryKey(),
  role: text('role').notNull(),
  grantedBy: uuid('granted_by'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('role_memberships_role_check', sql`${table.role} in ('owner', 'administrator')`),
])

export const roleAudit = appPrivate.table('role_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorUserId: uuid('actor_user_id').notNull(),
  targetUserId: uuid('target_user_id').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('role_audit_action_check', sql`${table.action} in ('bootstrap_owner', 'grant_administrator', 'revoke_administrator')`),
])

export const timetableLegacyEntries = appPrivate.table('timetable_legacy_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  entryHash: text('entry_hash').notNull(),
  courseCode: text('course_code').notNull(),
  courseName: text('course_name').notNull().default(''),
  section: text('section').notNull(),
  instructorName: text('instructor_name'),
  dayOfWeek: integer('day_of_week').notNull(),
  startsAt: time('starts_at').notNull(),
  endsAt: time('ends_at').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('timetable_legacy_day_check', sql`${table.dayOfWeek} between 1 and 7`),
  check('timetable_legacy_time_check', sql`${table.endsAt} > ${table.startsAt}`),
  unique('timetable_legacy_user_entry_unique').on(table.userId, table.entryHash),
])

export const legacyTimetableMigrationReceipts = appPrivate.table('legacy_timetable_migration_receipts', {
  userId: uuid('user_id').notNull(),
  migrationVersion: integer('migration_version').notNull(),
  entryHash: text('entry_hash').notNull(),
  outcome: text('outcome').notNull(),
  offeringId: uuid('offering_id').references(() => offerings.id, { onDelete: 'set null' }),
  legacyEntryId: uuid('legacy_entry_id').references(() => timetableLegacyEntries.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('legacy_timetable_receipt_version_check', sql`${table.migrationVersion} > 0`),
  check('legacy_timetable_receipt_outcome_check', sql`${table.outcome} in ('added-official', 'added-legacy', 'already-present', 'invalid', 'conflict')`),
  unique('legacy_timetable_receipt_user_version_entry_unique').on(table.userId, table.migrationVersion, table.entryHash),
])
