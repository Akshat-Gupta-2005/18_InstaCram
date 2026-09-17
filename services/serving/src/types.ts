/** Shapes returned by the API. Contract: Docs/API-CONTRACT.md */

export interface ScrollCard {
  id: string;
  topic: { id: string; name: string };
  content: string;
  source_url: string;
  trust_label: "sourced_verified" | "ai_generated";
  why_it_matters: string;
  recall: { prompt: string; answer: string };
  saved: boolean;
}

export interface FailedTopic {
  id: string;
  name: string;
}

export interface AdjacentField {
  /** null when the suggestion came from a model and the field doesn't exist yet. */
  id: string | null;
  name: string;
  shared_topics: number;
  source: "overlap" | "suggested";
  has_content: boolean;
}

export interface EndCard {
  viewed_count: number;
  adjacent_fields: AdjacentField[];
}

export interface FeedPage {
  field: { id: string; name: string };
  scrolls: ScrollCard[];
  generating: boolean;
  topics_pending: number;
  retry_after_ms?: number;
  /** Topics whose last run produced no card that passed fact-check. */
  failed_topics: FailedTopic[];
  exhausted: boolean;
  end_card: EndCard | null;
  /**
   * The field's most recent expansion. A "more topics" tap returns before its
   * candidates exist, so its result arrives here. When `kind` is "more", `status`
   * is "done" and all three counts are 0, the field is genuinely exhausted and the
   * client should stop offering the action.
   */
  last_expansion: LastExpansion | null;
}

export interface LastExpansion {
  kind: "initial" | "more";
  status: "running" | "done" | "failed";
  topics_queued: number;
  topics_linked: number;
  failed_retried: number;
}

/** Response of POST /v1/fields/{field_id}/expand. */
export interface ExpandResponse {
  /** "already_running" when an expansion for the field was still outstanding. */
  expansion: "queued" | "already_running";
  failed_retried: number;
  retry_after_ms: number;
}
