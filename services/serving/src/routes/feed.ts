import { Router } from "express";
import { config } from "../config.js";
import { buildFeedPage, buildRevisionPage } from "../feed/feedService.js";
import { handler, pageSize, requireString } from "../http.js";
import { adjacentFields, getField } from "../repo/fields.js";
import { ApiError } from "../http.js";
import { requireAccount } from "../auth.js";

export const feedRouter = Router();

feedRouter.use(requireAccount);

/**
 * The main endpoint. Note what it does NOT do: it never records a view. Views
 * are logged by the client when a card is displayed, because prefetch means the
 * client holds cards it has not shown yet (P12).
 */
feedRouter.post(
  "/feed",
  handler(async (req, res) => {
    const body = req.body as { field?: unknown; limit?: unknown };
    const field = requireString(body.field, "field", 100);
    const limit = pageSize(body.limit, config.defaultPageSize, config.maxPageSize);
    res.json(await buildFeedPage(field, req.accountId, limit));
  }),
);

feedRouter.post(
  "/feed/revision",
  handler(async (req, res) => {
    const body = req.body as { field?: unknown; limit?: unknown };
    const field = requireString(body.field, "field", 100);
    const limit = pageSize(body.limit, config.defaultPageSize, config.maxPageSize);
    res.json(await buildRevisionPage(field, req.accountId, limit));
  }),
);

feedRouter.get(
  "/fields/:fieldId/adjacent",
  handler(async (req, res) => {
    const fieldId = req.params.fieldId ?? "";
    const field = await getField(fieldId);
    if (!field) throw new ApiError(404, "field_not_found", "no such field");
    res.json({ adjacent_fields: await adjacentFields(field.id, config.adjacentFieldLimit) });
  }),
);
