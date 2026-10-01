import os
os.environ["HF_HOME"] = "/app/data/huggingface_cache"

import sys
import json
import logging
import argparse
import urllib.request
import subprocess
from pathlib import Path
import re
import threading
import unicodedata
import uuid

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)


class ExtractionError(Exception):
    """Raised on any expected extraction failure, with a message specific
    enough to show the caller (instead of a generic "check logs")."""
    pass


class MacroWindowTooNarrowError(ExtractionError):
    """Raised when Phase 3's coarse free-transcription match lands
    suspiciously close to the edge of the provided audio -- a strong signal
    that the requested ayah range's true content extends beyond what was
    cropped, so the crop should be widened and retried before accepting a
    result that may be missing audio at the source (as opposed to a mere
    forced-alignment/DTW timing error further downstream, which the
    existing collapse-recovery/boundary-cross-check machinery already
    handles). Only raised when the caller opts in via allow_macro_retry,
    since a standalone custom-audio upload has no bigger source to re-crop
    from and should never see this exception."""

    def __init__(self, message, needed_extra_seconds=None):
        super().__init__(message)
        self.needed_extra_seconds = needed_extra_seconds


def _fail(message: str):
    """Log and raise in one call so failure paths keep their exact previous
    log text while also surfacing that same text through the API response,
    instead of it being lost the moment the function used to `return None`."""
    logger.error(message)
    raise ExtractionError(message)


WORK_DIR = Path("/app/data/temp_extraction")
OUTPUT_DIR = Path("/app/data/extracted_clips")
SURAH_CACHE_DIR = Path("/app/data/surah_cache")
WORK_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SURAH_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Maximum number of cached surah files to keep on disk
MAX_SURAH_CACHE = 10

# ========== CACHING SINGLETONS ==========

_model_cache = {}
_model_lock = threading.Lock()

def get_whisper_model(size='small'):
    """Load Whisper model once and reuse across requests."""
    if size not in _model_cache:
        with _model_lock:
            if size not in _model_cache:  # Double-check inside lock
                try:
                    import stable_whisper
                except ImportError:
                    logger.info("installing stable_whisper...")
                    subprocess.run([sys.executable, "-m", "pip", "install", "--no-cache-dir", "faster-whisper", "stable-ts", "torch", "torchaudio", "--extra-index-url", "https://download.pytorch.org/whl/cpu"], check=True)
                    import stable_whisper
                
                logger.info(f"Loading faster-whisper model '{size}' (one-time)...")
                try:
                    _model_cache[size] = stable_whisper.load_faster_whisper(size, device="cuda", compute_type="float16")
                    logger.info(f"faster-whisper model '{size}' loaded successfully on CUDA.")
                except Exception as e:
                    logger.warning(f"Failed to load faster-whisper on CUDA: {e}. Falling back to CPU...")
                    _model_cache[size] = stable_whisper.load_faster_whisper(size, device="cpu", compute_type="int8")
    return _model_cache[size]

_text_cache = {}
_text_cache_lock = threading.Lock()

def _enforce_surah_cache_limit():
    """Remove oldest cached surah files if we exceed MAX_SURAH_CACHE."""
    try:
        cached_files = sorted(SURAH_CACHE_DIR.glob("*_full.mp3"), key=lambda f: f.stat().st_atime)
        while len(cached_files) > MAX_SURAH_CACHE:
            oldest = cached_files.pop(0)
            oldest.unlink(missing_ok=True)
            logger.info(f"Evicted old surah cache: {oldest.name}")
    except Exception as e:
        logger.warning(f"Cache eviction error: {e}")

RECITERS_MP3QURAN = {
    "ajmi": "https://server10.mp3quran.net/ajm/{surah:03d}.mp3",
    "maher": "https://server12.mp3quran.net/maher/{surah:03d}.mp3",
    "mishary": "https://server8.mp3quran.net/afs/{surah:03d}.mp3",
    "yasser": "https://server11.mp3quran.net/yasser/{surah:03d}.mp3",
    "mousa": "https://server14.mp3quran.net/mousa/Rewayat-Hafs-A-n-Assem/{surah:03d}.mp3",
    "raad_alkurdi": "https://server6.mp3quran.net/kurdi/{surah:03d}.mp3"
}

# Mp3Quran ayat_timing "read" ids -- each MUST belong to the exact recording
# in RECITERS_MP3QURAN above (same folder_url in the /ayat_timing/reads
# listing). Reciters left out here get self-generated timings instead, see
# generate_surah_timings(). "maher" is deliberately absent: read 133 is his
# Mujawwad recording (Almusshaf-Al-Mojawwad/), not the Murattal one we
# download, and scaling one onto the other landed on the wrong ayat
# (concretely observed: An-Nisa 27-28 extracted from a different passage).
RECITERS_TIMING_ID = {
    "ajmi": 5,
    "mishary": 123,
    "yasser": 92,
    "mousa": 243,
    "raad_alkurdi": 221
}

# Quran.com (QDC) recitations with human-reviewed, word-level timestamps
# ("segments") for their own surah recordings. For these reciters nothing is
# transcribed or aligned at all: the clip is cut from that exact recording
# and word timings come straight from the segments, see _extract_from_qdc().
# Keys are reciter ids as sent by the frontend (src/lib/reciters.ts), values
# are QDC recitation ids.
RECITERS_QDC = {
    "mishary": 7,
    "yasser": 97,
    "abdulbaset": 2,
    "abdulbaset_mujawwad": 1,
    "sudais": 3,
    "shatri": 4,
    "rifai": 5,
    "husary": 6,
    "minshawi": 9,
    "shuraim": 10,
}
QDC_API = "https://api.qurancdn.com/api/qdc"

# Reciters without quran.com word timings but with Mp3Quran ayat_timing
# (RECITERS_TIMING_ID) for their full-surah recording: ayah boundaries come
# from that data, refined against the pauses in the audio, and the clip is
# cut from the continuous recording so breaths between ayat stay natural.
# Words inside an ayah are placed by letter count over the voiced parts,
# split at the reciter's pauses (see _voiced_word_times).
RECITERS_AYAH_TIMING = {"ajmi", "mousa", "raad_alkurdi"}
MP3QURAN_TIMING_API = "https://www.mp3quran.net/api/v3/ayat_timing"

HUROOF_MUQATTAAH = {
    "الم": "ألف لام ميم",
    "المص": "ألف لام ميم صاد",
    "الر": "ألف لام را",
    "المر": "ألف لام ميم را",
    "كهيعص": "كاف ها يا عين صاد",
    "طه": "طا ها",
    "طسم": "طا سين ميم",
    "طس": "طا سين",
    "يس": "يا سين",
    "ص": "صاد",
    "حم": "حا ميم",
    "عسق": "عين سين قاف",
    "ق": "قاف",
    "ن": "نون"
}

def clean_arabic(text):
    # Remove all diacritics and tashkeel for Whisper alignment
    text = re.sub(r'[\u0617-\u061A\u064B-\u0652\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]', '', text)
    return text.strip()

