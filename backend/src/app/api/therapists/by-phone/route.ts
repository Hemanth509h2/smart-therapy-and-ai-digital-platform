import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/therapists/by-phone?phone=91XXXXXXXXXX
// Returns therapist profile for n8n WhatsApp chatbot lookup
// Called by n8n (no auth — open by request).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');

    if (!phone) {
      return NextResponse.json({ error: 'phone parameter is required' }, { status: 400 });
    }

    // Normalize phone number (remove +, spaces, etc.)
    const normalizedPhone = phone.replace(/[^\d]/g, '');
    // Ensure it starts with country code (91 for India)
    const searchPhone = normalizedPhone.startsWith('91') ? normalizedPhone : `91${normalizedPhone}`;

    const therapist = await prisma.profileTherapist.findUnique({
      where: { phoneNumber: searchPhone },
      include: {
        user: { select: { id: true, email: true } },
      },
    });

    if (!therapist) {
      return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });
    }

    return NextResponse.json({
      therapist: {
        id: therapist.id,
        userId: therapist.userId,
        firstName: therapist.firstName,
        lastName: therapist.lastName,
        phoneNumber: therapist.phoneNumber,
        email: therapist.user.email,
        specialty: therapist.specialty,
      },
    });
  } catch (error: any) {
    console.error('Therapist by phone lookup error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}