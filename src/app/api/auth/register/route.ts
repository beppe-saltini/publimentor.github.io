import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { 
  validatePassword, 
  sanitizeString, 
  checkRateLimit, 
  getRateLimitResponse,
  AUTH_RATE_LIMIT,
  getClientIp,
  auditLog,
  getUserAgent,
} from "@/lib/security";

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Invalid email address").max(254),
  password: z.string().min(10, "Password must be at least 10 characters").max(128),
  institution: z.string().max(200).optional(),
  orcid: z.string().max(50).optional(),
  role: z.enum(["AUTHOR", "EDITOR", "PUBLISHER"]).optional(),
  gender: z.enum(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"]).optional(),
  primaryExpertise: z.string().max(200).optional(),
  secondaryExpertise: z.string().max(200).optional(),
  betaCode: z.string().min(1, "Beta access code is required"),
});

export async function POST(request: Request) {
  try {
    const clientIp = getClientIp(request);
    
    // Rate limiting - strict for registration
    const rateLimit = checkRateLimit(`register:${clientIp}`, AUTH_RATE_LIMIT);
    if (!rateLimit.allowed) {
      auditLog({
        userId: null,
        action: "RATE_LIMIT_EXCEEDED",
        resource: "auth",
        resourceId: "register",
        ip: clientIp,
        userAgent: getUserAgent(request),
        severity: "warning",
      });
      return getRateLimitResponse(rateLimit.resetIn);
    }

    const body = await request.json();
    
    // Validate input schema
    const result = registerSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, email, password, institution, orcid, role, gender, primaryExpertise, secondaryExpertise, betaCode } = result.data;

    // Validate beta access code against one-time-use codes in DB
    const betaCodeRecord = await prisma.betaCode.findUnique({
      where: { code: betaCode },
    });

    if (!betaCodeRecord || betaCodeRecord.usedAt !== null) {
      return NextResponse.json(
        { error: "Invalid or already used beta access code" },
        { status: 403 }
      );
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: passwordValidation.errors[0] },
        { status: 400 }
      );
    }

    // Sanitize inputs
    const sanitizedName = sanitizeString(name);
    const sanitizedInstitution = institution ? sanitizeString(institution) : undefined;
    
    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      // SECURITY: Don't reveal that the email exists
      // Use the same response time to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, 100));
      
      auditLog({
        userId: null,
        action: "REGISTRATION_DUPLICATE_EMAIL",
        resource: "auth",
        resourceId: normalizedEmail,
        ip: clientIp,
        userAgent: getUserAgent(request),
        severity: "info",
      });
      
      // Generic message to prevent user enumeration
      return NextResponse.json(
        { error: "Registration failed. Please try again or contact support." },
        { status: 400 }
      );
    }

    // Hash password with strong settings (cost factor 12)
    const hashedPassword = await hash(password, 12);

    // Sanitize optional profile fields
    const sanitizedPrimaryExpertise = primaryExpertise ? sanitizeString(primaryExpertise) : undefined;
    const sanitizedSecondaryExpertise = secondaryExpertise ? sanitizeString(secondaryExpertise) : undefined;
    const sanitizedOrcid = orcid ? sanitizeString(orcid) : undefined;

    // Create user
    const user = await prisma.user.create({
      data: {
        name: sanitizedName,
        email: normalizedEmail,
        password: hashedPassword,
        institution: sanitizedInstitution,
        orcid: sanitizedOrcid,
        role: role || undefined,
        gender: gender || undefined,
        primaryExpertise: sanitizedPrimaryExpertise,
        secondaryExpertise: sanitizedSecondaryExpertise,
      },
    });

    // Consume the beta code (mark as used) now that registration succeeded
    await prisma.betaCode.update({
      where: { code: betaCode },
      data: { usedAt: new Date(), usedBy: user.id },
    });

    auditLog({
      userId: user.id,
      action: "USER_REGISTERED",
      resource: "auth",
      resourceId: user.id,
      ip: clientIp,
      userAgent: getUserAgent(request),
      severity: "info",
    });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Register] Error:", error);
    return NextResponse.json(
      { error: "Registration failed. Please try again later." },
      { status: 500 }
    );
  }
}
