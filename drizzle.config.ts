import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './db/drizzle',
  dbCredentials: process.env.DATABASE_URL_UNPOOLED
    ? { url: process.env.DATABASE_URL_UNPOOLED }
    : process.env.DATABASE_URL
      ? { url: process.env.DATABASE_URL }
      : undefined,
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
})
