import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@deepgram/sdk'

const deepgram = createClient(process.env.DEEPGRAM_API_KEY!)

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const projectId = process.env.DEEPGRAM_PROJECT_ID
    if (!projectId) {
      return NextResponse.json(
        { error: 'Deepgram project not configured' },
        { status: 500 }
      )
    }

    const { result, error } = await deepgram.manage.createProjectKey(
      projectId,
      {
        comment: 'staad-session-temp-key',
        scopes: ['usage:write'],
        time_to_live_in_seconds: 10,
      }
    )

    if (error || !result) {
      throw new Error('Failed to create temp key')
    }

    return NextResponse.json({ token: result.key })
  } catch (e) {
    console.error('[deepgram-token]', e)
    return NextResponse.json(
      { error: 'Token creation failed' },
      { status: 500 }
    )
  }
}
