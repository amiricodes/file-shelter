import { ObjectId } from "mongodb";
import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import Share from "../models/shareModel.js";
import {
  withStorageTransaction,
  assertQuota,
  liveAncestors,
  collectSubtree,
  removeFiles,
  reconcileSizes,
  storageError,
} from "../services/storageService.js";
import { buildCursorMatch, encodeCursor } from "../utils/paginationCursor.js";

function rejectRootMutation(req, res) {
  if (String(req.params.id) !== String(req.user.rootDirId)) return false;
  res.status(400).json({ error: "The root directory cannot be modified." });
  return true;
}

async function buildLegacyPathIds(directoryData, userId) {
  const pathIds = [];
  const visited = new Set();
  let current = directoryData;

  while (current) {
    const currentId = current._id?.toString();
    if (!currentId || visited.has(currentId)) break;

    visited.add(currentId);
    pathIds.unshift(current._id);

    if (!current.parentDirId) break;

    current = await Directory.findOne(
      { _id: current.parentDirId, userId },
      { _id: 1, parentDirId: 1 },
    ).lean();
  }

  return pathIds;
}

export const getDirectory = async (req, res) => {
  const { rootDirId } = req.user;
  const id = req.params.id || rootDirId;
  const { limit, cursor } = req.validated.query;

  const directoryData = await Directory.findOne({
    _id: id,
    userId: req.user._id,
  }).lean();
  if (!directoryData) {
    return res
      .status(404)
      .json({ error: "Directory not found or you do not have access to it!" });
  }

  const pathIds =
    Array.isArray(directoryData.path) && directoryData.path.length > 0
      ? directoryData.path
      : await buildLegacyPathIds(directoryData, req.user._id);

  const pathDirectories =
    pathIds.length > 0
      ? await Directory.find(
          { _id: { $in: pathIds }, userId: req.user._id },
          { _id: 1, name: 1 },
        ).lean()
      : [];

  const pathNameById = new Map(
    pathDirectories.map((dir) => [dir._id.toString(), dir.name]),
  );

  const rootIdString = rootDirId?.toString();
  const breadcrumbTrail = [{ id: null, name: "All Files" }];

  pathIds.forEach((pathId) => {
    const pathIdString = pathId.toString();
    if (pathIdString === rootIdString) return;

    const name = pathNameById.get(pathIdString);
    if (name) {
      breadcrumbTrail.push({ id: pathIdString, name });
    }
  });

  const childMatch = {
    parentDirId: new ObjectId(id),
    userId: new ObjectId(req.user._id),
    isTrashed: false,
  };
  // Directories never have uploadCompletedAt, and a missing field matches
  // $ne: null in Mongo — so this guard must apply to files only.
  const fileMatch = {
    ...childMatch,
    uploadCompletedAt: { $ne: null },
  };
  const cursorMatch = buildCursorMatch(cursor);

  const page = await File.aggregate([
    { $match: { ...fileMatch, ...cursorMatch } },
    {
      $project: {
        name: 1,
        size: 1,
        extension: 1,
        createdAt: 1,
        updatedAt: 1,
        itemType: { $literal: "file" },
      },
    },
    {
      $unionWith: {
        coll: Directory.collection.name,
        pipeline: [
          { $match: { ...childMatch, ...cursorMatch } },
          {
            $project: {
              name: 1,
              size: 1,
              createdAt: 1,
              updatedAt: 1,
              itemType: { $literal: "directory" },
            },
          },
        ],
      },
    },
    { $sort: { updatedAt: -1, _id: -1 } },
    { $limit: limit + 1 },
  ]);

  const hasMore = page.length > limit;
  const items = (hasMore ? page.slice(0, limit) : page).map((item) => ({
    ...item,
    id: item._id,
    isDirectory: item.itemType === "directory",
  }));

  return res.status(200).json({
    name: directoryData.name,
    breadcrumbTrail,
    items,
    nextCursor: hasMore ? encodeCursor(items.at(-1)) : null,
  });
};

export const createDirectory = async (req, res, next) => {
  try {
    const parentDirId = req.params.parentDirId || req.user.rootDirId;
    const { dirname } = req.validated.directory;
    await withStorageTransaction(req.user._id, async ({ user, session }) => {
      const ancestors = await liveAncestors(parentDirId, user._id, session);
      const newDirId = new ObjectId();
      await Directory.create(
        [
          {
            _id: newDirId,
            name: dirname,
            parentDirId,
            path: [...ancestors.map((dir) => dir._id).reverse(), newDirId],
            userId: user._id,
          },
        ],
        { session },
      );
    });
    return res.json({ message: "Directory Created!" });
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    next(error);
  }
};

export const renameDirectory = async (req, res, next) => {
  const user = req.user;
  const { id } = req.params;
  const { newDirName } = req.validated.body;

  if (rejectRootMutation(req, res)) return;

  try {
    await Directory.findOneAndUpdate(
      {
        _id: id,
        userId: user._id,
      },
      {
        name: newDirName,
      },
    );
    res.status(200).json({ message: "Directory Renamed!" });
  } catch (err) {
    next(err);
  }
};

async function mutateDirectory(req, res, next, action) {
  if (rejectRootMutation(req, res)) return;
  try {
    await withStorageTransaction(req.user._id, async ({ user, session }) => {
      const dir = await Directory.findOne({
        _id: req.params.id,
        userId: user._id,
      }).session(session);
      if (!dir) throw storageError(404, "Directory not found");
      const trash = action === "trash";
      if (action !== "delete" && dir.isTrashed === trash) return;
      if (action === "restore")
        await liveAncestors(dir.parentDirId, user._id, session);
      const directoryIds = await collectSubtree(dir._id, user._id, session);
      if (action === "delete") {
        const files = await File.find({
          parentDirId: { $in: directoryIds },
          userId: user._id,
        }).session(session);
        await removeFiles(files, user._id, session);
        await Directory.deleteMany({
          _id: { $in: directoryIds },
          userId: user._id,
        }).session(session);
        await Share.deleteMany({ directoryId: { $in: directoryIds } }).session(
          session,
        );
      } else {
        const state = {
          isTrashed: trash,
          trashedAt: trash ? new Date() : null,
        };
        await File.updateMany(
          { parentDirId: { $in: directoryIds }, userId: user._id },
          { $set: state },
        ).session(session);
        await Directory.updateMany(
          { _id: { $in: directoryIds }, userId: user._id },
          { $set: state },
        ).session(session);
        if (!trash) await assertQuota(user, session);
      }
      await reconcileSizes(user._id, session);
    });
    return res.json({
      message:
        action === "delete"
          ? "Directory permanently deleted"
          : action === "trash"
            ? "Directory moved to trash"
            : "Directory restored",
      ...(action === "delete" ? { cleanupPending: true } : {}),
    });
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    next(error);
  }
}

export const trashDirectory = (req, res, next) =>
  mutateDirectory(req, res, next, "trash");
export const restoreDirectory = (req, res, next) =>
  mutateDirectory(req, res, next, "restore");
export const permanentlyDeleteDirectory = (req, res, next) =>
  mutateDirectory(req, res, next, "delete");
