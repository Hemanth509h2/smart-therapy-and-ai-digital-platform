'use client'

import { motion } from 'motion/react'

/* Comic thought bubble — overshoot pop-in, gentle wiggle, trailing dots. */
export interface ThoughtBubbleProps {
  text: string
  triggerAt: number
  position: { top: string; right?: string; left?: string }
}

export function ThoughtBubble({ text, triggerAt, position }: ThoughtBubbleProps) {
  const d = triggerAt / 1000
  return (
    <motion.div
      initial={{ scale: 0.3, y: 10, opacity: 0 }}
      animate={{ scale: [0.3, 1.12, 1], y: [10, -2, 0], opacity: [0, 1, 1] }}
      transition={{ delay: d, duration: 0.5, times: [0, 0.6, 1], ease: [0.34, 1.56, 0.64, 1] }}
      style={{ position: 'absolute', ...position, zIndex: 7 }}
    >
      <motion.div
        animate={{ rotate: [-3, 1, -3] }}
        transition={{ delay: d + 0.5, duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          background: '#fff', border: '2.5px solid #2a2420', borderRadius: '20px 20px 20px 4px',
          padding: '6px 16px', boxShadow: '3px 4px 0 rgba(0,0,0,0.12)',
          fontFamily: "'Nunito', 'DM Sans', sans-serif", fontWeight: 900, fontSize: 18.5,
          color: '#c8602a', whiteSpace: 'nowrap', lineHeight: 1,
        }}
      >
        {text}
      </motion.div>
      <div style={{ position: 'absolute', left: 14, bottom: -12, width: 10, height: 10, borderRadius: '50%', background: '#fff', border: '2px solid #2a2420' }} />
      <div style={{ position: 'absolute', left: 8, bottom: -20, width: 6, height: 6, borderRadius: '50%', background: '#fff', border: '2px solid #2a2420' }} />
    </motion.div>
  )
}
