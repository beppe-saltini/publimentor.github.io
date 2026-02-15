#!/usr/bin/env node

/**
 * Integration test for the two-step Supabase upload flow.
 *
 * Usage:
 *   node scripts/test-upload.mjs <path-to-pdf>
 *
 * Requirements:
 *   - A valid session cookie (AUTH_COOKIE env var or hardcoded below)
 *   - The app deployed at BASE_URL
 */

import fs from "fs";
import path from "path";

// ── Configuration ──
const BASE_URL = process.env.BASE_URL || "https://app.publimentor.com";
const PDF_PATH = process.argv[2] || "/Users/beppe/Downloads/2026.02.10.704651v2.full.pdf";

// We'll get the cookie by logging in
const EMAIL = process.env.TEST_EMAIL || "";
const PASSWORD = process.env.TEST_PASSWORD || "";

console.log("=".repeat(60));
console.log("MANUSCRIPT UPLOAD INTEGRATION TEST");
console.log("=".repeat(60));
console.log(`Base URL:  ${BASE_URL}`);
console.log(`PDF Path:  ${PDF_PATH}`);

// Verify file exists
if (!fs.existsSync(PDF_PATH)) {
  console.error(`\n❌ File not found: ${PDF_PATH}`);
  process.exit(1);
}

const stats = fs.statSync(PDF_PATH);
console.log(`File Size: ${(stats.size / (1024 * 1024)).toFixed(1)} MB`);
console.log("");

async function safeFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, redirect: "manual" });
  return res;
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("Non-JSON response:", res.status, text.slice(0, 500));
    throw new Error(`Non-JSON response (HTTP ${res.status})`);
  }
}

