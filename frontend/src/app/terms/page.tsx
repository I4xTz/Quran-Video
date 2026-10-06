import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Kullanım Koşulları",
};

// Reads CONTACT_EMAIL and ?lang at request time.
export const dynamic = "force-dynamic";

export default function TermsPage({ searchParams }: { searchParams: { lang?: string } }) {
  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Navbar />
      <main id="main-content" className="px-4 py-12 md:py-16">
        <LegalPage
          doc="terms"
          contactEmail={process.env.CONTACT_EMAIL?.trim() || null}
          english={searchParams?.lang === "en"}
        />
      </main>
    </div>
  );
}
