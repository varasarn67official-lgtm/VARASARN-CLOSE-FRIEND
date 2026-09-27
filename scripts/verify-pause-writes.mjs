import assert from 'node:assert/strict'
import pg from 'pg'
import { isWriteFunction } from './api-write-classification.mjs'

const connectionString = process.env.DATABASE_URL_UNPOOLED
const expectedHost = process.env.PAUSE_WRITES_TEST_HOST
if (!connectionString || !expectedHost || new URL(connectionString).hostname !== expectedHost) {
  throw new Error('Supply a direct connection and the exact isolated test branch host')
}

const client = new pg.Client({ connectionString })
await client.connect()
const authClient = new pg.Client({ connectionString })
await authClient.connect()
await authClient.query('SET ROLE authenticated')

const grantedTo = async (role) => (await client.query(
  "SELECT routine_name FROM information_schema.routine_privileges WHERE routine_schema = 'api' AND grantee = $1", [role],
)).rows.map((r) => r.routine_name)

try {
  const fns = (await client.query("SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'api'")).rows.map((r) => r.proname)
  const writeFns = fns.filter(isWriteFunction)
  const readFns = fns.filter((f) => !isWriteFunction(f))
  assert.ok(writeFns.length > 0 && readFns.length > 0)

  // --- Baseline: every function starts granted to authenticated (a prerequisite this script assumes and
  // restores at the end, not a fact it changes). ---
  const before = await grantedTo('authenticated')
  for (const f of fns) assert.ok(before.includes(f), `${f} must be granted to authenticated before this check runs`)
  console.log(`PASS: baseline has all ${fns.length} api functions granted to authenticated`)

  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  const run = async (mode) => JSON.parse((await exec('node', ['scripts/pause-writes.mjs', mode], { env: process.env })).stdout)

  // --- Freeze denies every write RPC to the authenticated role while leaving every read RPC callable. ---
  const freezeResult = await run('freeze')
  assert.deepEqual(new Set(freezeResult.changed), new Set(writeFns))
  const afterFreeze = await grantedTo('authenticated')
  for (const f of writeFns) assert.ok(!afterFreeze.includes(f), `${f} must not be granted to authenticated while frozen`)
  for (const f of readFns) assert.ok(afterFreeze.includes(f), `${f} must stay granted to authenticated while frozen`)
  console.log(`PASS: freeze revokes exactly the ${writeFns.length} write functions and leaves all ${readFns.length} read functions granted`)

  // --- The freeze is a real permission-system change, not just accounting: the authenticated role is
  // denied a write and a read still succeeds, checked as that role rather than as db_owner. ---
  await assert.rejects(authClient.query('SELECT api.clear_my_timetable()'), /permission denied for function clear_my_timetable/)
  await authClient.query('SELECT * FROM api.list_categories()')
  console.log('PASS: as the authenticated role, a write RPC is denied and a read RPC still succeeds while frozen')

  // --- Status reports paused:true while frozen. ---
  const statusFrozen = await run('status')
  assert.equal(statusFrozen.paused, true)
  assert.deepEqual(statusFrozen.stillWritable, [])
  assert.deepEqual(statusFrozen.readBroken, [])
  console.log('PASS: status reports paused while frozen')

  // --- Unfreeze restores every write grant and changes nothing else. ---
  const unfreezeResult = await run('unfreeze')
  assert.deepEqual(new Set(unfreezeResult.changed), new Set(writeFns))
  const afterUnfreeze = await grantedTo('authenticated')
  assert.deepEqual(new Set(afterUnfreeze), new Set(before), 'unfreeze must restore exactly the original grant set')
  const statusRestored = await run('status')
  assert.equal(statusRestored.paused, false)
  assert.deepEqual(statusRestored.stillWritable.sort(), writeFns.sort())
  console.log('PASS: unfreeze restores every write grant to exactly its pre-freeze state')

  console.log('All pause-writes isolated-branch checks passed.')
} finally {
  await client.end()
  await authClient.end()
}
