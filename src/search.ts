// Codes are typed as "jc 221" as often as "JC221", so matching ignores case and whitespace.
export function searchKey(value: string) { return value.toLowerCase().replace(/\s+/g, '') }
