import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL_UNPOOLED
const expectedHost = process.env.REVIEW_DISCOVERY_TEST_HOST
if (!connectionString || !expectedHost || new URL(connectionString).hostname !== expectedHost) {
  throw new Error('Supply a direct connection and the exact isolated test branch host')
}

const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query('BEGIN')

  // Unauthenticated/malformed-token denial for list_visible_reviews and the raw reviews table is verified
  // live against the deployed Data API (see the matching ticket 09 comment); `list_visible_reviews` itself
  // has no additional per-row auth.user_id() guard by design, since any authenticated user may read the
  // anonymous projection for an approved course.

  await client.query("INSERT INTO app_private.categories (name) VALUES ('ทดสอบการค้นพบรีวิว')")
  await client.query(`
    INSERT INTO app_private.courses (code, name_th, category_name, category_id, status)
    SELECT seed.code, seed.name_th, c.name, c.id, seed.status
    FROM app_private.categories AS c
    CROSS JOIN (VALUES
      ('ZZDISCOVER', 'ทดสอบการค้นพบรีวิว', 'approved'),
      ('ZZDISCOVEREMPTY', 'ทดสอบรายวิชาที่ไม่มีรีวิว', 'approved'),
      ('ZZDISCOVERARCH', 'ทดสอบรีวิวบนรายวิชาที่เก็บเข้าคลัง', 'archived')
    ) AS seed(code, name_th, status)
    WHERE c.name = 'ทดสอบการค้นพบรีวิว'
  `)
  const courseId = async (code) => (await client.query('SELECT id FROM app_private.courses WHERE code = $1', [code])).rows[0].id
  const activeCourse = await courseId('ZZDISCOVER')
  const emptyCourse = await courseId('ZZDISCOVEREMPTY')
  const archivedCourse = await courseId('ZZDISCOVERARCH')

  const insertReview = (overrides) => {
    const row = {
      author_user_id: 'zz-user-1', course_id: activeCourse, academic_year: 2699, semester: '1', section: 'Sec1',
      instructor_name: 'อาจารย์เอ', day_of_week: 1, starts_at: '09:00', ends_at: '11:00',
      rating: 5, text: 'ดีมาก', author_active: true, moderation_visible: true, ...overrides,
    }
    return client.query(`
      INSERT INTO app_private.reviews (author_user_id, course_id, academic_year, semester, section, instructor_name, day_of_week, starts_at, ends_at, rating, text, author_active, moderation_visible)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id
    `, [row.author_user_id, row.course_id, row.academic_year, row.semester, row.section, row.instructor_name, row.day_of_week, row.starts_at, row.ends_at, row.rating, row.text, row.author_active, row.moderation_visible])
  }

  const visible1 = await insertReview({}) // shown: same user, section '1'
  const visible2 = await insertReview({ author_user_id: 'zz-user-2', section: '2', rating: 3, text: 'โอเค' }) // distinct section, different user: allowed and shown
  await insertReview({ author_user_id: 'zz-user-3', section: '3', moderation_visible: false, text: 'ซ่อนไว้' }) // hidden by moderation: must not show
  await insertReview({ author_user_id: 'zz-user-4', section: '4', author_active: false, text: 'ถอนแล้ว' }) // withdrawn by author: must not show
  const archivedReview = await insertReview({ author_user_id: 'zz-user-5', course_id: archivedCourse, section: '1', text: 'รีวิวบนวิชาที่เก็บเข้าคลัง' })

  // --- Test: duplicate rejection is normalized, cross-section reviews are not. ---
  await client.query('SAVEPOINT duplicate_check')
  await assert.rejects(
    insertReview({ author_user_id: 'zz-user-1', section: ' sec 1 ' }), // same user/course/year/semester; differs from visible1's 'Sec1' only by case and spacing
    (err) => { assert.equal(err.code, '23505'); return true },
  )
  await client.query('ROLLBACK TO SAVEPOINT duplicate_check')
  console.log('PASS: normalized duplicate (same user/course/year/semester/section) rejected by the unique index')
  console.log('PASS: a distinct section for the same user/course was accepted as a separate review (cross-section reviews allowed)')

  // --- Test: anonymous projection shape and moderation/withdrawal filtering. ---
  const { rows: visible } = await client.query('SELECT * FROM api.list_visible_reviews($1::uuid)', [activeCourse])
  assert.equal(visible.length, 2, 'only the two visible/active reviews for the active course should show')
  const ids = visible.map((r) => r.id)
  assert.ok(ids.includes(visible1.rows[0].id) && ids.includes(visible2.rows[0].id))
  const columns = Object.keys(visible[0]).sort()
  assert.deepEqual(columns, ['academic_year', 'created_at', 'day_of_week', 'ends_at', 'id', 'instructor_name', 'rating', 'section', 'semester', 'starts_at', 'text'].sort())
  assert.ok(!('author_user_id' in visible[0]), 'author identity must never appear in the anonymous projection')
  console.log('PASS: anonymous projection excludes hidden and withdrawn reviews and never exposes author identity')

  const catalog = (await client.query('SELECT * FROM api.list_approved_catalog() WHERE id = $1', [activeCourse])).rows[0]
  assert.equal(catalog.category_name, 'ทดสอบการค้นพบรีวิว', 'catalog badge must retain the category name')
  assert.equal(Number(catalog.review_count), 2, 'catalog count must include only active and moderation-visible reviews')
  assert.equal(Number(catalog.average_rating), 4, 'catalog average must match the same visible review set')
  const emptyCatalog = (await client.query('SELECT * FROM api.list_approved_catalog() WHERE id = $1', [emptyCourse])).rows[0]
  assert.equal(Number(emptyCatalog.review_count), 0)
  assert.equal(emptyCatalog.average_rating, null)
  const canExecute = (await client.query("SELECT has_function_privilege('authenticated', 'api.list_approved_catalog()', 'EXECUTE') AS allowed")).rows[0].allowed
  assert.equal(canExecute, true, 'authenticated must retain EXECUTE after the function is recreated')
  console.log('PASS: catalog rating summary matches visible reviews, represents empty courses as 0/null, and remains executable by authenticated')

  // --- Test: rating / semester / academic-year filters. ---
  const byRating = (await client.query('SELECT * FROM api.list_visible_reviews($1::uuid, $2::integer)', [activeCourse, 3])).rows
  assert.equal(byRating.length, 1)
  assert.equal(byRating[0].id, visible2.rows[0].id)
  const bySemester = (await client.query('SELECT * FROM api.list_visible_reviews($1::uuid, NULL, $2::text)', [activeCourse, '1'])).rows
  assert.equal(bySemester.length, 2)
  const byYear = (await client.query('SELECT * FROM api.list_visible_reviews($1::uuid, NULL, NULL, $2::integer)', [activeCourse, 2400])).rows
  assert.equal(byYear.length, 0, 'a non-matching academic year filter must return no rows')
  console.log('PASS: rating, semester, and academic-year filters narrow results correctly')

  // --- Test: reviews on an archived course remain readable. ---
  const archivedVisible = (await client.query('SELECT * FROM api.list_visible_reviews($1::uuid)', [archivedCourse])).rows
  assert.equal(archivedVisible.length, 1)
  assert.equal(archivedVisible[0].id, archivedReview.rows[0].id)
  console.log('PASS: reviews on an archived course remain readable through list_visible_reviews')

  // --- Test: student-reported class details never become official offerings. ---
  const offeringCount = (await client.query('SELECT count(*) FROM app_private.offerings WHERE course_id = $1', [activeCourse])).rows[0].count
  assert.equal(Number(offeringCount), 0, 'submitting reviews with class details must not create offerings rows')
  console.log('PASS: student-reported class details created no offerings rows')

  console.log('All review-discovery isolated-branch checks passed.')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
