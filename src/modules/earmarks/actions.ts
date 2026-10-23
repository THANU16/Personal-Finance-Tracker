"use server";

import { revalidatePath } from "next/cache";
import type { AccountBucketsDTO } from "@/modules/earmarks/schemas";
import { moveBetweenBuckets, removeEarmark, setEarmark } from "@/modules/earmarks/service";
import {
  moveHoldingBuckets,
  removeHoldingEarmark,
  setHoldingEarmark,
  type HoldingBucketsDTO,
} from "@/modules/earmarks/holding-service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

// Buckets show on accounts, the dashboard and Quick add, so refresh the app layout.
const refresh = () => revalidatePath("/", "layout");

export async function setEarmarkAction(input: unknown): Promise<ActionResult<AccountBucketsDTO>> {
  return runAction(async () => {
    const result = await setEarmark(await requireUser(), input);
    refresh();
    return result;
  });
}

export async function removeEarmarkAction(
  input: unknown,
): Promise<ActionResult<AccountBucketsDTO>> {
  return runAction(async () => {
    const result = await removeEarmark(await requireUser(), input);
    refresh();
    return result;
  });
}

export async function moveBetweenBucketsAction(
  input: unknown,
): Promise<ActionResult<AccountBucketsDTO>> {
  return runAction(async () => {
    const result = await moveBetweenBuckets(await requireUser(), input);
    refresh();
    return result;
  });
}

// Holding earmarks (owner request): the same actions on a holding's value.
export async function setHoldingEarmarkAction(
  input: unknown,
): Promise<ActionResult<HoldingBucketsDTO>> {
  return runAction(async () => {
    const result = await setHoldingEarmark(await requireUser(), input);
    refresh();
    return result;
  });
}

export async function removeHoldingEarmarkAction(
  input: unknown,
): Promise<ActionResult<HoldingBucketsDTO>> {
  return runAction(async () => {
    const result = await removeHoldingEarmark(await requireUser(), input);
    refresh();
    return result;
  });
}

export async function moveHoldingBucketsAction(
  input: unknown,
): Promise<ActionResult<HoldingBucketsDTO>> {
  return runAction(async () => {
    const result = await moveHoldingBuckets(await requireUser(), input);
    refresh();
    return result;
  });
}