def download_full_surah(reciter_id, surah_id, url=None, cache_prefix=""):
    url = url or RECITERS_MP3QURAN[reciter_id].format(surah=surah_id)
    # Use persistent cache directory instead of temp. cache_prefix keeps a
    # different recording of the same reciter (e.g. QDC vs Mp3Quran) apart.
    cache_file = SURAH_CACHE_DIR / f"{cache_prefix}{reciter_id}_{surah_id:03d}_full.mp3"
    
    if cache_file.exists():
        logger.info(f"Full Surah {surah_id} for {reciter_id} found in cache.")
        # Touch the file to update access time for LRU eviction
        cache_file.touch()
        return cache_file

    logger.info(f"Downloading full Surah {surah_id} from {url}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    
    temp_file = WORK_DIR / f"temp_raw_{cache_prefix}{reciter_id}_{surah_id:03d}.mp3"
    with urllib.request.urlopen(req, timeout=120) as response:
        with open(temp_file, 'wb') as f:
            f.write(response.read())
            
    logger.info("Sanitizing audio file (stripping cover art and junk data)...")
    try:
        subprocess.run([
            "ffmpeg", "-y",
            "-i", str(temp_file),
            "-vn",                  # Strip video (cover art)
            "-map", "0:a",          # Only map audio stream explicitly
            "-c:a", "copy",         # Copy audio stream without re-encoding
            "-map_metadata", "-1",  # Strip metadata (tags, covers)
            str(cache_file)
        ], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to sanitize audio: {e.output.decode(errors='ignore')}")
        if temp_file.exists(): temp_file.unlink()
        raise e
        
    if temp_file.exists():
        temp_file.unlink()
    
    # Enforce cache size limit
    _enforce_surah_cache_limit()
    return cache_file

def fetch_surah_texts(surah_id):
    # Check in-memory cache first
    with _text_cache_lock:
        if surah_id in _text_cache:
            logger.info(f"Surah {surah_id} texts found in memory cache.")
            return _text_cache[surah_id]

    # Fetch Uthmani text for JSON output
    url_uthmani = f"http://api.alquran.cloud/v1/surah/{surah_id}/quran-uthmani"
    req1 = urllib.request.Request(url_uthmani, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req1, timeout=15) as response:
        data_uthmani = json.loads(response.read().decode())['data']['ayahs']
        
    # Fetch Simple Clean text for Whisper alignment
    url_clean = f"http://api.alquran.cloud/v1/surah/{surah_id}/quran-simple-clean"
    req2 = urllib.request.Request(url_clean, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req2, timeout=15) as response:
        data_clean = json.loads(response.read().decode())['data']['ayahs']
    
    ayahs = {}
    for au, ac in zip(data_uthmani, data_clean):
        ayah_num = au['numberInSurah']
        text_u = au['text']
        text_c = ac['text']
        
        if ayah_num == 1 and text_u.startswith("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ") and surah_id != 1:
            text_u = text_u.replace("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ", "")
            text_c = text_c.replace("بسم الله الرحمن الرحيم ", "")
            
        ayahs[ayah_num] = {
            "uthmani": text_u.split(),
            "clean": text_c.split()
        }
    
    # Store in memory cache
    with _text_cache_lock:
        _text_cache[surah_id] = ayahs
    
    return ayahs

# ========== SELF-GENERATED AYAH TIMINGS ==========
# For recordings with no matching Mp3Quran ayat_timing data. Whisper over a
# whole long recording silently skips stretches (observed: the Basmala of a
# full-surah Al-Fatiha, whole ayat in long surahs), so transcribe in short
# overlapping chunks instead, then align the transcript to the ENTIRE surah
# text in order -- a single monotonic alignment can't confuse one ayah with a
# similar-sounding one elsewhere, unlike a per-request fuzzy search. The
# per-word result is cached per reciter+surah, so only the first request for a
# surah pays the transcription cost; extract_clip() then slices straight from
# it via _extract_from_word_timings().

TIMING_SR = 16000
TIMING_CHUNK_SECONDS = 30.0
TIMING_CHUNK_OVERLAP = 4.0
# Below this fraction of matched words, the recording likely isn't this
# surah (or is too noisy) -- refuse rather than cut the wrong passage.
MIN_TIMING_COVERAGE = 0.6
# Minimum Phase 3 text-match ratio accepted for a reciter extraction.
RECITER_MIN_MATCH_RATIO = 0.35
_timing_gen_lock = threading.Lock()


def _norm_ar(t):
    t = re.sub(r'[ؗ-ًؚ-ْٰۖ-ۭ]', '', t)
    t = re.sub(r'[^\w]', '', t)
    return (t.replace('ٱ', 'ا').replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا')
             .replace('ة', 'ه').replace('ى', 'ي'))


def _load_audio_16k(path):
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(TIMING_SR),
                          "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def _speech_onset(audio, threshold_db=-40.0, frame_seconds=0.05):
    """Time of the first frame louder than threshold_db (0.0 if none)."""
    import numpy as np
    frame = int(TIMING_SR * frame_seconds)
    for i in range(0, len(audio) - frame, frame):
        rms = float(np.sqrt(np.mean(audio[i:i + frame] ** 2)))
        if rms > 0 and 20 * np.log10(rms) > threshold_db:
            return i / TIMING_SR
    return 0.0


def _transcribe_chunked(audio):
    model = get_whisper_model('OdyAsh/faster-whisper-base-ar-quran')
    total = len(audio) / TIMING_SR
    words, start = [], 0.0
    while start < total:
        end = min(total, start + TIMING_CHUNK_SECONDS)
        chunk = audio[int(start * TIMING_SR):int(end * TIMING_SR)]
        result = model.transcribe(chunk, language='ar', word_timestamps=True, verbose=None)
        # Each chunk owns the middle of its overlap with a neighbor, so a word
        # heard by both chunks is kept exactly once.
        keep_from = start + (TIMING_CHUNK_OVERLAP / 2 if start > 0 else 0.0)
        keep_to = end - TIMING_CHUNK_OVERLAP / 2 if end < total else float('inf')
        for seg in result.segments:
            for w in seg.words:
                t0 = start + w.start
                if keep_from <= t0 < keep_to and _norm_ar(w.word):
                    words.append((_norm_ar(w.word), t0, start + w.end))
        if end >= total:
            break
        start = end - TIMING_CHUNK_OVERLAP
    return words


def generate_surah_timings(reciter_id, surah_id, full_audio_path, ayahs_text):
    """Word-level timings for this exact recording, generated once and cached
    next to the surah audio: {"coverage", "duration", "words": {"<ayah>":
    [[start_s, end_s], ...]}} with one entry per word of ayahs_text[a]["clean"]
    (same index as ayahs_text[a]["uthmani"])."""
    import difflib
    cache_file = SURAH_CACHE_DIR / f"{reciter_id}_{surah_id:03d}_timings.json"
    with _timing_gen_lock:
        if cache_file.exists():
            logger.info(f"Self-generated timings for {reciter_id} surah {surah_id} found in cache.")
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)

        logger.info(f"Generating ayah timings for {reciter_id} surah {surah_id} (one-time, chunked transcription)...")
        audio = _load_audio_16k(full_audio_path)
        words = _transcribe_chunked(audio)

        # (normalized token, ayah, word index) for the whole surah, in order.
        # Huroof Muqatta'at expand to their spoken letter names, so one text
        # word can span several tokens.
        expected = []
        for a in sorted(ayahs_text):
            for wi, cw in enumerate(ayahs_text[a]["clean"]):
                for part in HUROOF_MUQATTAAH.get(cw, cw).split():
                    if _norm_ar(part):
                        expected.append((_norm_ar(part), a, wi))

        sm = difflib.SequenceMatcher(None, [w[0] for w in words], [e[0] for e in expected], autojunk=False)
        tok_t = [None] * len(expected)  # index into `words` of each matched token
        for blk in sm.get_matching_blocks():
            for k in range(blk.size):
                tok_t[blk.b + k] = blk.a + k
        coverage = sum(t is not None for t in tok_t) / len(expected) if expected else 0.0
        if coverage < MIN_TIMING_COVERAGE:
            _fail(f"Could not match the recording of surah {surah_id} to its text "
                  f"(only {coverage:.0%} of words matched) -- refusing to guess ayah positions.")

        # Collapse tokens back to text words: [ayah, word index, t_first, t_last]
        # where t_* index into `words` (None when no token of it matched).
        text_words = []
        for i, (_, a, wi) in enumerate(expected):
            if not text_words or text_words[-1][:2] != [a, wi]:
                text_words.append([a, wi, None, None])
            if tok_t[i] is not None:
                tw = text_words[-1]
                tw[2] = tok_t[i] if tw[2] is None else tw[2]
                tw[3] = tok_t[i]
        times = [None] * len(text_words)
        for k, (_, _, t0, t1) in enumerate(text_words):
            if t0 is not None:
                times[k] = [words[t0][1], words[t1][2]]

        # Fill each run of unmatched text words. Prefer what Whisper actually
        # heard in that same gap (e.g. "يس" written as-is while the text
        # expects its spelled-out letter names), assigned one-to-one when the
        # counts line up; a leading gap takes the LAST heard words before the
        # first match, since anything earlier is typically the Basmala or
        # Isti'adha, which aren't part of the surah text. Otherwise spread
        # the run evenly over the gap (from the first audible sound for a
        # leading gap nothing was heard in, e.g. an unrecognized Basmala).
        onset = _speech_onset(audio)
        duration = len(audio) / TIMING_SR
        k = 0
        while k < len(text_words):
            if times[k] is not None:
                k += 1
                continue
            run_end = k
            while run_end < len(text_words) and times[run_end] is None:
                run_end += 1
            n = run_end - k
            prev_t = text_words[k - 1][3] if k > 0 else -1
            next_t = text_words[run_end][2] if run_end < len(text_words) else len(words)
            heard = words[prev_t + 1:next_t]
            if k == 0 and len(heard) > n:
                heard = heard[-n:]
            elif run_end == len(text_words) and len(heard) > n:
                heard = heard[:n]
            if len(heard) == n:
                for j in range(n):
                    times[k + j] = [heard[j][1], heard[j][2]]
            else:
                span_start = heard[0][1] if heard else (times[k - 1][1] if k > 0 else onset)
                span_end = times[run_end][0] if run_end < len(text_words) else duration
                step = max(0.0, span_end - span_start) / n
                for j in range(n):
                    times[k + j] = [span_start + j * step, span_start + (j + 1) * step]
            k = run_end

        words_out = {str(a): [] for a in sorted(ayahs_text)}
        for (a, _, _, _), (ws, we) in zip(text_words, times):
            words_out[str(a)].append([round(ws, 3), round(max(we, ws + 0.05), 3)])
        data = {"coverage": round(coverage, 4), "duration": round(duration, 3), "words": words_out}
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(data, f)
        logger.info(f"Generated word timings for {len(words_out)} ayat (word coverage {coverage:.1%}).")
        return data


def _extract_from_word_timings(reciter_id, surah_id, start_ayah, end_ayah, pad_seconds,
                               full_audio_path, ayahs_text, final_clip_path, final_json_path):
    """Slice start..end ayat straight from generate_surah_timings() word
    timings -- no macro crop or forced alignment (which was observed to
    collapse every word of an ayah into its first second for recordings
    without Mp3Quran timings, e.g. Al-Mulk 10-12 / maher)."""
    data = generate_surah_timings(reciter_id, surah_id, full_audio_path, ayahs_text)
    words = data["words"]
    duration = data["duration"]
    if not words.get(str(start_ayah)) or not words.get(str(end_ayah)):
        _fail(f"No word timings for ayah {start_ayah}-{end_ayah} of surah {surah_id}.")

    abs_start = words[str(start_ayah)][0][0]
    abs_end = words[str(end_ayah)][-1][1]
    # Whisper's last-word boundary tends to cut a final madd short, so extend
    # the end towards the next ayah's first word (never past it).
    next_words = words.get(str(end_ayah + 1))
    next_start = next_words[0][0] if next_words else duration
    abs_end = max(abs_end, min(abs_end + 1.0, next_start - 0.1))

    pad_start_val = 0.250
    slice_start = max(0.0, abs_start - pad_start_val - pad_seconds)
    slice_end = min(duration, abs_end + 0.5 + pad_seconds)
    clip_duration = slice_end - slice_start
    fade = min(0.150, clip_duration / 4)

    logger.info(f"=== Slicing {start_ayah}-{end_ayah} at {slice_start:.2f}s-{slice_end:.2f}s (self-generated word timings) ===")
    subprocess.run([
        "ffmpeg", "-y", "-ss", str(slice_start), "-i", str(full_audio_path), "-t", str(clip_duration), "-vn",
        "-af", f"afade=t=in:st=0:d={fade:.3f},afade=t=out:st={clip_duration - fade:.3f}:d={fade:.3f}",
        "-b:a", "192k", str(final_clip_path)
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if not final_clip_path.exists() or final_clip_path.stat().st_size < 1024:
        _fail("Slice produced an empty or missing clip.")

    verses = {}
    prev_end = 0
    for a in range(start_ayah, end_ayah + 1):
        out = []
        for uthmani_word, (ws, we) in zip(ayahs_text[a]["uthmani"], words.get(str(a), [])):
            start_ms = max(prev_end, int((ws - slice_start) * 1000))
            end_ms = max(start_ms + 50, int((we - slice_start) * 1000))
            out.append({"w": uthmani_word, "start": start_ms, "end": end_ms})
            prev_end = end_ms
        verses[str(a)] = {"words": out}

    with open(final_json_path, "w", encoding="utf-8") as f:
        json.dump({
            "surah": surah_id, "start_ayah": start_ayah, "end_ayah": end_ayah, "reciter": reciter_id,
            "pad_seconds": pad_seconds,
            # Low-confidence only when this surah matched poorly overall.
            "lowConfidenceEnd": data["coverage"] < 0.85,
            "verses": verses,
        }, f, ensure_ascii=False, indent=2)
    logger.info(f"Done. Extracted: {final_clip_path}")
    return str(final_clip_path), str(final_json_path)


# ========== QURAN.COM (QDC) WORD TIMINGS ==========

_qdc_lock = threading.Lock()


def _qdc_get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode())


def _qdc_cached(name, url):
    """Fetch a QDC API response once and keep it next to the surah audio --
    timings and word texts for a recording never change."""
    cache_file = SURAH_CACHE_DIR / name
    with _qdc_lock:
        if cache_file.exists():
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)
        data = _qdc_get_json(url)
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return data


_ALEF_FORMS = {"\u0671": "\u0627", "\u0623": "\u0627", "\u0625": "\u0627", "\u0622": "\u0627", "\u0649": "\u064A"}


def _qdc_letters(text):
    """Base letters only -- drops harakat, Quranic annotation marks, tatweel
    and small letters (anything but a non-modifier letter), and unifies alef
    forms -- so QDC's and alquran.cloud's spellings of a word compare equal."""
    out = []
    for ch in unicodedata.normalize("NFC", text):
        cat = unicodedata.category(ch)
        if cat.startswith("L") and cat != "Lm":
            out.append(_ALEF_FORMS.get(ch, ch))
    return "".join(out)


def _map_qdc_to_tokens(tokens, qdc_words, qdc_times):
    """Timings for each alquran.cloud token of one ayah, from QDC's word
    timings. The two tokenizations differ (alquran.cloud splits pause marks
    into their own tokens, writes a few words apart that QDC joins, and keeps
    the Basmala inside ayah 1 of some surahs), so they're aligned letter by
    letter instead of by index. A QDC word covering several tokens is split
    between them by letter count; tokens with no letters in the recording
    (pause marks, an extra Basmala) get None."""
    import difflib
    a_chars, a_owner = [], []
    for i, t in enumerate(tokens):
        for ch in _qdc_letters(t):
            a_chars.append(ch)
            a_owner.append(i)
    q_chars, q_owner = [], []
    for j, w in enumerate(qdc_words):
        for ch in _qdc_letters(w):
            q_chars.append(ch)
            q_owner.append(j)

    # How many letters of QDC word j matched each token.
    per_word = [dict() for _ in qdc_words]
    sm = difflib.SequenceMatcher(None, a_chars, q_chars, autojunk=False)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            ti, qj = a_owner[blk.a + k], q_owner[blk.b + k]
            per_word[qj][ti] = per_word[qj].get(ti, 0) + 1

    times = [None] * len(tokens)
    for j, counts in enumerate(per_word):
        if not counts:
            continue
        ws, we = qdc_times[j]
        total = sum(counts.values())
        cursor = ws
        for ti in sorted(counts):
            piece_end = cursor + (we - ws) * counts[ti] / total
            if times[ti] is None:
                times[ti] = [cursor, piece_end]
            else:
                times[ti] = [min(times[ti][0], cursor), max(times[ti][1], piece_end)]
            cursor = piece_end
    return times


# Pauses shorter than this, or quieter parts of a recitation above this
# level, don't count as silence between ayat.
SILENCE_DB = -35
SILENCE_MIN_SECONDS = 0.2
# How far from quran.com's ayah boundary a pause may be and still be taken
# as that boundary.
BOUNDARY_SNAP_WINDOW = 1.5


# For recordings with reverb or background noise the pauses between ayat
# never get quiet enough for silencedetect, which compares every single
# sample against its threshold (one echo peak breaks the pause). "adaptive"
# instead looks at loudness per short frame and treats frames this far below
# the reciter's typical (median) level as a pause.
ADAPTIVE_PAUSE_BELOW_MEDIAN_DB = 8
PAUSE_FRAME_SECONDS = 0.05


def _detect_pauses_rms(audio_path):
    """Pauses from per-frame RMS loudness, relative to the recording's median
    frame level. Streams the decoded audio so a two-hour surah stays cheap."""
    import numpy as np
    sr = 8000
    frame = int(sr * PAUSE_FRAME_SECONDS)
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(audio_path), "-ac", "1", "-ar", str(sr),
                             "-f", "s16le", "-"], stdout=subprocess.PIPE)
    levels, leftover = [], b""
    while True:
        chunk = proc.stdout.read(frame * 2 * 1200)
        if not chunk:
            break
        data = leftover + chunk
        usable = len(data) // (frame * 2) * frame * 2
        leftover = data[usable:]
        samples = np.frombuffer(data[:usable], np.int16).astype(np.float32) / 32768.0
        rms = np.sqrt((samples.reshape(-1, frame) ** 2).mean(axis=1)) + 1e-9
        levels.append(20 * np.log10(rms))
    proc.wait()
    if not levels:
        return []
    db = np.concatenate(levels)
    voiced = db[db > -60]
    if len(voiced) == 0:
        return []
    threshold = float(np.median(voiced)) - ADAPTIVE_PAUSE_BELOW_MEDIAN_DB
    quiet = db < threshold
    pauses, start = [], None
    for i, q in enumerate(quiet):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if (i - start) * PAUSE_FRAME_SECONDS >= SILENCE_MIN_SECONDS:
                pauses.append((start * PAUSE_FRAME_SECONDS, i * PAUSE_FRAME_SECONDS))
            start = None
    if start is not None and (len(quiet) - start) * PAUSE_FRAME_SECONDS >= SILENCE_MIN_SECONDS:
        pauses.append((start * PAUSE_FRAME_SECONDS, len(quiet) * PAUSE_FRAME_SECONDS))
    return pauses


