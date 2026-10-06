// The text of /privacy and /terms. Arabic and Turkish are the site's two
// languages; English exists because the reviewers at Google, TikTok and
// Meta (see src/lib/social) read these pages in English.
//
// Keep this in step with what the code actually does -- every statement
// here describes real behaviour (what is stored, where it is sent, what
// account deletion removes). Change the code, change the text.

export type LegalLanguage = "ar" | "tr" | "en";
export type LegalDocId = "privacy" | "terms";

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDoc = {
  title: string;
  intro: string;
  sections: LegalSection[];
};

// Shown as "last updated" on both pages -- bump it whenever the text changes.
export const LEGAL_LAST_UPDATED = "2026-10-06";

export const LEGAL_LABELS: Record<
  LegalLanguage,
  { privacy: string; terms: string; lastUpdated: string; contactHeading: string; contact: string }
> = {
  ar: {
    privacy: "سياسة الخصوصية",
    terms: "شروط الاستخدام",
    lastUpdated: "آخر تحديث",
    contactHeading: "التواصل",
    contact: "لأي سؤال أو طلب يخص بياناتك أو هذه الصفحة، راسلنا على:",
  },
  tr: {
    privacy: "Gizlilik Politikası",
    terms: "Kullanım Koşulları",
    lastUpdated: "Son güncelleme",
    contactHeading: "İletişim",
    contact: "Verileriniz veya bu sayfa hakkındaki her türlü soru ve talep için bize yazın:",
  },
  en: {
    privacy: "Privacy Policy",
    terms: "Terms of Use",
    lastUpdated: "Last updated",
    contactHeading: "Contact",
    contact: "For any question or request about your data or this page, write to us at:",
  },
};

