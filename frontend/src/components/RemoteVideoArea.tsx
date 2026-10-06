'use client'
import { useTracks, VideoTrack } from '@livekit/components-react'
import type { TrackReference } from '@livekit/components-react'
import { Track } from 'livekit-client'

interface RemoteVideoAreaProps {
  participantName?: string
}

export default function RemoteVideoArea({ participantName = 'Participant' }: RemoteVideoAreaProps) {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: false }],
    { onlySubscribed: false }
  )
  const remoteTracks = tracks.filter(t => !t.participant.isLocal)
  const subscribedRemote = remoteTracks.find(t => t.publication?.isSubscribed) as TrackReference | undefined

  if (subscribedRemote) {
    return (
      <VideoTrack
        trackRef={subscribedRemote}
        // `cover` fills the rounded card edge-to-edge so there are no black
        // letterbox/pillarbox bars on the sides when the camera aspect ratio
        // doesn't match the container.
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div
        style={{
          width: 110,
          height: 110,
          borderRadius: '50%',
          background: 'rgba(63,174,106,0.12)',
          border: '2px solid #3fae6a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 40, fontWeight: 600, color: '#2f9457' }}>
          {participantName?.charAt(0)?.toUpperCase() || '?'}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#f3f5f8',
          border: '1px solid #e7eaef',
          borderRadius: 20,
          boxShadow: '0 4px 14px rgba(20,30,40,0.06)',
          padding: '6px 16px',
          fontSize: 13,
          fontWeight: 500,
          color: '#2b2f33',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#3fae6a',
            display: 'inline-block',
          }}
        />
        {participantName}
      </div>
    </div>
  )
}
