import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { auth } from "@/lib/auth";
import { isPathWithinBase, sanitizeFileName, auditLog, getClientIp, getUserAgent } from "@/lib/security";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

// Allowed file extensions for serving
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".docx"]);

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

    // TODO: In production, verify user has access to this specific file
    // by checking manuscript ownership/permissions
    // This requires parsing the path to extract manuscriptId and checking DB

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
