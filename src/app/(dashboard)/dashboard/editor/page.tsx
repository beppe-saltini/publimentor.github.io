import { redirect } from "next/navigation";

export default function EditorIndexPage() {
  redirect("/dashboard/editor/reviewers");
}
