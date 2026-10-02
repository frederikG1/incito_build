/** 0..1, the same for the same key, every time. FNV-1a. */
export function seeded(key: string): number {
  return (fnv(key) % 100_000) / 100_000;
}

/** A short stable print of a string — for "is this the same as then", not for security. */
export function fingerprint(text: string): string {
  return fnv(text).toString(36);
}

function fnv(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
