"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircleIcon, ExclamationCircleIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { useLanguage } from "@/lib/LanguageContext";
import Spinner from "@/components/ui/Spinner";
import { latinNameForArabicReciterName } from "@/lib/reciterNames";
import type { GalleryEntry } from "@/lib/videoGallery";
import {
  CAPTION_MAX,
  PLATFORM_LABEL,
  YOUTUBE_TITLE_MAX,
  type PublishRequest,
  type PublishResult,
  type PublishVisibility,
  type SocialAccountStatus,
  type SocialPlatform,
} from "@/lib/social/platforms";
import { socialErrorText } from "@/lib/social/messages";

type Progress =
  | { state: "uploading" }
  | { state: "done"; result: PublishResult }
  | { state: "error"; code: string; detail?: string };

type Props = {
  entry: GalleryEntry;
  onClose: () => void;
  // Fired once every selected platform has answered, so the gallery card can
  // pick up the "published" markers the server just saved.
  onPublished: () => void;
};

const INPUT_CLASSES =
  "w-full outline-none transition-colors rounded-lg border border-border bg-background text-sm px-3 py-2 focus:border-primary focus:ring-1 focus:ring-primary";

function defaultTexts(entry: GalleryEntry, isAr: boolean): { title: string; caption: string } {
  const single = entry.startVerse === entry.endVerse;
  if (isAr) {
    const surah = entry.surahNameArabic.startsWith("سورة") ? entry.surahNameArabic : `سورة ${entry.surahNameArabic}`;
    const verses = single ? `الآية ${entry.startVerse}` : `الآيات ${entry.startVerse}-${entry.endVerse}`;
    return {
      title: `${surah} | ${verses} | ${entry.reciterName}`,
      caption: `${surah} - ${verses}\nالقارئ: ${entry.reciterName}\n\n#القرآن_الكريم #قرآن #تلاوة`,
    };
  }
  const reciter = entry.reciterNameLatin ?? latinNameForArabicReciterName(entry.reciterName) ?? entry.reciterName;
  const surah = `${entry.surahNameTransliteration} SURESİ`;
  const verses = single ? `${entry.startVerse}. Ayet` : `${entry.startVerse}-${entry.endVerse}. Ayetler`;
  return {
    title: `${surah} | ${verses} | ${reciter}`,
    caption: `${surah} - ${verses}\nKâri: ${reciter}\n\n#Kuran #KuranıKerim #tilavet`,
  };
}

