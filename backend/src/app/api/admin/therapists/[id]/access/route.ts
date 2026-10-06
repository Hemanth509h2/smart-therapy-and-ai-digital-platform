import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ALL_MODULE_IDS } from '@/lib/modules';

// PATCH /api/admin/therapists/[id]/access — set a therapist's module access.
// Body: { allModulesAllowed: boolean, moduleAccess: string[] }
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { allModulesAllowed, moduleAccess } = await request.json();

    const therapist = await prisma.profileTherapist.findUnique({ where: { id: params.id } });
    if (!therapist) {
      return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });
    }

    // Keep only known module ids.
    const cleaned = Array.isArray(moduleAccess)
      ? moduleAccess.filter((m: string) => ALL_MODULE_IDS.includes(m))
      : [];

    const updated = await prisma.profileTherapist.update({
      where: { id: params.id },
      data: {
        allModulesAllowed: Boolean(allModulesAllowed),
        moduleAccess: cleaned,
      },
      select: { id: true, allModulesAllowed: true, moduleAccess: true },
    });

    return NextResponse.json({ therapist: updated });
  } catch (error: any) {
    console.error('Therapist access PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
