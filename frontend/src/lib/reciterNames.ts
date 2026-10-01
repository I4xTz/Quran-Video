import { RECITERS } from "@/lib/reciters";

// Latin-script reciter display names -- shared between the client
// (VideoCreatorForm's suggested video title) and the server
// (render/route.ts, stored per gallery entry as reciterNameLatin). Derived
// from src/lib/reciters.ts, the single reciter list.
export const RECITER_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  RECITERS.map((r) => [r.id, r.latinName])
);

// Every reciter's Arabic name, exactly as render/route.ts stores it per
// gallery entry. Used both to look up a Latin name for a gallery entry
// saved BEFORE reciterNameLatin existed (see latinNameForArabicReciterName
// below) and, exported, by VideoCreatorForm's suggestedTitle for the
// Arabic-language version of the credit line.
export const RECITER_ARABIC_NAMES: Record<string, string> = Object.fromEntries(
  RECITERS.map((r) => [r.id, r.arabicName])
);

// Recovers a Latin reciter name from an OLD gallery entry that only ever
// stored the Arabic one (reciterNameLatin didn't exist yet) -- so those
// videos show correctly in Turkish too, without needing to touch their
// already-saved JSON.
export function latinNameForArabicReciterName(arabicName: string): string | undefined {
  const reciterId = Object.keys(RECITER_ARABIC_NAMES).find((id) => RECITER_ARABIC_NAMES[id] === arabicName);
  return reciterId ? RECITER_DISPLAY_NAMES[reciterId] : undefined;
}