const privacy: Record<LegalLanguage, LegalDoc> = {
  ar: {
    title: "سياسة الخصوصية",
    intro:
      "Kuran Nuru أداة لإنشاء مقاطع فيديو للقرآن الكريم. توضح هذه الصفحة ما البيانات التي نجمعها، ولماذا، وكيف تتحكم بها. لا نعرض إعلانات، ولا نستخدم أدوات تتبّع أو تحليلات، ولا نبيع بياناتك لأي جهة.",
    sections: [
      {
        heading: "البيانات التي نجمعها",
        bullets: [
          "بيانات الحساب: بريدك الإلكتروني، وكلمة مرورك مخزّنة بصيغة مشفّرة غير قابلة للاسترجاع (bcrypt)، واسمك وصورتك الشخصية إن أضفتهما.",
          "المحتوى الذي ترفعه: صور وفيديوهات الخلفية، والملفات الصوتية، والخطوط، وإعدادات مشاريعك (المسودات).",
          "الفيديوهات التي تنشئها: نحتفظ بآخر 20 فيديو في معرضك لتتمكن من تنزيلها أو نشرها لاحقًا، وتُحذف الأقدم تلقائيًا.",
          "بيانات تقنية: عنوان IP يُستخدم مؤقتًا للحد من إساءة الاستخدام (تحديد عدد الطلبات)، وقد يظهر في سجلات الخادم.",
        ],
      },
      {
        heading: "ملفات تعريف الارتباط والتخزين المحلي",
        paragraphs: [
          "نستخدم ملف تعريف ارتباط واحدًا ضروريًا لإبقائك مسجّل الدخول (مدته 30 يومًا)، وملفًا مؤقتًا قصير الأجل أثناء ربط حساب نشر. ونحفظ في متصفحك تفضيلاتك (اللغة، المظهر، الترجمة، ومشروعك الحالي). لا نستخدم أي ملفات ارتباط إعلانية أو تتبّعية.",
        ],
      },
      {
        heading: "كيف نستخدم بياناتك",
        bullets: [
          "تشغيل حسابك وتسجيل دخولك.",
          "إنشاء الفيديوهات التي تطلبها وحفظها في معرضك.",
          "نشر الفيديو على حساباتك في المنصات التي ربطتها، وفقط عندما تضغط زر النشر.",
          "حماية الخدمة من إساءة الاستخدام.",
        ],
      },
      {
        heading: "ربط حسابات يوتيوب وتيك توك وإنستغرام",
        paragraphs: [
          "الربط اختياري تمامًا. عند ربط حساب نخزّن: معرّف الحساب واسمه الظاهر، ورموز الوصول التي تمنحنا إياها المنصة، وهي محفوظة مشفّرة في قاعدة بياناتنا. لا نرى كلمة مرورك في تلك المنصات ولا نخزّنها.",
          "نستخدم هذا الوصول لغرض واحد: رفع الفيديو الذي تختاره إلى حسابك بالعنوان والوصف والخصوصية التي تحددها. لا نقرأ فيديوهاتك الأخرى ولا رسائلك ولا متابعيك، ولا ننشر أي شيء دون طلب صريح منك.",
          "يمكنك فصل أي حساب في أي وقت من صفحة «الحساب»، فنحذف رموزه من عندنا ونطلب من المنصة إلغاءها حيثما أمكن. ويمكنك أيضًا سحب الإذن من المنصة نفسها، ولحساب Google من صفحة أذونات الأمان: https://myaccount.google.com/permissions",
          "ميزة النشر على يوتيوب تستخدم خدمات YouTube API. باستخدامها فإنك توافق على شروط خدمة يوتيوب (https://www.youtube.com/t/terms)، وتخضع بياناتك لدى Google لسياسة خصوصية Google (https://policies.google.com/privacy).",
        ],
      },
      {
        heading: "الجهات الخارجية",
        bullets: [
          "يوتيوب (Google) وتيك توك وإنستغرام (Meta): نرسل إليها الفيديو وعنوانه ووصفه عندما تطلب النشر.",
          "Pollinations AI: إذا استخدمت توليد الخلفية بالذكاء الاصطناعي، يُرسل النص الذي تكتبه إلى هذه الخدمة لتوليد الصورة.",
          "مصادر النص القرآني والتلاوات والترجمات (quran.com و alquran.cloud و everyayah.com و jsDelivr): تُجلب منها البيانات القرآنية، وقد يتصل بها متصفحك مباشرة فيظهر لها عنوان IP الخاص بك.",
        ],
        paragraphs: ["لا نشارك بياناتك مع أي جهة أخرى، إلا إذا ألزمنا القانون بذلك."],
      },
      {
        heading: "مدة الاحتفاظ والحذف",
        paragraphs: [
          "نحتفظ ببياناتك ما دام حسابك قائمًا. يمكنك حذف أي فيديو من معرضك، وحذف حسابك كاملًا من صفحة «الحساب».",
          "عند حذف الحساب نحذف فورًا: بيانات الحساب، وصورتك الشخصية، وفيديوهات معرضك، وجميع حسابات النشر المرتبطة ورموزها. وتُحذف معها مشاريع (مسودات) تلك الفيديوهات وما رفعته لها من ملفات.",
          "مشاريعك تحت تصرفك: تُحذف المسودة عندما تبدأ مشروعًا جديدًا أو تحذف فيديوها من المعرض. أما المسودات المهجورة، وهي التي لم تُعدَّل منذ 30 يومًا وليست مرتبطة بأي فيديو محفوظ، فتُحذف تلقائيًا.",
          "الفيديوهات التي نشرتها على المنصات الأخرى تبقى هناك، وحذفها يتم من تلك المنصات.",
        ],
      },
      {
        heading: "حماية البيانات",
        paragraphs: [
          "كلمات المرور مخزّنة مشفّرة، ورموز حسابات النشر مشفّرة، والاتصال بالموقع يتم عبر HTTPS. ومع ذلك لا توجد خدمة على الإنترنت آمنة بنسبة مئة بالمئة، فاختر كلمة مرور قوية وخاصة بهذا الموقع.",
        ],
      },
      {
        heading: "حقوقك",
        paragraphs: [
          "يحق لك الاطلاع على بياناتك وتصحيحها وحذفها. معظم ذلك متاح مباشرة من صفحة «الحساب»، ولأي طلب آخر راسلنا.",
        ],
      },
      {
        heading: "الأطفال",
        paragraphs: ["الخدمة غير موجّهة لمن هم دون 13 عامًا، ولا نجمع بياناتهم عن علم."],
      },
      {
        heading: "تغييرات هذه السياسة",
        paragraphs: ["قد نحدّث هذه السياسة عند تغيّر الخدمة. يظهر تاريخ آخر تحديث أعلى الصفحة."],
      },
    ],
  },

  tr: {
    title: "Gizlilik Politikası",
    intro:
      "Kuran Nuru, Kur'an-ı Kerim videoları oluşturmaya yarayan bir araçtır. Bu sayfa hangi verileri topladığımızı, neden topladığımızı ve bunları nasıl kontrol edebileceğinizi açıklar. Reklam göstermiyoruz, izleme veya analiz aracı kullanmıyoruz ve verilerinizi kimseye satmıyoruz.",
    sections: [
      {
        heading: "Topladığımız veriler",
        bullets: [
          "Hesap bilgileri: e-posta adresiniz, geri döndürülemez biçimde karmalanmış (bcrypt) şifreniz ve eklediyseniz adınız ile profil fotoğrafınız.",
          "Yüklediğiniz içerik: arka plan görselleri ve videoları, ses dosyaları, yazı tipleri ve proje ayarlarınız (taslaklar).",
          "Oluşturduğunuz videolar: daha sonra indirebilmeniz veya yayınlayabilmeniz için son 20 videonuzu galerinizde tutarız; daha eskileri otomatik olarak silinir.",
          "Teknik veriler: IP adresiniz kötüye kullanımı sınırlamak (istek sınırlaması) için geçici olarak kullanılır ve sunucu kayıtlarında görünebilir.",
        ],
      },
      {
        heading: "Çerezler ve yerel depolama",
        paragraphs: [
          "Oturumunuzu açık tutmak için gerekli tek bir çerez (30 gün) ve bir yayın hesabı bağlanırken kısa ömürlü geçici bir çerez kullanırız. Tercihlerinizi (dil, tema, çeviri ve mevcut projeniz) tarayıcınızda saklarız. Reklam veya izleme çerezi kullanmıyoruz.",
        ],
      },
      {
        heading: "Verilerinizi nasıl kullanıyoruz",
        bullets: [
          "Hesabınızı çalıştırmak ve oturumunuzu açmak.",
          "İstediğiniz videoları oluşturmak ve galerinize kaydetmek.",
          "Videoyu, bağladığınız platformlardaki hesaplarınızda yalnızca yayınla düğmesine bastığınızda yayınlamak.",
          "Hizmeti kötüye kullanıma karşı korumak.",
        ],
      },
      {
        heading: "YouTube, TikTok ve Instagram hesaplarını bağlama",
        paragraphs: [
          "Bağlama tamamen isteğe bağlıdır. Bir hesap bağladığınızda hesap kimliğini, görünen adını ve platformun bize verdiği erişim anahtarlarını saklarız; bu anahtarlar veritabanımızda şifrelenmiş olarak tutulur. O platformlardaki şifrenizi görmeyiz ve saklamayız.",
          "Bu erişimi tek bir amaçla kullanırız: seçtiğiniz videoyu, belirlediğiniz başlık, açıklama ve gizlilik ayarıyla hesabınıza yüklemek. Diğer videolarınızı, mesajlarınızı veya takipçilerinizi okumayız ve açık talebiniz olmadan hiçbir şey yayınlamayız.",
          "Herhangi bir hesabın bağlantısını istediğiniz zaman «Hesap» sayfasından kesebilirsiniz; anahtarlarını siler ve mümkün olan durumlarda platformdan iptal edilmesini isteriz. İzni doğrudan platformdan da geri alabilirsiniz; Google hesabı için: https://myaccount.google.com/permissions",
          "YouTube'da yayınlama özelliği YouTube API Hizmetlerini kullanır. Bu özelliği kullanarak YouTube Hizmet Şartlarını (https://www.youtube.com/t/terms) kabul etmiş olursunuz; Google'daki verileriniz Google Gizlilik Politikasına (https://policies.google.com/privacy) tabidir.",
        ],
      },
      {
        heading: "Üçüncü taraflar",
        bullets: [
          "YouTube (Google), TikTok ve Instagram (Meta): yayınlamayı istediğinizde videoyu, başlığını ve açıklamasını bu platformlara göndeririz.",
          "Pollinations AI: yapay zekâ ile arka plan oluşturmayı kullanırsanız, yazdığınız metin görseli üretmek için bu hizmete gönderilir.",
          "Kur'an metni, tilavet ve çeviri kaynakları (quran.com, alquran.cloud, everyayah.com, jsDelivr): Kur'an verileri buralardan alınır; tarayıcınız bunlara doğrudan bağlanabilir ve IP adresinizi görebilirler.",
        ],
        paragraphs: ["Yasal bir zorunluluk olmadıkça verilerinizi başka hiç kimseyle paylaşmayız."],
      },
      {
        heading: "Saklama süresi ve silme",
        paragraphs: [
          "Verilerinizi hesabınız var olduğu sürece saklarız. Galerinizdeki herhangi bir videoyu ve «Hesap» sayfasından hesabınızın tamamını silebilirsiniz.",
          "Hesabı sildiğinizde şunları hemen sileriz: hesap bilgileri, profil fotoğrafınız, galeri videolarınız ve bağlı tüm yayın hesapları ile anahtarları. Bu videoların projeleri (taslakları) ve onlar için yüklediğiniz dosyalar da birlikte silinir.",
          "Projeleriniz sizin kontrolünüzdedir: yeni bir projeye başladığınızda veya videosunu galeriden sildiğinizde taslak silinir. Terk edilmiş taslaklar, yani 30 gündür değiştirilmemiş ve kayıtlı hiçbir videoya bağlı olmayanlar, otomatik olarak silinir.",
          "Diğer platformlarda yayınladığınız videolar orada kalır; bunları o platformlardan silmeniz gerekir.",
        ],
      },
      {
        heading: "Veri güvenliği",
        paragraphs: [
          "Şifreler karmalanmış, yayın hesabı anahtarları şifrelenmiş olarak saklanır ve siteyle bağlantı HTTPS üzerinden kurulur. Yine de internetteki hiçbir hizmet yüzde yüz güvenli değildir; güçlü ve bu siteye özel bir şifre seçin.",
        ],
      },
      {
        heading: "Haklarınız",
        paragraphs: [
          "Verilerinize erişme, düzeltme ve silme hakkına sahipsiniz. Bunların çoğunu doğrudan «Hesap» sayfasından yapabilirsiniz; diğer talepler için bize yazın.",
        ],
      },
      {
        heading: "Çocuklar",
        paragraphs: ["Hizmet 13 yaşından küçüklere yönelik değildir ve onların verilerini bilerek toplamayız."],
      },
      {
        heading: "Bu politikadaki değişiklikler",
        paragraphs: [
          "Hizmet değiştikçe bu politikayı güncelleyebiliriz. Son güncelleme tarihi sayfanın üstünde görünür.",
        ],
      },
    ],
  },

  en: {
    title: "Privacy Policy",
    intro:
      "Kuran Nuru is a tool for creating Quran recitation videos. This page explains what data we collect, why, and how you control it. We show no ads, use no tracking or analytics tools, and never sell your data.",
    sections: [
      {
        heading: "Data we collect",
        bullets: [
          "Account data: your email address, your password stored as an irreversible hash (bcrypt), and your name and profile picture if you add them.",
          "Content you upload: background images and videos, audio files, fonts, and your project settings (drafts).",
          "Videos you create: we keep your 20 most recent videos in your gallery so you can download or publish them later; older ones are deleted automatically.",
          "Technical data: your IP address is used temporarily to limit abuse (rate limiting) and may appear in server logs.",
        ],
      },
      {
        heading: "Cookies and local storage",
        paragraphs: [
          "We use one strictly necessary cookie to keep you signed in (30 days), and a short-lived temporary cookie while you link a publishing account. Your preferences (language, theme, translation, and your current project) are stored in your browser. We use no advertising or tracking cookies.",
        ],
      },
      {
        heading: "How we use your data",
        bullets: [
          "To run your account and sign you in.",
          "To create the videos you request and save them to your gallery.",
          "To publish a video to the accounts you linked, and only when you press the publish button.",
          "To protect the service from abuse.",
        ],
      },
      {
        heading: "Linking YouTube, TikTok and Instagram accounts",
        paragraphs: [
          "Linking is entirely optional. When you link an account we store its account ID and display name, and the access tokens the platform issues to us, which are kept encrypted in our database. We never see or store your password for those platforms.",
          "We use this access for one purpose: uploading the video you choose to your account, with the title, description and privacy setting you select. We do not read your other videos, messages or followers, and we never publish anything without your explicit request.",
          "You can disconnect any account at any time from the Account page; we delete its tokens and ask the platform to revoke them where possible. You can also withdraw access from the platform itself; for a Google account, at https://myaccount.google.com/permissions",
          "Publishing to YouTube uses YouTube API Services. By using it you agree to the YouTube Terms of Service (https://www.youtube.com/t/terms), and your data held by Google is subject to the Google Privacy Policy (https://policies.google.com/privacy).",
        ],
      },
      {
        heading: "Third parties",
        bullets: [
          "YouTube (Google), TikTok and Instagram (Meta): we send them the video, its title and its description when you ask to publish.",
          "Pollinations AI: if you use AI background generation, the text you type is sent to this service to generate the image.",
          "Quran text, recitation and translation sources (quran.com, alquran.cloud, everyayah.com, jsDelivr): Quran data is fetched from them; your browser may contact them directly, which exposes your IP address to them.",
        ],
        paragraphs: ["We do not share your data with anyone else unless the law requires it."],
      },
      {
        heading: "Retention and deletion",
        paragraphs: [
          "We keep your data for as long as your account exists. You can delete any video from your gallery, and delete your whole account from the Account page.",
          "When you delete your account we immediately delete: your account data, your profile picture, your gallery videos, and every linked publishing account and its tokens. The projects (drafts) behind those videos, and the files you uploaded for them, are deleted with them.",
          "Your projects are under your control: a draft is deleted when you start a new project or delete its video from the gallery. Abandoned drafts, meaning those not modified for 30 days and not linked to any saved video, are deleted automatically.",
          "Videos you published to other platforms stay there; delete them on those platforms.",
        ],
      },
      {
        heading: "Security",
        paragraphs: [
          "Passwords are stored hashed, publishing-account tokens are stored encrypted, and the site is served over HTTPS. Even so, no online service is completely secure, so choose a strong password that is unique to this site.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "You may access, correct and delete your data. Most of this is available directly on the Account page; for anything else, write to us.",
        ],
      },
      {
        heading: "Children",
        paragraphs: ["The service is not directed at children under 13 and we do not knowingly collect their data."],
      },
      {
        heading: "Changes to this policy",
        paragraphs: [
          "We may update this policy as the service changes. The date of the last update is shown at the top of the page.",
        ],
      },
    ],
  },
};

