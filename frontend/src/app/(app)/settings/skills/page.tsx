import type { Metadata } from "next";
import { SkillsScreen } from "@/features/service-rules/skills-screen";

export const metadata: Metadata = { title: "Skill tags" };

export default function SkillsPage() {
  return <SkillsScreen />;
}
