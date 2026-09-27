// Every api function is a task-oriented RPC, never a raw table grant (0001_security_api.sql). This
// project's naming convention is that a read-only RPC is named list_*, preview_*, or current_access;
// every other api function performs a write. scripts/pause-writes.mjs uses this to freeze every mutating
// RPC for a signed-in user without a maintained function list, so it keeps working as migrations add
// functions -- as long as a new read-only RPC keeps following the same naming convention.
export const READ_ONLY_API_FUNCTION = /^(list_|preview_)\w+$|^current_access$/

export const isWriteFunction = (name) => !READ_ONLY_API_FUNCTION.test(name)
