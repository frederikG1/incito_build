/**
 * An avis's name without its chain — "SuperBrugsen · uge 41" is "Uge 41"
 * wherever the chain already stands beside it (the header path, the
 * front page under the chain's name). Stored names are left alone.
 */
export function avisTitle(name: string, chain: string | null | undefined): string {
  const bare = chain ? chain.split(' — ')[0]!.trim() : '';
  if (!bare) return name;
  const rest = name.replace(new RegExp(`^${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[·\\-–—:]?\\s+`, 'i'), '');
  return rest === name || !rest ? name : rest.charAt(0).toUpperCase() + rest.slice(1);
}