const terms: Record<LegalLanguage, LegalDoc> = {
  ar: {
    title: "شروط الاستخدام",
    intro:
      "باستخدامك Kuran Nuru أو إنشائك حسابًا فيه فإنك توافق على هذه الشروط. إن لم توافق عليها فلا تستخدم الخدمة.",
    sections: [
      {
        heading: "الخدمة",
        paragraphs: [
          "Kuran Nuru أداة مجانية لإنشاء مقاطع فيديو للقرآن الكريم تجمع النص القرآني والتلاوة والترجمة والخلفية، مع إمكانية حفظها وتنزيلها ونشرها على حساباتك في منصات التواصل.",
        ],
      },
      {
        heading: "حسابك",
        bullets: [
          "قدّم بريدًا إلكترونيًا صحيحًا وحافظ على سرية كلمة مرورك.",
          "أنت مسؤول عن كل ما يجري عبر حسابك.",
          "يمكنك حذف حسابك في أي وقت من صفحة «الحساب».",
        ],
      },
      {
        heading: "الاستخدام المقبول",
        paragraphs: ["تتعامل هذه الخدمة مع كلام الله تعالى، فنطلب منك أن تستخدمها بما يليق به. يُمنع:"],
        bullets: [
          "تحريف النص القرآني أو تغيير معناه، أو عرضه بما ينافي حرمته.",
          "استخدام خلفيات أو أصوات مسيئة أو غير لائقة مع الآيات.",
          "رفع محتوى لا تملك حق استخدامه، أو محتوى مخالف للقانون.",
          "محاولة اختراق الخدمة أو تعطيلها أو إغراقها بالطلبات الآلية.",
          "استخدام الخدمة لإرسال محتوى مزعج أو مضلل على المنصات الأخرى.",
        ],
      },
      {
        heading: "محتواك",
        paragraphs: [
          "ما ترفعه من صور وفيديوهات وأصوات وخطوط يبقى ملكًا لك أو لأصحابه، وأنت تقرّ بأن لك حق استخدامه. تمنحنا إذنًا محدودًا بتخزينه ومعالجته لغرض واحد هو إنشاء الفيديو الذي طلبته وحفظه ونشره بطلبك.",
          "الفيديوهات التي تنشئها لك، وأنت المسؤول عن طريقة استخدامها ونشرها.",
        ],
      },
      {
        heading: "التلاوات والترجمات",
        paragraphs: [
          "التلاوات والترجمات والخطوط المتاحة في الخدمة مصدرها جهات خارجية، وحقوقها لأصحابها. قد تكون لبعضها شروط خاصة للاستخدام، وخاصةً التجاري؛ والتحقق من ذلك قبل النشر مسؤوليتك.",
          "نبذل جهدنا في صحة النص القرآني وتوقيت ظهوره، لكن قد تقع أخطاء. راجع الفيديو قبل نشره، وأبلغنا عن أي خطأ تجده.",
        ],
      },
      {
        heading: "النشر على المنصات الأخرى",
        paragraphs: [
          "عند النشر على يوتيوب أو تيك توك أو إنستغرام فأنت تنشر على حسابك وباسمك، وتلتزم بشروط تلك المنصات، ومنها شروط خدمة يوتيوب (https://www.youtube.com/t/terms). لسنا مسؤولين عن قرارات تلك المنصات تجاه محتواك أو حسابك، ولا عن قيودها أو أعطالها.",
        ],
      },
      {
        heading: "توفر الخدمة",
        paragraphs: [
          "الخدمة مقدَّمة «كما هي» دون أي ضمان. قد تتوقف أو تتغير أو تُحذف منها ميزات في أي وقت. نحتفظ بعدد محدود من فيديوهاتك وقد تُحذف الملفات المؤقتة، فاحتفظ بنسخة من كل ما يهمك.",
        ],
      },
      {
        heading: "حدود المسؤولية",
        paragraphs: [
          "في حدود ما يسمح به القانون، لا نتحمل مسؤولية أي خسارة أو ضرر ينتج عن استخدام الخدمة أو تعذّر استخدامها، ومن ذلك فقدان الملفات أو أخطاء الفيديو أو ما يترتب على نشره.",
        ],
      },
      {
        heading: "إيقاف الحساب",
        paragraphs: ["يحق لنا تعليق أو حذف أي حساب أو محتوى يخالف هذه الشروط."],
      },
      {
        heading: "القانون الحاكم",
        paragraphs: [
          "تخضع هذه الشروط لقوانين دولة ليبيا وتُفسَّر وفقًا لها، وتختص المحاكم الليبية بالنظر في أي نزاع ينشأ عنها.",
        ],
      },
      {
        heading: "تغيير الشروط",
        paragraphs: [
          "قد نعدّل هذه الشروط، ويظهر تاريخ آخر تحديث أعلى الصفحة. استمرارك في استخدام الخدمة بعد التعديل يعني موافقتك عليه.",
        ],
      },
    ],
  },

  tr: {
    title: "Kullanım Koşulları",
    intro:
      "Kuran Nuru'yu kullanarak veya hesap oluşturarak bu koşulları kabul etmiş olursunuz. Kabul etmiyorsanız hizmeti kullanmayın.",
    sections: [
      {
        heading: "Hizmet",
        paragraphs: [
          "Kuran Nuru; Kur'an metnini, tilaveti, çeviriyi ve arka planı bir araya getirerek Kur'an-ı Kerim videoları oluşturmaya yarayan ücretsiz bir araçtır. Videoları kaydedebilir, indirebilir ve sosyal medya hesaplarınızda yayınlayabilirsiniz.",
        ],
      },
      {
        heading: "Hesabınız",
        bullets: [
          "Geçerli bir e-posta adresi verin ve şifrenizi gizli tutun.",
          "Hesabınız üzerinden yapılan her işlemden siz sorumlusunuz.",
          "Hesabınızı istediğiniz zaman «Hesap» sayfasından silebilirsiniz.",
        ],
      },
      {
        heading: "Kabul edilebilir kullanım",
        paragraphs: [
          "Bu hizmet Allah'ın kelamıyla ilgilidir; ona yakışır biçimde kullanmanızı rica ederiz. Şunlar yasaktır:",
        ],
        bullets: [
          "Kur'an metnini tahrif etmek, anlamını değiştirmek veya saygınlığına aykırı biçimde sunmak.",
          "Ayetlerle birlikte uygunsuz veya saygısız arka plan ya da ses kullanmak.",
          "Kullanım hakkına sahip olmadığınız veya hukuka aykırı içerik yüklemek.",
          "Hizmete sızmaya, hizmeti aksatmaya veya otomatik isteklerle boğmaya çalışmak.",
          "Hizmeti diğer platformlarda istenmeyen veya yanıltıcı içerik yaymak için kullanmak.",
        ],
      },
      {
        heading: "İçeriğiniz",
        paragraphs: [
          "Yüklediğiniz görseller, videolar, sesler ve yazı tipleri size veya sahiplerine ait kalır; bunları kullanma hakkına sahip olduğunuzu beyan edersiniz. Bize yalnızca istediğiniz videoyu oluşturmak, kaydetmek ve talebinizle yayınlamak amacıyla bunları saklama ve işleme konusunda sınırlı bir izin verirsiniz.",
          "Oluşturduğunuz videolar size aittir; nasıl kullanıldıklarından ve yayınlandıklarından siz sorumlusunuz.",
        ],
      },
      {
        heading: "Tilavetler ve çeviriler",
        paragraphs: [
          "Hizmette sunulan tilavetler, çeviriler ve yazı tipleri üçüncü taraflardan gelir ve hakları sahiplerine aittir. Bazılarının özellikle ticari kullanım için özel koşulları olabilir; yayınlamadan önce bunu kontrol etmek sizin sorumluluğunuzdadır.",
          "Kur'an metninin doğruluğu ve zamanlaması için elimizden geleni yapıyoruz, ancak hatalar olabilir. Videoyu yayınlamadan önce gözden geçirin ve bulduğunuz hataları bize bildirin.",
        ],
      },
      {
        heading: "Diğer platformlarda yayınlama",
        paragraphs: [
          "YouTube, TikTok veya Instagram'da yayınladığınızda kendi hesabınızda ve kendi adınıza yayınlamış olursunuz ve YouTube Hizmet Şartları (https://www.youtube.com/t/terms) dahil o platformların koşullarına uymayı kabul edersiniz. Bu platformların içeriğiniz veya hesabınız hakkındaki kararlarından, kısıtlamalarından veya arızalarından sorumlu değiliz.",
        ],
      },
      {
        heading: "Hizmetin sürekliliği",
        paragraphs: [
          "Hizmet hiçbir garanti verilmeksizin «olduğu gibi» sunulur. Herhangi bir zamanda durabilir, değişebilir veya özellikleri kaldırılabilir. Videolarınızın sınırlı bir kısmını saklarız ve geçici dosyalar silinebilir; sizin için önemli olan her şeyin bir kopyasını saklayın.",
        ],
      },
      {
        heading: "Sorumluluğun sınırlandırılması",
        paragraphs: [
          "Yasaların izin verdiği ölçüde; dosya kaybı, video hataları veya yayınlamanın sonuçları dahil, hizmetin kullanılmasından veya kullanılamamasından doğan hiçbir kayıp ya da zarardan sorumlu değiliz.",
        ],
      },
      {
        heading: "Hesabın kapatılması",
        paragraphs: ["Bu koşulları ihlal eden hesapları veya içerikleri askıya alabilir ya da silebiliriz."],
      },
      {
        heading: "Uygulanacak hukuk",
        paragraphs: [
          "Bu koşullar Libya Devleti kanunlarına tabidir ve bu kanunlara göre yorumlanır; bu koşullardan doğan her türlü uyuşmazlıkta Libya mahkemeleri yetkilidir.",
        ],
      },
      {
        heading: "Koşullardaki değişiklikler",
        paragraphs: [
          "Bu koşulları değiştirebiliriz; son güncelleme tarihi sayfanın üstünde görünür. Değişiklikten sonra hizmeti kullanmaya devam etmeniz, değişikliği kabul ettiğiniz anlamına gelir.",
        ],
      },
    ],
  },

  en: {
    title: "Terms of Use",
    intro:
      "By using Kuran Nuru or creating an account you agree to these terms. If you do not agree, do not use the service.",
    sections: [
      {
        heading: "The service",
        paragraphs: [
          "Kuran Nuru is a free tool for creating Quran recitation videos that combine the Quranic text, a recitation, a translation and a background. You can save and download the videos and publish them to your own social media accounts.",
        ],
      },
      {
        heading: "Your account",
        bullets: [
          "Provide a valid email address and keep your password confidential.",
          "You are responsible for everything done through your account.",
          "You can delete your account at any time from the Account page.",
        ],
      },
      {
        heading: "Acceptable use",
        paragraphs: [
          "This service handles the words of the Quran, and we ask you to use it in a manner befitting them. You must not:",
        ],
        bullets: [
          "Distort the Quranic text, alter its meaning, or present it in a way that violates its sanctity.",
          "Pair the verses with offensive or inappropriate backgrounds or audio.",
          "Upload content you have no right to use, or content that is unlawful.",
          "Attempt to break into, disrupt, or flood the service with automated requests.",
          "Use the service to send spam or misleading content to other platforms.",
        ],
      },
      {
        heading: "Your content",
        paragraphs: [
          "Images, videos, audio and fonts you upload remain yours or their owners', and you confirm you have the right to use them. You grant us a limited permission to store and process them for the sole purpose of creating, saving and, at your request, publishing the video you asked for.",
          "The videos you create are yours, and you are responsible for how they are used and published.",
        ],
      },
      {
        heading: "Recitations and translations",
        paragraphs: [
          "The recitations, translations and fonts offered in the service come from third parties and remain the property of their owners. Some may carry their own conditions, particularly for commercial use; checking this before publishing is your responsibility.",
          "We do our best to keep the Quranic text and its timing accurate, but mistakes can happen. Review each video before publishing it and tell us about any error you find.",
        ],
      },
      {
        heading: "Publishing to other platforms",
        paragraphs: [
          "When you publish to YouTube, TikTok or Instagram you are publishing on your own account and in your own name, and you agree to comply with those platforms' terms, including the YouTube Terms of Service (https://www.youtube.com/t/terms). We are not responsible for those platforms' decisions about your content or account, nor for their restrictions or outages.",
        ],
      },
      {
        heading: "Availability",
        paragraphs: [
          "The service is provided \"as is\", without warranty of any kind. It may stop, change, or lose features at any time. We keep only a limited number of your videos and temporary files may be deleted, so keep your own copy of anything that matters to you.",
        ],
      },
      {
        heading: "Limitation of liability",
        paragraphs: [
          "To the extent permitted by law, we are not liable for any loss or damage arising from the use of, or inability to use, the service, including lost files, errors in a video, or the consequences of publishing it.",
        ],
      },
      {
        heading: "Termination",
        paragraphs: ["We may suspend or delete any account or content that violates these terms."],
      },
      {
        heading: "Governing law",
        paragraphs: [
          "These terms are governed by and construed in accordance with the laws of the State of Libya, and the Libyan courts have jurisdiction over any dispute arising from them.",
        ],
      },
      {
        heading: "Changes to these terms",
        paragraphs: [
          "We may change these terms; the date of the last update is shown at the top of the page. Continuing to use the service after a change means you accept it.",
        ],
      },
    ],
  },
};

export const LEGAL_DOCS: Record<LegalDocId, Record<LegalLanguage, LegalDoc>> = { privacy, terms };
