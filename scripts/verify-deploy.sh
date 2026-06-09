#!/bin/bash
set -e

echo "=== Vercel-compatible build verification ==="
echo ""

echo "1/4  Generating build info..."
node scripts/generate-build-info.js
echo "    ✓ build-info.ts generated"
echo ""

echo "2/4  Generating Prisma client..."
npx prisma generate
echo "    ✓ Prisma client generated"
echo ""

echo "3/4  Running TypeScript type-check..."
npx tsc --noEmit
echo "    ✓ TypeScript passes"
echo ""

echo "4/4  Running Next.js production build..."
npx next build
echo "    ✓ Next.js build passed"
echo ""

echo "=== All checks passed — safe to deploy ==="
