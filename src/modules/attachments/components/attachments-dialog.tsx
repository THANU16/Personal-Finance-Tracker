"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Download, FileText, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteAttachmentAction, listAttachmentsAction } from "@/modules/attachments/actions";
import type { AttachmentDTO } from "@/modules/attachments/service";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;

const size = (b: number) =>
  b >= 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`;

/** Receipts on one transaction: upload (POST /api/files), view/download, delete. */
export function AttachmentsDialog({
  transactionId,
  title,
  onClose,
}: {
  transactionId: string;
  title: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<AttachmentDTO[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void listAttachmentsAction(transactionId).then((res) => {
      if (!live) return;
      if (res.ok) setItems(res.data);
      else toast.error(res.error.message);
    });
    return () => {
      live = false;
    };
  }, [transactionId]);

  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("Files can be at most 10 MB");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("transactionId", transactionId);
      const res = await fetch("/api/files", { method: "POST", body: form });
      const body = (await res.json()) as
        { ok: true; data: AttachmentDTO } | { ok: false; error: { message: string } };
      if (!body.ok) {
        toast.error(body.error.message);
        return;
      }
      setItems((list) => [...(list ?? []), body.data]);
      toast.success("File attached");
      start(() => router.refresh());
    } catch {
      toast.error("Upload failed; check your connection");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attachments</DialogTitle>
          <DialogDescription>{title}. JPEG, PNG, WebP or PDF, up to 10 MB each.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {items === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No files yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {items.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                  {a.mimeType === "application/pdf" ? (
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
                  >
                    {a.fileName}
                  </a>
                  <span className="text-xs text-muted-foreground">{size(a.sizeBytes)}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Download ${a.fileName}`}
                    render={<a href={`${a.url}?download=1`} />}
                  >
                    <Download aria-hidden />
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button size="icon" variant="ghost" aria-label={`Delete ${a.fileName}`}>
                        <Trash2 aria-hidden />
                      </Button>
                    }
                    title={`Delete ${a.fileName}?`}
                    description="The file is removed for good. The transaction stays as it is."
                    confirmLabel="Delete"
                    destructive
                    onConfirm={async () => {
                      const res = await deleteAttachmentAction(a.id);
                      if (!res.ok) {
                        toast.error(res.error.message);
                        return false;
                      }
                      setItems((list) => (list ?? []).filter((x) => x.id !== a.id));
                      toast.success("File deleted");
                      router.refresh();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`attach-${transactionId}`}>Add a file</Label>
            <Input
              ref={input}
              id={`attach-${transactionId}`}
              type="file"
              accept={ACCEPT}
              disabled={uploading}
              onChange={(e) => void upload(e.target.files)}
            />
            {uploading ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
