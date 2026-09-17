import { Router } from "express";
import { requireAccount } from "../auth.js";
import { ApiError, handler, UUID } from "../http.js";
import {
  addSave,
  eraseAccount,
  listSaves,
  recordViews,
  removeSave,
  savedScrollIds,
} from "../repo/accounts.js";

export const accountRouter = Router();

accountRouter.use(requireAccount);

/**
 * Impressions, sent by the client when cards are DISPLAYED. Duplicates are kept
 * as separate rows on purpose: re-seeing a card in revision mode is a real event.
 */
accountRouter.post(
  "/views",
  handler(async (req, res) => {
    const body = req.body as { views?: unknown };
    if (!Array.isArray(body.views)) {
      throw new ApiError(400, "views_required", "views must be an array");
    }
    const views = body.views.map((raw): { scroll_id: string; viewed_at?: string } => {
      const v = raw as { scroll_id?: unknown; viewed_at?: unknown };
      if (typeof v.scroll_id !== "string" || !UUID.test(v.scroll_id)) {
        throw new ApiError(400, "scroll_id_invalid", "each view needs a scroll_id uuid");
      }
      return typeof v.viewed_at === "string"
        ? { scroll_id: v.scroll_id, viewed_at: v.viewed_at }
        : { scroll_id: v.scroll_id };
    });
    res.status(202).json({ recorded: await recordViews(req.accountId, views) });
  }),
);

accountRouter.get(
  "/saves",
  handler(async (req, res) => {
    res.json({ scrolls: await listSaves(req.accountId) });
  }),
);

accountRouter.put(
  "/saves/:scrollId",
  handler(async (req, res) => {
    const scrollId = req.params.scrollId ?? "";
    if (!UUID.test(scrollId)) throw new ApiError(400, "scroll_id_invalid", "not a uuid");
    await addSave(req.accountId, scrollId);
    res.json({ saved_scroll_ids: await savedScrollIds(req.accountId) });
  }),
);

accountRouter.delete(
  "/saves/:scrollId",
  handler(async (req, res) => {
    const scrollId = req.params.scrollId ?? "";
    if (!UUID.test(scrollId)) throw new ApiError(400, "scroll_id_invalid", "not a uuid");
    await removeSave(req.accountId, scrollId);
    res.json({ saved_scroll_ids: await savedScrollIds(req.accountId) });
  }),
);

/**
 * Erasure. The only path that can remove view history, and it removes the
 * account, its views and its saves together. Deleting the Firebase Auth user
 * belongs here too and lands with task 2b.1, when credentials exist.
 */
accountRouter.delete(
  "/account",
  handler(async (req, res) => {
    await eraseAccount(req.accountId);
    res.status(204).end();
  }),
);
