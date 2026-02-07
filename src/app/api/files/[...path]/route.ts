import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPathWithinBase, sanitizeFileName, auditLog, getClientIp, getUserAgent } from "@/lib/security";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

// Allowed file extensions for serving
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".docx"]);

/**
 * Check if user has access to a file by resolving the manuscript it belongs to.
 *
 * Storage paths follow the pattern: <publisherId>/<manuscriptId>/filename
 * We extract the publisherId and manuscriptId from the sanitized segments and
 * verify the user has legitimate access (uploader, publisher member, explicit
 * permission, or journal editor/admin).
 */
async function checkFileAccess(
  userId: string,
  pathSegments: string[]
): Promise<boolean> {
  // Paths must have at least: publisherId / manuscriptId / filename
  if (pathSegments.length < 3) return false;

  const [publisherId, manuscriptId] = pathSegments;

  // Look up the manuscript to confirm it actually exists at this path
  const manuscript = await prisma.manuscript.findFirst({
    where: {
      id: manuscriptId,
      publisherId,
    },
    select: {
      id: true,
      uploaderId: true,
      publisherId: true,
      journalId: true,
    },
  });

  if (!manuscript) return false;

  // 1. User is the uploader
  if (userId === manuscript.uploaderId) return true;

  // 2. User is a publisher member
  const publisherMember = await prisma.publisherMember.findUnique({
    where: {
      userId_publisherId: { userId, publisherId: manuscript.publisherId },
    },
  });
  if (publisherMember) return true;

  // 3. User has explicit permission for this manuscript
  const permission = await prisma.manuscriptPermission.findUnique({
    where: {
      manuscriptId_userId: { manuscriptId: manuscript.id, userId },
    },
  });
  if (permission) {
    if (!permission.expiresAt || permission.expiresAt > new Date()) {
      return true;
    }
  }

  // 4. User is a journal editor/admin
  if (manuscript.journalId) {
    const journalMember = await prisma.journalMember.findFirst({
      where: {
        userId,
        journalId: manuscript.journalId,
        role: { in: ["ADMIN", "EDITOR"] },
      },
    });
    if (journalMember) return true;
  }

  return false;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    // Authentication required
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { path: pathSegments } = await params;
    
    // Sanitize each path segment
    const sanitizedSegments = pathSegments.map((segment) => 
      sanitizeFileName(segment)
    );
    
    // Construct the target path
    const targetPath = path.join(...sanitizedSegments);
    const fullPath = path.resolve(UPLOAD_DIR, targetPath);

    // CRITICAL: Prevent path traversal attacks
    if (!isPathWithinBase(UPLOAD_DIR, targetPath)) {
      auditLog({
        userId: session.user.id,
        action: "PATH_TRAVERSAL_ATTEMPT",
        resource: "files",
        resourceId: targetPath,
        ip: getClientIp(request),
        userAgent: getUserAgent(request),
        severity: "critical",
        details: { originalPath: pathSegments.join("/") },
      });
      
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Check file extension is allowed
    const ext = path.extname(fullPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: "File type not allowed" },
        { status: 403 }
      );
    }

    // Check file exists
    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // SECURITY: Verify user has access to this specific file
    const hasAccess = await checkFileAccess(session.user.id, sanitizedSegments);
    if (!hasAccess) {
      auditLog({
        userId: session.user.id,
        action: "UNAUTHORIZED_FILE_ACCESS_ATTEMPT",
        resource: "files",
        resourceId: targetPath,
        ip: getClientIp(request),
        userAgent: getUserAgent(request),
        severity: "warning",
        details: { originalPath: pathSegments.join("/") },
      });

      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const file = await readFile(fullPath);
    const filename = sanitizedSegments[sanitizedSegments.length - 1];

    const contentTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };

    // Log file access
    auditLog({
      userId: session.user.id,
      action: "FILE_ACCESS",
      resource: "files",
      resourceId: targetPath,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
      severity: "info",
    });

    return new NextResponse(file, {
      headers: {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[Files] Error serving file:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 }
    );
  }
}
