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
}
