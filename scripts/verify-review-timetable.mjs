import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL_UNPOOLED
const expectedHost = process.env.REVIEW_TIMETABLE_TEST_HOST
if (!connectionString || !expectedHost || new URL(connectionString).hostname !== expectedHost) {
  throw new Error('Supply a direct connection and the exact isolated test branch host')
}
const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query('BEGIN')
  const names = ['list_my_reported_timetable', 'add_my_timetable_review', 'remove_my_timetable_review']
  for (const name of names) {
    const { rows: [access] } = await client.query(`
      SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS signed_in,
             has_function_privilege('anonymous', p.oid, 'EXECUTE') AS anonymous
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='api' AND p.proname=$1`, [name])
    assert.equal(access.signed_in, true)
    assert.equal(access.anonymous, false)
  }
  const direct = await client.query(`SELECT grantee FROM information_schema.table_privileges
    WHERE table_schema='app_private' AND table_name='timetable_review_selections'
      AND grantee IN ('PUBLIC', 'authenticated', 'anonymous')`)
  assert.equal(direct.rowCount, 0)

  const makeUser = async (suffix) => (await client.query(`INSERT INTO neon_auth."user"
    (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), $1, $2, true, now(), now()) RETURNING id`,
  [`test ${suffix}`, `review-timetable-${suffix}@example.invalid`])).rows[0].id
  const userA = await makeUser('a')
  const userB = await makeUser('b')
  const setUser = async (id) => client.query('SELECT set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: id })])
  const category = (await client.query(`INSERT INTO app_private.categories(name) VALUES('Test review timetable') RETURNING id`)).rows[0].id
  const course = (await client.query(`INSERT INTO app_private.courses(code,name_th,category_name,category_id)
    VALUES('ZZREVIEWTIMETABLE','Test course','Test review timetable',$1) RETURNING id`, [category])).rows[0].id
  const review = (await client.query(`INSERT INTO app_private.reviews
    (course_id,author_user_id,academic_year,semester,section,instructor_name,
     day_of_week,starts_at,ends_at,rating,text)
    VALUES($1,$2,2569,'1','test','Teacher',3,'09:30','11:30',5,'Test review') RETURNING id`,
  [course, userB])).rows[0].id

  await setUser(userA)
  assert.equal((await client.query('SELECT auth.user_id() AS id')).rows[0].id, userA)
  await client.query('SELECT api.add_my_timetable_review($1::uuid)', [review])
  let rows = (await client.query('SELECT * FROM api.list_my_reported_timetable()')).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].section, 'test')
  assert.equal(rows[0].day_of_week, 3)
  assert.equal(rows[0].starts_at, '09:30:00')
  assert.equal((await client.query('SELECT count(*)::int AS n FROM app_private.offerings WHERE course_id=$1', [course])).rows[0].n, 0)

  await setUser(userB)
  rows = (await client.query('SELECT * FROM api.list_my_reported_timetable()')).rows
  assert.equal(rows.length, 0)
  await client.query('SELECT api.remove_my_timetable_review($1::uuid)', [review])
  await setUser(userA)
  assert.equal((await client.query('SELECT count(*)::int AS n FROM api.list_my_reported_timetable()')).rows[0].n, 1)

  await client.query(`INSERT INTO app_private.offerings(course_id,academic_year,semester,section,status)
    VALUES($1,2569,'1','official','approved') RETURNING id`, [course]).then(async ({rows}) => {
    const offering = rows[0].id
    await client.query(`INSERT INTO app_private.offering_meetings(offering_id,day_of_week,starts_at,ends_at)
      VALUES($1,3,'13:00','15:00')`, [offering])
    await client.query('SELECT api.add_my_timetable_offering($1::uuid)', [offering])
    assert.equal((await client.query('SELECT count(*)::int AS n FROM api.list_my_reported_timetable()')).rows[0].n, 0)
    assert.equal((await client.query('SELECT count(*)::int AS n FROM api.list_my_timetable()')).rows[0].n, 1)
  })

  await client.query('SELECT api.add_my_timetable_review($1::uuid)', [review])
  assert.equal((await client.query('SELECT count(*)::int AS n FROM api.list_my_timetable()')).rows[0].n, 0)
  assert.equal((await client.query('SELECT count(*)::int AS n FROM api.list_my_reported_timetable()')).rows[0].n, 1)
  await client.query('SELECT api.remove_my_timetable_review($1::uuid)', [review])
  assert.equal((await client.query('SELECT count(*)::int AS n FROM api.list_my_reported_timetable()')).rows[0].n, 0)
  await client.query('SELECT api.add_my_timetable_review($1::uuid)', [review])
  await client.query('SELECT api.clear_my_timetable()')
  assert.equal((await client.query('SELECT count(*)::int AS n FROM api.list_my_reported_timetable()')).rows[0].n, 0)

  await client.query('UPDATE app_private.reviews SET moderation_visible=false WHERE id=$1', [review])
  await client.query('SAVEPOINT hidden_review')
  await assert.rejects(client.query('SELECT api.add_my_timetable_review($1::uuid)', [review]), /visible review with valid class time required/)
  await client.query('ROLLBACK TO SAVEPOINT hidden_review')
  console.log('PASS: private review add, account isolation, no shared offering, cross-source replacement, remove, clear, and hidden-review denial')
} finally {
  await client.query('ROLLBACK').catch(() => {})
  await client.end()
}
