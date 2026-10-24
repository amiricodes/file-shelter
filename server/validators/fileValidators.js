import * as z from "zod";

export const MAX_ITEM_NAME_LENGTH = 255;

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid object id");

export const itemNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(
    MAX_ITEM_NAME_LENGTH,
    `Name must be at most ${MAX_ITEM_NAME_LENGTH} characters`,
  );

const fileSizeSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return /^(0|[1-9]\d*)$/.test(normalized) ? Number(normalized) : value;
  },
  z
    .number({ error: "File size must be a number" })
    .int("File size must be an integer")
    .min(0, "File size cannot be negative")
    .max(Number.MAX_SAFE_INTEGER, "File size is too large"),
);

export const uploadInitiateSchema = z.strictObject({
  name: itemNameSchema.default("untitled"),
  size: fileSizeSchema,
  contentType: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((value) => value || undefined),
  parentDirId: objectIdSchema.optional(),
});

export const uploadCompleteSchema = z.strictObject({
  fileId: objectIdSchema,
});

export const uploadCancelSchema = uploadCompleteSchema;

export const renameFileSchema = z.strictObject({
  newFilename: itemNameSchema,
});
