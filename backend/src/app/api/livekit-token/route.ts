import { AccessToken } from 'livekit-server-sdk'
import { NextRequest, NextResponse } from 'next/server'
import { isTranslationLanguage } from '@/lib/translationLanguages'

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const roomName = searchParams.get('room')
  const participantName = searchParams.get('name')
  const role = searchParams.get('role')
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
  // The token is signed server-side, so a participant cannot forge their own
  // role here.
  // Fail closed: only a role we explicitly recognise is published. An absent or
  // unexpected `role` yields NO role claim rather than a defaulted one, so an
  // unlabelled participant can never be mistaken for the client and analysed.
  const claimedRole =
    role === 'therapist' || role === 'client' ? role : null

  // Live-translation languages, read by the translation agent from participant
  // attributes. `source_lang` is what this person SPEAKS (which STT model to
  // run on their audio); `target_lang` is what they READ (which language their
  // captions arrive in).
  //
  // Signed into the token rather than set by the browser, for the same reason
  // as the role: a participant must not be able to redirect another person's
  // audio to a different model. Anything not on the allow-list is dropped, so
  // the agent falls back to its own defaults rather than trusting free text.
  const attributes: Record<string, string> = {}
  if (claimedRole) attributes.role = claimedRole
  if (isTranslationLanguage(sourceLang)) attributes.source_lang = sourceLang
  if (isTranslationLanguage(targetLang)) attributes.target_lang = targetLang

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    {
      identity: participantName,
      // Metadata is kept for backwards compatibility: attention scoring reads
      // the role from here, not from attributes.
      ...(claimedRole ? { metadata: JSON.stringify({ role: claimedRole }) } : {}),
      ...(Object.keys(attributes).length ? { attributes } : {}),
    }
  )

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: role === 'therapist',
  })

  return NextResponse.json({ token: await at.toJwt() })
}
