"use client";

import * as React from "react";
import { useLanguage } from "@/lib/LanguageContext";
import Spinner from "@/components/ui/Spinner";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import {
  isSocialPlatform,
  PLATFORM_LABEL,
  type SocialAccountStatus,
  type SocialPlatform,
} from "@/lib/social/platforms";
import { socialErrorText } from "@/lib/social/messages";

type Notice = { kind: "success" | "error"; text: string };

// The "linked accounts" card on the account page: one row per platform with
// a connect link (a real navigation -- it leaves for the platform's consent
// screen, see /api/social/[platform]/connect) or a disconnect button.
export default function ConnectedAccounts() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const t = (ar: string, tr: string) => (isAr ? ar : tr);

  const [accounts, setAccounts] = React.useState<SocialAccountStatus[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<SocialPlatform | null>(null);
  // Two-click arm/confirm, same convention as the temp-files cleanup below.
  const [armed, setArmed] = React.useState<SocialPlatform | null>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/social/accounts");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAccounts(data.accounts);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // The OAuth callback lands back on this page with its outcome in the
  // query string -- shown once, then stripped so a reload doesn't repeat it.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const platform = params.get("platform");
    const error = params.get("social_error");
    if (!params.has("social_connected") && !error) return;

    const label = isSocialPlatform(platform) ? PLATFORM_LABEL[platform][isAr ? "ar" : "tr"] : "";
    setNotice(
      error
        ? { kind: "error", text: `${label ? `${label}: ` : ""}${socialErrorText(error, isAr)}` }
        : { kind: "success", text: isAr ? `تم ربط حساب ${label} بنجاح.` : `${label} hesabı bağlandı.` }
    );
    window.history.replaceState(null, "", window.location.pathname);
    // Only the query string as it was on arrival matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = async (platform: SocialPlatform) => {
    if (armed !== platform) {
      setArmed(platform);
      return;
    }
    setArmed(null);
    setBusy(platform);
    setNotice(null);
    try {
      const res = await fetch(`/api/social/${platform}`, { method: "DELETE" });
      if (!res.ok) {
        setNotice({ kind: "error", text: t("تعذر فصل الحساب", "Hesap bağlantısı kesilemedi") });
        return;
      }
      await load();
    } catch {
      setNotice({ kind: "error", text: t("خطأ في الاتصال", "Bağlantı hatası") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-background/50 p-5">
      <h2 className="text-sm font-bold text-foreground mb-2">{t("حسابات النشر", "Yayın Hesapları")}</h2>
      <p className="text-sm text-muted leading-relaxed mb-4">
        {t(
          "اربط حساباتك لنشر الفيديو من المعرض مباشرة بضغطة واحدة.",
          "Videoları galeriden tek tıkla yayınlamak için hesaplarınızı bağlayın."
        )}
      </p>

      {notice && (
        <p className={`mb-3 text-xs ${notice.kind === "error" ? "text-accent-red" : "text-primary"}`}>{notice.text}</p>
      )}

      {accounts === null ? (
        loadFailed ? (
          <p className="text-xs text-accent-red">{t("تعذر تحميل الحسابات", "Hesaplar yüklenemedi")}</p>
        ) : (
          <Spinner size="sm" className="border-primary/30 border-t-primary" />
        )
      ) : (
        <ul className="space-y-2">
          {accounts.map((account) => (
            <li
              key={account.platform}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {PLATFORM_LABEL[account.platform][isAr ? "ar" : "tr"]}
                </p>
                <p className="text-xs text-muted truncate" dir="auto">
                  {account.connected ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <CheckCircleIcon className="h-3.5 w-3.5 flex-shrink-0" />
                      {account.displayName}
                    </span>
                  ) : account.configured ? (
                    t("غير مرتبط", "Bağlı değil")
                  ) : (
                    t("غير مُعَدّ على الخادم", "Sunucuda yapılandırılmadı")
                  )}
                </p>
              </div>

              {account.connected ? (
                <button
                  type="button"
                  onClick={() => disconnect(account.platform)}
                  disabled={busy === account.platform}
                  className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    armed === account.platform
                      ? "border-accent-red/50 bg-accent-red/10 text-accent-red hover:bg-accent-red/20"
                      : "border-border text-foreground hover:bg-surface-2"
                  }`}
                >
                  {busy === account.platform && <Spinner size="sm" className="border-primary/30 border-t-primary" />}
                  {armed === account.platform ? t("تأكيد الفصل", "Kesmeyi Onayla") : t("فصل", "Bağlantıyı Kes")}
                </button>
              ) : account.configured ? (
                <a
                  href={`/api/social/${account.platform}/connect`}
                  className="flex-shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-dark"
                >
                  {t("ربط", "Bağla")}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
