# VPS Hosting Requirements: STAAD Platform

Estimated CPU, RAM, storage and bandwidth for self-hosting this project on a VPS.

> These are estimates based on reading the code. Nothing here has been load-tested.

---

## TL;DR

|  | vCPU | RAM | Disk |
| --- | --- | --- | --- |
| **Minimum** | 2 | 4 GB (+2 GB swap) | 40 GB SSD |
| **Recommended** | 4 | 8 GB | 80 GB SSD |

Most of the heavy work (video, database, AI, auth) runs on outside services. The VPS only runs lightweight Node.js processes.

---

## 1. What actually runs on the VPS

| Component | What it is | RAM (approx.) | CPU |
| --- | --- | --- | --- |
| `frontend/` | Next.js 14 app (`next start`) | 200–400 MB | Low |
| `backend/` | Next.js API routes + custom `server.js` (relays live session audio to Sarvam for speech-to-text) | 300–500 MB, plus a little per live session | Low to medium (busiest during live sessions) |
| `backend/whatsapp-bot/` | Baileys WhatsApp bot (Express) | 150–300 MB | Very low |
| Reverse proxy + process manager | Nginx/Caddy (HTTPS) + PM2 or Docker | \~100 MB | Very low |
| **Total while running** |  | **\~1–1.5 GB** |  |

---

## 2. What does *not* run on the VPS

| Service | Provider |
| --- | --- |
| Video/audio calls | **LiveKit Cloud** (the most expensive part, not on your server) |
| Relational DB + vector search | **Neon PostgreSQL** + pgvector (via Prisma) |
| Auth + realtime data | **Firebase** (Auth + Firestore) |
| Speech-to-text | **Deepgram**, **Sarvam** (API) |
| LLM / embeddings | **NVIDIA**, **OpenRouter** (API) |
| Attention scoring (MediaPipe) | Runs **in the user's browser** |
| Translation agent | Not in this repo. If it runs on a GPU, it lives somewhere else. |

---

## 3. Builds need the most memory

Running `next build` for each app (large packages: Excalidraw, LiveKit, Firebase, Chart.js, MediaPipe) can use **2–3 GB of RAM**. On a 2 GB server the build will usually crash with an out-of-memory error.

Pick one:

- **Build on the VPS:** have at least 4 GB RAM and add 2 GB of swap:

  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- **Build somewhere else** (GitHub Actions or a Docker image) and only run the finished apps on the VPS.

Give each app its own Node memory limit so one app can't use up all the RAM:

```bash
NODE_OPTIONS=--max-old-space-size=1024
```

---

## 4. Recommended plans

| Tier | Specs | Suits |
| --- | --- | --- |
| **Minimum** | 2 vCPU, 4 GB RAM, 40 GB SSD, 2 GB swap | Testing, demos, about 10–20 sessions at once |
| **Recommended** | 4 vCPU, 8 GB RAM, 80 GB SSD | Production, about 50+ sessions at once, room to build without downtime |
| **If you self-host LiveKit** | 8 vCPU, 16 GB RAM, 1 Gbps network, high bandwidth | Only if you move away from LiveKit Cloud. Running LiveKit on a separate server is better. |

Example providers for the recommended tier: Hetzner CPX31, a DigitalOcean 4 vCPU / 8 GB droplet, Contabo VPS M.

---

## 5. Bandwidth

- **Main server:** low, because video goes through LiveKit Cloud.
  - The live audio relay to Sarvam is the biggest user, at roughly **32–64 kbps per active session**.
  - Page and asset traffic is normal web traffic. Use a CDN or caching for static files.
- **Self-hosted LiveKit (if ever):** about **1–2 Mbps per participant, both up and down**. Plan for TBs per month at scale.

---

## 6. Suggested setup

```
Internet
   │
   ▼
Nginx / Caddy (HTTPS, WebSocket upgrade for /api/sarvam-stream)
   ├── app.example.com  → frontend   (next start, :3000)
   ├── api.example.com  → backend    (node server.js --prod, :4000)
   └── (internal)       → whatsapp-bot (:PORT)
```

- Run the processes with **PM2** (`pm2 start`, `pm2 save`, `pm2 startup`) or **Docker Compose**.
- The proxy **must allow WebSocket upgrades**, otherwise live transcription won't work.
- Keep the `.env` files only on the server. Never set `AUTH_DISABLED=true` in production.
- The WhatsApp bot stores session/auth files on disk, so keep them on a persistent volume and back them up.
- Add the production domain to **Firebase → Authentication → Authorized domains**.