# STAAD Platform — Deployment & VPS Requirements

## 🏗️ Architecture Overview

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | Next.js 14 (React 18) | SPA + API routes |
| **Backend** | Next.js 14 (API routes on port 4000) | REST API, WebSocket handling |
| **Database** | PostgreSQL + pgvector | Session data, RAG embeddings |
| **Real-time** | LiveKit Cloud / Self-hosted | Video/audio calling, data channels |
| **Auth** | Firebase Auth + Firestore | User management, real-time sync |
| **AI/ML** | OpenAI, Deepgram, Sarvam | Transcription, translation, RAG |
| **MediaPipe** | Client-side WASM | Attention scoring (runs in browser) |

---

## 📊 Minimum VPS Specs

### **Option A: All-in-One VPS (Recommended for Launch)**

| Resource | Spec | Notes |
|----------|------|-------|
| **CPU** | **4 vCPU** (2+ cores reserved for Node.js) | Next.js build + runtime, Prisma, WebSocket handling |
| **RAM** | **8 GB** | Node.js (~2-3GB), PostgreSQL (~2-3GB), OS/overhead |
| **Storage** | **100 GB SSD** | Docker images, node_modules, DB, logs, MediaPipe assets |
| **OS** | Ubuntu 22.04/24.04 LTS | Docker support |
| **Swap** | 4 GB | Safety buffer for memory spikes |

**Estimated Cost:** ~$24-40/mo (DigitalOcean, Hetzner, Linode, Vultr)

---

### **Option B: Separated Services (Production Scale)**

| Service | Spec | Est. Cost |
|---------|------|-----------|
| **App Server** (Frontend + Backend) | 2 vCPU, 4 GB RAM, 50 GB SSD | $12-20/mo |
| **PostgreSQL** (Managed) | 2 vCPU, 4 GB RAM, 100 GB | $15-30/mo (Neon, Supabase, RDS) |
| **LiveKit** | **Use LiveKit Cloud** (free tier: 50k participant-minutes/mo) | $0-50/mo |
| **Redis** (Optional - for scaling) | 1 vCPU, 1 GB RAM | $5-10/mo |

---

## 🔑 Required External Services (Don't Self-Host These)

| Service | Why | Free Tier |
|---------|-----|-----------|
| **LiveKit Cloud** | WebRTC signaling, SFU, recording | 50k participant-min/mo free |
| **Firebase** | Auth, Firestore (real-time), Hosting | Spark plan: generous |
| **Neon / Supabase** | PostgreSQL + pgvector (embeddings) | Free tier available |
| **OpenAI API** | Embeddings, GPT for analysis | Pay-per-use |
| **Deepgram** | Speech-to-text (STT) | $200 free credits |
| **Sarvam AI** | Indic language STT/TTS | Pay-per-use |

> **Strong recommendation:** Use managed services for LiveKit, Database, and Firebase. Self-hosting LiveKit SFU requires significant DevOps expertise and bandwidth costs.

---

## 🐳 Docker Compose Services (What Runs on VPS)

```yaml
# Your docker-compose.yml runs:
1. frontend  (Next.js on :3000)     → ~1-2 GB RAM
2. backend   (Next.js API on :4000) → ~1-2 GB RAM  
3. db        (PostgreSQL + pgvector) → ~2-3 GB RAM
```

---

## 🚀 Deployment Checklist

### **Environment Variables Needed**

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/staad

# Firebase (client + admin)
NEXT_PUBLIC_FIREBASE_API_KEY=...
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...

# LiveKit (use Cloud)
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...

# AI APIs
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...
SARVAM_API_KEY=...

# Email
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
```

### **Ports to Open**

| Port | Service |
|------|---------|
| 80/443 | Nginx reverse proxy (SSL termination) |
| 3000 | Frontend (internal) |
| 4000 | Backend API (internal) |
| 5432 | PostgreSQL (internal only - block external!) |

---

## 📦 Build & Deploy Commands

### **Local Build Test**
```bash
# Frontend
cd frontend && npm run build

# Backend
cd backend && npm run build
```

### **Production Deploy (Docker)**
```bash
# Build images
docker-compose -f docker-compose.yml build

