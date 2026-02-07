import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Onboarding } from "@/components/dashboard/onboarding";

export default async function OnboardingPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // If user already has journals, redirect to dashboard
  const membershipCount = await prisma.journalMember.count({
    where: { userId: session.user.id },
  });

  if (membershipCount > 0) {
    redirect("/dashboard");
  }

  return (
    <div className="py-8">
      <Onboarding userName={session.user.name?.split(" ")[0]} />
    </div>
  );
}
