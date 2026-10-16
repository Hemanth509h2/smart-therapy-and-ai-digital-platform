import { AccessToken } from 'livekit-server-sdk'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/core/db'
import { requireAuth } from '@/lib/http/apiAuth'
import { getLobbyEntry } from '@/lib/sessions/lobby'
import { isTranslationLanguage } from '@/lib/sessions/translationLanguages'

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const roomName = searchParams.get('room')
  const participantName = searchParams.get('name')
  const sourceLang = searchParams.get('sourceLang')
  const targetLang = searchParams.get('targetLang')

  if (!roomName || !participantName) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  // `identity` is the display name, which says nothing about who the person is
  // in the session. Publishing the role as participant metadata makes it
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
  const session = await prisma.session.findUnique({
    where: { id: roomName },
    select: { therapist: { select: { userId: true } } },
  })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  let claimedRole: 'therapist' | 'client'
  if (session.therapist.userId === auth.uid) {
    claimedRole = 'therapist'
  } else {
    // Waiting room: no token until the therapist admits this guest. The
    // client's browser polls this endpoint while it gets `waiting: true`.
    const entry = await getLobbyEntry(roomName, auth.uid)
    if (!entry) return NextResponse.json({ error: 'Not invited to this session' }, { status: 403 })
    if (entry.status === 'denied') return NextResponse.json({ error: 'Not admitted', denied: true }, { status: 403 })
    if (entry.status !== 'admitted') return NextResponse.json({ waiting: true }, { status: 409 })
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
  const attributes: Record<string, string> = { role: claimedRole }
  if (isTranslationLanguage(sourceLang)) attributes.source_lang = sourceLang
  if (isTranslationLanguage(targetLang)) attributes.target_lang = targetLang

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    {
      identity: participantName,
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

  return NextResponse.json({ token: await at.toJwt() })
}