async function run() {
  // ── Step 0: Get CSRF token and authenticate ──
  console.log("Step 0: Authenticating...");
  
  // Get CSRF token from the login page
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  const cookies = csrfRes.headers.getSetCookie?.() || [];
  let cookieHeader = cookies.map(c => c.split(";")[0]).join("; ");
  
  if (!EMAIL || !PASSWORD) {
    console.log("  No TEST_EMAIL/TEST_PASSWORD set. Trying without auth...");
    console.log("  (Set TEST_EMAIL and TEST_PASSWORD env vars for full test)");
    console.log("");
  } else {
    // Sign in with credentials
    const signInRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
      },
      body: new URLSearchParams({
        csrfToken,
        email: EMAIL,
        password: PASSWORD,
        redirect: "false",
        callbackUrl: BASE_URL,
        json: "true",
      }),
      redirect: "manual",
    });

    const signInCookies = signInRes.headers.getSetCookie?.() || [];
    if (signInCookies.length > 0) {
      cookieHeader = [...cookies, ...signInCookies].map(c => c.split(";")[0]).join("; ");
    }
    
    console.log(`  Auth response: ${signInRes.status}`);
    console.log(`  Cookies: ${cookieHeader.length > 0 ? "obtained" : "none"}`);
    console.log("");
  }

  // ── Step 0.5: Get publisher ID ──
  console.log("Step 0.5: Getting publisher ID...");
  const pubRes = await fetch(`${BASE_URL}/api/publishers`, {
    headers: { Cookie: cookieHeader },
  });
  const pubData = await safeJson(pubRes);
  
  if (!pubRes.ok) {
    console.error(`  ❌ Failed to get publishers: ${pubData.error || pubRes.status}`);
    console.error("  Make sure you're authenticated (set TEST_EMAIL and TEST_PASSWORD)");
    process.exit(1);
  }
  
  const publisherId = pubData.publishers?.[0]?.id;
  if (!publisherId) {
    console.error("  ❌ No publishers found for this user");
    process.exit(1);
  }
  console.log(`  Publisher: ${pubData.publishers[0].name} (${publisherId})`);
  console.log("");

  // ── Step 1: Initialize upload ──
  console.log("Step 1: Calling /api/manuscripts/upload/init...");
  const fileName = path.basename(PDF_PATH);
  
  const initRes = await fetch(`${BASE_URL}/api/manuscripts/upload/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      publisherId,
      fileName,
      fileSize: stats.size,
    }),
  });

  const initData = await safeJson(initRes);
  
  if (!initRes.ok) {
    console.error(`  ❌ Init failed: ${initData.error}`);
    process.exit(1);
  }

  console.log(`  ✅ Manuscript created: ${initData.manuscriptId}`);
  console.log(`  Storage path: ${initData.storagePath}`);
  console.log(`  Signed URL: ${initData.signedUrl?.substring(0, 80)}...`);
  console.log("");

  // ── Step 2: Upload file to Supabase ──
  console.log("Step 2: Uploading to Supabase Storage...");
  const fileBuffer = fs.readFileSync(PDF_PATH);
  
  const uploadRes = await fetch(initData.signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
      "x-upsert": "false",
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const uploadText = await uploadRes.text();
    console.error(`  ❌ Supabase upload failed: ${uploadRes.status} ${uploadText.slice(0, 500)}`);
    process.exit(1);
  }

  console.log(`  ✅ File uploaded to Supabase (${(stats.size / (1024 * 1024)).toFixed(1)} MB)`);
  console.log("");

  // ── Step 3: Trigger processing ──
  console.log("Step 3: Triggering processing...");
  const processRes = await fetch(`${BASE_URL}/api/manuscripts/${initData.manuscriptId}/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({}),
  });

  const processData = await safeJson(processRes);
  
  if (!processRes.ok) {
    console.error(`  ❌ Process failed: ${processData.error}`);
    process.exit(1);
  }

  console.log(`  ✅ Processing started: ${processData.status}`);
  console.log("");

  // ── Step 4: Poll for status ──
  console.log("Step 4: Polling for status...");
  let attempts = 0;
  const maxAttempts = 40; // 40 * 3s = 120s
  let finalStatus = null;

  while (attempts < maxAttempts) {
    attempts++;
    await new Promise(r => setTimeout(r, 3000));

    const statusRes = await fetch(`${BASE_URL}/api/manuscripts/${initData.manuscriptId}/status`, {
      headers: { Cookie: cookieHeader },
    });
    const statusData = await safeJson(statusRes);

    const elapsed = attempts * 3;
    console.log(`  [${elapsed}s] ${statusData.status} — ${statusData.stage || "..."} (${statusData.progress}%)`);

    if (statusData.isComplete) {
      finalStatus = statusData;
      break;
    }

    if (statusData.hasError) {
      console.error(`  ❌ Processing failed: ${statusData.statusMessage || "unknown error"}`);
      process.exit(1);
    }
  }

  if (!finalStatus) {
    console.error("  ❌ Timed out waiting for processing");
    process.exit(1);
  }

  console.log("");

  // ── Step 5: Verify results ──
  console.log("Step 5: Verifying manuscript data...");
  const msRes = await fetch(`${BASE_URL}/api/manuscripts/${initData.manuscriptId}`, {
    headers: { Cookie: cookieHeader },
  });
  const msData = await safeJson(msRes);

  if (!msRes.ok) {
    console.error(`  ❌ Failed to fetch manuscript: ${msData.error}`);
    process.exit(1);
  }

  const ms = msData.manuscript;
  console.log("");
  console.log("=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`Title:      ${ms.title || "(none)"}`);
  console.log(`Status:     ${ms.status}`);
  console.log(`Words:      ${ms.wordCount?.toLocaleString() || "(none)"}`);
  console.log(`Pages:      ${ms.pageCount || "(none)"}`);
  console.log(`Keywords:   ${ms.keywords?.length || 0} — ${(ms.keywords || []).slice(0, 5).join(", ")}`);
  console.log(`Authors:    ${ms.authors?.length || 0}`);
  if (ms.authors?.length > 0) {
    ms.authors.slice(0, 5).forEach((a, i) => {
      console.log(`  ${i + 1}. ${a.fullName}${a.isCorresponding ? " *" : ""}`);
    });
    if (ms.authors.length > 5) console.log(`  ... and ${ms.authors.length - 5} more`);
  }
  console.log(`References: ${ms.referenceCount || 0}`);
  console.log(`Chunks:     ${ms.chunkCount || 0}`);
  console.log(`Confidence: ${ms.extractionConfidence ? (ms.extractionConfidence * 100).toFixed(0) + "%" : "(none)"}`);
  console.log("");

  // Pass/Fail
  const passed = ms.status === "READY" && ms.keywords?.length > 0 && ms.authors?.length > 0;
  if (passed) {
    console.log("✅ TEST PASSED — Upload + processing + metadata extraction all working!");
  } else {
    console.log("❌ TEST FAILED — Check results above");
    if (ms.status !== "READY") console.log("  - Status is not READY");
    if (!ms.keywords?.length) console.log("  - No keywords extracted");
    if (!ms.authors?.length) console.log("  - No authors extracted");
  }

  process.exit(passed ? 0 : 1);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
