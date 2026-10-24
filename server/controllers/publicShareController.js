import { ObjectId } from "mongodb";
import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import Share from "../models/shareModel.js";
import User from "../models/userModel.js";
import { createCloudFrontGetUrl } from "../services/cloudFrontService.js";
import {
  buildCursorMatch,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
} from "../utils/paginationCursor.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

async function resolveActiveShare(token) {
  const share = await Share.findOne({ token, isActive: true }).lean();
  if (!share) {
    return {
      error: {
        status: 404,
        body: { error: "This link is invalid or has been revoked." },
      },
    };
  }

  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
    return {
      error: { status: 410, body: { error: "This link has expired." } },
    };
  }

  const owner = await User.findOne(
    { _id: share.ownerId },
    { name: 1, isDeleted: 1, isTrashed: 1 },
  ).lean();
  if (!owner || owner.isDeleted || owner.isTrashed) {
    return {
      error: {
        status: 404,
        body: { error: "This link is no longer available." },
      },
    };
  }

  return { share, owner };
}

async function assertShareAccess(req, share) {
  if (share.accessType !== "restricted") return null;

  const signInRequired = {
    status: 401,
    body: {
      error: "Sign in to open this link.",
      code: "SIGN_IN_REQUIRED",
    },
  };

  if (!req.user?._id) return signInRequired;

  const user = await User.findOne(
    { _id: req.user._id },
    { email: 1, isDeleted: 1 },
  ).lean();
  if (!user || user.isDeleted) return signInRequired;

  const email = String(user.email || "")
    .trim()
    .toLowerCase();
  const allowed = (share.allowedEmails || []).map((value) =>
    String(value || "")
      .trim()
      .toLowerCase(),
  );
  if (!allowed.includes(email)) {
    return {
      status: 403,
      body: {
        error: "This link is restricted to specific email addresses.",
        code: "ACCESS_DENIED",
      },
    };
  }

  return null;
}

async function getPathIds(directory, ownerId) {
  if (Array.isArray(directory.path) && directory.path.length > 0) {
    return directory.path;
  }

  const pathIds = [];
  const visited = new Set();
  let current = directory;

  while (current) {
    const currentId = current._id?.toString();
    if (!currentId || visited.has(currentId)) break;

    visited.add(currentId);
    pathIds.unshift(current._id);

    if (!current.parentDirId) break;

    current = await Directory.findOne(
      { _id: current.parentDirId, userId: ownerId },
      { _id: 1, parentDirId: 1 },
    ).lean();
  }

  return pathIds;
}

async function isWithinSharedSubtree(directoryId, rootId, ownerId) {
  let currentId =
    directoryId instanceof ObjectId
      ? directoryId
      : new ObjectId(String(directoryId));
  const rootObjectId =
    rootId instanceof ObjectId ? rootId : new ObjectId(String(rootId));

  while (currentId) {
    if (currentId.equals(rootObjectId)) return true;

    const parent = await Directory.findOne(
      { _id: currentId, userId: ownerId },
      { parentDirId: 1 },
    ).lean();
    if (!parent?.parentDirId) return false;

    currentId = parent.parentDirId;
  }

  return false;
}

function findSharedFile(share) {
  return File.findOne({
    _id: share.fileId,
    userId: share.ownerId,
    isTrashed: false,
    uploadCompletedAt: { $ne: null },
  })
    .select({ name: 1, size: 1, extension: 1 })
    .lean();
}

