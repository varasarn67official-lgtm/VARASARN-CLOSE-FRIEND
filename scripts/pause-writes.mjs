import pg from 'pg'
import { isWriteFunction } from './api-write-classification.mjs'

const [mode] = process.argv.slice(2)
if (!['freeze', 'unfreeze', 'status'].includes(mode)) {
  throw new Error('Usage: node scripts/pause-writes.mjs <freeze|unfreeze|status>')
}
if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('DATABASE_URL_UNPOOLED is required')

const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED })
await client.connect()
try {
  const fns = (await client.query(`
    SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'api'
  `)).rows
  const writeFns = fns.filter((f) => isWriteFunction(f.name))
  const readFns = fns.filter((f) => !isWriteFunction(f.name))
  const signature = (f) => `api."${f.name}"(${f.args})`

  if (mode === 'status') {
    const grants = (await client.query(
      "SELECT routine_name FROM information_schema.routine_privileges WHERE routine_schema = 'api' AND grantee = 'authenticated'",
    )).rows.map((r) => r.routine_name)
    const frozen = writeFns.filter((f) => !grants.includes(f.name))
    const stillWritable = writeFns.filter((f) => grants.includes(f.name))
    const readBroken = readFns.filter((f) => !grants.includes(f.name))
    console.log(JSON.stringify({
      totalFunctions: fns.length, writeFunctions: writeFns.length, readFunctions: readFns.length,
      frozen: frozen.map((f) => f.name), stillWritable: stillWritable.map((f) => f.name),
      readBroken: readBroken.map((f) => f.name),
      paused: stillWritable.length === 0 && readBroken.length === 0,
    }, null, 2))
  } else {
    const verb = mode === 'freeze' ? 'REVOKE EXECUTE ON FUNCTION %s FROM authenticated' : 'GRANT EXECUTE ON FUNCTION %s TO authenticated'
    for (const f of writeFns) await client.query(verb.replace('%s', signature(f)))
    console.log(JSON.stringify({ mode, changed: writeFns.map((f) => f.name), count: writeFns.length }, null, 2))
  }
} finally {
  await client.end()
}
