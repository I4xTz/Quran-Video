"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";
import {
  LEGAL_DOCS,
  LEGAL_LABELS,
  LEGAL_LAST_UPDATED,
  type LegalDocId,
  type LegalLanguage,
} from "@/lib/legal/content";

type Props = {
  doc: LegalDocId;
  // From CONTACT_EMAIL -- the contact section is left out entirely while
  // that isn't set, rather than showing an address nobody reads.
  contactEmail: string | null;
  // `?lang=en`: the site itself only switches between Arabic and Turkish,
  // so English (what the platforms' reviewers read) is a per-page link.
  english: boolean;
};

const URL_RE = /(https?:\/\/[^\s)،]+)/g;

// The documents are plain strings; any URL inside one becomes a real link.
function withLinks(text: string) {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" dir="ltr" className="text-primary hover:underline break-all">
        {part}
      </a>
    ) : (
      part
    )
  );
}

export default function LegalPage({ doc, contactEmail, english }: Props) {
  const { language } = useLanguage();
  const lang: LegalLanguage = english ? "en" : language;
  const content = LEGAL_DOCS[doc][lang];
  const labels = LEGAL_LABELS[lang];
  const other: LegalDocId = doc === "privacy" ? "terms" : "privacy";

  return (
    <article dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="max-w-3xl mx-auto">
      <div className="rounded-2xl border border-border bg-surface shadow-soft p-6 sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{content.title}</h1>
          <Link
            href={english ? `/${doc}` : `/${doc}?lang=en`}
            className="flex-shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-2"
          >
            {english ? (language === "ar" ? "العربية" : "Türkçe") : "English"}
          </Link>
        </div>
        <p className="text-xs text-muted mb-6">
          {labels.lastUpdated}: <span dir="ltr">{LEGAL_LAST_UPDATED}</span>
        </p>

        <p className="text-sm sm:text-base text-foreground leading-loose">{withLinks(content.intro)}</p>

        {content.sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="text-lg font-bold text-foreground mb-3">{section.heading}</h2>
            {/* A section with both reads "lead-in, list" when the paragraph
                ends in a colon, and "list, closing note" otherwise. */}
            {section.paragraphs
              ?.filter((p) => !section.bullets || /[:：]$/.test(p))
              .map((p) => (
                <p key={p} className="text-sm sm:text-base text-foreground leading-loose mb-3">
                  {withLinks(p)}
                </p>
              ))}
            {section.bullets && (
              <ul className="list-disc ps-5 space-y-2 mb-3 marker:text-primary">
                {section.bullets.map((b) => (
                  <li key={b} className="text-sm sm:text-base text-foreground leading-loose">
                    {withLinks(b)}
                  </li>
                ))}
              </ul>
            )}
            {section.bullets &&
              section.paragraphs
                ?.filter((p) => !/[:：]$/.test(p))
                .map((p) => (
                  <p key={p} className="text-sm sm:text-base text-foreground leading-loose mb-3">
                    {withLinks(p)}
                  </p>
                ))}
          </section>
        ))}

        {contactEmail && (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-foreground mb-3">{labels.contactHeading}</h2>
            <p className="text-sm sm:text-base text-foreground leading-loose">
              {labels.contact}{" "}
              <a href={`mailto:${contactEmail}`} dir="ltr" className="text-primary hover:underline">
                {contactEmail}
              </a>
            </p>
          </section>
        )}

        <p className="mt-10 border-t border-border pt-5 text-sm">
          <Link href={english ? `/${other}?lang=en` : `/${other}`} className="font-semibold text-primary hover:underline">
            {labels[other]}
          </Link>
        </p>
      </div>
    </article>
  );
}
