import quranData from "@/data/quran.json";
import { getVerseWordMap } from "@/lib/quranWordMap";

export type SegmentationResult = { data: any[] } | { error: string };

// Validates a segmentation array and auto-corrects word_count mismatches in
// place. Shared by /api/segmentation/apply (early feedback in the UI) and
// /api/video/render, which receives each request's own segmentation in its
// form data -- there is no server-side shared copy, so two users can never
// see each other's segmentation.
export async function normalizeSegmentation(data: unknown): Promise<SegmentationResult> {
  if (!Array.isArray(data)) {
    return { error: "Invalid format: Expected an array of segmentation objects." };
  }

  if (data.length === 0) {
    return { error: "Invalid format: Array cannot be empty." };
  }

  const localSurahs = quranData as any[];

  for (const item of data) {
    if (typeof item.surah !== "number" || item.surah < 1 || item.surah > 114) {
      return { error: `Invalid surah number: ${item.surah}. Must be between 1 and 114.` };
    }

    const surahData = localSurahs.find((s) => s.id === item.surah);
    if (!surahData) {
      return { error: `Surah ${item.surah} not found in database.` };
    }

    if (typeof item.ayah !== "number" || item.ayah < 1 || item.ayah > surahData.total_verses) {
      return { error: `Invalid ayah number: ${item.ayah} for surah ${item.surah}.` };
    }

    if (!Array.isArray(item.mappings) || item.mappings.length < 1) {
      return { error: `Surah ${item.surah} Ayah ${item.ayah} must have a mappings array with at least 1 item.` };
    }

    let totalUnits = 0;
    let allMappingsHaveManualTiming = true;
    for (const mapping of item.mappings) {
      if (typeof mapping.part !== "number" || mapping.part < 1) {
        return { error: `Invalid part number in Surah ${item.surah} Ayah ${item.ayah}.` };
      }
      // Empty is allowed deliberately: a segment can legitimately show just
      // its Arabic text with no translation line (VerseScene/QuranVideo.tsx
      // already renders that fine -- the translation div is only rendered
      // `{translation ? (...) : null}`), e.g. a manually-split leftover
      // word, or simply because the user hasn't finished typing it yet.
      // Rejecting the WHOLE request here used to make applyPendingSegmentation
      // (VideoCreatorForm.tsx) fall back to clearing ALL segmentation for
      // every ayah, not just this one -- so a still-in-progress segment
      // was silently discarding a user's finished work on every other
      // segment/ayah too, showing the whole ayah unsplit in the preview
      // and final render alike.
      if (typeof mapping.translation_text !== "string") {
        return { error: `translation_text must be a string in Surah ${item.surah} Ayah ${item.ayah}.` };
      }
      if (typeof mapping.word_count !== "number" || mapping.word_count < 1) {
        return { error: `word_count must be a positive integer in Surah ${item.surah} Ayah ${item.ayah}.` };
      }
      // Manual timing override from SegmentTimingEditor — optional, but if
      // present must be a sane (start < end, both non-negative) raw
      // prepared-audio-clip-relative millisecond pair.
      const hasStart = mapping.start_ms !== undefined;
      const hasEnd = mapping.end_ms !== undefined;
      if (hasStart !== hasEnd) {
        return { error: `start_ms and end_ms must be set together in Surah ${item.surah} Ayah ${item.ayah}.` };
      }
      if (hasStart && (typeof mapping.start_ms !== "number" || typeof mapping.end_ms !== "number" || mapping.start_ms < 0 || mapping.end_ms <= mapping.start_ms)) {
        return { error: `Invalid start_ms/end_ms in Surah ${item.surah} Ayah ${item.ayah}.` };
      }
      if (!hasStart) allMappingsHaveManualTiming = false;
      totalUnits += mapping.word_count;
    }

    const verseData = surahData.verses.find((v: any) => v.id === item.ayah);
    if (!verseData) {
      return { error: `Verse ${item.ayah} not found in Surah ${item.surah}.` };
    }

    // Validate against the REAL Uthmani word count (same basis wordTimings
    // is indexed by at render time), not the QCF glyph-token count.
    const puaWordCount = verseData.text.trim().split(/\s+/).length;
    let actualWordCount: number;
    try {
      const wordMap = await getVerseWordMap(item.surah, item.ayah, puaWordCount);
      actualWordCount = wordMap.realWordCount;
    } catch (e) {
      console.warn(`[Segmentation] Failed to resolve real word count for Surah ${item.surah} Ayah ${item.ayah}, falling back to PUA count:`, e);
      actualWordCount = puaWordCount;
    }

    // Never silently reshuffle word_count when every mapping already
    // carries a manually-dragged start_ms/end_ms (i.e. it went through
    // SegmentTimingEditor) -- the editor keeps word_count and the
    // displayed Arabic text on the same real-word basis this function
    // validates against (see VideoCreatorForm.tsx's
    // buildTimingEditorSegments/ensureWordMapForAyahs), so a mismatch here
    // would mean something upstream is already wrong. Proportionally
    // rewriting word_count in that case would desync it from the
    // boundaries the user actually dragged -- text would shift to
    // different segments than the ones they timed -- which is strictly
    // worse than rendering with whatever the user explicitly set.
    // Likewise when every mapping carries its own word_start: segments
    // then pick their word ranges independently (they may repeat or skip
    // words, see VerseMapping.word_start), so word_counts summing to
    // something other than the ayah's word count is expected, not an error.
    const allMappingsHaveOwnRange = item.mappings.every((m: any) => typeof m.word_start === "number");
    if (totalUnits !== actualWordCount && !allMappingsHaveManualTiming && !allMappingsHaveOwnRange) {
      console.warn(`[Segmentation] Auto-correcting word count mismatch for Surah ${item.surah} Ayah ${item.ayah}. Expected ${actualWordCount}, got ${totalUnits}`);
      // Proportionately adjust the mappings. Reserve at least 1 word for
      // every remaining mapping (including the current one) so earlier
      // mappings rounding up can never push the total past
      // actualWordCount and starve the LAST mapping down to 0/negative —
      // which would silently drop the tail of the ayah from every segment.
      let newTotal = 0;
      for (let i = 0; i < item.mappings.length; i++) {
        const remainingMappings = item.mappings.length - i;
        if (i === item.mappings.length - 1) {
          item.mappings[i].word_count = Math.max(1, actualWordCount - newTotal);
        } else {
          const proportional = Math.max(1, Math.round((item.mappings[i].word_count / totalUnits) * actualWordCount));
          const maxAllowed = actualWordCount - newTotal - (remainingMappings - 1);
          const adjusted = Math.max(1, Math.min(proportional, maxAllowed));
          item.mappings[i].word_count = adjusted;
          newTotal += adjusted;
        }
      }
    }
  }

  return { data };
}
