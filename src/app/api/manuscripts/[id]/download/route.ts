import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage } from "@/lib/storage";
import { 
  checkRateLimit, 
  getRateLimitResponse, 
  auditLog, 
  getClientIp, 
  getUserAgent,
  sanitizeFileName,
} from "@/lib/security";

export const dynamic = "force-dynamic";

/**
 * Sanitize filename for Content-Disposition header
 * Prevents header injection attacks
 */
function sanitizeForContentDisposition(filename: string): string {
  // Remove any characters that could cause header injection
  const sanitized = filename
    .replace(/[\r\n]/g, "") // Remove CRLF
    .replace(/["\\/]/g, "_") // Replace quotes and path separators
    .replace(/[^\x20-\x7E]/g, "_"); // Only allow printable ASCII
  
  // RFC 5987 encoding for non-ASCII and special chars
  const encoded = encodeURIComponent(sanitized);
  
  return encoded;
}

/**
 * GET /api/manuscripts/:id/download
 * Download the original manuscript file
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientIp = getClientIp(request);
    
    // Rate limiting - 30 downloads per minute
    const rateLimit = checkRateLimit(
      `download:${session.user.id}`,
      { windowMs: 60000, maxRequests: 30 }
    );
    if (!rateLimit.allowed) {
      return getRateLimitResponse(rateLimit.resetIn);
    }

    const { id } = await params;

    // Validate ID format (prevent injection)
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid manuscript ID" }, { status: 400 });
    }

    // Get manuscript
    const manuscript = await prisma.manuscript.findUnique({
      where: { id },
      select: {
        id: true,
        fileName: true,
        filePath: true,
        fileMimeType: true,
        fileSize: true,
        uploaderId: true,
        publisherId: true,
        journalId: true,
      },
    });

    if (!manuscript) {
      return NextResponse.json(
        { error: "Manuscript not found" },
        { status: 404 }
      );
    }

    // Check access - FIXED: Now correctly checks the specific manuscript
    const hasAccess = await checkAccess(
      session.user.id,
      manuscript.id,  // Pass the actual manuscript ID
      manuscript.uploaderId,
      manuscript.publisherId,
      manuscript.journalId
    );

    if (!hasAccess) {
      auditLog({
        userId: session.user.id,
        action: "UNAUTHORIZED_DOWNLOAD_ATTEMPT",
        resource: "manuscripts",
        resourceId: manuscript.id,
        ip: clientIp,
        userAgent: getUserAgent(request),
        severity: "warning",
      });
      
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Get file from storage
    const storage = getStorage();
    
    try {
      const buffer = await storage.download(manuscript.filePath);

      // Sanitize filename for Content-Disposition header
      const safeFileName = sanitizeForContentDisposition(manuscript.fileName);

      // Audit log successful download
      auditLog({
        userId: session.user.id,
        action: "MANUSCRIPT_DOWNLOADED",
        resource: "manuscripts",
        resourceId: manuscript.id,
        ip: clientIp,
        userAgent: getUserAgent(request),
        severity: "info",
      });

      // Return file with secure headers
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": manuscript.fileMimeType,
          // Use both filename and filename* for compatibility
          "Content-Disposition": `attachment; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`,
          "Content-Length": buffer.length.toString(),
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-cache",
        },
      });
    } catch (error) {
      console.error("[Download] File not found in storage:", error);
      return NextResponse.json(
        { error: "File not found in storage" },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error("[Download] Error:", error);
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 }
    );
  }
}

/**
 * Check if user has access to a specific manuscript - FIXED
 */
async function checkAccess(
  userId: string,
  manuscriptId: string,  // Added: specific manuscript ID
  uploaderId: string,
  publisherId: string,
  journalId: string | null
): Promise<boolean> {
  // User is uploader
  if (userId === uploaderId) return true;

  // User is publisher member
  const publisherMember = await prisma.publisherMember.findUnique({
    where: {
      userId_publisherId: { userId, publisherId },
    },
  });
  if (publisherMember) return true;

  // User has explicit permission for THIS SPECIFIC manuscript
  const permission = await prisma.manuscriptPermission.findUnique({
    where: {
      manuscriptId_userId: {  // FIXED: Use the composite unique key
        manuscriptId,
        userId,
      },
    },
  });
  
  if (permission) {
    // Check expiration
    if (!permission.expiresAt || permission.expiresAt > new Date()) {
      return true;
    }
  }

  // User is journal member with appropriate role
  if (journalId) {
    const journalMember = await prisma.journalMember.findFirst({
      where: {
        userId,
        journalId,
        role: { in: ["ADMIN", "EDITOR"] },
      },
    });
    if (journalMember) return true;
  }

  return false;
}