# Run detached
docker-compose -f docker-compose.yml up -d

# View logs
docker-compose logs -f
```

### **Database Migrations**
```bash
# Run after deploy
cd backend && npx prisma migrate deploy
```

---

## 💡 Cost Optimization Tips

1. **Start with Option A** (single 4 vCPU / 8 GB VPS) - handles ~50-100 concurrent sessions
2. **Use LiveKit Cloud** - don't self-host SFU (bandwidth + complexity)
3. **Use Neon/Supabase free tier** for PostgreSQL + pgvector initially
3. **Enable swap** (2-4 GB) on VPS as safety buffer
4. **Use PM2 or Docker restart policies** for process management
5. **Set up log rotation** (`logrotate`) to prevent disk fill

---

## 📈 Scaling Triggers

| Metric | Upgrade When |
|--------|--------------|
| CPU > 70% sustained | Add CPU or split frontend/backend |
| RAM > 75% | Add RAM or move DB to managed service |
| Concurrent sessions > 50 | Add second app server + load balancer |
| DB connections > 80 | Add PgBouncer or upgrade DB |

---

## 🔒 Security Hardening

- [ ] UFW firewall: allow only 22 (SSH), 80, 443
- [ ] Fail2ban for SSH protection
- [ ] PostgreSQL: `listen_addresses = 'localhost'` only
- [ ] Nginx: rate limiting on API routes
- [ ] HTTPS via Let's Encrypt (Certbot)
- [ ] Environment files: `chmod 600 .env*`
- [ ] Regular `apt update && apt upgrade -y`

---

## 🔄 CI/CD Pipeline (Optional)

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build & Push
        run: |
          docker build -t ghcr.io/${{ github.repository }}/frontend ./frontend
          docker build -t ghcr.io/${{ github.repository }}/backend ./backend
          docker push ghcr.io/${{ github.repository }}/frontend
          docker push ghcr.io/${{ github.repository }}/backend
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: root
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/staad
            docker-compose pull
            docker-compose up -d
```

---

## 🆘 Troubleshooting

| Issue | Fix |
|-------|-----|
| `ENOMEM` during build | Add 4GB swap: `fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |
| DB connection refused | Check `DATABASE_URL` host (use `db` in Docker, localhost outside) |
| LiveKit token 401 | Verify `LIVEKIT_API_KEY`/`SECRET` match LiveKit Cloud project |
| WebSocket 404 | Nginx proxy needs `proxy_http_version 1.1` + `upgrade` headers |
| Prisma client missing | Run `npx prisma generate` in backend after deploy |

---

## 💰 Estimated Monthly Costs (Launch)

| Item | Cost |
|------|------|
| VPS (4 vCPU, 8GB, 100GB) | $25-30 |
| LiveKit Cloud | $0 (free tier) |
| Firebase | $0 (Spark) |
| Neon DB | $0 (free tier) |
| OpenAI API | ~$5-20 (usage) |
| Deepgram | ~$0-10 (usage) |
| **Total** | **~$30-60/mo** |

---

## ✅ Pre-Launch Checklist

- [ ] VPS provisioned with 4 vCPU / 8GB RAM / 100GB SSD
- [ ] Docker + Docker Compose installed
- [ ] Domain DNS pointed to VPS IP
- [ ] Nginx configured with SSL (Certbot)
- [ ] All environment variables set in `.env.production`
- [ ] `docker-compose build` succeeds
- [ ] `docker-compose up -d` starts all 3 services
- [ ] `npx prisma migrate deploy` runs
- [ ] Frontend accessible at `https://yourdomain.com`
- [ ] Backend API at `https://api.yourdomain.com` (or `/api` path)
- [ ] LiveKit connection works (test video call)
- [ ] Firebase auth works (signup/login)
- [ ] WhatsApp notifications send (test)
- [ ] Monitoring: `htop`, `docker stats`, log files

---

**Bottom Line:** For launch, get a **4 vCPU / 8 GB RAM / 100 GB SSD VPS** (~$25-30/mo on Hetzner/DigitalOcean) and use **managed services for LiveKit, Firebase, and PostgreSQL**. This keeps DevOps simple while handling real traffic.