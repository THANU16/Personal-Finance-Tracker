import { GoalsClient } from "@/modules/goals/components/goals-client";
import { listGoals } from "@/modules/goals/service";
import { requireUser } from "@/server/auth/require-user";

export async function GoalsContent() {
  const ctx = await requireUser();
  return <GoalsClient data={await listGoals(ctx)} />;
}
