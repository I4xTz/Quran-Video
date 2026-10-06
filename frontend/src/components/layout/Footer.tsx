"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";
import { LEGAL_LABELS } from "@/lib/legal/content";

// Site-wide footer (mounted once in app/layout.tsx): the only place the
// privacy policy and terms are linked from every page, which is what the
// platforms' app reviews look for.
export default function Footer() {
  const { language } = useLanguage();
  const labels = LEGAL_LABELS[language];

  return (
    <footer
      dir={language === "ar" ? "rtl" : "ltr"}
      className="border-t border-border bg-background px-4 py-6 text-xs text-muted"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <span dir="ltr">© {new Date().getFullYear()} Kuran Nuru</span>
        <nav className="flex items-center gap-5">
          <Link href="/privacy" className="hover:text-primary transition-colors">
            {labels.privacy}
          </Link>
          <Link href="/terms" className="hover:text-primary transition-colors">
            {labels.terms}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
