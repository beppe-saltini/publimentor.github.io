import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Onboarding } from "@/components/dashboard/onboarding";

export default async function OnboardingPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // If user already has a role set, they've completed onboarding
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  // Also check if they have journals or publisher memberships
  const membershipCount = await prisma.journalMember.count({
    where: { userId: session.user.id },
  });

  const publisherCount = await prisma.publisherMember.count({
    where: { userId: session.user.id },
  });

  // If user has a role AND has some memberships, skip onboarding
  if (user?.role && (membershipCount > 0 || publisherCount > 0)) {
    redirect("/dashboard");
  }

  // Authors don't need journal memberships; if they have a role, skip
  if (user?.role === "AUTHOR") {
    redirect("/dashboard");
  }

  return (
    <div className="py-8">
      <Onboarding userName={session.user.name?.split(" ")[0]} userEmail={session.user.email} />
    </div>
  );
}
