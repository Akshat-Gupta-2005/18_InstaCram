/**
 * The API's response shapes, mirrored from services/serving/src/types.ts.
 * Contract: Docs/API-CONTRACT.md. A change there is a change here.
 */

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
  /** null when the model suggested a field that does not exist yet. */
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

export interface LastExpansion {
  kind: "initial" | "more";
  status: "running" | "done" | "failed";
  topics_queued: number;
  topics_linked: number;
  failed_retried: number;
}

export interface FeedPage {
  field: { id: string; name: string };
  scrolls: ScrollCard[];
  generating: boolean;
  topics_pending: number;
  retry_after_ms?: number;
  failed_topics: FailedTopic[];
  exhausted: boolean;
  end_card: EndCard | null;
  last_expansion: LastExpansion | null;
  /** The user's place in the whole field; `total` grows while it generates. */
  progress: { viewed: number; total: number };
}

export interface ExpandResponse {
  expansion: "queued" | "already_running";
  failed_retried: number;
  retry_after_ms: number;
}

export interface LoginResponse {
  token: string;
  expires_at: string;
}
