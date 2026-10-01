// The single list of reciters -- the Step 3 dropdown, the API routes and
// gallery names all read from here, so adding a reciter is one entry.
// Client-safe (no fs imports).
//
// backendKey is the reciter id the Python backend knows
// (extract_precise_clip.py: RECITERS_QDC for quran.com word timings,
// otherwise RECITERS_MP3QURAN). everyAyahFolder is the per-ayah fallback
// render/route.ts uses if extraction fails.
export type Reciter = {
  id: string;
  backendKey: string;
  arabicName: string;
  // Latin credit/gallery name (see RECITER_DISPLAY_NAMES).
  latinName: string;
  // Longer label for the Turkish-mode dropdown.
  turkishLabel: string;
  everyAyahFolder: string;
};

export const RECITERS: Reciter[] = [
  {
    id: "mishary_alafasy",
    backendKey: "mishary",
    arabicName: "مشاري راشد العفاسي",
    latinName: "Mishary Al-Afasy",
    turkishLabel: "Mishary Rashed Alafasy",
    everyAyahFolder: "Alafasy_128kbps",
  },
  {
    id: "maher_muaiqly",
    backendKey: "maher",
    arabicName: "ماهر المعيقلي",
    latinName: "Maher Al-Muaiqly",
    turkishLabel: "Maher Al-Muaiqly",
    everyAyahFolder: "Maher_AlMuaiqly_64kbps",
  },
  {
    id: "ahmed_ajmi",
    backendKey: "ajmi",
    arabicName: "أحمد العجمي",
    latinName: "Ahmed Al-Ajmi",
    turkishLabel: "Ahmed Al-Ajmi",
    everyAyahFolder: "Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net",
  },
  {
    id: "yasser_dosari",
    backendKey: "yasser",
    arabicName: "ياسر الدوسري",
    latinName: "Yasser Al-Dosari",
    turkishLabel: "Yasser Al-Dosari",
    everyAyahFolder: "Yasser_Ad-Dussary_128kbps",
  },
  {
    id: "abdullah_mousa",
    backendKey: "mousa",
    arabicName: "عبدالله الموسى",
    latinName: "Abdullah Al-Mousa",
    turkishLabel: "Abdullah Al-Mousa",
    // No EveryAyah recording -- the backend extraction is the only source.
    everyAyahFolder: "Alafasy_128kbps",
  },
  {
    id: "raad_alkurdi",
    backendKey: "raad_alkurdi",
    arabicName: "رعد محمد الكردي",
    latinName: "Raad Al-Kurdi",
    turkishLabel: "Raad Mohammad Al Kurdi",
    // No EveryAyah recording -- the backend extraction is the only source.
    everyAyahFolder: "Alafasy_128kbps",
  },
  {
    id: "abdulbaset_murattal",
    backendKey: "abdulbaset",
    arabicName: "عبد الباسط عبد الصمد (مرتل)",
    latinName: "Abdul Basit Abdus-Samad",
    turkishLabel: "Abdul Basit Abdus-Samad (Murattal)",
    everyAyahFolder: "Abdul_Basit_Murattal_192kbps",
  },
  {
    id: "abdulbaset_mujawwad",
    backendKey: "abdulbaset_mujawwad",
    arabicName: "عبد الباسط عبد الصمد (مجود)",
    latinName: "Abdul Basit Abdus-Samad (Mujawwad)",
    turkishLabel: "Abdul Basit Abdus-Samad (Mücevved)",
    everyAyahFolder: "Abdul_Basit_Mujawwad_128kbps",
  },
  {
    id: "sudais",
    backendKey: "sudais",
    arabicName: "عبد الرحمن السديس",
    latinName: "Abdur-Rahman As-Sudais",
    turkishLabel: "Abdurrahman es-Sudeys",
    everyAyahFolder: "Abdurrahmaan_As-Sudais_192kbps",
  },
  {
    id: "shuraim",
    backendKey: "shuraim",
    arabicName: "سعود الشريم",
    latinName: "Saud Ash-Shuraim",
    turkishLabel: "Suud eş-Şureym",
    everyAyahFolder: "Saood_ash-Shuraym_128kbps",
  },
  {
    id: "husary",
    backendKey: "husary",
    arabicName: "محمود خليل الحصري",
    latinName: "Mahmoud Khalil Al-Husary",
    turkishLabel: "Mahmud Halil el-Husari",
    everyAyahFolder: "Husary_128kbps",
  },
  {
    id: "minshawi",
    backendKey: "minshawi",
    arabicName: "محمد صديق المنشاوي",
    latinName: "Mohamed Siddiq Al-Minshawi",
    turkishLabel: "Muhammed Sıddık el-Minşavi",
    everyAyahFolder: "Minshawy_Murattal_128kbps",
  },
  {
    id: "shatri",
    backendKey: "shatri",
    arabicName: "أبو بكر الشاطري",
    latinName: "Abu Bakr Ash-Shatri",
    turkishLabel: "Ebubekir eş-Şatiri",
    everyAyahFolder: "Abu_Bakr_Ash-Shaatree_128kbps",
  },
  {
    id: "rifai",
    backendKey: "rifai",
    arabicName: "هاني الرفاعي",
    latinName: "Hani Ar-Rifai",
    turkishLabel: "Hani er-Rifai",
    everyAyahFolder: "Hani_Rifai_192kbps",
  },
];

export const DEFAULT_RECITER_ID = "mishary_alafasy";

export function getReciter(id: string | null | undefined): Reciter {
  return RECITERS.find((r) => r.id === id) ?? RECITERS.find((r) => r.id === DEFAULT_RECITER_ID)!;
}
