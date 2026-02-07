#!/bin/bash
set -e

echo "=== Vercel-compatible build verification ==="
echo ""

echo "1/3  Generating Prisma client..."
npx prisma generate
echo "    ✓ Prisma client generated"
echo ""

echo "2/3  Running TypeScript type-check..."
npx tsc --noEmit
echo "    ✓ TypeScript passes"
echo ""

echo "3/3  Running Next.js production build..."
npx next build
echo "    ✓ Next.js build passed"
echo ""

echo "=== All checks passed — safe to deploy ==="
