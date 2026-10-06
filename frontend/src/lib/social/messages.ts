// User-facing wording for the error codes the /api/social routes return
// (SocialApiError.code, plus the few codes the routes produce themselves).
// Client-safe: imported by ConnectedAccounts.tsx and PublishDialog.tsx.
const MESSAGES: Record<string, { ar: string; tr: string }> = {
  not_configured: {
    ar: "لم تُضف مفاتيح هذه المنصة إلى إعدادات الخادم بعد.",
    tr: "Bu platformun API anahtarları sunucuya henüz eklenmedi.",
  },
  not_connected: {
    ar: "الحساب غير مرتبط. اربطه من صفحة الحساب.",
    tr: "Hesap bağlı değil. Hesap sayfasından bağlayın.",
  },
  reconnect_required: {
    ar: "انتهت صلاحية الربط. أعد ربط الحساب من صفحة الحساب.",
    tr: "Bağlantının süresi doldu. Hesabı hesap sayfasından yeniden bağlayın.",
  },
  denied: {
    ar: "تم إلغاء الربط.",
    tr: "Bağlantı iptal edildi.",
  },
  state_mismatch: {
    ar: "انتهت صلاحية المحاولة. حاول مرة أخرى.",
    tr: "İşlemin süresi doldu. Tekrar deneyin.",
  },
  missing_scope: {
    ar: "لم تُمنح صلاحية النشر. أعد المحاولة ووافق على جميع الصلاحيات.",
    tr: "Yayınlama izni verilmedi. Tekrar deneyin ve tüm izinleri onaylayın.",
  },
  no_channel: {
    ar: "هذا الحساب لا يملك قناة يوتيوب. أنشئ قناة أولًا ثم أعد الربط.",
    tr: "Bu hesabın YouTube kanalı yok. Önce bir kanal oluşturup tekrar bağlayın.",
  },
  instagram_public_only: {
    ar: "إنستغرام لا يدعم النشر الخاص.",
    tr: "Instagram özel paylaşımı desteklemiyor.",
  },
  quota_exceeded: {
    ar: "تم بلوغ حد النشر اليومي لهذه المنصة. حاول لاحقًا.",
    tr: "Bu platformun günlük yayın sınırına ulaşıldı. Daha sonra deneyin.",
  },
  tiktok_unaudited: {
    ar: "تطبيق تيك توك لم يُراجَع بعد: النشر متاح فقط لحساب خاص وبخصوصية «خاص».",
    tr: "TikTok uygulaması henüz denetlenmedi: yalnızca gizli hesaba ve «özel» olarak paylaşılabilir.",
  },
  video_not_found: {
    ar: "الفيديو لم يعد موجودًا.",
    tr: "Video artık mevcut değil.",
  },
  too_many_requests: {
    ar: "محاولات كثيرة. انتظر قليلًا ثم حاول.",
    tr: "Çok fazla deneme. Biraz bekleyip tekrar deneyin.",
  },
};

const FALLBACK = { ar: "تعذر إتمام العملية. حاول مرة أخرى.", tr: "İşlem tamamlanamadı. Tekrar deneyin." };

export function socialErrorText(code: string | null | undefined, isArabic: boolean): string {
  const entry = (code && MESSAGES[code]) || FALLBACK;
  return isArabic ? entry.ar : entry.tr;
}
