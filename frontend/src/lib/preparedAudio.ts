// Where "prepare audio" output (and the timing editor's saved cut, see
// /api/video/save-trimmed-preview) lives, relative to public/. Under
// render-assets -- the persistent `render_assets` Docker volume -- rather
// than renders/temp_audio, which is a tmpfs wiped on every frontend
// container restart: that left saved drafts pointing at a vanished file,
// so the timing editor hung loading a 404 and every render had to
// re-extract the audio from scratch (dropping the user's trim).
// Cleared only by the manual /api/video/cleanup route, same as drafts.
export const PREPARED_AUDIO_REL_DIR = "render-assets/prepared-audio";
