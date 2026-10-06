import { NextResponse } from 'next/server';

// Backend only serves /api/*; give the root URL a friendly status response
// instead of Next's default 404.
export async function GET() {
  return NextResponse.json({
    name: 'staad-backend',
    status: 'ok',
    api: '/api',
  });
}
