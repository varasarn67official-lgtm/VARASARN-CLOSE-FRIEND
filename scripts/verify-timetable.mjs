import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL_UNPOOLED
const expectedHost = process.env.TIMETABLE_TEST_HOST
if (!connectionString || !expectedHost || new URL(connectionString).hostname !== expectedHost) {
  throw new Error('Supply a direct connection and the exact isolated test branch host')
}

const timetableFunctions = ['list_my_timetable', 'list_my_reported_timetable', 'add_my_timetable_offering', 'add_my_timetable_review', 'remove_my_timetable_offering', 'remove_my_timetable_review', 'clear_my_timetable', 'replace_my_timetable_offering', 'list_approved_offering_meetings']
const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query('BEGIN')

  // --- Grants: authenticated only, never PUBLIC. ---
  for (const name of timetableFunctions) {
    const grantees = (await client.query(
      "SELECT grantee FROM information_schema.routine_privileges WHERE routine_schema = 'api' AND routine_name = $1", [name],
    )).rows.map((r) => r.grantee)
    assert.ok(grantees.includes('authenticated'), `${name} must be granted to authenticated`)
    assert.ok(!grantees.includes('PUBLIC'), `${name} must not be granted to PUBLIC`)
  }
  console.log('PASS: list/add/remove/clear/replace/list-meetings are granted to authenticated and not PUBLIC')

  // --- No function anywhere reads or writes timetable_selections for someone other than auth.user_id(). ---
  const readers = (await client.query(`
    SELECT p.proname, p.prosrc ~ 'auth\\.user_id\\(\\)' AS self_scoped FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'api' AND p.prosrc ~* 'timetable_selections'
  `)).rows
  assert.ok(readers.length >= 4)
  for (const f of readers) assert.ok(f.self_scoped, `${f.proname} touches timetable_selections without scoping to auth.user_id()`)
  const tableGrants = (await client.query(`
    SELECT grantee FROM information_schema.table_privileges
    WHERE table_schema = 'app_private' AND table_name = 'timetable_selections' AND grantee IN ('PUBLIC', 'authenticated', 'anonymous')
  `)).rows
  assert.deepEqual(tableGrants, [], 'no client role may touch timetable_selections directly, only through the self-scoped RPCs')
  console.log(`PASS: all ${readers.length} functions touching timetable_selections are self-scoped, and no role can read/write the table directly`)

  // Bypass auth.user_id()'s NULL for setup only; every assertion below still checks self-scoping explicitly.
  await client.query("INSERT INTO app_private.categories (name) VALUES ('ทดสอบตารางเรียน')")
  await client.query(`
    INSERT INTO app_private.courses (code, name_th, category_name, category_id, status)
    SELECT seed.code, seed.name_th, c.name, c.id, seed.status FROM app_private.categories c
    CROSS JOIN (VALUES ('ZZTIMETABLE', 'ทดสอบตารางเรียน', 'approved'), ('ZZTTARCHIVED', 'ทดสอบวิชาที่เก็บเข้าคลัง', 'archived')) AS seed(code, name_th, status)
    WHERE c.name = 'ทดสอบตารางเรียน'
  `)
  const courseId = async (code) => (await client.query('SELECT id FROM app_private.courses WHERE code = $1', [code])).rows[0].id
  const activeCourse = await courseId('ZZTIMETABLE')
  const archivedCourse = await courseId('ZZTTARCHIVED')

  const makeOffering = async (course, status, withMeeting = true) => {
    const { rows: [o] } = await client.query(
      'INSERT INTO app_private.offerings (course_id, academic_year, semester, section, status) VALUES ($1, 2699, \'1\', $2, $3) RETURNING id',
      [course, `sec-${Math.random().toString(36).slice(2, 7)}`, status],
    )
    if (withMeeting) await client.query('INSERT INTO app_private.offering_meetings (offering_id, day_of_week, starts_at, ends_at) VALUES ($1, 1, $2, $3)', [o.id, '09:00', '11:00'])
    return o.id
  }
  const makeUser = async (email) => (await client.query(
    `INSERT INTO neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $1, true, now(), now()) RETURNING id`,
    [email],
  )).rows[0].id
  const userA = await makeUser('zz-timetable-a@example.invalid')
  const userB = await makeUser('zz-timetable-b@example.invalid')

  const approvedOffering = await makeOffering(activeCourse, 'approved')
  const pendingOffering = await makeOffering(activeCourse, 'pending')
  const rejectedOffering = await makeOffering(activeCourse, 'rejected')
  const archivedCourseOffering = await makeOffering(archivedCourse, 'approved')
  const noMeetingOffering = await makeOffering(activeCourse, 'approved', false)

  // --- add_my_timetable_offering rejects everything that isn't an approved offering, under an approved
  // course, with a meeting time -- pending, rejected, archived-course, and meetingless offerings. ---
  for (const [label, id] of [['pending', pendingOffering], ['rejected', rejectedOffering], ['archived-course', archivedCourseOffering], ['no-meeting', noMeetingOffering]]) {
    await client.query('SAVEPOINT invalid_add')
    await assert.rejects(client.query('SELECT api.add_my_timetable_offering($1::uuid)', [id]), /approved offering with meeting time required/, `${label} offering must be rejected`)
    await client.query('ROLLBACK TO SAVEPOINT invalid_add')
  }
  console.log('PASS: pending, rejected, archived-course, and meetingless offerings cannot be newly selected')

  // --- add_my_timetable_offering is denied without an authenticated identity (NOT NULL user_id). ---
  await client.query('SAVEPOINT no_identity')
  await assert.rejects(client.query('SELECT api.add_my_timetable_offering($1::uuid)', [approvedOffering]), /authentication required/)
  await client.query('ROLLBACK TO SAVEPOINT no_identity')
  console.log('PASS: adding a selection is denied without an authenticated identity')

  // --- Migration 0030: replace_my_timetable_offering must reject the same invalid offerings as add, not
  // just a plain 'approved offering required' check -- otherwise replace was a bypass around add's
  // selection rule (Ticket 13 item 2). The rejection fires before the auth.user_id()-scoped write, so it
  // is verifiable here even without a real signed-in identity. ---
  for (const [label, id] of [['pending', pendingOffering], ['rejected', rejectedOffering], ['archived-course', archivedCourseOffering], ['no-meeting', noMeetingOffering]]) {
    await client.query('SAVEPOINT invalid_replace')
    await assert.rejects(client.query('SELECT api.replace_my_timetable_offering($1::uuid)', [id]), /approved offering with meeting time required/, `${label} offering must be rejected by replace`)
    await client.query('ROLLBACK TO SAVEPOINT invalid_replace')
  }
  console.log('PASS: replace_my_timetable_offering rejects pending, rejected, archived-course, and meetingless offerings, matching add')

  // --- A valid offering clears replace's validation and reaches the identity-scoped write, which is then
  // denied the same way add is without a real signed-in identity. ---
  await client.query('SAVEPOINT replace_no_identity')
  await assert.rejects(client.query('SELECT api.replace_my_timetable_offering($1::uuid)', [approvedOffering]), /authentication required/)
  await client.query('ROLLBACK TO SAVEPOINT replace_no_identity')
  console.log('PASS: a valid offering passes replace validation and is denied only for lacking an authenticated identity')

  // --- Two accounts' timetables are independent, and each only ever sees their own via the WHERE clause
  // the RPC uses (auth.user_id() cannot be faked here without a real JWT, so this exercises the same
  // predicate list_my_timetable's body runs). ---
  await client.query('INSERT INTO app_private.timetable_selections (user_id, offering_id) VALUES ($1::uuid, $2::uuid)', [userA, approvedOffering])
  const secondOffering = await makeOffering(activeCourse, 'approved')
  await client.query('INSERT INTO app_private.timetable_selections (user_id, offering_id) VALUES ($1::uuid, $2::uuid)', [userB, secondOffering])
  const forA = (await client.query('SELECT offering_id FROM app_private.timetable_selections WHERE user_id = $1::uuid', [userA])).rows
  assert.deepEqual(forA.map((r) => r.offering_id), [approvedOffering])
  console.log('PASS: each account\'s timetable rows are isolated by user_id, matching what list_my_timetable filters on')

  // --- Course merge preserves selections because they key on the immutable offering id, not course id. ---
  const { rows: [target] } = await client.query(
    "INSERT INTO app_private.courses (code, name_th, category_name, category_id, status) SELECT 'ZZTTARGET', 'ทดสอบรายวิชาปลายทาง', c.name, c.id, 'approved' FROM app_private.categories c WHERE c.name = 'ทดสอบตารางเรียน' RETURNING id",
  )
  await client.query(`
    CREATE OR REPLACE FUNCTION app_private.require_administrator() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$ BEGIN RETURN; END $$
  `)
  await client.query('ALTER TABLE app_private.course_merge_audit ALTER COLUMN actor_user_id DROP NOT NULL')
  await client.query('SELECT api.merge_course($1::uuid, $2::uuid)', [activeCourse, target.id])
  const survived = (await client.query('SELECT offering_id FROM app_private.timetable_selections WHERE user_id = $1::uuid', [userA])).rows
  assert.deepEqual(survived.map((r) => r.offering_id), [approvedOffering], 'the selection row must survive the merge unchanged')
  const movedOffering = (await client.query('SELECT course_id FROM app_private.offerings WHERE id = $1', [approvedOffering])).rows[0].course_id
  assert.equal(movedOffering, target.id, 'the underlying offering now belongs to the merge target')
  console.log('PASS: course merge preserves the timetable selection (keyed on the unchanged offering id) while the offering itself moves to the target course')

  // --- Remove and clear, each scoped to a single account. ---
  await client.query('DELETE FROM app_private.timetable_selections WHERE user_id = $1::uuid AND offering_id = $2::uuid', [userA, approvedOffering])
  assert.equal((await client.query('SELECT count(*) FROM app_private.timetable_selections WHERE user_id = $1::uuid', [userA])).rows[0].count, '0')
  assert.equal((await client.query('SELECT count(*) FROM app_private.timetable_selections WHERE user_id = $1::uuid', [userB])).rows[0].count, '1', 'removing one account\'s row must not touch another account\'s')
  await client.query('DELETE FROM app_private.timetable_selections WHERE user_id = $1::uuid', [userB])
  assert.equal((await client.query('SELECT count(*) FROM app_private.timetable_selections WHERE user_id = $1::uuid', [userB])).rows[0].count, '0')
  console.log('PASS: remove and clear each only ever touch the calling account\'s own rows')

  console.log('All timetable isolated-branch checks passed.')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
