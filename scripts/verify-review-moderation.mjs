import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL_UNPOOLED
const expectedHost = process.env.REVIEW_MODERATION_TEST_HOST
if (!connectionString || !expectedHost || new URL(connectionString).hostname !== expectedHost) {
  throw new Error('Supply a direct connection and the exact isolated test branch host')
}

const moderationFunctions = ['list_moderation_reviews', 'moderate_review', 'list_review_moderation_audit']
const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query('BEGIN')

  // --- Denied without an administrator identity. ---
  for (const call of [
    'SELECT * FROM api.list_moderation_reviews(NULL)',
    "SELECT api.moderate_review('00000000-0000-0000-0000-000000000000'::uuid, 'hidden', 'x')",
    "SELECT * FROM api.list_review_moderation_audit('00000000-0000-0000-0000-000000000000'::uuid)",
  ]) {
    await client.query('SAVEPOINT denied')
    await assert.rejects(client.query(call), /administrator access required/)
    await client.query('ROLLBACK TO SAVEPOINT denied')
  }
  console.log('PASS: all three moderation RPCs are denied without an administrator identity')

  // --- Grants: authenticated only, never PUBLIC. ---
  for (const name of moderationFunctions) {
    const grantees = (await client.query(
      "SELECT grantee FROM information_schema.routine_privileges WHERE routine_schema = 'api' AND routine_name = $1", [name],
    )).rows.map((r) => r.grantee)
    assert.ok(grantees.includes('authenticated'), `${name} must be granted to authenticated`)
    assert.ok(!grantees.includes('PUBLIC'), `${name} must not be granted to PUBLIC`)
  }
  console.log('PASS: moderation RPCs are granted to authenticated and not PUBLIC')

  // --- Append-only audit: unreachable directly, and no function ever rewrites or deletes it. ---
  const tableGrants = (await client.query(`
    SELECT grantee, privilege_type FROM information_schema.table_privileges
    WHERE table_schema = 'app_private' AND table_name = 'review_moderation_audit' AND grantee IN ('PUBLIC', 'authenticated', 'anonymous')
  `)).rows
  assert.deepEqual(tableGrants, [], 'no client role may touch the audit table directly')
  const schemaUsage = (await client.query("SELECT has_schema_privilege('authenticated', 'app_private', 'USAGE') AS usage")).rows[0].usage
  assert.equal(schemaUsage, false, 'authenticated must not have USAGE on app_private')
  const rewriters = (await client.query(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('api', 'app_private') AND p.prosrc ~* '(update|delete\\s+from)\\s+(app_private\\.)?review_moderation_audit'
  `)).rows
  assert.deepEqual(rewriters, [], 'no function may update or delete audit rows')
  console.log('PASS: review_moderation_audit is append-only and unreachable except through the RPCs')

  // --- No ordinary-dashboard hard delete, and no administrator timetable read. ---
  const hardDeletes = (await client.query(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'api' AND p.prosrc ~* 'delete\\s+from\\s+(app_private\\.)?reviews\\M'
  `)).rows
  assert.deepEqual(hardDeletes, [], 'no api function may permanently erase a review')
  const timetableReaders = (await client.query(`
    SELECT p.proname, p.prosrc ~ 'auth\\.user_id\\(\\)' AS self_scoped FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'api' AND p.prosrc ~* 'timetable_selections'
  `)).rows
  assert.ok(timetableReaders.length > 0)
  for (const f of timetableReaders) assert.ok(f.self_scoped, `${f.proname} must be scoped to the caller's own timetable`)
  console.log(`PASS: no api function hard-deletes reviews; all ${timetableReaders.length} timetable functions are self-scoped`)

  // Bypass identity for the rest, as the other isolated-branch scripts do.
  await client.query(`
    CREATE OR REPLACE FUNCTION app_private.require_administrator()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp
    AS $$ BEGIN RETURN; END $$
  `)
  await client.query('ALTER TABLE app_private.review_moderation_audit ALTER COLUMN actor_user_id DROP NOT NULL')

  await client.query("INSERT INTO app_private.categories (name) VALUES ('ทดสอบการตรวจสอบรีวิว')")
  await client.query(`
    INSERT INTO app_private.courses (code, name_th, category_name, category_id, status)
    SELECT 'ZZMODERATE', 'ทดสอบการตรวจสอบรีวิว', c.name, c.id, 'approved' FROM app_private.categories c WHERE c.name = 'ทดสอบการตรวจสอบรีวิว'
  `)
  const courseId = (await client.query("SELECT id FROM app_private.courses WHERE code = 'ZZMODERATE'")).rows[0].id
  const insertReview = async (author, section, authorActive) => (await client.query(`
    INSERT INTO app_private.reviews (author_user_id, course_id, academic_year, semester, section, rating, text, author_active)
    VALUES ($1, $2, 2699, '1', $3, 2, 'ข้อความเดิมของผู้เขียน', $4) RETURNING id
  `, [author, courseId, section, authorActive])).rows[0].id
  const active = await insertReview('zz-mod-author-1', '1', true)
  const withdrawn = await insertReview('zz-mod-author-2', '2', false)
  const visibleIds = async () => (await client.query('SELECT id FROM api.list_visible_reviews($1::uuid)', [courseId])).rows.map((r) => r.id)
  const stateOf = async (id) => (await client.query('SELECT rating, text, author_active, moderation_state, moderation_visible FROM app_private.reviews WHERE id = $1', [id])).rows[0]

  // --- The moderation list now loads, and exposes no author identity. ---
  const listed = (await client.query('SELECT * FROM api.list_moderation_reviews(NULL)')).rows.filter((r) => [active, withdrawn].includes(r.id))
  assert.equal(listed.length, 2)
  assert.deepEqual(Object.keys(listed[0]).sort(), ['author_active', 'created_at', 'id', 'moderation_state', 'rating', 'text'])
  assert.equal(listed.find((r) => r.id === withdrawn).author_active, false, 'author-withdrawn state is inspectable')
  const hiddenOnly = (await client.query("SELECT id FROM api.list_moderation_reviews('hidden')")).rows.map((r) => r.id)
  assert.ok(!hiddenOnly.includes(active))
  console.log('PASS: list_moderation_reviews loads (no ambiguity error), filters by state, and shows withdrawal without author identity')

  // --- Reason and state validation. ---
  for (const [state, reason] of [['hidden', '   '], ['deleted', 'เหตุผล']]) {
    await client.query('SAVEPOINT invalid')
    await assert.rejects(client.query('SELECT api.moderate_review($1::uuid, $2, $3)', [active, state, reason]), /state and reason required/)
    await client.query('ROLLBACK TO SAVEPOINT invalid')
  }
  console.log('PASS: a blank reason and an unknown state are both rejected')

  // --- Transitions: visible -> hidden -> removed -> visible. ---
  assert.ok((await visibleIds()).includes(active))
  await client.query('SELECT api.moderate_review($1::uuid, $2, $3)', [active, 'hidden', '  ซ่อนชั่วคราว  '])
  assert.ok(!(await visibleIds()).includes(active), 'hidden reviews leave shared reads')
  await client.query('SELECT api.moderate_review($1::uuid, $2, $3)', [active, 'removed', 'ละเมิดกติกา'])
  assert.ok(!(await visibleIds()).includes(active), 'removed reviews leave shared reads')
  await client.query('SELECT api.moderate_review($1::uuid, $2, $3)', [active, 'visible', 'ตรวจสอบแล้ว คืนสถานะ'])
  assert.ok((await visibleIds()).includes(active), 'restored reviews return to shared reads')
  const afterTransitions = await stateOf(active)
  assert.equal(afterTransitions.rating, 2)
  assert.equal(afterTransitions.text, 'ข้อความเดิมของผู้เขียน', 'moderation never changes rating or text')
  // Each moderation is its own request in production, but this script is one transaction where now() is
  // constant; spread the three rows' times by transition so ordering can be checked meaningfully.
  await client.query(`
    UPDATE app_private.review_moderation_audit SET created_at = created_at + CASE new_state WHEN 'hidden' THEN interval '1 minute' WHEN 'removed' THEN interval '2 minutes' ELSE interval '3 minutes' END
    WHERE review_id = $1
  `, [active])
  const trail = (await client.query(
    'SELECT prior_state, new_state, reason, created_at FROM app_private.review_moderation_audit WHERE review_id = $1 ORDER BY created_at', [active],
  )).rows
  assert.deepEqual(trail.map((r) => [r.prior_state, r.new_state, r.reason]), [
    ['visible', 'hidden', 'ซ่อนชั่วคราว'],
    ['hidden', 'removed', 'ละเมิดกติกา'],
    ['removed', 'visible', 'ตรวจสอบแล้ว คืนสถานะ'],
  ])
  assert.ok(trail.every((r) => r.created_at instanceof Date))
  console.log('PASS: visible -> hidden -> removed -> visible each leave/return to shared reads, keep rating and text, and append one audit row with prior/new state, trimmed reason, and time')

  // --- Restoring a withdrawn review does not publish it. ---
  await client.query('SELECT api.moderate_review($1::uuid, $2, $3)', [withdrawn, 'hidden', 'ตรวจสอบ'])
  await client.query('SELECT api.moderate_review($1::uuid, $2, $3)', [withdrawn, 'visible', 'คืนสถานะ'])
  const withdrawnState = await stateOf(withdrawn)
  assert.equal(withdrawnState.author_active, false, 'moderation never changes the author\'s withdrawal')
  assert.equal(withdrawnState.moderation_visible, true)
  assert.ok(!(await visibleIds()).includes(withdrawn), 'a restored but withdrawn review stays out of shared reads')
  console.log('PASS: restoring a withdrawn review leaves it hidden until its author republishes')

  // --- The audit read names the acting administrator, never the review author. ---
  const { rows: [admin] } = await client.query(`
    INSERT INTO neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'ผู้ดูแลทดสอบ', 'zz-moderation-admin@example.invalid', true, now(), now()) RETURNING id
  `)
  await client.query("UPDATE app_private.review_moderation_audit SET actor_user_id = $1 WHERE review_id = $2", [admin.id, active])
  const audit = (await client.query('SELECT * FROM api.list_review_moderation_audit($1::uuid)', [active])).rows
  assert.equal(audit.length, 3)
  assert.deepEqual(Object.keys(audit[0]).sort(), ['actor_name', 'created_at', 'id', 'new_state', 'prior_state', 'reason'])
  assert.ok(audit.every((r) => r.actor_name === 'ผู้ดูแลทดสอบ'))
  assert.ok(!JSON.stringify(audit).includes('zz-mod-author-1'), 'the review author must never appear in the audit read')
  assert.ok(!JSON.stringify(audit).includes('zz-moderation-admin@example.invalid'), 'the actor is named, not emailed')
  assert.equal(audit[0].new_state, 'visible', 'newest first')
  console.log('PASS: list_review_moderation_audit returns the full trail newest-first, naming the administrator but never the author or an email')

  console.log('All review-moderation isolated-branch checks passed.')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
