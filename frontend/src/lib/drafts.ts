import fs from "fs/promises";
import path from "path";

// Where /api/drafts keeps a project: its settings as one JSON file, and the
// files uploaded for it (background, audio, font) in a folder of the same id.
export const DRAFTS_DIR = path.join(process.cwd(), "src", "data", "drafts");
export const DRAFT_ASSETS_DIR = path.join(process.cwd(), "public", "render-assets", "drafts");

// Draft ids are always our own crypto.randomUUID() output -- anything else
// could path-traverse out of the two folders above.
const DRAFT_ID_RE = /^[a-f0-9-]{36}$/i;

export function isDraftId(id: unknown): id is string {
  return typeof id === "string" && DRAFT_ID_RE.test(id);
}

// A draft nobody has saved for this long, and that no gallery video links
// back to, is considered abandoned (see pruneAbandonedDrafts).
export const ABANDONED_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Removes a draft's settings and uploaded files. A draft that's already
// gone is not an error.
export async function deleteDraft(id: string): Promise<void> {
  if (!isDraftId(id)) return;
  await fs.unlink(path.join(DRAFTS_DIR, `${id}.json`)).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  await fs.rm(path.join(DRAFT_ASSETS_DIR, id), { recursive: true, force: true });
}

async function modifiedAt(target: string): Promise<number | null> {
  try {
    return (await fs.stat(target)).mtimeMs;
  } catch {
    return null;
  }
}

// A draft belongs to whoever holds its id: the user deletes it themselves
// ("new project", deleting its gallery video, deleting their account). The
// only drafts nobody can ever delete are the ones left behind -- typically
// by a visitor without an account who never came back -- so those, and only
// those, expire on their own. `linkedDraftIds` (every draft a saved gallery
// video was made from, see videoGallery.listLinkedDraftIds) are never
// touched however old: their owner can still press Edit on that video.
// Returns how many were removed.
export async function pruneAbandonedDrafts(linkedDraftIds: Set<string>): Promise<number> {
  const [manifests, assetDirs] = await Promise.all([
    fs.readdir(DRAFTS_DIR).catch(() => [] as string[]),
    fs.readdir(DRAFT_ASSETS_DIR).catch(() => [] as string[]),
  ]);
  // Both folders, so uploaded files whose settings file is already gone
  // are caught too.
  const ids = new Set(
    [...manifests.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)), ...assetDirs].filter(
      isDraftId
    )
  );

  const cutoff = Date.now() - ABANDONED_DRAFT_MAX_AGE_MS;
  let removed = 0;
  for (const id of ids) {
    if (linkedDraftIds.has(id)) continue;
    // Every autosave rewrites the settings file, so its mtime is "last
    // touched"; the folder's own mtime stands in when that file is missing.
    const lastTouched =
      (await modifiedAt(path.join(DRAFTS_DIR, `${id}.json`))) ?? (await modifiedAt(path.join(DRAFT_ASSETS_DIR, id)));
    if (lastTouched === null || lastTouched > cutoff) continue;
    try {
      await deleteDraft(id);
      removed++;
    } catch (err) {
      console.warn(`[Drafts] Failed to prune abandoned draft ${id}:`, err);
    }
  }
  return removed;
}
