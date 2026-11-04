import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { prisma } from '@/lib/core/db';
import { therapistIdForUser } from '@/lib/core/links';
import { requireAuth } from '@/lib/http/apiAuth';
import { getLobbyEntry } from '@/lib/sessions/lobby';
import { checkAIConsent } from '@/lib/sessions/transcript-store';
import { isTranslationLanguage } from '@/lib/sessions/translationLanguages';
import { handle, queryParams, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/livekit-token --------------------------------------------------------

router.get('/livekit-token', handle(async (req, res) => {
  const auth = await requireAuth(req)
  if (!auth.ok) return send(res, auth.response)

  const searchParams = queryParams(req)
  const roomName = searchParams.get('room')
  const participantName = searchParams.get('name')
  const sourceLang = searchParams.get('sourceLang')
  const targetLang = searchParams.get('targetLang')

  if (!roomName || !participantName) {
    return res.status(400).json({ error: "We couldn't tell which session to join. Open the session link again." })
  }
  // The display name shown to the other side: printable text, trimmed and
  // capped. Never used to decide who someone is.
  const displayName = participantName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'Guest'

  // The display name says nothing about who the person is in the session. Publishing the role as participant metadata makes it
  // readable by the other side of the call, so a peer can tell the client from
  // the therapist instead of guessing "whoever isn't me".
  //
  // Attention scoring depends on this: it will only attach face tracking to a
  // participant it can positively confirm is the CLIENT, and refuses to start
  // when the role is absent or unparseable. Removing this field does not break
  // the call — it silently disables attention scoring. See
  // src/hooks/useAttentionScoring.ts.
  //
  // The role is decided here from the signed-in user, never taken from the
  // request: the session's own therapist is 'therapist'; anyone else must be a
  // guest the therapist admitted from the waiting room, and is 'client'.
  // Everyone else gets no token at all.
  const [session, therapistId] = await Promise.all([
    prisma.session.findUnique({ where: { id: roomName }, select: { therapistId: true } }),
    therapistIdForUser(auth.uid),
  ])
  if (!session) return res.status(404).json({ error: 'This session no longer exists. It may have been deleted.' })

  let claimedRole: 'therapist' | 'client'
  if (session.therapistId === therapistId) {
    claimedRole = 'therapist'
  } else {
    // Waiting room: no token until the therapist admits this guest. The
    // client's browser polls this endpoint while it gets `waiting: true`.
    const entry = await getLobbyEntry(roomName, auth.uid)
    if (!entry) return res.status(403).json({ error: "You haven't been invited to this session. Open the invite link your therapist sent you." })
    if (entry.status === 'denied' || entry.status === 'removed') {
      return res.status(403).json({ error: "The therapist didn't let you into this session.", denied: true })
    }
    if (entry.status !== 'admitted') return res.status(409).json({ waiting: true })
    claimedRole = 'client'
  }

  // Live-translation languages, read by the translation agent from participant
  // attributes. `source_lang` is what this person SPEAKS (which STT model to
  // run on their audio); `target_lang` is what they READ (which language their
  // captions arrive in).
  //
  // Signed into the token rather than set by the browser, for the same reason
  // as the role: a participant must not be able to redirect another person's
  // audio to a different model. Anything not on the allow-list is dropped, so
  // the agent falls back to its own defaults rather than trusting free text.
  // `uid` lets the server find this participant again (identity is only the
  // display name), e.g. when the therapist removes a guest from the call.
  //
  // The languages switch on the translation agent (audio to speech-to-text),
  // so they are only signed in once both participants have consented to AI
  // features; until then the agent stays off for this person. Same dev-only
  // bypass as /api/stt-token, never in production.
  const attributes: Record<string, string> = { role: claimedRole, uid: auth.uid }
  const wantsTranslation = isTranslationLanguage(sourceLang) || isTranslationLanguage(targetLang)
  const sttTestMode =
    process.env.NEXT_PUBLIC_STT_TEST_MODE === 'true' &&
    process.env.NODE_ENV !== 'production'
  if (wantsTranslation && (sttTestMode || (await checkAIConsent(roomName)))) {
    if (isTranslationLanguage(sourceLang)) attributes.source_lang = sourceLang
    if (isTranslationLanguage(targetLang)) attributes.target_lang = targetLang
  }

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    {
      // The identity is the verified uid, so nobody can join under another
      // participant's identity (LiveKit would disconnect the original holder)
      // by choosing the same display name. The name is shown separately.
      identity: auth.uid,
      name: displayName,
      // Metadata is kept for backwards compatibility: attention scoring reads
      // the role from here, not from attributes.
      metadata: JSON.stringify({ role: claimedRole }),
      attributes,
    }
  )

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: claimedRole === 'therapist',
  })

  return res.json({ token: await at.toJwt() })
}));
