-- Match the optional phone number field already defined in schema.prisma.
ALTER TABLE "public"."ProfileClient"
ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT;
