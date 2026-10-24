import path from "path";
import mongoose from "mongoose";
import File from "../models/fileModel.js";
import {
  createSignedUploadUrl,
  getFileMetaData,
} from "../services/s3Service.js";
import { createCloudFrontGetUrl } from "../services/cloudFrontService.js";
import {
  withStorageTransaction,
  assertQuota,
  liveAncestors,
  adjustAncestorSizes,
  removeFiles,
  storageError,
  UPLOAD_LIFETIME_MS,
} from "../services/storageService.js";

async function findFile(id, userId, session) {
  const file = await File.findOne({ _id: id, userId }).session(session);
  if (!file) throw storageError(404, "File not found");
  return file;
}

function respondError(error, res, next) {
  if (error.status)
    return res.status(error.status).json({ error: error.message });
  return next(error);
}

export const getFile = async (req, res, next) => {
  try {
    const file = await findFile(req.params.id, req.user._id, null);
    if (!file.uploadCompletedAt)
      throw storageError(409, "File upload is not complete yet");
    if (file.isTrashed) throw storageError(409, "File is trashed");
    await liveAncestors(file.parentDirId, req.user._id, null);
    return res.redirect(
      createCloudFrontGetUrl({
        Key: `${file.id}${file.extension}`,
        download: req.query.action === "download",
        filename: file.name,
      }),
    );
  } catch (error) {
    return respondError(error, res, next);
  }
};

export const renameFile = async (req, res, next) => {
  try {
    const file = await findFile(req.params.id, req.user._id, null);
    file.name = req.validated.body.newFilename;
    file.updatedAt = new Date();
    await file.save();
    return res.json({ message: "Renamed" });
  } catch (error) {
    return respondError(error, res, next);
  }
};

export const uploadInitiate = async (req, res, next) => {
  try {
    const {
      name,
      size,
      contentType,
      parentDirId: requestedParentDirId,
    } = req.validated.body;
    const parentDirId = requestedParentDirId || req.user.rootDirId;
    const fileId = new mongoose.Types.ObjectId();
    const extension = path.extname(name);
    // Signing has no remote side effect. Only expose the URL after reservation.
    const uploadUrl = await createSignedUploadUrl({
      Key: `${fileId}${extension}`,
      ContentType: contentType,
      ContentLength: size,
    });
    await withStorageTransaction(req.user._id, async ({ user, session }) => {
      await liveAncestors(parentDirId, user._id, session);
      await assertQuota(user, session, size);
      await File.create(
        [
          {
            _id: fileId,
            name,
            size,
            extension,
            parentDirId,
            userId: user._id,
            uploadCompletedAt: null,
          },
        ],
        { session },
      );
    });
    return res.status(201).json({ uploadUrl, fileId });
  } catch (error) {
    return respondError(error, res, next);
  }
};

export const uploadComplete = async (req, res, next) => {
  try {
    const { fileId } = req.validated.body;
    const initial = await findFile(fileId, req.user._id, null);
    if (initial.uploadCompletedAt)
      return res.json({ message: "Upload Complete" });
    // S3 calls stay outside retryable MongoDB transactions.
    let metadata;
    try {
      metadata = await getFileMetaData(`${initial.id}${initial.extension}`);
    } catch (error) {
      const missing =
        error.$metadata?.httpStatusCode === 404 ||
        ["NotFound", "NoSuchKey"].includes(error.name);
      throw storageError(
        missing ? 409 : 503,
        missing
          ? "Upload not found in S3 yet; retry or cancel"
          : "S3 verification unavailable; retry completion",
      );
    }
    const result = await withStorageTransaction(
      req.user._id,
      async ({ user, session }) => {
        const file = await findFile(fileId, user._id, session);
        if (file.uploadCompletedAt) return "complete";
        if (Date.now() - file.createdAt.getTime() >= UPLOAD_LIFETIME_MS) {
          await removeFiles([file], user._id, session);
          return "expired";
        }
        if (Number(metadata.ContentLength) !== file.size) {
          await removeFiles([file], user._id, session);
          return "mismatch";
        }
        if (file.isTrashed)
          throw storageError(409, "Cannot complete a trashed upload");
        await liveAncestors(file.parentDirId, user._id, session);
        // Recheck after a subscription downgrade; this file is already reserved.
        await assertQuota(user, session);
        file.uploadCompletedAt = new Date();
        await file.save({ session });
        await adjustAncestorSizes(
          file.parentDirId,
          user._id,
          file.size,
          session,
        );
        return "complete";
      },
    );
    if (result !== "complete")
      return res.status(result === "expired" ? 410 : 400).json({
        error:
          result === "expired" ? "Upload expired" : "File size does not match",
        cleanupPending: true,
      });
    return res.json({ message: "Upload Complete" });
  } catch (error) {
    return respondError(error, res, next);
  }
};

export const uploadCancel = async (req, res, next) => {
  try {
    const { fileId } = req.validated.body;
    await withStorageTransaction(req.user._id, async ({ user, session }) => {
      const file = await File.findOne({
        _id: fileId,
        userId: user._id,
      }).session(session);
      if (!file) return;
      if (file.uploadCompletedAt)
        throw storageError(409, "Completed uploads cannot be cancelled");
      await removeFiles([file], user._id, session);
    });
    return res.json({ message: "Upload cancelled", cleanupPending: true });
  } catch (error) {
    return respondError(error, res, next);
  }
};

async function mutateFile(req, res, next, action) {
  try {
    await withStorageTransaction(req.user._id, async ({ user, session }) => {
      const file = await findFile(req.params.id, user._id, session);
      if (action === "delete") {
        if (!file.isTrashed && file.uploadCompletedAt)
          await adjustAncestorSizes(
            file.parentDirId,
            user._id,
            -file.size,
            session,
          );
        await removeFiles([file], user._id, session);
        return;
      }
      const trash = action === "trash";
      if (file.isTrashed === trash) return;
      if (!trash) {
        await liveAncestors(file.parentDirId, user._id, session);
        await assertQuota(user, session, file.size);
      }
      if (file.uploadCompletedAt)
        await adjustAncestorSizes(
          file.parentDirId,
          user._id,
          trash ? -file.size : file.size,
          session,
        );
      file.isTrashed = trash;
      file.trashedAt = trash ? new Date() : null;
      await file.save({ session });
    });
    return res.json({
      message:
        action === "delete"
          ? "File Deleted Permanently"
          : action === "trash"
            ? "File moved to trash"
            : "File restored",
      ...(action === "delete" ? { cleanupPending: true } : {}),
    });
  } catch (error) {
    return respondError(error, res, next);
  }
}

export const trashFile = (req, res, next) =>
  mutateFile(req, res, next, "trash");
export const restoreFile = (req, res, next) =>
  mutateFile(req, res, next, "restore");
export const permanentlyDeleteFile = (req, res, next) =>
  mutateFile(req, res, next, "delete");
