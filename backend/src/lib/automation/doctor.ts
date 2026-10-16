import { NextResponse } from 'next/server'
import { prisma } from '@/lib/core/db'
import { normalizeWhatsAppNumber } from '@/lib/messaging/whatsapp-cloud-api'
import { PublicError } from '@/lib/http/apiError'
import { rejectUnlessAutomation } from './auth'

const doctorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  specialty: true,
  qualification: true,
  experience: true,
  bio: true,
  phoneNumber: true,
} as const

export type Doctor = {
  id: string
  firstName: string
  lastName: string
  specialty: string[]
  qualification: string | null
  experience: string | null
  bio: string | null
  phoneNumber: string | null
}

export const doctorSummary = (d: Doctor) => ({
  id: d.id,
  name: `${d.firstName} ${d.lastName}`.trim(),
  specialty: d.specialty,
  qualification: d.qualification,
  experience: d.experience,
  phoneNumber: d.phoneNumber,
})

/**
 * The chatbot endpoints identify the doctor by the WhatsApp number the message
 * came from, so an n8n workflow can only ever see the data of whoever is
 * writing to it. `phone` accepts any format WhatsApp gives n8n
 * ("919876543210", "+91 98765 43210", "9876543210").
 *
 * Resolves to the doctor, or a response to return (401, 400 or 404).
 */
export async function requireDoctorByPhone(request: Request) {
  const denied = rejectUnlessAutomation(request)
  if (denied) return { ok: false as const, response: denied }

  const phone = new URL(request.url).searchParams.get('phone')
  if (!phone) {
    return { ok: false as const, response: NextResponse.json({ error: 'phone is required' }, { status: 400 }) }
  }

  let normalized: string
  try {
    normalized = normalizeWhatsAppNumber(phone)
  } catch (e) {
    const status = e instanceof PublicError ? e.status : 400
    return { ok: false as const, response: NextResponse.json({ error: 'phone is not a valid number' }, { status }) }
  }

  const doctor = await prisma.profileTherapist.findUnique({ where: { phoneNumber: normalized }, select: doctorSelect })
  if (!doctor) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'No doctor is registered with this WhatsApp number' }, { status: 404 }),
    }
  }
  return { ok: true as const, doctor }
}
