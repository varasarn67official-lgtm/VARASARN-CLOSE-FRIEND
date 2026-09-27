import assert from 'node:assert/strict'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL_UNPOOLED
const expectedHost = process.env.OFFERING_PROPOSAL_TEST_HOST
if (!connectionString || !expectedHost || new URL(connectionString).hostname !== expectedHost) {
  throw new Error('Supply a direct connection and the exact isolated test branch host')
}

const client = new pg.Client({ connectionString })
await client.connect()
try {
  await client.query('BEGIN')

  // Denied without administrator identity, matching every other admin RPC.
  await client.query('SAVEPOINT denied_without_identity')
  await assert.rejects(
    client.query('SELECT api.resolve_offering_proposal($1::uuid, true)', ['00000000-0000-0000-0000-000000000000']),
    /administrator access required/,
  )
  await client.query('ROLLBACK TO SAVEPOINT denied_without_identity')

  // Bypass auth.user_id() for the rest of this transaction the same way this repo's other isolated-branch
  // verification (scripts/verify-offering-import.mjs) does: override the admin gate, and relax the NOT NULL
  // actor columns that would otherwise require a real Neon Auth session.
  await client.query(`
    CREATE OR REPLACE FUNCTION app_private.require_administrator()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp
    AS $$ BEGIN RETURN; END $$
  `)
  await client.query('ALTER TABLE app_private.course_merge_audit ALTER COLUMN actor_user_id DROP NOT NULL')

  const { rows: [proposer] } = await client.query(`
    INSERT INTO neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), 'ทดสอบผู้เสนอ', 'zz-proposal-test@example.invalid', true, now(), now())
    RETURNING id
  `)
  await client.query("INSERT INTO app_private.categories (name) VALUES ('ทดสอบข้อเสนอกลุ่มเรียน')")
  await client.query(`
    INSERT INTO app_private.courses (code, name_th, category_name, category_id, status)
    SELECT seed.code, seed.name_th, c.name, c.id, seed.status
    FROM app_private.categories AS c
    CROSS JOIN (VALUES
      ('ZZPROPOSALSRC', 'ทดสอบรายวิชาต้นทาง', 'approved'),
      ('ZZPROPOSALDST', 'ทดสอบรายวิชาปลายทาง', 'approved'),
      ('ZZPROPOSALARCH', 'ทดสอบรายวิชาที่เก็บเข้าคลัง', 'archived')
    ) AS seed(code, name_th, status)
    WHERE c.name = 'ทดสอบข้อเสนอกลุ่มเรียน'
  `)
  await client.query("INSERT INTO app_private.academic_periods (academic_year, semester) VALUES (3100, '1')")

  const courseId = async (code) => {
    const { rows } = await client.query('SELECT id FROM app_private.courses WHERE code = $1', [code])
    return rows[0].id
  }
  const srcId = await courseId('ZZPROPOSALSRC')
  const dstId = await courseId('ZZPROPOSALDST')
  const archId = await courseId('ZZPROPOSALARCH')

  // --- Test 1: resolve_offering_proposal reuses a normalized-equivalent offering instead of erroring. ---
  await client.query(`
    INSERT INTO app_private.offerings (course_id, academic_year, semester, section, instructor_name, status)
    VALUES ($1, 3100, '1', ' Sec 1 ', 'อาจารย์เดิม', 'approved')
  `, [srcId])
  const { rows: [normProposal] } = await client.query(`
    INSERT INTO app_private.offering_proposals (proposer_user_id, course_id, academic_year, semester, section, instructor_name)
    SELECT $2::uuid, $1, 3100, '1', 'sec1', 'อาจารย์ใหม่'
    RETURNING id
  `, [srcId, proposer.id])
  const beforeCount = (await client.query('SELECT count(*) FROM app_private.offerings WHERE course_id = $1', [srcId])).rows[0].count
  await client.query('SELECT api.resolve_offering_proposal($1::uuid, true)', [normProposal.id])
  const afterCount = (await client.query('SELECT count(*) FROM app_private.offerings WHERE course_id = $1', [srcId])).rows[0].count
  assert.equal(beforeCount, afterCount, 'a normalized-equivalent section must not create a second offering')
  const resolvedStatus = (await client.query('SELECT status, resolved_at FROM app_private.offering_proposals WHERE id = $1', [normProposal.id])).rows[0]
  assert.equal(resolvedStatus.status, 'approved')
  assert.ok(resolvedStatus.resolved_at, 'resolved_at must be recorded')
  console.log('PASS: normalized section reuses existing offering, no duplicate created')

  // --- Test 2: approval is denied for a proposal whose course is no longer approved. ---
  const { rows: [archProposal] } = await client.query(`
    INSERT INTO app_private.offering_proposals (proposer_user_id, course_id, academic_year, semester, section, instructor_name)
    SELECT $2::uuid, $1, 3100, '1', '9', 'อาจารย์'
    RETURNING id
  `, [archId, proposer.id])
  await client.query('SAVEPOINT archived_course_denied')
  await assert.rejects(
    client.query('SELECT api.resolve_offering_proposal($1::uuid, true)', [archProposal.id]),
    /active course required/,
  )
  await client.query('ROLLBACK TO SAVEPOINT archived_course_denied')
  console.log('PASS: approval denied for a proposal whose course is archived')

  // --- Test 3: merge_course carries offering_proposals forward to the target course. ---
  const { rows: [mergeProposal] } = await client.query(`
    INSERT INTO app_private.offering_proposals (proposer_user_id, course_id, academic_year, semester, section, instructor_name)
    SELECT $2::uuid, $1, 3100, '1', '2', 'อาจารย์บี'
    RETURNING id
  `, [srcId, proposer.id])
  await client.query('SELECT api.merge_course($1::uuid, $2::uuid)', [srcId, dstId])
  const merged = (await client.query('SELECT course_id FROM app_private.offering_proposals WHERE id = $1', [mergeProposal.id])).rows[0]
  assert.equal(merged.course_id, dstId, 'proposal must now reference the merge target course')
  const sourceStatus = (await client.query('SELECT status FROM app_private.courses WHERE id = $1', [srcId])).rows[0].status
  assert.equal(sourceStatus, 'archived')
  console.log('PASS: course merge reassigns offering_proposals.course_id to the target course')

  console.log('All offering-proposal isolated-branch checks passed.')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
