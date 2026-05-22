import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  sanitizeFileName,
  checkRateLimit,
  getRateLimitResponse,
  auditLog,
  getClientIp,
  getUserAgent,
} from "@/lib/security";
import { createSignedUploadUrl, isSupabaseConfigured } from "@/lib/supabase";
import { generateStoragePath, getStorageProviderName } from "@/lib/storage";
import { findDuplicateManuscripts } from "@/lib/manuscript/find-duplicate-manuscripts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = ["pdf", "docx"];
const ALLOWED_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * POST /api/manuscripts/upload/init
 *
 * Step 1 of the two-step upload flow:
 *   1. Client sends file metadata (JSON, tiny payload)
 *   2. Server creates the manuscript record and returns a signed Supabase upload URL
 *   3. Client uploads the file directly to Supabase (no body-size limit)
 *   4. Client then calls POST /api/manuscripts/[id]/process
 */
export async function POST(request: Request) {
  console.log("[UploadInit] POST handler reached", new Date().toISOString());

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limiting
    const rateLimit = checkRateLimit(
      `upload:${session.user.id}`,
      { windowMs: 60000, maxRequests: 10 }
    );
    if (!rateLimit.allowed) {
      return getRateLimitResponse(rateLimit.resetIn);
    }

    // Parse JSON body
    const body = await request.json();
    const { publisherId, fileName, fileSize, journalId, fileHash, confirmDuplicate } = body as {
      publisherId?: string;
      fileName?: string;
      fileSize?: number;
      journalId?: string;
      fileHash?: string;
      confirmDuplicate?: boolean;
    };

    console.log("[UploadInit] request", { publisherId: !!publisherId, fileName, fileSize });

    // Validate required fields
    if (!publisherId) {
      return NextResponse.json({ error: "publisherId is required" }, { status: 400 });
    }
    if (!fileName) {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    }

    // Validate file extension
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (!extension || !ALLOWED_EXTENSIONS.includes(extension)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum: ${MAX_FILE_SIZE / (1024 * 1024)} MB` },
        { status: 400 }
      );
    }

    // Sanitize filename
    const sanitizedFileName = sanitizeFileName(fileName);
    const mimeType = ALLOWED_MIME_TYPES[extension] || `application/${extension}`;

    // Verify publisher access
    const publisherMember = await prisma.publisherMember.findUnique({
      where: {
        userId_publisherId: {
          userId: session.user.id,
          publisherId,
        },
      },
    });

    if (!publisherMember) {
      return NextResponse.json(
        { error: "You don't have access to this publisher" },
        { status: 403 }
      );
    }

    if (journalId) {
      const journalMember = await prisma.journalMember.findFirst({
        where: { userId: session.user.id, journalId },
      });
      if (!journalMember) {
        return NextResponse.json(
          { error: "You don't have access to this journal" },
          { status: 403 }
        );
      }
    }

    // Check Supabase availability
    if (!isSupabaseConfigured()) {
      return NextResponse.json(
        { error: "File storage is not configured on the server" },
        { status: 503 }
      );
    }

    if (!confirmDuplicate) {
      const duplicate = await findDuplicateManuscripts({
        publisherId,
        uploaderId: session.user.id,
        fileHash,
        fileName: sanitizedFileName,
        fileSize: fileSize || 0,
      });

      if (duplicate.isDuplicate) {
        return NextResponse.json(
          {
            error: "This file appears to be a duplicate upload",
            reason: duplicate.reason,
            matches: duplicate.matches.map((m) => ({
              ...m,
              createdAt: m.createdAt.toISOString(),
            })),
          },
          { status: 409 }
        );
      }
    }

    // Create manuscript record (status: UPLOADING — file not yet received)
    const manuscript = await prisma.manuscript.create({
      data: {
        publisherId,
        journalId: journalId || null,
        uploaderId: session.user.id,
        assignedEditorId: session.user.id,
        fileName: sanitizedFileName,
        fileType: extension,
        fileMimeType: mimeType,
        fileSize: fileSize || 0,
        filePath: "", // Will be set after processing
        fileHash: fileHash || null,
        status: "UPLOADED", // Using UPLOADED as initial state
        storageProvider: "supabase",
      },
    });

    // Generate the storage path and signed upload URL
    const storagePath = generateStoragePath({
      publisherId,
      journalId,
      manuscriptId: manuscript.id,
      fileName: sanitizedFileName,
      mimeType,
    });

    const { signedUrl, token } = await createSignedUploadUrl(storagePath);

    // Save the storage path to the manuscript
    await prisma.manuscript.update({
      where: { id: manuscript.id },
      data: { storagePath },
    });

    // Audit log
    auditLog({
      userId: session.user.id,
      action: "MANUSCRIPT_UPLOAD_INIT",
      resource: "manuscripts",
      resourceId: manuscript.id,
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
      severity: "info",
      details: { fileName: sanitizedFileName, fileSize, publisherId },
    });

    console.log("[UploadInit] success, manuscriptId:", manuscript.id);

    return NextResponse.json({
      success: true,
      manuscriptId: manuscript.id,
      signedUrl,
      token,
      storagePath,
    });
  } catch (error) {
    console.error("[UploadInit] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initialize upload" },
      { status: 500 }
    );
  }
}