def _detect_silences(audio_path, adaptive=False):
    """[(start, end), ...] of every pause in the recording, cached next to it."""
    suffix = "_silences_adaptive.json" if adaptive else "_silences.json"
    cache_file = audio_path.with_name(audio_path.stem + suffix)
    if cache_file.exists():
        with open(cache_file, "r", encoding="utf-8") as f:
            return [tuple(x) for x in json.load(f)]
    silences = _detect_silences_uncached(audio_path, adaptive)
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(silences, f)
    return silences


def _detect_silences_uncached(audio_path, adaptive=False):
    if adaptive:
        return _detect_pauses_rms(audio_path)
    out = subprocess.run(
        ["ffmpeg", "-v", "info", "-nostats", "-i", str(audio_path),
         "-af", f"silencedetect=n={SILENCE_DB}dB:d={SILENCE_MIN_SECONDS}", "-f", "null", "-"],
        capture_output=True, text=True).stderr
    silences, start = [], None
    for m in re.finditer(r"silence_(start|end): (-?[0-9.]+)", out):
        if m.group(1) == "start":
            start = max(0.0, float(m.group(2)))
        elif start is not None:
            silences.append((start, float(m.group(2))))
            start = None
    return silences


def _snap_ayah_boundaries(ayahs, q_by_ayah, from_by_ayah, silences):
    """quran.com's word segments can put an ayah's first word ~0.5-1s early
    and cut its last word's madd short (observed: Mishary, An-Nasr 2-3),
    while the recording itself has a clear pause between ayat. Move each
    ayah's first word start to the end of the pause nearest quran.com's own
    ayah start, and the previous ayah's last word end to where that pause
    begins. With no pause nearby (ayat recited joined), only clamp to
    quran.com's ayah start. Edits q_by_ayah in place."""
    def nearest(t):
        best, best_d = None, BOUNDARY_SNAP_WINDOW
        for s0, s1 in silences:
            d = 0.0 if s0 <= t <= s1 else min(abs(t - s0), abs(t - s1))
            if d <= best_d:
                best, best_d = (s0, s1), d
        return best

    prev = None
    for ayah in ayahs:
        cur = q_by_ayah.get(ayah)
        if not cur:
            continue
        first_start, first_end = cur[0]
        target = from_by_ayah[ayah] if prev is not None else first_start
        sil = nearest(target)
        new_start = sil[1] - 0.03 if sil is not None else None
        # A "pause" reaching past the whole first word is more likely quiet
        # recitation than silence -- don't trust it for the start.
        if new_start is not None and new_start < first_end - 0.05 and (prev is None or new_start > prev[-1][0] + 0.05):
            cur[0] = (new_start, first_end)
            # The previous ayah's recitation runs until the pause begins.
            if prev is not None and prev[-1][1] <= sil[1] + 0.1:
                prev[-1] = (prev[-1][0], max(prev[-1][0] + 0.05, sil[0] + 0.05))
        elif prev is not None and first_start < target < first_end - 0.05:
            cur[0] = (target, first_end)
        prev = cur

    # The surah's final ayah: its last word lasts until the closing pause.
    if prev:
        last_start, last_end = prev[-1]
        after = [s0 for s0, _ in silences if last_end - 0.2 <= s0 <= last_end + 3.0]
        if after:
            prev[-1] = (last_start, max(last_end, after[0] + 0.05))


def _speech_bounds(a0, a1, silences):
    """[a0, a1] with any pause touching either edge cut off (within a small
    tolerance -- frame rounding can leave a pause a few ms short of the
    file's end)."""
    tol = 0.15
    start, end = a0, a1
    for s0, s1 in silences:
        if s0 - tol <= start < s1:
            start = max(start, s1)
        if s0 < end <= s1 + tol:
            end = min(end, s0)
    return (start, end) if end - start > 0.1 else (a0, a1)


def _voiced_word_times(tokens, a0, a1, silences):
    """Word timings for one ayah spoken within [a0, a1] (seconds), without
    any speech recognition: the reciter's pauses inside the ayah split it
    into voiced chunks, each pause is matched to the word boundary whose
    letter-count position is closest (preferring one right after a pause
    mark), and words share each chunk by letter count. Tokens without
    letters (pause marks) get None."""
    weights = [len(_qdc_letters(t)) for t in tokens]
    total_w = sum(weights)
    if total_w == 0:
        return [None] * len(tokens)

    a0, a1 = _speech_bounds(a0, a1, silences)
    inner = [(max(s0, a0), min(s1, a1)) for s0, s1 in silences if s0 > a0 + 0.1 and s1 < a1 - 0.1]
    chunks, cursor = [], a0
    for s0, s1 in inner:
        chunks.append((cursor, s0))
        cursor = s1
    chunks.append((cursor, a1))
    voiced_total = sum(e - b for b, e in chunks) or (a1 - a0)

    # Candidate word boundaries: index j = first token of the next chunk.
    word_idx = [i for i, w in enumerate(weights) if w > 0]
    cum_before = {}
    acc = 0
    for i, w in enumerate(weights):
        cum_before[i] = acc / total_w
        acc += w

    def after_pause_mark(j):
        return j > 0 and weights[j - 1] == 0

    cuts = []  # token index where each chunk after the first starts
    voiced_so_far = 0.0
    for k, (b, e) in enumerate(chunks[:-1]):
        voiced_so_far += e - b
        frac = voiced_so_far / voiced_total
        remaining_cuts = len(chunks) - 2 - k
        options = [j for j in word_idx
                   if j > (cuts[-1] if cuts else 0)
                   and sum(1 for x in word_idx if x >= j) > remaining_cuts]
        if not options:
            break
        best = min(options, key=lambda j: abs(cum_before[j] - frac) - (0.05 if after_pause_mark(j) else 0))
        cuts.append(best)

    if len(cuts) != len(chunks) - 1:
        # Couldn't place every pause -- treat the ayah as one voiced run.
        chunks, cuts = [(a0, a1)], []

    times = [None] * len(tokens)
    bounds = [0] + cuts + [len(tokens)]
    for (b, e), t0, t1 in zip(chunks, bounds, bounds[1:]):
        group_w = sum(weights[t0:t1])
        cur = b
        for i in range(t0, t1):
            if weights[i] == 0:
                continue
            dur = (e - b) * weights[i] / group_w if group_w else 0.0
            times[i] = [cur, cur + dur]
            cur += dur
    return times


def _ayah_word_json(tokens, times, offset, prev_start):
    """Clip-relative word entries (ms) for one ayah; same rules as the QDC
    path: starts never move backwards, pause marks become blips."""
    out = []
    for word, t in zip(tokens, times):
        if t is None:
            start_ms = prev_start
            end_ms = start_ms + 50
        else:
            start_ms = max(prev_start, int((t[0] - offset) * 1000))
            end_ms = max(start_ms + 50, int((t[1] - offset) * 1000))
        out.append({"w": word, "start": start_ms, "end": end_ms})
        prev_start = start_ms
    return out, prev_start


def _register_ayah_timing(by_ayah, duration, silences):
    """(ratio, shift) mapping Mp3Quran's ayah times onto this file. The file
    and the timing data don't always have the same length (extra silence at
    the end, a different intro), so rather than assuming a stretch, try no
    stretch and the length ratio, each with a small shift, and keep whichever
    puts the most ayah boundaries inside actual pauses. Ties favour no
    stretch and the smallest shift."""
    api_total = max(e for _, e in by_ayah.values())
    starts = [st for st, _ in by_ayah.values() if st > 0.5]
    if not starts or not silences:
        return 1.0, 0.0

    def score(ratio, shift):
        hits = 0
        for st in starts:
            t = st * ratio + shift
            if any(s0 - 0.15 <= t <= s1 + 0.15 for s0, s1 in silences):
                hits += 1
        return hits

    baseline = score(1.0, 0.0)
    best = (baseline, 0, 0.0, 1.0, 0.0)
    ratios = [1.0] + ([duration / api_total] if api_total > 0 and abs(duration - api_total) > 0.5 else [])
    for ri, ratio in enumerate(ratios):
        for step in range(-150, 151):
            shift = step * 0.02
            cand = (score(ratio, shift), -ri, -abs(shift), ratio, shift)
            if cand > best:
                best = cand
    # Only move away from the data as published when the evidence is clear
    # -- a handful of lucky hits must not shift every ayah.
    if best[0] < max(3, 0.3 * len(starts)) or best[0] < baseline + 2:
        best = (baseline, 0, 0.0, 1.0, 0.0)
    logger.info(f"Ayah timing registration: ratio={best[3]:.4f} shift={best[4]:+.2f}s "
                f"({best[0]}/{len(starts)} ayah starts in pauses, {baseline} as published)")
    return best[3], best[4]


def _extract_from_ayah_timings(reciter_id, surah_id, start_ayah, end_ayah, pad_seconds,
                               final_clip_path, final_json_path):
    """Mp3Quran full-surah recording + its ayah start/end times, with each
    boundary moved onto the actual pause between the two ayat."""
    ayahs_text = fetch_surah_texts(surah_id)
    if start_ayah not in ayahs_text or end_ayah not in ayahs_text:
        _fail(f"Ayah bounds error: surah {surah_id} has no ayah {start_ayah} or {end_ayah}.")

    timing = _qdc_cached(f"mp3quran_{reciter_id}_{surah_id:03d}_timing.json",
                         f"{MP3QURAN_TIMING_API}?surah={surah_id}&read={RECITERS_TIMING_ID[reciter_id]}")
    if isinstance(timing, dict):
        timing = timing.get("times") or timing.get("ayat_timing") or next(
            (v for v in timing.values() if isinstance(v, list)), [])
    by_ayah = {int(t["ayah"]): (float(t["start_time"]) / 1000.0, float(t["end_time"]) / 1000.0)
               for t in timing if int(t.get("ayah", 0)) > 0}
    if start_ayah not in by_ayah or end_ayah not in by_ayah:
        _fail(f"Mp3Quran has no ayah timing for {start_ayah}-{end_ayah} of surah {surah_id}.")

    full_audio_path = download_full_surah(reciter_id, surah_id)
    duration = float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(full_audio_path)], text=True).strip())
    silences = _detect_silences(full_audio_path, adaptive=True)
    ratio, shift = _register_ayah_timing(by_ayah, duration, silences)

    def nearest_pause(t):
        best, best_d = None, BOUNDARY_SNAP_WINDOW
        for s0, s1 in silences:
            d = 0.0 if s0 <= t <= s1 else min(abs(t - s0), abs(t - s1))
            if d <= best_d:
                best, best_d = (s0, s1), d
        return best

    # Speech region of each ayah: from the pause before it ends to the
    # pause after it begins.
    regions = {}
    for a in range(start_ayah, end_ayah + 1):
        t_start, t_end = by_ayah[a][0] * ratio + shift, by_ayah[a][1] * ratio + shift
        p = nearest_pause(t_start)
        a0 = p[1] if p else t_start
        p = nearest_pause(t_end)
        a1 = p[0] if p and p[0] > a0 + 0.3 else t_end
        regions[a] = (a0, max(a1, a0 + 0.3))

    slice_start = max(0.0, regions[start_ayah][0] - 0.250 - pad_seconds)
    slice_end = min(duration, regions[end_ayah][1] + 0.3 + pad_seconds)
    clip_duration = slice_end - slice_start
    fade = min(0.150, clip_duration / 4)
    logger.info(f"=== Slicing {start_ayah}-{end_ayah} at {slice_start:.2f}s-{slice_end:.2f}s (Mp3Quran ayah timings) ===")
    subprocess.run([
        "ffmpeg", "-y", "-ss", str(slice_start), "-i", str(full_audio_path), "-t", str(clip_duration), "-vn",
        "-af", f"afade=t=in:st=0:d={fade:.3f},afade=t=out:st={clip_duration - fade:.3f}:d={fade:.3f}",
        "-b:a", "192k", str(final_clip_path)
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if not final_clip_path.exists() or final_clip_path.stat().st_size < 1024:
        _fail("Slice produced an empty or missing clip.")

    verses, prev_start = {}, 0
    for a in range(start_ayah, end_ayah + 1):
        tokens = ayahs_text[a]["uthmani"]
        times = _voiced_word_times(tokens, regions[a][0], regions[a][1], silences)
        words, prev_start = _ayah_word_json(tokens, times, slice_start, prev_start)
        verses[str(a)] = {"words": words}
    _write_clip_json(final_json_path, surah_id, start_ayah, end_ayah, reciter_id, pad_seconds, "mp3quran_timing", verses)
    logger.info(f"Done. Extracted: {final_clip_path}")
    return str(final_clip_path), str(final_json_path)


def _write_clip_json(path, surah_id, start_ayah, end_ayah, reciter_id, pad_seconds, source, verses):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "surah": surah_id, "start_ayah": start_ayah, "end_ayah": end_ayah, "reciter": reciter_id,
            "pad_seconds": pad_seconds,
            "source": source,
            "lowConfidenceEnd": False,
            "verses": verses,
        }, f, ensure_ascii=False, indent=2)


