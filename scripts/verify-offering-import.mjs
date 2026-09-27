import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL_UNPOOLED
const expectedHost = process.env.OFFERING_IMPORT_TEST_HOST
if (!connectionString || !expectedHost || new URL(connectionString).hostname !== expectedHost) {
  throw new Error('Supply a direct connection and the exact isolated test branch host')
}

const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query('BEGIN')
  await client.query('SAVEPOINT denied_without_identity')
  await assert.rejects(
    client.query('SELECT * FROM api.preview_offering_import($1::jsonb)', ['[]']),
    /administrator access required/,
  )
  await client.query('ROLLBACK TO SAVEPOINT denied_without_identity')
  await client.query(`
    CREATE OR REPLACE FUNCTION app_private.require_administrator()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp
    AS $$ BEGIN RETURN; END $$
  `)
  await client.query('ALTER TABLE app_private.offering_import_audit ALTER COLUMN actor_user_id DROP NOT NULL')
  await client.query("INSERT INTO app_private.categories (name) VALUES ('ทดสอบนำเข้ากลุ่มเรียน')")
  await client.query(`
    INSERT INTO app_private.courses (code, name_th, category_name, category_id, status)
    SELECT seed.code, seed.name_th, c.name, c.id, seed.status
    FROM app_private.categories AS c
    CROSS JOIN (VALUES
      ('ZZIMPORTTEST', 'ทดสอบนำเข้ากลุ่มเรียน', 'approved'),
      ('ZZIMPORTARCHIVED', 'ทดสอบวิชาที่เก็บเข้าคลัง', 'archived')
    ) AS seed(code, name_th, status)
    WHERE c.name = 'ทดสอบนำเข้ากลุ่มเรียน'
  `)
  await client.query("INSERT INTO app_private.academic_periods (academic_year, semester) VALUES (3100, '1')")
  await client.query(`
    INSERT INTO app_private.offerings (course_id, academic_year, semester, section, instructor_name, status)
    SELECT id, 3100, '1', '04', 'อาจารย์เดิม', 'approved'
    FROM app_private.courses WHERE code = 'ZZIMPORTTEST'
  `)
  await client.query(`
    INSERT INTO app_private.offerings (course_id, academic_year, semester, section, instructor_name, status)
    SELECT id, 3100, '1', '05', 'อาจารย์เดิม', 'approved'
    FROM app_private.courses WHERE code = 'ZZIMPORTTEST'
  `)
  await client.query(`
    INSERT INTO app_private.offerings (course_id, academic_year, semester, section, instructor_name, status)
    SELECT id, 3100, '1', '06', NULL, 'rejected'
    FROM app_private.courses WHERE code = 'ZZIMPORTTEST'
  `)
  await client.query(`
    INSERT INTO app_private.offering_meetings (offering_id, day_of_week, starts_at, ends_at)
    SELECT id, 1, '09:00', '11:00' FROM app_private.offerings
    WHERE section IN ('04', '05') AND academic_year = 3100
  `)

  const row = (section, overrides = {}) => ({
    courseCode: ' ZZ IMPORT TEST ', academicYear: 3100, semester: '1', section,
    instructorName: 'อาจารย์เดิม', dayOfWeek: 1, startsAt: '09:00', endsAt: '11:00',
    ...overrides,
  })
  const validBatch = [row('01'), row('04'), row('05', { instructorName: 'อาจารย์ใหม่', startsAt: '10:00', endsAt: '12:00' })]
  const badBatch = [
    ...validBatch,
    row('02', { startsAt: '25:99' }),
    row('03', { academicYear: '999999999999999999999999' }),
    row('01', { section: ' 01 ' }),
    row('06'),
    row('07', { courseCode: 'NOCOURSE' }),
    row('08', { courseCode: 'ZZIMPORTARCHIVED' }),
    row('09', { academicYear: 3101 }),
  ]
  const preview = (await client.query('SELECT * FROM api.preview_offering_import($1::jsonb)', [JSON.stringify(badBatch)])).rows
  assert.deepEqual(preview.map((item) => item.row_number), badBatch.map((_, index) => index + 1))
  assert.deepEqual(preview.slice(0, 3).map((item) => item.action), ['create', 'existing', 'update'])
  assert.deepEqual(preview.slice(3).map((item) => item.valid), [false, false, false, false, false, false, false])
  assert.match(preview[5].reason, /ซ้ำ/)
  assert.match(preview[6].reason, /ยังไม่ได้รับอนุมัติ/)

  await client.query('SAVEPOINT invalid_batch')
  await assert.rejects(client.query('SELECT * FROM api.bulk_import_offerings($1::jsonb)', [JSON.stringify(badBatch)]), /invalid offering row 4/)
  await client.query('ROLLBACK TO SAVEPOINT invalid_batch')
  const beforeCount = (await client.query("SELECT count(*)::integer AS count FROM app_private.offerings WHERE section = '01' AND academic_year = 3100")).rows[0].count
  assert.equal(beforeCount, 0)

  const first = (await client.query('SELECT * FROM api.bulk_import_offerings($1::jsonb)', [JSON.stringify(validBatch)])).rows[0]
  assert.deepEqual(first, { created_count: 1, updated_count: 1, existing_count: 1 })
  const updated = (await client.query(`
    SELECT o.instructor_name, m.starts_at::text, m.ends_at::text
    FROM app_private.offerings AS o JOIN app_private.offering_meetings AS m ON m.offering_id = o.id
    WHERE o.section = '05' AND o.academic_year = 3100
  `)).rows
  assert.equal(updated.length, 1)
  assert.equal(updated[0].instructor_name, 'อาจารย์ใหม่')
  assert.equal(updated[0].starts_at, '10:00:00')

  const second = (await client.query('SELECT * FROM api.bulk_import_offerings($1::jsonb)', [JSON.stringify(validBatch)])).rows[0]
  assert.deepEqual(second, { created_count: 0, updated_count: 0, existing_count: 3 })
  const audits = (await client.query('SELECT created_count, updated_count, existing_count FROM app_private.offering_import_audit ORDER BY created_at DESC LIMIT 2')).rows
  assert.equal(audits.length, 2)
  console.log('Offering import branch test passed: row errors, create, update, existing, rollback, and idempotent rerun')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
