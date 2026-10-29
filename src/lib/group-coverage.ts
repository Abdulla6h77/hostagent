import type { GroupCoverage, Pick } from "@/types";

function earlier(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
const bits = (mask: number) => mask.toString(2).replace(/0/g, "").length;

/** Exact maximum coverage over an already-ranked pool; rank order breaks ties.
 * Only explicit individual retrieval evidence contributes. No IO or new candidates.
 * At most 4 guests => 16 masks and 3 selection slots.
 */
export function selectGroupCoverage(ranked: Pick[], guestNames: string[]): { picks: Pick[]; coverage: GroupCoverage } {
  const slots = Math.min(3, ranked.length);
  const masks = ranked.map((pick) => guestNames.reduce((mask, guest, index) =>
    mask | (pick.support?.kind === "qloo-retrieval" && pick.guestEvidence?.some((e) => e.guest === guest && e.state === "supported") ? 1 << index : 0), 0));
  const states = Array.from({ length: slots + 1 }, () => new Map<number, number[]>());
  states[0].set(0, []);
  ranked.forEach((_pick, index) => {
    for (let size = slots; size > 0; size--) {
      for (const [mask, indices] of states[size - 1]) {
        const nextMask = mask | masks[index], next = [...indices, index];
        const previous = states[size].get(nextMask);
        if (!previous || earlier(next, previous)) states[size].set(nextMask, next);
      }
    }
  });
  let bestMask = 0, best: number[] | undefined;
  for (const [mask, indices] of states[slots]) {
    if (!best || bits(mask) > bits(bestMask) || (bits(mask) === bits(bestMask) && earlier(indices, best))) { bestMask = mask; best = indices; }
  }
  const available = masks.reduce((mask, value) => mask | value, 0);
  const coverage: GroupCoverage = { representedGuests: [], checkedWithoutCandidateGuests: [], uncheckedGuests: [], unselectedGuests: [] };
  guestNames.forEach((guest, index) => {
    if (bestMask & (1 << index)) coverage.representedGuests.push(guest);
    else if (available & (1 << index)) coverage.unselectedGuests.push(guest);
    else if (ranked.some((pick) => pick.guestEvidence?.some((e) => e.guest === guest && e.state === "checked-not-retrieved"))) coverage.checkedWithoutCandidateGuests.push(guest);
    else coverage.uncheckedGuests.push(guest);
  });
  return { picks: (best ?? []).map((index) => ranked[index]), coverage };
}

export function describeCoverage(coverage: GroupCoverage, total: number): string {
  const notes = [`Selected picks have verified individual retrieval support for ${coverage.representedGuests.length} of ${total} guests. This is set coverage, not shared consensus or affinity.`];
  if (coverage.checkedWithoutCandidateGuests.length) notes.push(`No candidate in the group pool had individual retrieval support for: ${coverage.checkedWithoutCandidateGuests.join(", ")}.`);
  if (coverage.uncheckedGuests.length) notes.push(`Individual evidence was not checked for: ${coverage.uncheckedGuests.join(", ")}.`);
  if (coverage.unselectedGuests.length) notes.push(`The three-pick limit leaves these guests unrepresented despite candidate evidence: ${coverage.unselectedGuests.join(", ")}.`);
  return notes.join(" ");
}
