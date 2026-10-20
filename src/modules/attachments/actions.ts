"use server";

import { revalidatePath } from "next/cache";
import {
  deleteAttachment,
  listAttachments,
  type AttachmentDTO,
} from "@/modules/attachments/service";
import type { ActionResult } from "@/server/action-result";
import { requireUser } from "@/server/auth/require-user";
import { runAction } from "@/server/run-action";

export async function listAttachmentsAction(
  transactionId: string,
): Promise<ActionResult<AttachmentDTO[]>> {
  return runAction(async () => listAttachments(await requireUser(), transactionId));
}

export async function deleteAttachmentAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const r = await deleteAttachment(await requireUser(), id);
    revalidatePath("/transactions");
    return r;
  });
}
