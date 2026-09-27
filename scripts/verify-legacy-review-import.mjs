import assert from 'node:assert/strict'
import pg from 'pg'
import XLSX from 'xlsx'
import { normalizeLegacyReviews } from './legacy-review-normalize.mjs'

const connectionString = process.env.DATABASE_URL_UNPOOLED
const expectedHost = process.env.LEGACY_REVIEW_TEST_HOST
if (!connectionString || !expectedHost || new URL(connectionString).hostname !== expectedHost) {
  throw new Error('Supply a direct connection and the exact isolated test branch host')
}

const WORKBOOK = 'old-repo/สำเนาของ เว็บรีวิววิชา.xlsx'
const client = new pg.Client({ connectionString })
await client.connect()
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0]
const importRows = async (rows) => one('SELECT * FROM app_private.import_legacy_review_rows($1::jsonb)', [JSON.stringify(rows)])
const expectFailure = async (label, sql, params, pattern) => {
  await client.query(`SAVEPOINT ${label}`)
  await assert.rejects(client.query(sql, params), pattern)
  await client.query(`ROLLBACK TO SAVEPOINT ${label}`)
}

try {
  await client.query('BEGIN')

  // --- Grants: the owner RPC is authenticated-only, the core import is not executable by any client role. ---
  const grantees = async (schema, name) => (await client.query(
    'SELECT grantee FROM information_schema.routine_privileges WHERE routine_schema = $1 AND routine_name = $2', [schema, name],
  )).rows.map((r) => r.grantee)
  const rpc = await grantees('api', 'import_legacy_reviews')
  assert.ok(rpc.includes('authenticated') && !rpc.includes('PUBLIC'), 'import_legacy_reviews must be authenticated-only')
  const core = await grantees('app_private', 'import_legacy_review_rows')
  assert.ok(!core.includes('PUBLIC') && !core.includes('authenticated') && !core.includes('anonymous'), 'core import must not be client-executable')
  console.log('PASS: import_legacy_reviews is authenticated-only and the core import is not executable by any client role')

  await expectFailure('not_owner', 'SELECT * FROM api.import_legacy_reviews($1::jsonb)', ['[]'], /owner access required/)
  console.log('PASS: the confirmed import RPC is denied without the owner identity')

  // --- The real four-review snapshot, normalized by the same code the dry run uses, against this catalog. ---
  const catalog = new Set((await client.query('SELECT code FROM app_private.courses')).rows.map((r) => r.code))
  const sheetRows = XLSX.utils.sheet_to_json(XLSX.readFile(WORKBOOK).Sheets.Reviews, { defval: '' })
  const report = normalizeLegacyReviews(sheetRows, { catalog })
  assert.equal(report.accepted, 4)
  assert.equal(report.unmatched, 0)
  const offeringsBefore = Number((await one('SELECT count(*) FROM app_private.offerings')).count)
  const first = await importRows(report.reviews)
  assert.deepEqual([first.imported_count, first.duplicate_count], [4, 0])
  assert.equal(Number((await one('SELECT count(*) FROM app_private.offerings')).count), offeringsBefore, 'legacy import must not create offerings')
  console.log('PASS: the snapshot imports 4 reviews and creates no offerings')

  // --- Ownerless, email-free, and carrying the historical context and original date. ---
  const legacy = (await client.query(`
    SELECT r.id, r.author_user_id, r.offering_id, r.course_id, c.code, r.academic_year, r.semester, r.section,
      r.instructor_name, r.rating, r.text, r.created_at, r.day_of_week, r.starts_at
    FROM app_private.reviews r JOIN app_private.courses c ON c.id = r.course_id WHERE r.is_legacy ORDER BY r.created_at
  `)).rows
  assert.equal(legacy.length, 4)
  for (const r of legacy) {
    assert.equal(r.author_user_id, null); assert.equal(r.offering_id, null)
    assert.equal(r.day_of_week, null); assert.equal(r.starts_at, null)
    assert.ok(![r.text, r.section, r.instructor_name].some((v) => String(v ?? '').includes('@')), 'no legacy email may reach target data')
  }
  assert.equal(legacy[0].code, 'JC380'); assert.equal(legacy[0].section, '450001'); assert.equal(legacy[0].academic_year, 2569)
  assert.equal(legacy[0].created_at.toISOString(), '2026-09-20T07:26:26.000Z')
  console.log('PASS: imported reviews are ownerless, have no offering or schedule, contain no email, and keep course/section/term/date')

  // --- Idempotent: a re-run and a whitespace/case section variant are duplicates, not new rows. ---
  const again = await importRows(report.reviews)
  assert.deepEqual([again.imported_count, again.duplicate_count], [0, 4])
  const variant = { ...report.reviews[0], section: ' 450 001 ' }
  assert.deepEqual(Object.values(await importRows([variant])), [0, 1])
  assert.equal(Number((await one('SELECT count(*) FROM app_private.reviews WHERE is_legacy')).count), 4)
  console.log('PASS: re-running the import and a spacing-variant section are counted as duplicates')

  // --- Invalid rows name their source row and roll back the whole batch. ---
  const good = { sourceRow: 90, courseCode: 'JC201', rating: 3, text: 'ทดสอบการย้อนกลับ', semester: '1', year: 2568, section: '9', createdAt: '2026-01-01T09:00:00+07:00' }
  await expectFailure('bad_date', 'SELECT * FROM app_private.import_legacy_review_rows($1::jsonb)', [JSON.stringify([good, { ...good, sourceRow: 91, createdAt: 46285.6 }])], /legacy row 91: invalid/)
  await expectFailure('unmatched', 'SELECT * FROM app_private.import_legacy_review_rows($1::jsonb)', [JSON.stringify([good, { ...good, sourceRow: 92, courseCode: 'ZZNOPE' }])], /legacy row 92: course ZZNOPE is not in the catalog/)
  assert.equal(Number((await one("SELECT count(*) FROM app_private.reviews WHERE text = 'ทดสอบการย้อนกลับ'")).count), 0, 'a failing batch must not leave earlier rows behind')
  console.log('PASS: an unparsed date or unmatched course names the source row and rolls back the batch')

  // --- Regression: the class a legacy review describes can still become an official, selectable offering. ---
  await client.query(`CREATE OR REPLACE FUNCTION app_private.require_administrator() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$ BEGIN RETURN; END $$`)
  await client.query('ALTER TABLE app_private.offering_audit ALTER COLUMN actor_user_id DROP NOT NULL')
  await client.query('ALTER TABLE app_private.course_merge_audit ALTER COLUMN actor_user_id DROP NOT NULL')
  await client.query("INSERT INTO app_private.academic_periods (academic_year, semester) VALUES (2569, '1') ON CONFLICT DO NOTHING")
  const { create_offering: offeringId } = await one("SELECT api.create_offering($1::uuid, 2569, '1', '450001', 'อาจารย์', 2, '13:30', '17:30')", [legacy[0].course_id])
  assert.equal((await one('SELECT status FROM app_private.offerings WHERE id = $1', [offeringId])).status, 'approved')
  console.log('PASS: an administrator can still create the official offering for a class a legacy review describes')

  // --- Readers get the anonymous projection; nobody owns, edits, withdraws, or claims a legacy review. ---
  const visible = await client.query('SELECT * FROM api.list_visible_reviews($1::uuid)', [legacy[0].course_id])
  assert.ok(visible.rows.some((r) => r.id === legacy[0].id), 'legacy review must be visible to readers')
  const columns = visible.fields.map((f) => f.name)
  for (const hidden of ['author_user_id', 'is_legacy', 'email', 'offering_id']) assert.ok(!columns.includes(hidden), `projection must not expose ${hidden}`)
  await expectFailure('edit_legacy', 'SELECT api.update_my_review($1::uuid, 1, $2)', [legacy[0].id, 'แก้ไขโดยคนอื่น'], /review not found/)
  await expectFailure('withdraw_legacy', 'SELECT api.set_my_review_active($1::uuid, false)', [legacy[0].id], /review not found/)
  const after = await one('SELECT rating, text, author_active FROM app_private.reviews WHERE id = $1', [legacy[0].id])
  assert.deepEqual([after.rating, after.text, after.author_active], [legacy[0].rating, legacy[0].text, true])
  assert.equal(Number((await one('SELECT count(*) FROM app_private.review_revisions WHERE review_id = $1', [legacy[0].id])).count), 0)
  const ownerGuards = (await client.query(`
    SELECT p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'api' AND p.prosrc ~* 'update\\s+reviews'
  `)).rows
  for (const f of ownerGuards) {
    for (const [, assignments] of f.prosrc.matchAll(/update\s+reviews\s+(?:\w+\s+)?set\s+([\s\S]*?)\s+(?:where|from)\b/gi)) {
      assert.ok(!/author_user_id\s*=/i.test(assignments), `${f.proname} must not reassign review authorship`)
    }
  }
  const selfScoped = ownerGuards.filter((f) => /author_user_id\s*=\s*auth\.user_id\(\)/i.test(f.prosrc)).map((f) => f.proname)
  assert.ok(selfScoped.includes('update_my_review') && selfScoped.includes('set_my_review_active'))
  console.log(`PASS: readers see the legacy review anonymously; editing or withdrawing it is refused ('review not found') and leaves no revision; author-only mutators (${selfScoped.join(', ')}) are self-scoped and no API function reassigns authorship`)

  // --- A course merged away before import resolves to the retained course. ---
  const { rows: [cat] } = await client.query("INSERT INTO app_private.categories (name) VALUES ('ทดสอบรีวิวเก่า') RETURNING id, name")
  const mk = async (code) => (await one("INSERT INTO app_private.courses (code, name_th, category_name, category_id, status) VALUES ($1, $1, $2, $3, 'approved') RETURNING id", [code, cat.name, cat.id])).id
  const source = await mk('ZZLEGSRC'); const target = await mk('ZZLEGTGT')
  await client.query('SELECT api.merge_course($1::uuid, $2::uuid)', [source, target])
  await importRows([{ ...good, sourceRow: 93, courseCode: 'zz leg src', text: 'รีวิวของวิชาที่ถูกรวม' }])
  assert.equal((await one("SELECT course_id FROM app_private.reviews WHERE text = 'รีวิวของวิชาที่ถูกรวม'")).course_id, target)
  console.log('PASS: a legacy row for a merged-away course code lands on the retained course')

  // --- Audit rows distinguish the owner RPC from the DB-owner script. ---
  await client.query("INSERT INTO app_private.legacy_import_audit (actor_user_id, via, source_rows, imported_count, duplicate_count) VALUES (NULL, 'database_script', 4, 4, 0)")
  await expectFailure('rpc_needs_actor', "INSERT INTO app_private.legacy_import_audit (actor_user_id, via, source_rows, imported_count, duplicate_count) VALUES (NULL, 'owner_rpc', 1, 1, 0)", [], /legacy_import_audit_via_check/)
  console.log('PASS: script imports are audited without an account; owner-RPC imports must record their actor')

  console.log('All legacy review isolated-branch checks passed.')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
