import { Types } from "mongoose";
import { AppError } from "@/server/errors";

/** Parses an id from input. Invalid ids are reported as "not found" (never leak a parse error). */
export function toObjectId(id: string, what = "Record"): Types.ObjectId {
  if (!Types.ObjectId.isValid(id) || String(new Types.ObjectId(id)) !== id.toLowerCase()) {
    throw new AppError("NOT_FOUND", `${what} not found`);
  }
  return new Types.ObjectId(id);
}

export function idString(id: Types.ObjectId | string | null | undefined): string | null {
  return id ? String(id) : null;
}
