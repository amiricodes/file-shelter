import * as z from "zod";
import { decodeCursor } from "../utils/paginationCursor.js";
import { itemNameSchema, objectIdSchema } from "./fileValidators.js";

export const DEFAULT_DIRECTORY_PAGE_SIZE = 100;
export const MAX_DIRECTORY_PAGE_SIZE = 100;

const cursorPayloadSchema = z.strictObject({
  updatedAt: z.iso.datetime(),
  id: objectIdSchema,
});

function decodeDirectoryCursor(value) {
  const cursor = decodeCursor(value);
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  cursorPayloadSchema.parse(JSON.parse(decoded));
  return cursor;
}

const paginationCursorSchema = z
  .string()
  .min(1, "Cursor cannot be empty")
  .max(1024, "Cursor is too long")
  .superRefine((value, context) => {
    try {
      decodeDirectoryCursor(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid pagination cursor",
      });
    }
  })
  .transform(decodeDirectoryCursor);

const pageLimitSchema = z.preprocess(
  (value) => {
    if (value === undefined) return DEFAULT_DIRECTORY_PAGE_SIZE;
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }
    return value;
  },
  z
    .number({ error: "Limit must be an integer" })
    .int("Limit must be an integer")
    .min(1, "Limit must be at least 1")
    .max(
      MAX_DIRECTORY_PAGE_SIZE,
      `Limit must be at most ${MAX_DIRECTORY_PAGE_SIZE}`,
    ),
);

export const directoryListingQuerySchema = z.strictObject({
  limit: pageLimitSchema,
  cursor: paginationCursorSchema.optional(),
});

export const createDirectorySchema = z.strictObject({
  dirname: itemNameSchema.default("New Folder"),
});

export const renameDirectorySchema = z.strictObject({
  newDirName: itemNameSchema,
});
