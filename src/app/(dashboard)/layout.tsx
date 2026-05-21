import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DashboardNestedLayout } from "@/components/dashboard/dashboard-nested-layout";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  return <DashboardNestedLayout>{children}</DashboardNestedLayout>;
}