// Publishes one saved gallery video to the user's linked accounts. Mounted
// only while open (GalleryGrid keys it by entry id), so all of its state
// starts fresh for every video.
export default function PublishDialog({ entry, onClose, onPublished }: Props) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const t = (ar: string, tr: string) => (isAr ? ar : tr);

  const defaults = React.useMemo(() => defaultTexts(entry, isAr), [entry, isAr]);
  const [accounts, setAccounts] = React.useState<SocialAccountStatus[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<SocialPlatform>>(new Set());
  const [title, setTitle] = React.useState(defaults.title.slice(0, YOUTUBE_TITLE_MAX));
  const [caption, setCaption] = React.useState(defaults.caption);
  const [visibility, setVisibility] = React.useState<PublishVisibility>("public");
  const [progress, setProgress] = React.useState<Partial<Record<SocialPlatform, Progress>>>({});

  const uploading = Object.values(progress).some((p) => p.state === "uploading");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/social/accounts");
        if (!res.ok) throw new Error();
        const data: { accounts: SocialAccountStatus[] } = await res.json();
        if (cancelled) return;
        setAccounts(data.accounts);
        // Pre-ticks every linked platform this video hasn't gone to yet.
        setSelected(
          new Set(data.accounts.filter((a) => a.connected && !entry.published?.[a.platform]).map((a) => a.platform))
        );
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per open: the gallery re-fetches its entries every few seconds
    // (a new `entry` object each time), which must not reset the ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Uploads keep running on the server even if this closes, with nowhere
  // left to show their outcome -- so it can't be dismissed mid-upload.
  const close = React.useCallback(() => {
    if (!uploading) onClose();
  }, [uploading, onClose]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  // Instagram has no private posts, so it sits out a private publish.
  const usable = (platform: SocialPlatform) => !(platform === "instagram" && visibility === "private");
  const targets = [...selected].filter((p) => usable(p) && progress[p]?.state !== "done");

  const publishOne = async (platform: SocialPlatform) => {
    setProgress((prev) => ({ ...prev, [platform]: { state: "uploading" } }));
    let outcome: Progress;
    try {
      const body: PublishRequest = { galleryId: entry.id, title: title.trim(), caption: caption.trim(), visibility };
      const res = await fetch(`/api/social/${platform}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      outcome =
        res.ok && data?.result
          ? { state: "done", result: data.result }
          : { state: "error", code: data?.error ?? "upload_failed", detail: data?.detail };
    } catch {
      outcome = { state: "error", code: "upload_failed" };
    }
    setProgress((prev) => ({ ...prev, [platform]: outcome }));
  };

  const publish = async () => {
    await Promise.all(targets.map(publishOne));
    onPublished();
  };

  const toggle = (platform: SocialPlatform) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const resultText = (result: PublishResult) => {
    if (result.status === "draft") {
      return t("أُرسل إلى صندوق تيك توك. أكمل النشر من التطبيق.", "TikTok gelen kutusuna gönderildi. Paylaşımı uygulamadan tamamlayın.");
    }
    const base =
      result.status === "processing"
        ? t("تم الرفع، والمنصة ما زالت تعالجه.", "Yüklendi, platform hâlâ işliyor.")
        : t("تم النشر.", "Yayınlandı.");
    // The platform narrowed the audience on its own (unaudited API app, or
    // a private TikTok account) -- say so rather than imply it went public.
    return visibility === "public" && result.visibility === "private"
      ? `${base} ${t("(المنصة جعلته خاصًا)", "(platform özel yaptı)")}`
      : base;
  };

  const anyConnected = accounts?.some((a) => a.connected) ?? false;
  const allDone = targets.length === 0 && Object.values(progress).some((p) => p.state === "done");

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-dialog-title"
        dir={isAr ? "rtl" : "ltr"}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto animate-fade-in rounded-2xl border border-border bg-surface p-6 shadow-lg"
      >
        <div className="mb-4 flex items-start gap-3">
          <span className="rounded-full bg-primary/10 p-2 text-primary">
            <PaperAirplaneIcon className={`w-6 h-6 ${isAr ? "-scale-x-100" : ""}`} />
          </span>
          <h2 id="publish-dialog-title" className="text-lg font-bold text-foreground pt-1.5">
            {t("نشر الفيديو", "Videoyu Yayınla")}
          </h2>
        </div>

        {accounts === null ? (
          loadFailed ? (
            <p className="text-sm text-accent-red">{t("تعذر تحميل الحسابات", "Hesaplar yüklenemedi")}</p>
          ) : (
            <div className="flex justify-center py-6">
              <Spinner size="sm" className="border-primary/30 border-t-primary" />
            </div>
          )
        ) : (
          <div className="space-y-4">
            <ul className="space-y-2">
              {accounts.map((account) => {
                const state = progress[account.platform];
                const before = entry.published?.[account.platform];
                const disabled = !account.connected || !usable(account.platform) || uploading || state?.state === "done";
                return (
                  <li key={account.platform} className="rounded-lg border border-border bg-background px-3 py-2.5">
                    <label className={`flex items-center gap-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={account.connected && usable(account.platform) && selected.has(account.platform)}
                        disabled={disabled}
                        onChange={() => toggle(account.platform)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-foreground">
                          {PLATFORM_LABEL[account.platform][isAr ? "ar" : "tr"]}
                        </span>
                        <span className="block text-xs text-muted truncate" dir="auto">
                          {!account.connected
                            ? t("غير مرتبط", "Bağlı değil")
                            : !usable(account.platform)
                              ? t("لا يدعم النشر الخاص", "Özel paylaşımı desteklemiyor")
                              : account.displayName}
                        </span>
                      </span>
                      {before && !state && (
                        <span className="flex-shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {t("نُشر سابقًا", "Daha önce yayınlandı")}
                        </span>
                      )}
                      {state?.state === "uploading" && (
                        <Spinner size="sm" className="flex-shrink-0 border-primary/30 border-t-primary" />
                      )}
                      {state?.state === "done" && <CheckCircleIcon className="h-5 w-5 flex-shrink-0 text-primary" />}
                      {state?.state === "error" && (
                        <ExclamationCircleIcon className="h-5 w-5 flex-shrink-0 text-accent-red" />
                      )}
                    </label>
                    {state?.state === "uploading" && (
                      <p className="mt-1.5 text-xs text-muted">{t("جارٍ الرفع...", "Yükleniyor...")}</p>
                    )}
                    {state?.state === "done" && (
                      <p className="mt-1.5 text-xs text-primary">
                        {resultText(state.result)}{" "}
                        {state.result.url && (
                          <a href={state.result.url} target="_blank" rel="noopener noreferrer" className="underline">
                            {t("فتح", "Aç")}
                          </a>
                        )}
                      </p>
                    )}
                    {state?.state === "error" && (
                      <p className="mt-1.5 text-xs text-accent-red">
                        {socialErrorText(state.code, isAr)}
                        {state.detail && (
                          <span className="block text-muted mt-0.5" dir="ltr">
                            {state.detail}
                          </span>
                        )}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {accounts.some((a) => !a.connected) && (
              <p className="text-xs text-muted">
                <Link href="/account" className="font-semibold text-primary hover:underline">
                  {t("اربط حساباتك من صفحة الحساب", "Hesaplarınızı hesap sayfasından bağlayın")}
                </Link>
              </p>
            )}

            {anyConnected && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {t("العنوان (يوتيوب)", "Başlık (YouTube)")}
                  </label>
                  <input
                    type="text"
                    dir="auto"
                    maxLength={YOUTUBE_TITLE_MAX}
                    className={INPUT_CLASSES}
                    value={title}
                    disabled={uploading}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {t("الوصف", "Açıklama")}
                  </label>
                  <textarea
                    dir="auto"
                    rows={4}
                    maxLength={CAPTION_MAX}
                    className={`${INPUT_CLASSES} resize-none`}
                    value={caption}
                    disabled={uploading}
                    onChange={(e) => setCaption(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground">{t("الخصوصية", "Gizlilik")}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(["public", "private"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={uploading}
                        onClick={() => setVisibility(option)}
                        className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                          visibility === option
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-foreground hover:bg-surface-2"
                        }`}
                      >
                        {option === "public" ? t("عام", "Herkese açık") : t("خاص", "Özel")}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={close}
            disabled={uploading}
            className="rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {allDone ? t("إغلاق", "Kapat") : t("إلغاء", "İptal")}
          </button>
          {!allDone && (
            <button
              type="button"
              onClick={publish}
              disabled={uploading || targets.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading && <Spinner size="sm" className="border-white/40 border-t-white" />}
              {Object.values(progress).some((p) => p.state === "error") && !uploading
                ? t("إعادة المحاولة", "Tekrar Dene")
                : t("نشر", "Yayınla")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
