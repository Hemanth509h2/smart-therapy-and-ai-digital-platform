# Video/Audio Algorithms Report — Google Meet vs Zoom vs STAAD

Date: 2026-10-06

## 1. Google Meet — video
- **Codecs:** VP9 as the default workhorse (Vp9 is royalty-free and efficient), plus H.264 for fallback/compatibility, VP8 on older paths, and **AV1 being rolled out** for supported devices.
- **Scalable Video Coding (SVC):** Meet encodes VP9/AV1 as SVC streams — multiple **temporal layers** (e.g. L3T3 = 3 spatial × 3 temporal layers) in one stream. The SFU/gateway drops layers (top temporal layer first) instead of fully re-encoding, so it can adapt per-receiver bandwidth cheaply.
- **Simulcast layering:** on top of SVC, clients typically publish a few quality rungs; Meet's SFU selects per-receiver (pin/gallery layout decides which layer is forwarded to which tile).
- **Adaptive Bitrate (BWE):** WebRTC GCC-style bandwidth estimation (delay-based + loss-based) drives the encoder bitrate ladder; Meet also scales frame rate/resolution before it gives up on bitrate (resolution ↓ first, then FPS ↓, then bitrate ↓).
- **Resolution policy:** adaptive — tiles get 360p/720p/1080p rungs, "mirror/pin" viewers get a higher layer, grid thumbnails get lower layers.

## 2. Google Meet — audio
- **Codec:** Opus (royalty-free, adaptive bitrate ~16–510 kbps, normally 32–64 kbps mono for speech).
- **Jitter buffer:** NetEQ (Google's patented adaptive jitter buffer with PLC — packet loss concealment).
- **Audio processing:** WebRTC AEC (echo cancellation), AGC (automatic gain control), noise suppression; newer clients use a learned **RNN noise-suppression** model.

## 3. Zoom — video
- **Codecs:** Primarily **H.264 (AVC)** — the universal default — with VP8/VP9 on supported builds, **AV1** rolled out on newer clients/OS.
- **Multi-stream / simulcast:** each publisher encodes multiple resolution rungs; the SFU picks per-viewer (gallery view = many small tiles gets smaller layers; speaker view = big tile gets 720p/1080p).
- **H.264 SVC** is used in newer versions to get Meet-like temporal layering on the H.264 path.
- **Adaptive bitrate:** similar to WebRTC's BWE; Zoom scales resolution/FPS before dropping bitrate.

## 4. Zoom — audio
- **Codecs:** **Opus** + **SILK** (Skype's codec, low-latency speech) — Opus is preferred on modern builds.
- **Noise suppression:** proprietary "Zoom IQ" / intelligent audio processing (noise suppression, echo cancellation, AGC); newer versions use ML-based denoising.
- Adaptive jitter buffer equivalent and packet-loss concealment similar to NetEQ.

## 5. What STAAD uses today
From the codebase:

- **Engine:** LiveKit (WebRTC SFU) — `frontend/src/components/StaadVideo.tsx` instantiates `new Room()` with **default options** and fetches a token from `/api/livekit-token`.
- **Video codec:** LiveKit default ladder — **VP8** as baseline (broad WebRTC interop), **H.264** where negotiated; **VP9/AV1 off by default** unless explicitly enabled. No explicit `publishDefaults.videoCodec` is set in `StaadVideo.tsx`.
- **Scalability:** LiveKit supports **VP9-SVC / AV1-SVC** and **simulcast**, but neither is explicitly enabled in the current config — publishers likely send one fixed rung per track.
- **Audio:** Opus via LiveKit/WebRTC (default), no explicit audio constraints or Krisp-style noise suppression found in `useSessionTranscription.ts`/LiveKit room options.
- **Layout/ABR:** handled at the app level (single remote video + PiP) — the SFU forwards whatever layer matches the subscriber; with no SVC there is no layer dropping, so a weak patient's upload forces the therapist's download to degrade globally.

## 6. Meet/Zoom vs STAAD — gap

| Feature | Meet / Zoom | STAAD today |
|---|---|---|
| Video codec | VP9-SVC (Meet), H.264-SVC + AV1 (Zoom) | VP8/H.264, no SVC/AV1 |
| Per-receiver quality | SVC layer drop / simulcast selection per tile | Single fixed rung, global quality for both sides |
| Audio denoising | ML/RNN noise suppression + AEC + AGC (both) | Default WebRTC, no explicit processing |
| Audio jitter/loss | NetEQ / equivalent | WebRTC NetEQ (inherited) — OK |
| Max video quality | Up to 1080p adaptive | LiveKit default cap (typically 720p) |

## 7. Improvement methods for STAAD

1. **Enable AV1 or VP9 with SVC** in `StaadVideo.tsx`:
   ```ts
   const room = new Room({
     publishDefaults: {
       videoCodec: 'vp9', // or 'av1' on Chrome 105+
       simulcast: true,
       videoSimulcastLayers: [{ resolutionH: 360… }], // LiveKit handles layer list
     },
     adaptiveStream: true, // let the SFU forward a lower layer when CPU/bandwidth is tight
     dynacast: true,       // drop layers no subscriber needs
   })
   ```
2. **Set explicit video constraints:** `resolution: { width: 1280, height: 720 }`, `frameRate: 24` for lower CPU on low-end patient devices; step up to 1080p only on desktop/strong uplink.
3. **Audio processing:** enable WebRTC `noiseSuppression: true, echoCancellation: true, autoGainControl: true` explicitly in publish defaults, and consider **Krisp injected noise filter** for children's noisy environments.
4. **Set bandwidth allocator:** LiveKit `roomOptions.adaptiveStream = true` + client-side `track.setSubscribedQuality(Quality.Medium)` when a participant is on a weak uplink.
5. **Graceful degradation:** already have TURN fallback via LiveKit; add a hook that reacts to `Participant.connectionQualityChanged` and lowers the published video resolution instead of letting the call freeze.

## 8. What NOT to change (already aligned with Meet/Zoom)
- Opus for audio — both Meet and Zoom default to it.
- NetEQ jitter buffer — inherited from WebRTC, same as Meet.
- H.264 fallback — kept for compatibility, same trade-off Zoom makes.
