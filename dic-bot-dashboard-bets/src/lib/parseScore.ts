/**
 * Parses free-text score lines from #scores channel.
 * Supports:
 *  - @Sean 27-24 @Gabe
 *  - Penn State 27, Texas A&M 24
 *  - W 31-28 vs @Gabe
 *  - L 21-35 @ @Gabe
 */
export type ParsedScore =
  | { type: "users"; aId: string; aPts: number; bPts: number; bId: string }
  | { type: "teams"; aTeam: string; aPts: number; bPts: number; bTeam: string }
  | { type: "wl"; who: "W" | "L"; myPts: number; oppPts: number; oppId: string; venue: "home"|"away" };

const patterns = [
  // <@123> 27-24 <@456>
  /<@!?(\d+)>\s*(\d+)\s*[-–]\s*(\d+)\s*<@!?(\d+)>/i,
  // Team 27-24 Team
  /([A-Za-z0-9 .&'\-]+)\s*(\d+)\s*[,\-–]\s*(\d+)\s*([A-Za-z0-9 .&'\-]+)/i,
  // W 27-24 vs <@id>
  /\b(W|L)\b\s*(\d+)\s*[-–]\s*(\d+)\s*(vs|@)\s*<@!?(\d+)>/i
];

export function tryParseScore(text: string): ParsedScore | null {
  for (const r of patterns) {
    const m = text.match(r);
    if (!m) continue;

    if (r === patterns[0]) {
      return { type: "users", aId: m[1], aPts: +m[2], bPts: +m[3], bId: m[4] };
    }
    if (r === patterns[1]) {
      return { type: "teams", aTeam: m[1].trim(), aPts: +m[2], bPts: +m[3], bTeam: m[4].trim() };
    }
    if (r === patterns[2]) {
      return { type: "wl", who: m[1] as any, myPts: +m[2], oppPts: +m[3], venue: m[4] === "@" ? "away" : "home", oppId: m[5] };
    }
  }
  return null;
}