def _qdc_surah_timings(reciter_id, surah_id, ayahs_text, silences=()):
    """{"audio_url", "verses": {ayah: {"from", "to", "words": [[s, e] | None
    per alquran.cloud token]}}} in seconds, for this reciter's QDC recording.
    `silences` (see _detect_silences) refines the ayah boundaries."""
    rid = RECITERS_QDC[reciter_id]
    audio = _qdc_cached(f"qdc_{reciter_id}_{surah_id:03d}_audio.json",
                        f"{QDC_API}/audio/reciters/{rid}/audio_files?chapter={surah_id}&segments=true")
    words = _qdc_cached(f"qdc_{surah_id:03d}_words.json",
                        f"{QDC_API}/verses/by_chapter/{surah_id}?words=true&word_fields=text_uthmani&per_page=300")

    audio_file = audio["audio_files"][0]
    qdc_words_by_ayah = {}
    for v in words["verses"]:
        ayah = int(v["verse_key"].split(":")[1])
        # (position, text) of real words only -- not the ayah-number glyph.
        qdc_words_by_ayah[ayah] = [
            (w["position"], w["text_uthmani"]) for w in v["words"]
            if w.get("char_type_name") == "word" and _qdc_letters(w["text_uthmani"])
        ]

    verses = {}
    for vt in audio_file["verse_timings"]:
        ayah = int(vt["verse_key"].split(":")[1])
        v_from, v_to = vt["timestamp_from"] / 1000.0, vt["timestamp_to"] / 1000.0
        # Reciters often stop and go back a few words (e.g. Mishary in 2:14
        # reads words 1-11, repeats 7-11, then continues), so a position can
        # appear several times, in order. Each word spans from the FIRST
        # time it starts to the LAST time it ends: its segment then stays on
        # screen through the whole passage, repeat included.
        seg_by_pos = {}
        verse_max_end = None
        for seg in vt.get("segments") or []:
            # A few QDC segments are malformed (missing fields) -- skip them.
            if len(seg) >= 3 and all(isinstance(x, (int, float)) for x in seg[:3]):
                pos, ws, we = int(seg[0]), seg[1] / 1000.0, seg[2] / 1000.0
                first = seg_by_pos.get(pos)
                seg_by_pos[pos] = (first[0], max(first[1], we)) if first else (ws, we)
                verse_max_end = we if verse_max_end is None else max(verse_max_end, we)

        qw = qdc_words_by_ayah.get(ayah, [])
        q_times = [seg_by_pos.get(pos) for pos, _ in qw]
        # Words without a segment are spread over the gap between their
        # timed neighbours (or the ayah bounds).
        k = 0
        while k < len(q_times):
            if q_times[k] is not None:
                k += 1
                continue
            run_end = k
            while run_end < len(q_times) and q_times[run_end] is None:
                run_end += 1
            gap_end = q_times[run_end][0] if run_end < len(q_times) else v_to
            gap_start = min(q_times[k - 1][1], gap_end) if k > 0 else v_from
            step = max(0.0, gap_end - gap_start) / (run_end - k)
            for j in range(k, run_end):
                q_times[j] = (gap_start + (j - k) * step, gap_start + (j - k + 1) * step)
            k = run_end
        # A repeat of the ayah's closing words must stay inside the ayah.
        if q_times and verse_max_end is not None and verse_max_end > q_times[-1][1]:
            q_times[-1] = (q_times[-1][0], verse_max_end)

        verses[ayah] = {"from": v_from, "to": v_to, "qw": qw, "q_times": q_times}

    ayahs = sorted(verses)
    _snap_ayah_boundaries(
        ayahs,
        {a: verses[a]["q_times"] for a in ayahs},
        {a: verses[a]["from"] for a in ayahs},
        silences,
    )
    for ayah in ayahs:
        v = verses[ayah]
        tokens = ayahs_text.get(ayah, {}).get("uthmani", [])
        v["words"] = _map_qdc_to_tokens(tokens, [t for _, t in v.pop("qw")], v.pop("q_times"))
    return {"audio_url": audio_file["audio_url"], "verses": verses}


