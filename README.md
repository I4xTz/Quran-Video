# KuranNuru Video Creator

A powerful web application designed to automatically generate high-quality, synchronized Quran recitation videos. It provides a programmatic video rendering pipeline using **Remotion** and **Next.js** on the frontend, and precise audio extraction/alignment using **FastAPI** and **Whisper** on the backend.

## 🚀 Features

- **Programmatic Video Generation**: Uses [Remotion](https://www.remotion.dev/) to render videos directly in the browser/Node environment.
- **Precise Audio Alignment**: Utilizes Whisper (via `stable-ts` and `faster-whisper`) to extract word-level timestamps from Quran recitations.
- **Rich Typography & Styling**: Supports custom Arabic fonts (Uthmanic, KFGQPC) and transliterations, styled beautifully with Tailwind CSS.
- **Custom Backgrounds & Audio**: Allows users to upload custom background images and custom audio recitations for seamless alignment.
- **GPU Acceleration**: Built-in support for NVIDIA GPUs in Docker for blazingly fast audio processing and rendering.

## 🛠️ Tech Stack

### Frontend
- **Framework**: Next.js 14
- **Video Rendering**: Remotion
- **Styling**: Tailwind CSS, Framer Motion
- **Language**: TypeScript

### Backend
- **Framework**: FastAPI (Python)
- **Database**: PostgreSQL
- **Caching/Queue**: Redis
- **AI / Audio Processing**: `stable-ts`, `faster-whisper`, `PyTorch`

## 📋 Prerequisites

Before you begin, ensure you have the following installed on your machine:
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- *(Optional but Highly Recommended)* [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) for GPU acceleration.

## ⚙️ Getting Started

Follow these instructions to get the project up and running on your local machine.

### 1. Clone the repository
```bash
git clone https://github.com/I4xTz/Quran-Video.git
cd Quran-Video
```

### 2. Environment Variables
If you need specific features like HuggingFace integrations, you can export your token or add a `.env` file at the root:
```bash
export HUGGINGFACE_TOKEN="your_token_here"
```

### 3. Build and Run using Docker Compose
The easiest way to run the entire stack (Frontend, Backend, Postgres, and Redis) is using Docker Compose:

```bash
docker compose up --build
```

*(Note: The first build might take a while as it downloads the necessary Docker images, Python dependencies, and Node modules.)*

This runs on the CPU and works on any machine with Docker. The database tables (including user accounts) are created automatically on first start.

**Optional – NVIDIA GPU acceleration:** if you have an NVIDIA GPU and the NVIDIA Container Toolkit installed, add the GPU override file for much faster audio alignment:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

### 4. Access the Application
Once the containers are successfully running, you can access the services at:
- **Frontend (UI)**: [http://localhost:3000](http://localhost:3000)
- **Backend API Docs**: [http://localhost:8001/docs](http://localhost:8001/docs)
- **Postgres Database**: `localhost:5433` (User: `user`, Password: `password`, DB: `kurannuru`)
- **Redis**: `localhost:6380`

## 🌐 Production Deployment

The default `docker-compose.yml` is for local development only (dev server, open ports, default passwords). On a server:

1. Copy `.env.example` to `.env` and fill in `POSTGRES_PASSWORD`, `AUTH_SECRET` (`openssl rand -hex 32`) and your own email in `ADMIN_EMAILS`.
2. Start with the production override (add `-f docker-compose.gpu.yml` on a GPU server):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
3. Put a reverse proxy with HTTPS (Caddy or nginx) in front of port `3000`. It is the only published port; Postgres and the backend stay on the internal Docker network.

Uploaded files, drafts, gallery videos, avatars and the backend's audio cache are kept on named Docker volumes, so they survive rebuilds.

> ⚠️ Password-reset and email-verification links are still returned directly in the API response (`DEV_MODE_NO_EMAIL` in `frontend/src/lib/auth/tokens.ts`) until real email delivery is wired up. While it is on, anyone who knows a user's email can reset that user's password.

## 🛑 Stopping the Application
To stop the running containers, press `Ctrl+C` in your terminal, and then run:
```bash
docker compose down
```
If you want to wipe the database and volumes, run:
```bash
docker compose down -v
```

## 📝 Notes
- **GPU Usage**: The default `docker-compose.yml` does not require a GPU — Whisper automatically runs on the CPU (slower audio alignment, rendering is unaffected). Use `docker-compose.gpu.yml` as shown above to enable an NVIDIA GPU.
- **Port Conflicts**: Ensure ports `3000`, `8001`, `5433`, and `6380` are not being used by other applications on your host machine.

## 📄 License
[MIT License](LICENSE)
