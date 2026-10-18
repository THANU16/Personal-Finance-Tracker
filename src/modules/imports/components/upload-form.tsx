"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Step 1 — upload one or more Money Manager .xlsx exports (nothing is posted yet). */
export function MoneyManagerUploadForm() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) {
      setError("Choose at least one .xlsx file");
      return;
    }
    setPending(true);
    setError(null);
    const body = new FormData();
    for (const f of files) body.append("files", f);
    try {
      const res = await fetch("/api/import/money-manager", { method: "POST", body });
      const json = (await res.json()) as
        { ok: true; data: { batchId: string } } | { ok: false; error: { message: string } };
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      toast.success("File read — now map your accounts");
      router.push(`/transactions/import/money-manager/${json.data.batchId}`);
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="mm-files">Money Manager export (.xlsx)</Label>
        <Input
          id="mm-files"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          aria-invalid={Boolean(error)}
          aria-describedby="mm-files-help"
          onChange={(e) => setFiles([...(e.target.files ?? [])])}
        />
        <p id="mm-files-help" className="text-xs text-muted-foreground">
          In Money Manager: More → Backup → Export to Excel. Add several years at once; overlapping
          rows are counted once. Up to 10 MB per file.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {files.length ? (
        <ul className="space-y-1 text-sm">
          {files.map((f) => (
            <li key={f.name} className="flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
              {f.name}
            </li>
          ))}
        </ul>
      ) : null}
      <Button type="submit" disabled={pending}>
        <Upload aria-hidden /> {pending ? "Reading…" : "Upload and continue"}
      </Button>
    </form>
  );
}