export const getSharedItem = async (req, res, next) => {
  try {
    const resolved = await resolveActiveShare(req.params.token);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { share, owner } = resolved;
    const accessError = await assertShareAccess(req, share);
    if (accessError) {
      return res.status(accessError.status).json(accessError.body);
    }

    if (share.resourceType === "file") {
      const file = await findSharedFile(share);
      if (!file) {
        return res
          .status(404)
          .json({ error: "This content is no longer available." });
      }

      return res.status(200).json({
        resourceType: "file",
        accessType: share.accessType,
        ownerName: owner.name,
        item: {
          id: file._id,
          name: file.name,
          size: file.size,
          extension: file.extension,
        },
      });
    }

    const rootId = share.directoryId;
    const rootIdString = String(rootId);
    const requestedDirId = req.query.dir;
    let currentDir;

    if (requestedDirId && requestedDirId !== rootIdString) {
      if (!ObjectId.isValid(requestedDirId)) {
        return res.status(400).json({ error: "Invalid directory reference." });
      }

      currentDir = await Directory.findOne({
        _id: new ObjectId(requestedDirId),
        userId: share.ownerId,
        isTrashed: false,
      }).lean();
      if (!currentDir) {
        return res
          .status(404)
          .json({ error: "This folder is no longer available." });
      }

      const withinSubtree = await isWithinSharedSubtree(
        currentDir._id,
        rootId,
        share.ownerId,
      );
      if (!withinSubtree) {
        return res
          .status(403)
          .json({ error: "This folder is not part of the shared link." });
      }
    } else {
      currentDir = await Directory.findOne({
        _id: rootId,
        userId: share.ownerId,
        isTrashed: false,
      }).lean();
      if (!currentDir) {
        return res
          .status(404)
          .json({ error: "This folder is no longer available." });
      }
    }

    const pathIds = await getPathIds(currentDir, share.ownerId);
    const rootIndex = pathIds.findIndex(
      (pathId) => String(pathId) === rootIdString,
    );
    const visiblePathIds =
      rootIndex === -1 ? [currentDir._id] : pathIds.slice(rootIndex);

    const pathDirectories =
      visiblePathIds.length > 0
        ? await Directory.find(
            { _id: { $in: visiblePathIds }, userId: share.ownerId },
            { _id: 1, name: 1 },
          ).lean()
        : [];

    const pathNameById = new Map(
      pathDirectories.map((dir) => [dir._id.toString(), dir.name]),
    );

    const breadcrumbTrail = [
      { id: null, name: pathNameById.get(rootIdString) || currentDir.name },
    ];
    visiblePathIds.forEach((pathId) => {
      const pathIdString = pathId.toString();
      if (pathIdString === rootIdString) return;

      const name = pathNameById.get(pathIdString);
      if (name) {
        breadcrumbTrail.push({ id: pathIdString, name });
      }
    });

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(
      Math.max(
        Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_PAGE_SIZE,
        1,
      ),
      MAX_PAGE_SIZE,
    );
    let cursor;
    try {
      cursor = decodeCursor(req.query.cursor);
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }

    const childMatch = {
      parentDirId: currentDir._id,
      userId: share.ownerId,
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
      resourceType: "directory",
      accessType: share.accessType,
      ownerName: owner.name,
      name: currentDir.name,
      breadcrumbTrail,
      items,
      nextCursor: hasMore ? encodeCursor(items.at(-1)) : null,
    });
  } catch (err) {
    return next(err);
  }
};

export const downloadSharedFile = async (req, res, next) => {
  try {
    const resolved = await resolveActiveShare(req.params.token);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { share } = resolved;
    const accessError = await assertShareAccess(req, share);
    if (accessError) {
      return res.status(accessError.status).json(accessError.body);
    }

    let file;
    if (share.resourceType === "file") {
      file = await findSharedFile(share);
    } else {
      const { fileId } = req.params;
      if (!ObjectId.isValid(fileId)) {
        return res.status(400).json({ error: "Invalid file reference." });
      }

      file = await File.findOne({
        _id: new ObjectId(fileId),
        userId: share.ownerId,
        isTrashed: false,
        uploadCompletedAt: { $ne: null },
      })
        .select({ name: 1, size: 1, extension: 1, parentDirId: 1 })
        .lean();

      if (
        file &&
        !(await isWithinSharedSubtree(
          file.parentDirId,
          share.directoryId,
          share.ownerId,
        ))
      ) {
        file = null;
      }
    }

    if (!file) {
      return res
        .status(404)
        .json({ error: "This file is no longer available." });
    }

    const fileUrl = createCloudFrontGetUrl({
      Key: `${file._id}${file.extension}`,
      download: req.query.mode !== "preview",
      filename: file.name,
    });

    return res.redirect(fileUrl);
  } catch (err) {
    return next(err);
  }
};
