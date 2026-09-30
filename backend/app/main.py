from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.database import engine, Base

# Create tables
Base.metadata.create_all(bind=engine)

# Interactive API docs are handy locally but just advertise every endpoint
# in production -- set DISABLE_DOCS=1 there.
_docs_disabled = os.getenv("DISABLE_DOCS", "").lower() in ("1", "true", "yes")

app = FastAPI(
    docs_url=None if _docs_disabled else "/docs",
    redoc_url=None if _docs_disabled else "/redoc",
    openapi_url=None if _docs_disabled else "/openapi.json",
    title="Kuran Nuru API",
    description="Kur'an-ı Kerim veritabanı — Uthmânî metin, Türkçe çeviri, ses dosyaları.",
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# In production, restrict to your actual domain(s) via env var
_raw_origins = os.getenv("CORS_ORIGINS", "*")
# Empty means "no cross-origin access at all" -- the browser only ever
# reaches this API through the Next.js /backend proxy (same origin).
allow_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],  # Allow GET, POST, DELETE for public API
    allow_headers=["*"],
)

# ── Static files ──────────────────────────────────────────────────────────────
os.makedirs("app/static/audio", exist_ok=True)
os.makedirs("app/static/text", exist_ok=True)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

from app.routers import surahs, ayahs, extraction, ai

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(surahs.router, prefix="/api/surahs", tags=["Surahs"])
app.include_router(ayahs.router, prefix="/api/ayahs", tags=["Ayahs"])
app.include_router(extraction.router, prefix="/api/extraction", tags=["Extraction"])
app.include_router(ai.router, prefix="/api/ai", tags=["AI"])


@app.get("/", tags=["Root"])
def read_root():
    return {
        "message": "Kuran Nuru API — hoş geldiniz",
        "docs": "/docs",
        "version": "1.0.0",
    }


@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "ok"}