def _extract_from_qdc(reciter_id, surah_id, start_ayah, end_ayah, pad_seconds,
                      final_clip_path, final_json_path):
    ayahs_text = fetch_surah_texts(surah_id)
    if start_ayah not in ayahs_text or end_ayah not in ayahs_text:
        _fail(f"Ayah bounds error: surah {surah_id} has no ayah {start_ayah} or {end_ayah}.")

    # The recording the timings were made for -- NOT the Mp3Quran one.
    rid = RECITERS_QDC[reciter_id]
    audio_meta = _qdc_cached(f"qdc_{reciter_id}_{surah_id:03d}_audio.json",
                             f"{QDC_API}/audio/reciters/{rid}/audio_files?chapter={surah_id}&segments=true")
    full_audio_path = download_full_surah(reciter_id, surah_id, url=audio_meta["audio_files"][0]["audio_url"],
                                          cache_prefix="qdc_")
    duration = float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(full_audio_path)], text=True).strip())

    data = _qdc_surah_timings(reciter_id, surah_id, ayahs_text, _detect_silences(full_audio_path))
    verses_t = data["verses"]
    if start_ayah not in verses_t or end_ayah not in verses_t:
        _fail(f"Quran.com has no timings for ayah {start_ayah}-{end_ayah} of surah {surah_id}.")

    first_timed = [t for t in verses_t[start_ayah]["words"] if t]
    last_timed = [t for t in verses_t[end_ayah]["words"] if t]
    clip_from = min([verses_t[start_ayah]["from"]] + [t[0] for t in first_timed])
    clip_to = max([verses_t[end_ayah]["to"]] + [t[1] for t in last_timed])
    slice_start = max(0.0, clip_from - 0.250 - pad_seconds)
    slice_end = min(duration, clip_to + pad_seconds)
    clip_duration = slice_end - slice_start
    fade = min(0.150, clip_duration / 4)

    logger.info(f"=== Slicing {start_ayah}-{end_ayah} at {slice_start:.2f}s-{slice_end:.2f}s (quran.com word timings) ===")
    subprocess.run([
        "ffmpeg", "-y", "-ss", str(slice_start), "-i", str(full_audio_path), "-t", str(clip_duration), "-vn",
        "-af", f"afade=t=in:st=0:d={fade:.3f},afade=t=out:st={clip_duration - fade:.3f}:d={fade:.3f}",
        "-b:a", "192k", str(final_clip_path)
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if not final_clip_path.exists() or final_clip_path.stat().st_size < 1024:
        _fail("Slice produced an empty or missing clip.")

    # Starts only ever move forward; ends may overlap the next word's start
    # when the reciter went back and repeated it (see _qdc_surah_timings).
    verses = {}
    prev_start = 0
    for a in range(start_ayah, end_ayah + 1):
        v = verses_t.get(a)
        tokens = ayahs_text[a]["uthmani"]
        times = v["words"] if v else [None] * len(tokens)
        out = []
        for word, t in zip(tokens, times):
            if t is None:
                # Pause mark / Basmala token: a blip at the previous word's
                # start, so it never pushes the following word later.
                start_ms = prev_start
                end_ms = start_ms + 50
            else:
                start_ms = max(prev_start, int((t[0] - slice_start) * 1000))
                end_ms = max(start_ms + 50, int((t[1] - slice_start) * 1000))
            out.append({"w": word, "start": start_ms, "end": end_ms})
            prev_start = start_ms
        verses[str(a)] = {"words": out}

    with open(final_json_path, "w", encoding="utf-8") as f:
        json.dump({
            "surah": surah_id, "start_ayah": start_ayah, "end_ayah": end_ayah, "reciter": reciter_id,
            "pad_seconds": pad_seconds,
            "source": "qdc",
            "lowConfidenceEnd": False,
            "verses": verses,
        }, f, ensure_ascii=False, indent=2)
    logger.info(f"Done. Extracted: {final_clip_path}")
    return str(final_clip_path), str(final_json_path)


def extract_clip(reciter_id, surah_id, start_ayah, end_ayah, pad_seconds=0.0):
    if reciter_id not in RECITERS_MP3QURAN and reciter_id not in RECITERS_QDC:
        _fail(f"Reciter '{reciter_id}' not found.")

    # "qdc" in the name: a clip cached from the older Mp3Quran/Whisper path
    # for the same reciter must never be reused for the QDC one.
    source_tag = ("_qdc" if reciter_id in RECITERS_QDC
                  else "_at" if reciter_id in RECITERS_AYAH_TIMING
                  else "")
    clip_name = f"{reciter_id}{source_tag}_{surah_id:03d}_{start_ayah}-{end_ayah}"
    final_clip_path = OUTPUT_DIR / f"{clip_name}.mp3"
    final_json_path = OUTPUT_DIR / f"{clip_name}.json"

    # This whole function is a real Whisper transcription + DTW forced-alignment
    # pipeline (Phases 1-8 below), not a lookup -- it used to unconditionally
    # delete and redo it EVERY time, even for the exact same (reciter, surah,
    # start, end, pad_seconds) combo already extracted successfully seconds/
    # minutes earlier (e.g. the user picking a reciter they'd already tried,
    # or the wizard's own re-renders). That made every re-selection pay the
    # full cost again for no reason. Reuse a cached result instead, as long as
    # it was written with the same pad_seconds this call wants (an older
    # cache file predating the "pad_seconds" JSON field, or one written for a
    # different padding, is NOT reused -- correctness over speed) and the mp3
    # isn't a truncated/empty leftover from an interrupted previous run.
    if final_json_path.exists() and final_clip_path.exists():
        try:
            with open(final_json_path, "r", encoding="utf-8") as f:
                cached_json = json.load(f)
            cached_pad_seconds = cached_json.get("pad_seconds")
            if cached_pad_seconds == pad_seconds and final_clip_path.stat().st_size > 1024:
                logger.info(f"Cache hit for {clip_name} (pad_seconds={pad_seconds}) -- reusing existing extraction.")
                return str(final_clip_path), str(final_json_path)
            else:
                logger.info(
                    f"Cache present for {clip_name} but stale (cached pad_seconds={cached_pad_seconds!r}, "
                    f"requested={pad_seconds!r}) or truncated -- re-extracting."
                )
        except Exception as e:
            logger.warning(f"Cached extraction for {clip_name} unreadable ({e}) -- re-extracting.")

    if final_json_path.exists():
        final_json_path.unlink()
    if final_clip_path.exists():
        final_clip_path.unlink()

    if reciter_id in RECITERS_QDC:
        return _extract_from_qdc(reciter_id, surah_id, start_ayah, end_ayah, pad_seconds,
                                 final_clip_path, final_json_path)

    if reciter_id in RECITERS_AYAH_TIMING:
        try:
            return _extract_from_ayah_timings(reciter_id, surah_id, start_ayah, end_ayah, pad_seconds,
                                              final_clip_path, final_json_path)
        except Exception as e:
            # Source down or incomplete -- the older Whisper pipeline below
            # still works from the full-surah recording.
            logger.warning(f"Per-ayah extraction failed for {reciter_id} {surah_id}:{start_ayah}-{end_ayah} "
                           f"({e}) -- falling back to Whisper alignment.")
            for path in (final_clip_path, final_json_path):
                if path.exists():
                    path.unlink()

    logger.info("=== Phase 1: Preparation ===")
    full_audio_path = None
    macro_clip_path = None
    
    try:
        full_audio_path = download_full_surah(reciter_id, surah_id)
        ayahs_text = fetch_surah_texts(surah_id)
        
        if start_ayah not in ayahs_text or end_ayah not in ayahs_text:
            _fail(f"Ayah bounds error: surah {surah_id} has no ayah {start_ayah} or {end_ayah}.")

        if reciter_id not in RECITERS_TIMING_ID:
            return _extract_from_word_timings(reciter_id, surah_id, start_ayah, end_ayah, pad_seconds,
                                              full_audio_path, ayahs_text, final_clip_path, final_json_path)

        logger.info("=== Phase 2: Macro-Alignment (Mp3Quran API) ===")
        timing_url = f"https://mp3quran.net/api/v3/ayat_timing?surah={surah_id}&read={RECITERS_TIMING_ID[reciter_id]}"
        req = urllib.request.Request(timing_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as response:
            api_data = json.loads(response.read().decode())
            # Some versions of API return list, some return {"times": [...]}
            if isinstance(api_data, dict) and "times" in api_data:
                timings = api_data["times"]
            elif isinstance(api_data, dict) and "ayat_timing" in api_data:
                timings = api_data["ayat_timing"]
            elif isinstance(api_data, list):
                timings = api_data
            else:
                # Try to find any list in the response
                timings = next((v for v in api_data.values() if isinstance(v, list)), [])
            
        if not timings:
            _fail("Failed to parse timings array from Mp3Quran API — the reciter timing service may be down.")

        # First find target timings
        target_start_timing = next((t for t in timings if t["ayah"] == start_ayah), None)
        target_end_timing = next((t for t in timings if t["ayah"] == end_ayah), None)
        if not target_start_timing or not target_end_timing:
            _fail(f"Target timing data not found for ayah {start_ayah}-{end_ayah} from Mp3Quran API.")

        # --- PROPORTIONAL SCALING FIX ---
        api_total_duration = float(timings[-1]["end_time"]) / 1000.0
        
        actual_duration = api_total_duration
        try:
            probe_cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(full_audio_path)]
            probe_out = subprocess.check_output(probe_cmd, text=True).strip()
            if probe_out:
                actual_duration = float(probe_out)
        except Exception as e:
            logger.warning(f"Could not get actual duration from ffprobe: {e}")
            
        ratio = 1.0
        if abs(actual_duration - api_total_duration) > (0.05 * api_total_duration):
            ratio = actual_duration / api_total_duration
            logger.info(f"Timing mismatch detected. Scaling timings by ratio: {ratio:.4f} (Actual: {actual_duration}s, API: {api_total_duration}s)")
            
        # Calculate precise macro boundaries based on pad_seconds
        # We add 5.0s of extra margin to give Whisper acoustic context
        macro_start = max(0, (float(target_start_timing["start_time"]) / 1000.0 * ratio) - pad_seconds - 5.0)
        macro_end = min(actual_duration, (float(target_end_timing["end_time"]) / 1000.0 * ratio) + pad_seconds + 5.0)
        
        # For last verses, add extra padding since there's no next ayah timing to bound us
        if end_ayah == len(ayahs_text):
            macro_end = min(actual_duration, macro_end + 5.0)

        # Guard against bad/truncated end_time data from the Mp3Quran API
        # (observed for at least one surah's final ayah) collapsing the
        # macro window to near-zero or negative length, which ffmpeg turns
        # into an empty output file. When the computed window is
        # suspiciously short, fall back to running all the way to the end
        # of the downloaded audio -- Phase 3's content-based localization
        # crops this back down precisely regardless of how much slack this
        # window starts with, so widening it here is always safe.
        MIN_MACRO_DURATION = pad_seconds + 10.0
        if macro_end - macro_start < MIN_MACRO_DURATION:
            logger.warning(
                f"Macro window too short ({macro_end - macro_start:.2f}s, start={macro_start:.2f}, "
                f"end={macro_end:.2f}) -- likely bad Mp3Quran timing data for ayah {end_ayah}. "
                f"Falling back to end-of-file ({actual_duration:.2f}s)."
            )
            macro_end = actual_duration

        # Dynamically determine pad_start and pad_end by finding which ayahs are inside [macro_start, macro_end]
        pad_start = 1
        for t in timings:
            if float(t["end_time"]) / 1000.0 * ratio > macro_start:
                pad_start = t["ayah"]
                break
                
        pad_end = len(ayahs_text)
        for t in reversed(timings):
            if float(t["start_time"]) / 1000.0 * ratio < macro_end:
                pad_end = t["ayah"]
                break
                
        # Ensure pad_start/end are reasonable and include target
        if pad_start == 0: pad_start = 1
        pad_start = min(max(1, pad_start), start_ayah)
        pad_end = max(min(len(ayahs_text), pad_end), end_ayah)
        
        logger.info(f"Target verses: {start_ayah}-{end_ayah}. Extracted macro covers text: {pad_start}-{pad_end}.")
        
        macro_duration = macro_end - macro_start
        
        # Suffixed with a per-call uuid, NOT just clip_name -- two requests
        # for the identical reciter/surah/ayah-range (e.g. the frontend's
        # debounced auto-prepare firing alongside a manual click, or two
        # browser tabs) used to share this exact path, so one's `ffmpeg -y`
        # truncated the file out from under the other's still-in-progress
        # read/validation, failing both with "Macro clip empty".
        macro_clip_path = WORK_DIR / f"macro_{clip_name}_{uuid.uuid4().hex[:8]}.wav"
        
        # Use -ss after -i for accurate output seeking. 
        # We output to WAV format because WAV is uncompressed and guarantees 
        # mathematically perfect fast-seeking (-ss before -i) in Phase 5.
        # This completely fixes the "audio starts too early/late" VBR MP3 bug.
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", str(full_audio_path),
            "-ss", str(macro_start),
            "-t", str(macro_duration),
            "-vn",
            "-acodec", "pcm_s16le", "-ar", "44100", str(macro_clip_path)
        ]
        
        subprocess.run(ffmpeg_cmd, check=True)
        
        # Validate the output file is not empty
        if not macro_clip_path.exists() or macro_clip_path.stat().st_size < 1024:
            _fail("Macro clip empty after output seeking — the source audio may be shorter than expected for this ayah range.")
        
        logger.info("=== Phase 3: Robust Content-Based Localization + Micro-Alignment ===")
        # A single-shot forced alignment (align() over the whole ~60-100s macro
        # clip) can silently drift by several seconds for some reciters/recordings
        # even when it reports a "successful" word-count match — this is DTW
        # misalignment, not a missing-word failure, so the boundary-word safeguard
        # above doesn't catch it. Delegating to extract_custom_clip()'s strategy
        # (free transcription + fuzzy text search to localize, then forced
        # alignment only on a tightly cropped window) avoids long-range DTW drift
        # entirely and is reciter-agnostic, since it never trusts any per-reciter
        # external timing beyond this cheap macro-window crop.
        is_last_ayah_of_surah = (end_ayah == len(ayahs_text))
        # The mp3quran.net timing API (scaled by `ratio` above) can still
        # underestimate an ayah's true end even after correction, and
        # Quranic recitation commonly prolongs (madd) an ayah's final word
        # well past that -- concretely observed: Hud/maher needed a 0.676
        # ratio (32% mismatch) and even a first +15s widening still weren't
        # enough, with the exported clip still ending mid-recitation.
        # Retry up to twice (three attempts total), re-cropping ONLY the
        # end further out each time (not the start, to avoid pulling in
        # more preceding text that could confuse the collapse-recovery
        # fuzzy search the way a symmetric widen attempt previously did),
        # sized by the actual clamped amount extract_custom_clip measured
        # rather than a blind guess -- a full, clean re-run of Phase 3
        # onward on the wider crop each time, not a patch applied mid-pipeline.
        MAX_MACRO_RETRIES = 2
        attempt = 0
        while True:
            try:
                result = extract_custom_clip(
                    str(macro_clip_path), surah_id, start_ayah, end_ayah,
                    pad_seconds=pad_seconds, ayahs_text=ayahs_text,
                    output_prefix=reciter_id, reciter_label=reciter_id,
                    allow_macro_retry=(attempt < MAX_MACRO_RETRIES),
                    is_last_ayah_of_surah=is_last_ayah_of_surah,
                    min_match_ratio=RECITER_MIN_MATCH_RATIO,
                )
                break
            except MacroWindowTooNarrowError as e:
                attempt += 1
                if attempt > MAX_MACRO_RETRIES:
                    raise
                extra_seconds = max(15.0, getattr(e, "needed_extra_seconds", None) or 15.0)
                logger.info(f"{e} Retrying with a wider macro crop (attempt {attempt}/{MAX_MACRO_RETRIES}, +{extra_seconds:.1f}s).")
                macro_end = min(actual_duration, macro_end + extra_seconds)
                macro_duration = macro_end - macro_start
                subprocess.run([
                    "ffmpeg", "-y",
                    "-i", str(full_audio_path),
                    "-ss", str(macro_start),
                    "-t", str(macro_duration),
                    "-vn",
                    "-acodec", "pcm_s16le", "-ar", "44100", str(macro_clip_path)
                ], check=True)
                if not macro_clip_path.exists() or macro_clip_path.stat().st_size < 1024:
                    _fail("Macro clip empty after widened re-crop.")

        logger.info(f"Done. Extracted: {final_clip_path}")
        return result

    finally:
        logger.info("=== Phase 7: Cleanup ===")
        try:
            # Clean the temporary macro clip (specific to this request), but keep
            # full_audio_path in SURAH_CACHE_DIR — it's a shared, reusable cache
            # already managed by download_full_surah()'s own LRU eviction
            # (_enforce_surah_cache_limit, capped at MAX_SURAH_CACHE). Deleting it
            # here forced every single request — including immediate retries and
            # picking a different ayah range within the same surah — to re-download
            # the full surah from the external mp3quran.net server from scratch,
            # which was a major avoidable source of slow/timed-out requests.
            if macro_clip_path and macro_clip_path.exists(): macro_clip_path.unlink()
        except Exception as e:
            logger.warning(f"Cleanup error: {e}")

def extract_custom_clip(audio_path_str, surah_id, start_ayah, end_ayah, pad_seconds=0.0,
                         ayahs_text=None, output_prefix="custom", reciter_label="custom",
                         allow_macro_retry=False, is_last_ayah_of_surah=False,
                         min_match_ratio=0.15):
    import difflib
    import re
    audio_path = Path(audio_path_str)
    if not audio_path.exists():
        _fail(f"Custom audio file not found: {audio_path}")

    clip_name = f"{output_prefix}_{surah_id:03d}_{start_ayah}-{end_ayah}"
    final_clip_path = OUTPUT_DIR / f"{clip_name}.mp3"
    final_json_path = OUTPUT_DIR / f"{clip_name}.json"

    logger.info("=== Phase 1: Preparation (Custom Audio) ===")
    if ayahs_text is None:
        ayahs_text = fetch_surah_texts(surah_id)

    if start_ayah not in ayahs_text or end_ayah not in ayahs_text:
        _fail(f"Ayah bounds error: surah {surah_id} has no ayah {start_ayah} or {end_ayah}.")
        
    logger.info("=== Phase 2: Transcribing Custom Audio ===")
    # Use fine-tuned Quran model for better accuracy
    model = get_whisper_model('OdyAsh/faster-whisper-base-ar-quran')
    # Deliberately NOT using vad=True here (unlike Phase 5/6's alignment): this
    # transcription is later cross-checked in Phase 6 against the forced-alignment
    # result to catch cases where VAD makes the forced alignment drift. Keeping
    # this pass on a different setting preserves that independence — if both
    # passes shared the same VAD-related bias, they could agree with each other
    # while both being wrong, and the cross-check would miss it.
    transcribe_result = model.transcribe(str(audio_path), language='ar', word_timestamps=True)
    
    whisper_words = []
    for segment in transcribe_result.segments:
        for w in segment.words:
            whisper_words.append(w)
            
    def norm(t):
        t = re.sub(r'[^\w\s]', '', t)
        t = re.sub(r'[\u0617-\u061A\u064B-\u0652\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]', '', t)
        t = t.replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ة', 'ه').replace('ى', 'ي')
        return t.strip()

    T_words_original = [w for w in whisper_words if norm(w.word)]
    T_words = [norm(w.word) for w in T_words_original]
    
    target_clean = []
    for a in range(start_ayah, end_ayah + 1):
        for cw in ayahs_text[a]["clean"]:
            target_clean.append(norm(cw))
            
    P_words = [w for w in target_clean if w]
    
    logger.info("=== Phase 3: Searching for Target Verses ===")
    best_ratio = -1
    best_start_idx = 0
    best_end_idx = 0
    target_len = len(P_words)
    
    for i in range(len(T_words)):
        for j in range(i + int(target_len * 0.5), min(len(T_words), i + int(target_len * 1.5) + 1)):
            window = T_words[i:j]
            sm = difflib.SequenceMatcher(None, window, P_words)
            ratio = sm.ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_start_idx = i
                best_end_idx = j - 1

    # extract_clip() passes a stricter bar than the 0.15 default used for a
    # user's own upload: its macro crop is supposed to contain the target, so
    # a weak match means the crop is wrong -- fail loudly instead of returning
    # some other passage (concretely observed: An-Nisa 27-28 / maher at 0.15).
    if best_ratio < min_match_ratio or target_len == 0:
        _fail(f"Could not locate ayah {start_ayah}-{end_ayah} in the audio (best text match ratio: {best_ratio:.2f}). The audio may not actually contain this recitation, or its quality is too poor to transcribe.")
        
    strict_start = T_words_original[best_start_idx].start
    strict_end = T_words_original[best_end_idx].end

    logger.info(f"Target found at approx {strict_start:.2f}s to {strict_end:.2f}s (Ratio: {best_ratio:.2f})")

    if allow_macro_retry and not is_last_ayah_of_surah:
        # If the coarse match's end lands right at the edge of the audio we
        # were given, the true recitation almost certainly continues past
        # what was cropped -- no amount of downstream forced-alignment or
        # collapse-recovery can recover audio that was never included in
        # the first place. Concretely observed: Hud 15-16 / reciter maher,
        # where the macro crop was only 56.83s and this match landed at
        # 56.18s (0.65s from the edge), and the final exported clip was
        # genuinely truncated mid-word as a result. Let the caller
        # (extract_clip) catch this and retry with a wider crop from the
        # full surah audio before we ever reach DTW/collapse-recovery.
        NEAR_EDGE_SECONDS = 3.0
        try:
            probe_out = subprocess.check_output(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)],
                text=True,
            ).strip()
            input_duration = float(probe_out) if probe_out else None
        except Exception:
            input_duration = None
        if input_duration is not None and (input_duration - strict_end) < NEAR_EDGE_SECONDS:
            raise MacroWindowTooNarrowError(
                f"Coarse match ended {input_duration - strict_end:.2f}s from the edge of a "
                f"{input_duration:.2f}s macro crop — likely missing trailing audio."
            )

    logger.info("=== Phase 4: Strict-Slice Custom Audio ===")
    # This crop only exists to give the forced-alignment DTW step a small,
    # tightly-bounded acoustic window — it is NOT the final output padding
    # (that's applied separately in Phase 7 using the real pad_seconds).
    # Reusing pad_seconds here would make this window balloon back up to
    # nearly the size of the original audio whenever pad_seconds is large
    # (e.g. the 10s pre-trim buffer requested by the frontend), giving DTW
    # just as much room to drift as an unbounded alignment would.
    #
    # 3.0s used to be the value here, but two independent real extractions
    # (different surahs, different audio) both showed the model.align() DTW
    # producing several consecutive words with byte-identical timestamps
    # right at the start of the target text — i.e. exactly where only 3s of
    # lead-in context had elapsed. Raised to give DTW substantially more
    # acoustic history to stabilize on before the words that actually matter
    # arrive, at the cost of a bit more alignment compute per request.
    align_context_seconds = 10.0
    macro_start = max(0, strict_start - align_context_seconds)
    macro_duration = (strict_end - strict_start) + align_context_seconds * 2

    # Suffixed with a per-call uuid -- this is a transient intermediate
    # (deleted at the end of this function), and clip_name alone is
    # deterministic per reciter/surah/ayah-range, so two concurrent calls
    # for the identical range (e.g. extract_clip's Phase 2->3 handoff
    # racing against another request) used to collide on this exact path,
    # each ffmpeg's `-y` truncating the other's still-in-progress write.
    strict_clip_path = OUTPUT_DIR / f"strict_{clip_name}_{uuid.uuid4().hex[:8]}.mp3"
    subprocess.run([
        "ffmpeg", "-y",
        "-ss", str(macro_start),
        "-i", str(audio_path),
        "-t", str(macro_duration),
        "-vn",
        "-b:a", "192k", str(strict_clip_path)
    ], check=True)
    
    logger.info("=== Phase 5: Micro-Alignment on Target ===")
    aligned_words_mapping = []
    text_for_whisper = []
    
    for a in range(start_ayah, end_ayah + 1):
        uthmani_words = ayahs_text[a]["uthmani"]
        clean_words = ayahs_text[a]["clean"]
        min_len = min(len(uthmani_words), len(clean_words))
        for i in range(min_len):
            clean_word = clean_words[i]
            uthmani_word = uthmani_words[i]
            phonetic_word = HUROOF_MUQATTAAH.get(clean_word, clean_word)
            text_for_whisper.append(phonetic_word)
            aligned_words_mapping.append({
                "ayah": a, "w": uthmani_word, "clean": clean_word, "phonetic": phonetic_word
            })
            
    exact_text_clean = " ".join(text_for_whisper)

    logger.info("=== Phase 6: Extracting Target Timings ===")
    # Align the exact text to the ZERO-PADDING strict clip.
    # This prevents the DTW algorithm from stretching words into silence/padding.
    # VAD anchors word boundaries to where the voice actually starts/stops
    # acoustically rather than a linguistic guess, which measurably improves
    # precision (observed: ~1.2s start-boundary error down to ~0.01s on one
    # reciter) — tried first since accuracy is the priority. But it can
    # occasionally make stable-ts lose confidence near a boundary and silently
    # cram several real words into a near-zero time span (observed: both a
    # 340ms and a 5.6ms collapse, with no warning raised). When that happens,
    # fall back to plain (non-VAD) alignment rather than fail outright.
    target_start_time = None
    target_end_time = None
    target_ayah_words = []
    matched_flags = [False] * len(aligned_words_mapping)
    failure_reason = None
    last_collapse_attempt = None

    # Set whenever a collapse (or the last-resort clamp fallback) touches the
    # FINAL word of the requested ayah range. Collapse recovery re-anchors a
    # whole span of words via one fuzzy free-transcription match and then
    # interpolates their timing linearly by word count -- a coarse
    # approximation that can leave the last word's `end` several seconds
    # early even when recovery "succeeds" (concretely observed: Hud 15-16 /
    # reciter maher, where a repeated "فِيهَا" between the two ayahs confused
    # DTW and the recovered span covered the rest of the text). Surfaced to
    # the frontend so it can widen the default trim selection instead of
    # silently truncating real recitation audio.
    end_boundary_low_confidence = False

    for vad_enabled in (True, False):
        align_result = model.align(str(strict_clip_path), exact_text_clean, language='ar', vad=vad_enabled)
        align_words = []
        for segment in align_result.segments:
            for w in segment.words:
                align_words.append(w)

        attempt_start_time = None
        attempt_end_time = None
        attempt_words = []
        attempt_flags = [False] * len(aligned_words_mapping)

        w_idx = 0
        for map_idx, mapped in enumerate(aligned_words_mapping):
            expected_len = len(mapped["phonetic"].replace(" ", ""))
            if expected_len == 0: continue

            word_start = None
            word_end = None
            matched_chars = 0

            while w_idx < len(align_words) and matched_chars < expected_len:
                curr_w = align_words[w_idx]
                curr_text = curr_w.word.strip().replace(" ", "")
                if curr_text:
                    if word_start is None: word_start = curr_w.start
                    word_end = curr_w.end
                    matched_chars += len(curr_text)
                w_idx += 1

            if word_start is None: continue
            attempt_flags[map_idx] = True

            attempt_start_time = word_start if attempt_start_time is None else attempt_start_time
            attempt_end_time = word_end

            # We must shift the aligned word timestamps (which are relative to strict_clip)
            # back to absolute timestamps in the ORIGINAL audio file!
            abs_start = macro_start + word_start
            abs_end = macro_start + word_end

            attempt_words.append({
                "ayah": mapped["ayah"], "w": mapped["w"], "start": abs_start, "end": abs_end
            })

        if attempt_start_time is None:
            failure_reason = "Failed to find target Ayahs in micro-alignment."
            continue

        # Boundary-word safeguard: an aggregate match ratio can look fine while
        # specifically the first or last word of the range failed to align,
        # silently shifting the selected start/end to the wrong word.
        if aligned_words_mapping and not attempt_flags[0]:
            failure_reason = f"First word of ayah {start_ayah} ('{aligned_words_mapping[0]['w']}') failed to align."
            continue
        if aligned_words_mapping and not attempt_flags[-1]:
            failure_reason = f"Last word of ayah {end_ayah} ('{aligned_words_mapping[-1]['w']}') failed to align."
            continue

        MIN_SECONDS_PER_WORD = 0.06

        # Whole-ayah proactive cross-check: DTW forced-alignment has been
        # observed (concretely, on real extractions) to produce implausible
        # word timing even when every check above passes clean — not only
        # right at the start (where the align_context_seconds increase
        # above targets the main known cause), but potentially anywhere the
        # DTW path loses confidence. Rather than only reacting to a
        # detected symptom (collapse/long-stretch below), proactively
        # cross-check EVERY consecutive window of words across the WHOLE
        # ayah against the free transcription (T_words_original, which
        # isn't produced by constrained DTW and doesn't share its failure
        # modes) using the same fuzzy-search technique the collapse
        # recovery below uses — and only correct a window when it actually
        # looks suspicious or disagrees with a confident match by a real
        # margin, so a genuinely correct DTW result is never discarded
        # needlessly. This trades extra extraction time (one more
        # free-transcription search per 5-word window) for maximum timing
        # accuracy across the entire ayah, not just its first few words.
        CROSS_CHECK_WINDOW = 5
        for window_start in range(0, len(attempt_words), CROSS_CHECK_WINDOW):
            window_words = attempt_words[window_start:window_start + CROSS_CHECK_WINDOW]
            n = len(window_words)
            window_query = [norm(w["w"]) for w in window_words if norm(w["w"])]
            if not window_query:
                continue

            qlen = len(window_query)
            best_ratio, best_start, best_end = -1.0, 0, 0
            for i in range(len(T_words)):
                for j in range(i + max(1, int(qlen * 0.5)), min(len(T_words), i + int(qlen * 1.5) + 1)):
                    ratio = difflib.SequenceMatcher(None, T_words[i:j], window_query).ratio()
                    if ratio > best_ratio:
                        best_ratio, best_start, best_end = ratio, i, j - 1
            if best_ratio < 0.6:
                continue

            new_start = T_words_original[best_start].start
            new_end = T_words_original[best_end].end
            if (new_end - new_start) < n * MIN_SECONDS_PER_WORD:
                continue

            current_span = window_words[-1]["end"] - window_words[0]["start"]
            # Only override when the forced-alignment result actually looks
            # suspicious (implausibly short span) or disagrees with the
            # free-transcription estimate by a real margin.
            looks_wrong = current_span < n * MIN_SECONDS_PER_WORD
            disagrees = abs(new_start - window_words[0]["start"]) > 0.3
            if not (looks_wrong or disagrees):
                continue

            # Never accept a re-anchor that would push this window's timing
            # past an immediate neighbor this pass isn't touching -- this is
            # exactly how a real collapse was produced (concretely observed:
            # Al-Furqan 27-29 / reciter "mousa", where words 0-4 were
            # re-anchored on a 0.67-ratio match that placed their end past
            # the next, still-original word's start, squeezing the words
            # between them into a negative-duration span). Skip the
            # re-anchor and keep the original DTW timing instead; the
            # collapse detector/recovery below still runs as a fallback.
            prev_end = attempt_words[window_start - 1]["end"] if window_start > 0 else None
            next_start = attempt_words[window_start + n]["start"] if window_start + n < len(attempt_words) else None
            if prev_end is not None and new_start < prev_end:
                continue
            if next_start is not None and new_end > next_start:
                continue

            span = new_end - new_start
            for k in range(n):
                attempt_words[window_start + k]["start"] = new_start + span * k / n
                attempt_words[window_start + k]["end"] = new_start + span * (k + 1) / n
            logger.info(
                f"[Cross-check] Re-anchored words {window_start}-{window_start + n - 1} "
                f"('{' '.join(w['w'] for w in window_words)}') via free-transcription "
                f"search (ratio {best_ratio:.2f}), vad={vad_enabled}."
            )

        attempt_start_time = attempt_words[0]["start"] - macro_start
        attempt_end_time = attempt_words[-1]["end"] - macro_start

        # Collapse detection: scan for any run of 4 consecutive target words
        # spanning an implausibly short combined duration. word start/end here
        # are in SECONDS (straight from Whisper), not milliseconds.
        WINDOW = 4

        def _find_collapse(words):
            # Signature 1: any 2+ consecutive words sharing the EXACT same
            # (start, end) pair. This is physically impossible in real
            # speech, so it's flagged immediately regardless of absolute
            # duration -- catches collapses the duration-based check below
            # can miss (observed concretely: Al-Baqarah 286's first 4 words
            # -- "لا يكلف الله نفسا" -- all reported as 10.250-10.300s by
            # stable-ts, a known failure mode right at a clip boundary/onset
            # where DTW has accumulated little acoustic evidence yet).
            i = 0
            while i < len(words) - 1:
                if words[i]["start"] == words[i + 1]["start"] and words[i]["end"] == words[i + 1]["end"]:
                    j = i + 1
                    while j + 1 < len(words) and words[j]["start"] == words[j + 1]["start"] and words[j]["end"] == words[j + 1]["end"]:
                        j += 1
                    return (i, j)
                i += 1

            # Signature 2: any run of 4 consecutive target words spanning an
            # implausibly short combined duration.
            if len(words) < WINDOW:
                return None
            for i in range(len(words) - WINDOW + 1):
                window = words[i:i + WINDOW]
                span_sec = window[-1]["end"] - window[0]["start"]
                if span_sec < WINDOW * MIN_SECONDS_PER_WORD:
                    return (i, i + WINDOW - 1)
            return None

        collapse_range = _find_collapse(attempt_words)
        if collapse_range is not None and collapse_range[1] == len(attempt_words) - 1:
            # The collapse touches the ayah range's final word -- the
            # recovery below may fix it well or may only approximate it, but
            # either way the end boundary is no longer as trustworthy as a
            # clean, uncollapsed alignment. Flag regardless of whether
            # recovery ultimately "succeeds" below.
            end_boundary_low_confidence = True
        if collapse_range is not None:
            # Forced alignment (DTW) can lose its place specifically when the
            # expected text contains a repeated/similar phrase nearby (e.g.
            # Fatir 2's parallel "فَلَا مُمْسِكَ لَهَا ... فَلَا مُرْسِلَ لَهُ") and
            # confuses which occurrence maps to which position, cramming one
            # of them into a near-zero span. This isn't specific to any one
            # reciter or ayah — it can happen wherever the target text itself
            # has this kind of repetition, and the confusion can bleed into
            # several neighboring words, not just the minimal 4-word window
            # that first trips the detector. Recover by fuzzy-searching the
            # collapsed phrase against the free transcription from Phase 2
            # (T_words/T_words_original, already computed for Phase 3's
            # coarse search) — that method isn't constrained to a specific
            # expected sequence, so it doesn't share the same confusion —
            # and keep growing the window toward whichever side still ends
            # up out of chronological order with its neighbor, up to a cap.
            i0, i1 = collapse_range
            recovered = False
            local_words: list = []
            MAX_RECOVERY_WORDS = 40
            for _ in range(MAX_RECOVERY_WORDS):
                local_words = attempt_words[i0:i1 + 1]
                local_query = [norm(w["w"]) for w in local_words if norm(w["w"])]
                recovered = False
                if local_query:
                    qlen = len(local_query)
                    local_best_ratio, local_best_start, local_best_end = -1.0, 0, 0
                    for i in range(len(T_words)):
                        for j in range(i + max(1, int(qlen * 0.5)), min(len(T_words), i + int(qlen * 1.5) + 1)):
                            ratio = difflib.SequenceMatcher(None, T_words[i:j], local_query).ratio()
                            if ratio > local_best_ratio:
                                local_best_ratio, local_best_start, local_best_end = ratio, i, j - 1
                    # Higher bar than Phase 3's 0.15 — this is a much shorter
                    # phrase, so a weak match is more likely to be a
                    # coincidental false positive elsewhere in the recording.
                    if local_best_ratio >= 0.6:
                        new_start = T_words_original[local_best_start].start
                        new_end = T_words_original[local_best_end].end
                        if (new_end - new_start) >= len(local_words) * MIN_SECONDS_PER_WORD:
                            span = new_end - new_start
                            n = len(local_words)
                            for k, w in enumerate(local_words):
                                w["start"] = new_start + span * k / n
                                w["end"] = new_start + span * (k + 1) / n
                            recovered = True

                left_ok = i0 == 0 or attempt_words[i0 - 1]["end"] <= attempt_words[i0]["start"]
                right_ok = i1 == len(attempt_words) - 1 or attempt_words[i1]["end"] <= attempt_words[i1 + 1]["start"]

                if recovered and left_ok and right_ok:
                    logger.info(
                        f"[Collapse recovery] Re-anchored '{' '.join(w['w'] for w in local_words)}' "
                        f"via free-transcription search, vad={vad_enabled}."
                    )
                    break

                if i0 == 0 and i1 == len(attempt_words) - 1:
                    recovered = False
                    break

                if not left_ok and i0 > 0:
                    i0 -= 1
                if not right_ok and i1 < len(attempt_words) - 1:
                    i1 += 1
                if left_ok and right_ok:
                    # Recovery itself failed (low ratio / implausible span)
                    # rather than a neighbor conflict — try once more with a
                    # bit more context on both sides before giving up.
                    i0 = max(0, i0 - 1)
                    i1 = min(len(attempt_words) - 1, i1 + 1)

            # Last-resort recovery: the free-transcription re-anchor above
            # never found a confident match (or its recovered span was
            # itself implausible) even after growing the search window up
            # to MAX_RECOVERY_WORDS — on a long ayah this budget can be
            # exhausted well before the window reaches a clean boundary, so
            # neither "recovered" nor the "whole ayah" exit ever triggers.
            # Rather than shipping the still-collapsed timestamps as-is or
            # failing the entire extraction, interpolate the collapsed
            # words evenly between their nearest reliable (non-collapsed)
            # neighbors. Still an approximation, but guarantees
            # monotonically increasing, individually-plausible timing
            # instead of several words crammed into the same instant.
            still_collapsed = _find_collapse(attempt_words)
            if still_collapsed is not None:
                ci0, ci1 = still_collapsed
                n = ci1 - ci0 + 1
                anchor_start = (
                    attempt_words[ci0 - 1]["end"] if ci0 > 0
                    else max(0.0, attempt_words[ci0]["start"] - MIN_SECONDS_PER_WORD * n)
                )
                anchor_end = (
                    attempt_words[ci1 + 1]["start"] if ci1 + 1 < len(attempt_words)
                    else attempt_words[ci1]["end"] + MIN_SECONDS_PER_WORD * n
                )
                if anchor_end > anchor_start:
                    span = anchor_end - anchor_start
                    for k in range(n):
                        attempt_words[ci0 + k]["start"] = anchor_start + span * k / n
                        attempt_words[ci0 + k]["end"] = anchor_start + span * (k + 1) / n
                    logger.info(
                        f"[Collapse recovery] Free-transcription re-anchor failed for words "
                        f"'{' '.join(w['w'] for w in attempt_words[ci0:ci1 + 1])}'; "
                        f"interpolated between neighboring words as last resort, vad={vad_enabled}."
                    )

            # Boundary words may have just been patched — keep target_start/end
            # in sync with whatever attempt_words now actually says.
            attempt_start_time = attempt_words[0]["start"] - macro_start
            attempt_end_time = attempt_words[-1]["end"] - macro_start

            collapse_range = _find_collapse(attempt_words)
            left_ok = i0 == 0 or attempt_words[i0 - 1]["end"] <= attempt_words[i0]["start"]
            right_ok = i1 == len(attempt_words) - 1 or attempt_words[i1]["end"] <= attempt_words[i1 + 1]["start"]
            if collapse_range is not None or not (left_ok and right_ok):
                if collapse_range is not None:
                    window = attempt_words[collapse_range[0]:collapse_range[1] + 1]
                    span_sec = window[-1]["end"] - window[0]["start"]
                    detail = f"words '{' '.join(w['w'] for w in window)}' squeezed into {span_sec*1000:.0f}ms"
                else:
                    detail = f"words '{' '.join(w['w'] for w in local_words)}' ended up out of chronological order with a neighboring word"
                suffix = " (recovery attempt failed)." if recovered else "."
                failure_reason = f"Alignment collapse detected: {detail}{suffix}"
                # Keep this attempt around (even though it's being rejected)
                # so that if BOTH vad settings end up here, we have something
                # to run the final monotonic-clamp safety net on below
                # instead of failing the whole extraction outright.
                last_collapse_attempt = (attempt_words, attempt_flags, vad_enabled)
                continue

        # Repeated-recitation detection: a reciter re-saying a word/phrase
        # that only appears once in the reference text has nowhere to go in
        # forced alignment except to be crammed into whichever single
        # reference word is playing when the repeat happens — showing up as
        # one word's span being implausibly LONG relative to its neighbors,
        # the mirror image of the short-collapse case above. Left alone, the
        # on-screen segment for that word lingers through the whole repeated
        # utterance instead of tracking the reciter's actual current word.
        # Recover the same way as the short-collapse case above: search the
        # free transcription (T_words_original, already in absolute
        # original-audio time, same as attempt_words) for the LAST instance
        # of this word spoken inside the anomalous span, and snap to it.
        # Only nudges this one word's start forward (end and every other
        # word are untouched), so a wrong/missed detection degrades to a
        # no-op rather than corrupting neighboring boundaries.
        MAX_SECONDS_PER_WORD = 2.5
        LONG_STRETCH_MULTIPLIER = 4.0

        def _find_long_stretch(words):
            if len(words) < 3:
                return None
            durations = [w["end"] - w["start"] for w in words]
            avg = sum(durations) / len(durations)
            threshold = max(MAX_SECONDS_PER_WORD, avg * LONG_STRETCH_MULTIPLIER)
            for i, dur in enumerate(durations):
                if dur > threshold:
                    return i
            return None

        long_idx = _find_long_stretch(attempt_words)
        if long_idx is not None:
            long_word = attempt_words[long_idx]
            long_query = norm(long_word["w"])
            if long_query:
                repeat_candidates = [
                    tw for tw in T_words_original
                    if norm(tw.word) == long_query and long_word["start"] <= tw.start <= long_word["end"]
                ]
                if repeat_candidates:
                    last_instance = repeat_candidates[-1]
                    if (
                        long_word["start"] < last_instance.start < long_word["end"]
                        and (long_word["end"] - last_instance.start) >= MIN_SECONDS_PER_WORD
                    ):
                        logger.info(
                            f"[Repeat recovery] Word '{long_word['w']}' spanned "
                            f"{long_word['end'] - long_word['start']:.2f}s (threshold {max(MAX_SECONDS_PER_WORD, 0):.2f}s+) "
                            f"— likely an absorbed repeat; snapping its start to the last spoken "
                            f"instance at {last_instance.start:.2f}s, vad={vad_enabled}."
                        )
                        long_word["start"] = last_instance.start

        # This attempt passed every check — use it.
        target_start_time, target_end_time, target_ayah_words, matched_flags = (
            attempt_start_time, attempt_end_time, attempt_words, attempt_flags
        )
        failure_reason = None
        break

    if (target_start_time is None or failure_reason) and last_collapse_attempt is not None:
        # Absolute last resort: every targeted recovery above (cross-check
        # neighbor guard, fuzzy re-anchoring, growing-window recovery,
        # interpolation) failed to produce clean timing on BOTH vad settings.
        # Rather than fail the whole extraction (concretely observed: Al-Furqan
        # 27-29 / reciter "mousa"), fall back to the last attempt and clamp any
        # remaining out-of-order timestamp forward against its predecessor.
        # This guarantees monotonically valid (if, in this rare fallback case,
        # slightly approximated) timing instead of a hard failure, for any
        # reciter/ayah this can occur on -- consistent with the same
        # "approximation over failure" tradeoff the interpolation step above
        # already makes. Reaching this branch at all means targeted recovery
        # never cleanly succeeded, so the whole attempt's timing -- including
        # the end boundary -- is approximate.
        end_boundary_low_confidence = True
        words, flags, vad_used = last_collapse_attempt
        for k in range(1, len(words)):
            if words[k]["start"] < words[k - 1]["end"]:
                duration = max(words[k]["end"] - words[k]["start"], MIN_SECONDS_PER_WORD)
                words[k]["start"] = words[k - 1]["end"]
                words[k]["end"] = words[k]["start"] + duration
            elif words[k]["end"] < words[k]["start"]:
                words[k]["end"] = words[k]["start"] + MIN_SECONDS_PER_WORD
        logger.warning(
            "[Collapse recovery] All targeted re-anchoring failed on both VAD "
            "settings; clamped remaining out-of-order word timing forward as a "
            f"final safety net (last attempt used vad={vad_used})."
        )
        target_start_time = words[0]["start"] - macro_start
        target_end_time = words[-1]["end"] - macro_start
        target_ayah_words = words
        matched_flags = flags
        failure_reason = None

    if target_start_time is None or failure_reason:
        _fail(f"{failure_reason} Refusing to return a clip with inaccurate/corrupted timing (tried with and without VAD).")

    # Cross-check the very first/last word's boundary against the free-transcription
    # estimate that already located this same phrase in Phase 3 (`strict_start`/
    # `strict_end`). Forced alignment (Phase 6) is constrained to match the exact
    # expected text and can drift on unusual phonetic patterns — e.g. Huroof
    # Muqatta'at like "يس" pronounced as two separated letter-names — even when
    # every other check (boundary-word match, collapse detection) passes clean.
    # Free transcription isn't constrained that way, so when the two disagree by
    # more than a fraction of a second, trust the free-transcription boundary
    # instead. Only trusted when Phase 3's match was itself reasonably confident.
    BOUNDARY_DISAGREEMENT_THRESHOLD = 0.6
    if best_ratio >= 0.5:
        abs_start_check = macro_start + target_start_time
        if abs(abs_start_check - strict_start) > BOUNDARY_DISAGREEMENT_THRESHOLD:
            start_delta = strict_start - abs_start_check
            logger.info(f"[Boundary cross-check] forced-alignment start {abs_start_check:.2f}s vs free-transcription {strict_start:.2f}s — snapping to free-transcription estimate.")
            target_start_time += start_delta
            target_end_time += start_delta
            if target_ayah_words:
                # Shift EVERY word by the same delta, not just the first
                # one's start. A disagreement this large means the whole
                # forced-alignment run matched the target text at the wrong
                # position in the macro clip, so every word it produced is
                # off by roughly the same amount -- patching only the first
                # word left it on the corrected timeline while every other
                # word (and the new slice boundary derived from
                # target_start_time) stayed on the old one, producing wildly
                # inconsistent per-word timestamps once shifted relative to
                # the corrected clip start (concretely observed: Al-Furqan
                # 27-29 / reciter "mousa" -- 11 words of ayah 27 collapsed
                # into a 50ms sliver while ayah 28's words spread across a
                # bogus 25s span).
                for w in target_ayah_words:
                    w["start"] += start_delta
                    w["end"] += start_delta

        abs_end_check = macro_start + target_end_time
        if abs(abs_end_check - strict_end) > BOUNDARY_DISAGREEMENT_THRESHOLD:
            logger.info(f"[Boundary cross-check] forced-alignment end {abs_end_check:.2f}s vs free-transcription {strict_end:.2f}s — snapping to free-transcription estimate.")
            target_end_time += (strict_end - abs_end_check)
            if target_ayah_words:
                # Anchor "end" absolutely at strict_end (the trusted
                # free-transcription boundary) rather than shifting by
                # (strict_end - abs_end_check): when DTW has badly lost its
                # place near the end, that delta can itself be enormous
                # (tens of seconds), and adding it to the word's own
                # "start"/"end" would just relocate the same nonsense
                # somewhere else instead of fixing it (concretely observed:
                # a delta-shift attempt here once produced a "start" of
                # 95s+ for a clip whose final exported audio was only 41s
                # long). Instead, keep this word's own PRE-correction
                # duration (a locally-scaled estimate that's still
                # reasonable even if its absolute position was wrong) and
                # re-anchor it so it ends exactly at strict_end. Deliberately
                # NOT clamped against the previous word's "end" here -- that
                # neighbor can itself already be corrupted by an upstream
                # collapse this check doesn't know about, and clamping
                # against it would import that corruption into this word
                # (observed concretely: propagated a bogus ~95s neighbor
                # timestamp into this word). Phase 8's final validity pass
                # already enforces global cross-word monotonicity as a
                # last-resort safety net, so it's not needed here too.
                last_word = target_ayah_words[-1]
                original_duration = last_word["end"] - last_word["start"]
                if original_duration <= 0 or original_duration > 3.0:
                    original_duration = MIN_SECONDS_PER_WORD
                last_word["end"] = strict_end
                last_word["start"] = strict_end - original_duration
            end_boundary_low_confidence = True

    # Get duration of ORIGINAL audio
    try:
        probe_result = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                       "format=duration", "-of",
                                       "default=noprint_wrappers=1:nokey=1", str(audio_path)],
                                      stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=True)
        original_duration = float(probe_result.stdout.strip())
    except Exception:
        original_duration = strict_end + pad_seconds + 5.0

    # The absolute bounds of the target text in the ORIGINAL audio
    abs_target_start = macro_start + target_start_time
    abs_target_end = macro_start + target_end_time

    pad_start_val = 0.250
    # Final slice start relative to original audio
    final_slice_start = max(0, abs_target_start - pad_start_val - pad_seconds)
    
    remaining = original_duration - abs_target_end
    # Quranic recitation commonly prolongs (madd) an ayah's final word well
    # past where Whisper's own transcription places its word boundary --
    # observed concretely (Hud 15-16 / maher) that even after widening the
    # macro crop until Phase 3's match was no longer clamped by crop size,
    # the exported audio still ended mid-recitation, because the 1.0s cap
    # here left no room to cover that prolongation once the crop itself
    # was no longer the bottleneck. Allow a much larger safety margin
    # specifically when the end boundary is already known to be
    # low-confidence (bounded by `remaining`/2 same as before, so it still
    # never asks for more than half of whatever room is actually left).
    safe_padding_cap = 6.0 if end_boundary_low_confidence else 1.0
    safe_padding = min(safe_padding_cap, max(0.5, remaining * 0.5))
    desired_slice_end = abs_target_end + safe_padding + pad_seconds
    final_slice_end = min(original_duration, desired_slice_end)

    if allow_macro_retry and not is_last_ayah_of_surah:
        # Quranic recitation commonly prolongs (madd) the final word of an
        # ayah well past where Whisper's own word-boundary transcription
        # places it -- the early Phase-3 "near the crop's edge" check above
        # catches the obvious cases cheaply, but a reciter's prolongation
        # can still exceed the available room even when Phase 3's match
        # didn't look suspiciously close to the edge (concretely observed:
        # Hud 15-16 / maher, where Phase 3 matched 7.29s before a widened
        # crop's own end, which looked like enough margin, yet the desired
        # padding was still clamped and the exported audio still ended
        # mid-recitation). This is the more direct, ground-truth signal:
        # did we actually have to clamp away real requested padding?
        clamped_amount = desired_slice_end - final_slice_end
        if clamped_amount > 2.0:
            raise MacroWindowTooNarrowError(
                f"Desired trailing padding was clamped by {clamped_amount:.2f}s "
                f"(wanted to end at {desired_slice_end:.2f}s, crop only extends to "
                f"{original_duration:.2f}s) — macro crop too narrow.",
                needed_extra_seconds=clamped_amount + 10.0,
            )

    clip_duration = final_slice_end - final_slice_start
    fade_in_dur = min(0.150, pad_start_val)
    fade_out_dur = min(0.150, original_duration - final_slice_end if original_duration - final_slice_end > 0 else 0.150)
    fade_out_start = clip_duration - fade_out_dur
    
    audio_filter = f"afade=t=in:st=0:d={fade_in_dur:.3f},afade=t=out:st={fade_out_start:.3f}:d={fade_out_dur:.3f}"
    
    logger.info("=== Phase 7: Micro-Slicing Custom Audio ===")
    subprocess.run([
        "ffmpeg", "-y",
        "-ss", str(final_slice_start),
        "-i", str(audio_path),
        "-t", str(clip_duration),
        "-vn",
        "-af", audio_filter,
        "-b:a", "192k", str(final_clip_path)
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    if not final_clip_path.exists() or final_clip_path.stat().st_size < 1024:
        _fail("Micro-slice produced an empty or missing clip — aborting instead of returning a stale/mismatched result.")
    
    logger.info("=== Phase 8: JSON Generation (Custom Audio) ===")
    verses = {}
    for word_data in target_ayah_words:
        a_id = str(word_data["ayah"])
        if a_id not in verses:
            verses[a_id] = {"words": []}
            
        # Shift absolute timestamps to be relative to the new final_clip
        shifted_start = word_data["start"] - final_slice_start
        shifted_end = word_data["end"] - final_slice_start

        verses[a_id]["words"].append({
            "w": word_data["w"],
            "start": int(max(0, shifted_start) * 1000),
            "end": int(shifted_end * 1000)
        })

    for a_id, v_data in verses.items():
        words = v_data["words"]
        for i in range(1, len(words)):
            gap = words[i]["start"] - words[i-1]["end"]
            if gap > 1500:
                words[i-1]["end"] = words[i]["start"] - 100

            word_duration = words[i]["end"] - words[i]["start"]
            if word_duration > 2500:
                words[i]["start"] = words[i]["end"] - 1500
                words[i-1]["end"] = words[i]["start"] - 100

        # Safety net: the adjustments above only look at one adjacent pair at
        # a time, so a correction made while handling word i can still leave
        # an EARLIER word (i-1, or one word further still handled from other
        # ayahs sharing the same underlying target_ayah_words sequence) with
        # its end before its own start once a later step nudges things back.
        # Observed concretely: a word's start/end came out reversed (e.g.
        # 10250-7310) after this loop ran, even though nothing upstream
        # flagged a collapse — the loop's own local edits produced it. Enforce
        # basic validity as a final pass so no inverted timestamp ever reaches
        # the client, regardless of what caused it upstream.
        #
        # Both checks below only clamp for a SMALL (jitter-scale) mismatch,
        # not an arbitrarily large one: a large mismatch means the PREVIOUS
        # word is the one carrying a stale/corrupted timestamp from an
        # upstream collapse this pass doesn't know about, and forcing THIS
        # word to match it would import that corruption instead of fixing
        # anything (concretely observed: doing this unconditionally dragged
        # a correctly end-boundary-anchored last word from ~39s to ~47s to
        # match a corrupted neighbor). A large mismatch is left for
        # lowConfidenceEnd/the macro-retry logic above to have already
        # addressed instead.
        SMALL_OVERLAP_THRESHOLD_MS = 1000
        for i in range(len(words)):
            if i > 0 and 0 < (words[i - 1]["start"] - words[i]["start"]) <= SMALL_OVERLAP_THRESHOLD_MS:
                words[i]["start"] = words[i - 1]["start"]
            # Also guard against overlapping the PREVIOUS word's end, not
            # just its start -- a word can have start >= previous start yet
            # still start before the previous word finishes (observed
            # concretely: a boundary-cross-check re-anchor on the last word
            # of Al-Fatiha 7 left it starting inside the previous word's own
            # span). The gap-closing loop above only handles large positive
            # gaps, not this negative-gap/overlap case.
            if i > 0 and 0 < (words[i - 1]["end"] - words[i]["start"]) <= SMALL_OVERLAP_THRESHOLD_MS:
                words[i]["start"] = words[i - 1]["end"]
            if words[i]["end"] < words[i]["start"]:
                words[i]["end"] = words[i]["start"] + 50

    final_json = {
        "surah": surah_id,
        "start_ayah": start_ayah,
        "end_ayah": end_ayah,
        "reciter": reciter_label,
        "pad_seconds": pad_seconds,
        "lowConfidenceEnd": end_boundary_low_confidence,
        "verses": verses
    }
    
    with open(final_json_path, "w", encoding="utf-8") as f:
        json.dump(final_json, f, ensure_ascii=False, indent=2)
        
    # Cleanup strict clip
    try:
        strict_clip_path.unlink(missing_ok=True)
    except:
        pass
        
    logger.info(f"JSON written successfully to {final_json_path}")
    return str(final_clip_path), str(final_json_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reciter", required=True)
    parser.add_argument("--surah", required=True, type=int)
    parser.add_argument("--start", required=True, type=int)
    parser.add_argument("--end", required=True, type=int)
    args = parser.parse_args()
    extract_clip(args.reciter, args.surah, args.start, args.end)
