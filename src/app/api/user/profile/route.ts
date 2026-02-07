import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateProfileSchema = z.object({
  role: z.enum(["AUTHOR", "EDITOR", "PUBLISHER"]).optional(),
  primaryExpertise: z.string().max(200).optional(),
  secondaryExpertise: z.string().max(200).optional(),
  institution: z.string().max(200).optional(),
});

/**
 * GET /api/user/profile — fetch current user's profile
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        institution: true,
        orcid: true,
        primaryExpertise: true,
        secondaryExpertise: true,
        gender: true,
        image: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}

/**
 * PATCH /api/user/profile — update current user's profile (role, expertise, etc.)
 */
export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = updateProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: parsed.data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        institution: true,
        primaryExpertise: true,
        secondaryExpertise: true,
      },
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
