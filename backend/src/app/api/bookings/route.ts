import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const therapistId = searchParams.get('therapistId');
    const clientId = searchParams.get('clientId');

    if (therapistId) {
      const bookings = await prisma.booking.findMany({
        where: { therapistId },
        include: {
          client: true,
        },
        orderBy: { dateTime: 'asc' },
      });
      return NextResponse.json({ bookings });
    }

    if (clientId) {
      const bookings = await prisma.booking.findMany({
        where: { clientId },
        include: {
          therapist: true,
        },
        orderBy: { dateTime: 'asc' },
      });
      return NextResponse.json({ bookings });
    }

    return NextResponse.json({ error: 'Missing filter parameter' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { therapistId, clientId, dateTime, duration } = await request.json();

    const booking = await prisma.booking.create({
      data: {
        therapistId,
        clientId,
        dateTime: new Date(dateTime),
        duration: duration || 50,
      },
    });

    return NextResponse.json({ booking });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
