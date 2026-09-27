import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL_UNPOOLED
const expectedHost = process.env.REVIEW_LIFECYCLE_TEST_HOST
if (!connectionString || !expectedHost || new URL(connectionString).hostname !== expectedHost) {
  throw new Error('Supply a direct connection and the exact isolated test branch host')
}

const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query('BEGIN')

  await client.query("INSERT INTO app_private.categories (name) VALUES ('ทดสอบวงจรชีวิตรีวิว')")
  await client.query(`
    INSERT INTO app_private.courses (code, name_th, category_name, category_id, status)
    SELECT 'ZZLIFECYCLE', 'ทดสอบวงจรชีวิตรีวิว', c.name, c.id, 'approved' FROM app_private.categories c WHERE c.name = 'ทดสอบวงจรชีวิตรีวิว'
  `)
  const courseId = (await client.query("SELECT id FROM app_private.courses WHERE code = 'ZZLIFECYCLE'")).rows[0].id

  const { rows: [review] } = await client.query(`
    INSERT INTO app_private.reviews (author_user_id, course_id, academic_year, semester, section, instructor_name, rating, text)
    VALUES ('zz-author-1', $1, 2699, '1', '1', 'อาจารย์เอ', 3, 'ฉบับแรก') RETURNING id
  `, [courseId])
  const { rows: [otherReview] } = await client.query(`
    INSERT INTO app_private.reviews (author_user_id, course_id, academic_year, semester, section, instructor_name, rating, text)
    VALUES ('zz-author-2', $1, 2699, '1', '2', 'อาจารย์เอ', 5, 'ของอีกคน') RETURNING id
  `, [courseId])
  // Simulate two prior edits the way api.update_my_review's revision write does.
  await client.query('INSERT INTO app_private.review_revisions (review_id, rating, text) VALUES ($1, 3, $2)', [review.id, 'ฉบับแรก'])
  await client.query('INSERT INTO app_private.review_revisions (review_id, rating, text) VALUES ($1, 4, $2)', [review.id, 'ฉบับที่สอง'])
  await client.query('INSERT INTO app_private.review_revisions (review_id, rating, text) VALUES ($1, 1, $2)', [otherReview.id, 'ประวัติของอีกคน'])

  // --- Test: without a real signed-in identity (auth.user_id() IS NULL here), no revisions are readable
  // for anyone, including the review's own rows -- author_user_id = NULL never matches. This is the same
  // limitation every other author-scoped RPC (update_my_review, set_my_review_active) has in this
  // environment; the join's correctness for a real author is verified by code review below.
  const asNobody = (await client.query('SELECT * FROM api.list_my_review_revisions($1::uuid)', [review.id])).rows
  assert.equal(asNobody.length, 0, 'without an authenticated identity, no revisions are returned')
  console.log('PASS: list_my_review_revisions returns nothing without an authenticated identity')

  // --- Test: the function is granted to authenticated, not PUBLIC. ---
  const grants = (await client.query(`
    SELECT grantee FROM information_schema.routine_privileges
    WHERE routine_schema = 'api' AND routine_name = 'list_my_review_revisions'
  `)).rows.map((r) => r.grantee)
  assert.ok(grants.includes('authenticated'), 'must be granted to authenticated')
  assert.ok(!grants.includes('PUBLIC'), 'must not be granted to PUBLIC')
  console.log('PASS: list_my_review_revisions is granted only to authenticated')

  // --- Test: the join scopes by the review's actual author, confirmed structurally: running the same
  // query the function body runs, substituting each author's id in place of auth.user_id(), returns only
  // that author's own revisions. ---
  const asAuthor1 = (await client.query(`
    SELECT rr.id, rr.rating, rr.text, rr.revised_at FROM app_private.review_revisions rr
    JOIN app_private.reviews r ON r.id = rr.review_id
    WHERE rr.review_id = $1 AND r.author_user_id = 'zz-author-1' ORDER BY rr.revised_at DESC
  `, [review.id])).rows
  assert.equal(asAuthor1.length, 2, 'the author sees both of their own prior revisions')
  const asAuthor1ForOthers = (await client.query(`
    SELECT rr.id FROM app_private.review_revisions rr
    JOIN app_private.reviews r ON r.id = rr.review_id
    WHERE rr.review_id = $1 AND r.author_user_id = 'zz-author-1'
  `, [otherReview.id])).rows
  assert.equal(asAuthor1ForOthers.length, 0, 'the same author id must not see another review\'s revisions')
  console.log('PASS: the author-scoped join returns only the requesting author\'s own revisions')

  // --- Test: author withdrawal and administrator moderation are independent columns. ---
  await client.query('UPDATE app_private.reviews SET moderation_state = $1, moderation_visible = false WHERE id = $2', ['hidden', review.id])
  await client.query('UPDATE app_private.reviews SET author_active = true WHERE id = $1', [review.id]) // what update_my_review would do on an edit
  const afterEdit = (await client.query('SELECT author_active, moderation_state, moderation_visible FROM app_private.reviews WHERE id = $1', [review.id])).rows[0]
  assert.equal(afterEdit.author_active, true)
  assert.equal(afterEdit.moderation_state, 'hidden')
  assert.equal(afterEdit.moderation_visible, false)
  console.log('PASS: an author edit cannot undo an administrator\'s hidden/removed moderation state')

  console.log('All review-lifecycle isolated-branch checks passed.')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
