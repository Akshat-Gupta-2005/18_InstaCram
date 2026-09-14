# Project Plan — "Microlearn" (working title)
*A field-scoped, scroll-based microlearning app*

> This document consolidates every decision, discussion, and piece of reasoning from the project's planning conversation. It is meant to serve as the single source of context for beginning implementation.

---

## 1. Problem Statement & Origin

**The problem:** Attention spans have collapsed into short-form scroll habits (Reels, Shorts, TikTok). Fighting that habit — telling people to read long-form instead — doesn't work. The opportunity is to put something useful into the exact slot that reels currently occupy, rather than compete with it.

**Origin story:** While waiting for a Sabre interview, the founder saw an Instagram reel explaining "man in the loop" vs. "man on the loop." Later in that same interview, they were asked that exact question — and could answer it directly because of the reel. This is the direct inspiration for the app: brief, low-effort exposure to a concept can be enough to recall it under pressure later.

**A second validating observation:** Separately, while struggling to learn system design through long (5+ hour) YouTube videos, the founder noticed such videos are really just small topics stitched together into a forced linear format. A scroll-based, chunked format would have suited *revising* that same material better than re-watching the full video.

**Personal motivation:** The founder wants to reduce their own dependency on Instagram-like apps — this project is partly an attempt to redirect that habit toward something useful, for themselves first.

---

## 2. Core Concept

An Instagram-Reels-style app where the unit of content is not a video but a **one-page, single-topic microlesson** ("scroll" / "card").

- The user selects a **field of interest** (tech or non-tech, e.g. "Java Utils," "Behavioral Economics").
- The app sources/generates small, discrete **topics** within that field (e.g. HashMap, Queue, Stack).
- Each scroll = one topic, one page, readable in about the time it takes to watch one reel.
- Scrolling through the feed surfaces one topic after another within the chosen field.

---

## 3. Product Positioning & Boundaries — what this is and isn't

This is the single most important scoping decision made during planning, arrived at through a critique-and-response cycle (see §10 for the full reasoning trail).

**What it is:**
- A **recognition-readiness / priming tool** — brief exposure to a concept so that when it resurfaces later (an interview, a conversation, a real situation), the user isn't starting cold. This is what the Sabre interview story demonstrates.
- A **revision tool** for material the user has already loosely encountered once (e.g. from a long video), reformatted into its natural, separable chunks so it can be skimmed back through instead of re-watched in full.

**What it explicitly is not (in v1):**
- Not a tool for first-time deep learning of complex, multi-step, or nuanced material.
- Not claiming "subconscious learning" replaces active recall — passive re-exposure alone risks the *fluency illusion* (mistaking familiarity for retention). The app leans toward exposure/priming, which is a real and distinct mechanism from mastery.

**A standing risk that scope decisions don't remove:** Content trust matters *more* in a priming/revision tool than in long-form content, because the user often has no independent way to sanity-check a fact they only vaguely remember. This shaped several architecture and MVP decisions below (source links, trust labels).

---

## 4. Use Case Summary

| Use case | Description |
|---|---|
| **Breadth / priming** | Build peripheral awareness of a field you're not deep in, so unfamiliar terms/concepts aren't a total blank later (interviews, conversations). |
| **Revision** | Re-digest material already encountered once (e.g. broken down from a long video or course), in bite-sized, resurfaceable form. |
| **Explicitly out of scope (v1)** | Teaching complex, multi-step topics from zero; acting as a structured curriculum with prerequisites. |

---

## 5. Feature Scope

### 5.1 Build into the MVP itself
Chosen because they're either near-zero cost now (expensive to retrofit later), or load-bearing for the "revision tool" claim to be honest rather than aspirational:

- **Visible source link per card** — cards are grounded in scraped source material; storing/showing that source is the first, cheapest answer to the content-trust problem.
- **Bookmark / save to a personal revision pile** — trivial to build, directly expresses the "revision" half of the product.
- **Minimal recall prompt at the end of a card** (e.g. "tap to reveal: what does this do?") — converts passive viewing into active recall; without this, the revision claim is aspirational.
- **Content trust label** (e.g. "AI-generated" vs "sourced/verified") — one field in the data model, meaningful given the LLM-generation pipeline.
- **Log every card-view event, even with no UI for it yet** — an architecture decision, not a feature: everything later (spaced resurfacing, coverage dashboards, streaks) depends on having this history from day one. Cannot be reconstructed retroactively.
- **"Why this matters" one-liner per card** — near-free schema addition; generalizes the founder's own Sabre-interview insight (a fact sticks better tied to a reason it matters).

### 5.2 High priority — right after the core loop works
- User flagging for incorrect cards
- Direct search bar
- Request-a-topic input (helps cold-start niche fields)
- Confidence-based resurfacing / spaced-repetition scheduling (enabled by the view-log built in MVP)
- Multi-field feeds

### 5.3 Medium priority — legitimate v2, not urgent
- Depth toggle / explanation-style toggle (needs multiple content variants per topic — real cost)
- "More like this" branching (effectively the topic-sequencing/dependency model, deferred — see §5.5)
- Personal dashboard / coverage map
- "Before this moment" cram mode
- Feed generation from a pasted job description or syllabus (high narrative value — directly generalizes the founder's own origin story — but a distinct parsing pipeline, not a small add)
- Share a single card

### 5.4 Low priority / needs scale or expands scope
- Trending-within-field topics (meaningless without a real user base)
- TTS narration, auto-generated diagrams
- Home-screen widget / lock-screen glanceable card
- Offline packs, weekly recap, multi-language generation
- **Follow a curated feed from another user / community voting** — flagged specifically: this quietly turns the product from "personal tool" into "content platform with multi-user trust/moderation problems." A real pivot, not a toggle.

### 5.5 Explicitly deferred (architectural, not just feature) scope
- **Big/complex topics** (multi-step reasoning, real nuance) that don't reduce cleanly to one page — phase 2.
- **Topic sequencing / prerequisite-dependency model** — later stage; v1 is a flat, field-scoped feed, not a curriculum.
- **Meaning-disambiguation in topic matching** — see §6.4; added only if bad merges actually appear on real data.

### 5.6 A deliberate tension worth remembering
**Streaks / daily goals** sit in direct tension with the founder's own stated reason for building this — reducing dependence on Instagram-style engagement mechanics. If added later, this should be a deliberate decision, not a default inclusion just because it's a familiar pattern.

---

## 6. System Architecture (High-Level Design)

### 6.1 Design philosophy
- **Cache-then-generate:** always check for existing content before running the (expensive) generation pipeline.
- **Split services:** the Generation Pipeline (slow, agentic, LLM/scrape-heavy) and the Serving/Read path (fast, read-heavy) have different scaling and failure profiles, so they are architected as separate services from the start.
- **Common backend** serves both the mobile app and the web app identically.

### 6.2 Data model

- **Field** `{ id, name }` — what the user types in (e.g. "Java Collections").
- **Topic** `{ id, name, description }` — a discrete concept (e.g. "HashMap"). Independent of any single field.
- **Field_Topic** `{ field_id, topic_id }` — **junction table**, many-to-many. A topic can surface under multiple fields; this is the key structural decision that makes cross-field reuse possible (see §6.4).
- **Scroll** `{ id, topic_id, content, source_url, trust_label }` — one topic maps to **one or more** scrolls (1:N).
- **Account** `{ id, email, saved_scroll_ids[] }` — saved scrolls stored as a simple array of scroll IDs.

### 6.3 Core flow (cache-then-generate)

1. User submits a **field of interest**.
2. The **Candidate Topic Generator** (LLM agent) proposes a list of candidate topic names for that field.
3. Each candidate name is checked against the **Topic-Name Vector DB**.
   - **Match found →** reuse: add a `Field_Topic` link to the existing topic (no regeneration); fetch its existing scrolls; stream them to the client immediately.
   - **No match →** trigger the **Generation Pipeline** for that topic.
4. Generation Pipeline (async, per-topic):
   - **Web Scraping Agent(s)** and **LLM Data-Generation Agent** run to gather raw + generated material.
   - **Card Generation LLM** combines both into multiple draft one-page cards for the topic.
   - **Fact-Check Agent** verifies each draft card.
     - **Fail →** card deleted outright (no retry/re-queue in v1).
     - **Pass →** card persisted to the Relational DB, embedded into the Scroll-Content Vector DB, and **streamed to the client immediately** — the client does not wait for the full generation batch to complete. If the topic is new, its embedding is added to the Topic-Name Vector DB and the `Field_Topic` link is created.

### 6.4 Cross-field topic matching (partial-match mechanism)

**The problem this solves:** the same topic (e.g. "HashMap") can legitimately be requested under two different field names (e.g. "Java Utils" and "Java Collections"). A naive per-field cache would regenerate it needlessly.

**The mechanism:**
- Topic identity is decoupled from Field entirely (see `Field_Topic` junction table above) — a topic is never "owned" by the field that first produced it.
- When a new field's candidate topic list is generated, each candidate name is embedded and checked against the **Topic-Name Vector DB**.
- **Worked example:** Field A ("Java Utils") already has a "HashMap" topic with 3 scrolls. A user requests Field B ("Java Collections"). Candidate generation for Field B proposes "HashMap" again. The vector lookup finds a near-exact match against the existing topic → the full scrape→generate→fact-check pipeline is **skipped entirely**; a `Field_Topic` row links Field B to the *existing* topic ID; its 3 scrolls now appear under Java Collections too, at zero extra generation cost. Other candidates that don't match (e.g. "TreeSet") go through the full pipeline as new topics.

**A known risk, deliberately deferred:** name-embedding similarity is not the same as concept equivalence. Example: "Stack" as a candidate under a Web Development field (meaning *tech stack*) could sit close, embedding-wise, to an existing "Stack" topic under a DSA field (meaning *the data structure*) — same string, unrelated concepts. A fuller solution would use a **two-stage match**: coarse retrieval by name-embedding, followed by a disambiguation check (either a longer-description embedding comparison or an LLM call confirming genuine concept equivalence) before reuse is allowed.

**Decision for v1:** skip the disambiguation stage. Use **name-embedding similarity with a strict threshold only**. Accept some duplicate generation as the cost of never wrongly merging two different meanings (a bad merge silently corrupts content; a redundant topic is just easy waste). The disambiguation stage is added **only if bad merges actually show up on real data**, not preemptively.

### 6.5 Agents / pipeline steps — full specification

| # | Agent / Step | Type | Input | Output |
|---|---|---|---|---|
| 1 | **Candidate Topic Generator** | LLM Agent | Field name | List of candidate topic names for that field |
| 2 | **Web Scraping Agent(s)** | Non-LLM (scraper/parser) | Topic name | Raw scraped snippets + source URLs (grounding context — never served verbatim, avoiding republishing/copyright issues) |
| 3 | **LLM Data-Generation Agent** | LLM Agent | Topic name | Supplementary generated explanatory content, filling gaps scraping alone may miss |
| 4 | **Card Generation LLM** | LLM Agent | Scraped data + generated data | Multiple original, single-topic draft cards (scrolls) |
| 5 | **Fact-Check Agent** | LLM Agent | Draft card + source material | Pass / Fail verdict |

**Total: 5 pipeline steps — 4 LLM-based agents, 1 non-LLM scraper.**

### 6.6 Content verification / checking mechanism

The **Fact-Check Agent (step 5)** is the sole quality gate before a card can reach a user:
- Verifies each draft card against the source material gathered in steps 2 & 3.
- **Fail → deleted outright.** No retry or re-queue logic in v1.
- **Pass → persisted + streamed immediately**, without waiting for the rest of the generation batch.

### 6.7 Data stores — full contents

| Store | Technology role | Contents | Purpose |
|---|---|---|---|
| **Relational DB** | Core system of record | `Field`, `Topic`, `Field_Topic` (junction), `Scroll`, `Account` | Primary structured data |
| **Topic-Name Vector DB** | Vector DB #1 | `{ topic_id, name+description embedding }` | Dedup/reuse check at generation time (strict-threshold match, v1) |
| **Scroll-Content Vector DB** | Vector DB #2 | `{ scroll_id, topic_id, content embedding }` | Semantic search; future "more like this" / recommendations |
| **User-View DB** | v1: table in the Relational DB | `{ user_id, scroll_id, viewed_at }` | Impression log; foundation for future resurfacing/spaced-repetition (not built yet) |
| **Local Storage** | Client-side (mobile + web) | Cached `saved_scroll_ids` (+ possibly offline content) | Offline/instant access; syncs with `Account.saved_scroll_ids` |

### 6.8 Service split

- **Serving / Read Service** — Feed Orchestrator, Candidate Topic Generator (LLM agent), Account/Saves/View Logger. Fast, read-heavy.
- **Generation Pipeline Service** — the full agentic pipeline (§6.5). Slow, async, triggered only on a cache miss.

---

## 7. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Mobile app | **React Native (Expo)** *— proposed, not explicitly confirmed in discussion; inferred from resume experience (PriceCoderApp, Income Tax Mapper, GoRide, etc.). Flag for confirmation.* | Reuses proven experience across multiple prior projects |
| Web app | **Next.js (React)** *— same caveat as above, proposed not confirmed* | Consistent with resume-listed skills |
| Serving/Read Service | **Node.js + Express + TypeScript** | Matches heavy existing experience (4+ prior projects); lower risk for the "ship fast" half of the split |
| Generation Pipeline Service | **Python + FastAPI** | Async-native — matters since scraping + multiple LLM calls + fact-checking benefit from concurrency; natural fit for the AI-heavy pipeline |
| Agent orchestration | **LangGraph** | Direct reuse of prior experience (TreasuryPulse project on resume is a LangGraph multi-agent pipeline); its explicit graph/branching model fits the fact-check pass/fail flow |
| LLM provider layer | **LiteLLM**, self-hosted as its own proxy/gateway service | Both backend services call one OpenAI-compatible endpoint; provider/model is a config change, not code — satisfies the "swap anytime" requirement; built-in fallback/retry across providers; default set to **Gemini** |
| Web scraping | **Playwright** | Dual-purpose: same tool also used for E2E testing — one library, two jobs |
| Relational DB | **PostgreSQL** | Industry-standard; houses Field/Topic/Field_Topic/Scroll/Account |
| Vector DBs (both) | **Qdrant**, self-hosted via Docker | Fits the "run it ourselves" Docker/K8s story better than a managed-only SaaS option; open-source, no added recurring cost; solid Python + Node clients |
| View-tracking | PostgreSQL table (v1); **Redis** flagged as an optional future caching layer (not the system of record) | Simplicity first; Redis is an existing claimed resume skill if added later |
| Auth | **Firebase Auth** | Already implemented once (GoRide project) — lower risk, ships faster; hand-rolled JWT/RBAC flagged as a possible phase-2 upgrade for deeper interview talking points |
| Testing | **Selenium + Playwright** — unit + integration testing | User's explicit requirement |
| Deployment | **Docker + Kubernetes on GCP (GKE)**, not AWS | GKE provides a standing $74.40/month free-tier credit covering one zonal cluster's control-plane management fee, vs. AWS EKS's flat $0.10/hr (~$73/mo) fee with no free-tier equivalent — meaningful for a continuously-running personal project. Also deliberately adds a new cloud platform to the founder's portfolio alongside existing deep AWS experience (CVMS project). Local cluster (kind/minikube) remains a zero-cost fallback using identical manifests. |
| CI/CD | **GitHub Actions** | Free; natural home for the build/test/deploy pipeline (Docker builds, Playwright/Selenium runs, K8s deploy) |
| Monitoring | **Prometheus + Grafana** | User's explicit requirement |

---

## 8. Cross-Cutting Concerns

- **Testing:** unit + integration tests; Selenium and Playwright for browser/E2E coverage.
- **Deployment:** containerized services (Docker), orchestrated via Kubernetes — matching the split-service design in §6.8.
- **Monitoring & maintenance:** Prometheus for metrics collection, Grafana for dashboards/alerting.

---

## 9. Open Items / Not Yet Decided

- **Frontend framework** — React Native (Expo) + Next.js proposed based on resume history, but not explicitly discussed/confirmed in the planning conversation. Needs confirmation.
- **Final LLM provider** — intentionally left open by design; Gemini is the assumed default, swappable via the LiteLLM gateway.
- **Meaning-disambiguation matching** (§6.4) — only added if bad merges are actually observed on real data.
- **Big/complex topic handling** (§5.5) — phase 2.
- **Topic sequencing/dependency model** (§5.5) — later stage.
- **All ranked features beyond MVP** (§5.2–§5.4) — sequenced post-MVP.
- **Detailed data model / API design** — the explicitly agreed next step after this document.

---

## 10. Project Development Process — Step by Step

This section documents *how* the project reached its current state, not just *what* was decided — the reasoning trail from initial idea to current scope.

1. **Origin.** The idea began from a real personal experience: a reel about "man in the loop / man on the loop," seen by chance before a Sabre interview, directly answered a question asked in that same interview.

2. **Initial idea formulation.** The founder proposed an Instagram-Reels-style learning app: pick a field, get a feed of one-page topic cards sourced by web-scraping, framed around the idea that short-form scrolling could teach people "subconsciously."

3. **Idea refinement (first pass).** Asked for a refined, sharpened articulation of the idea in plain language before any critique — clarifying the problem, the core mechanic, the psychological rationale, and what the product fundamentally is.

4. **Critique requested.** Asked directly for flaws and honest opinion, not validation. Six issues were raised:
   - Scraping-and-serving content verbatim is a real copyright/republishing risk.
   - The "subconscious learning" claim is closer to *exposure* than *learning* — risk of the fluency illusion (mistaking familiarity for retention).
   - The one-page-per-topic assumption breaks down for topics with real nuance or multi-step reasoning.
   - No topic sequencing/dependency model — risk of showing advanced concepts before prerequisites.
   - The "reels are addictive, so this will be too" comparison likely overstates how much of reels' addictiveness (variable reward, social proof, near-infinite curated supply) actually transfers to a feed of uniform factual cards.
   - The category isn't new — similar microlearning products already exist (Blinkist, Brilliant, edu-TikTok); value has to come from execution, not novelty.

5. **Response to critique, point by point.** The founder addressed each flaw directly: agents/LLM work deliberately deferred; the Sabre-interview story defended the exposure/priming mechanism specifically (distinguishing it from the fluency-illusion concern); big/complex topics pushed to phase 2; sequencing deferred to a later stage; the system-design-video struggle offered as independent evidence for the *revision* use case specifically; and personal motivation (reducing Instagram dependency) offered as the reason to continue.

6. **Updated, honest opinion given.** Rather than restate the original critique, the positioning was revised: not "reels will teach people subconsciously" (rejected), but "a low-friction way to stay primed on the periphery of a field, and to re-digest things already half-learned" (accepted as defensible). Content-trust risk was flagged as *unchanged* by the narrower scope — it matters more, not less, in a priming/revision context where users can't easily self-check.

7. **Idea rewritten** to reflect this narrower, more honest positioning — explicitly stating what the app is and is not, ahead of any further feature work.

8. **Feature brainstorm.** A wide, unscoped list of possible future features was generated across categories: personalization, retention mechanics, format variety, trust/sourcing, utility, progress/motivation, social layer, and input variety — deliberately without ranking, to separate ideation from prioritization.

9. **Feature ranking.** The brainstormed list was then ranked by *need × cost-now-vs-later*, not just appeal: identifying which items were near-zero-cost to build immediately but expensive to retrofit later (source links, view-logging, bookmarks, recall prompts, trust labels), separating those from genuine v2/v3 material, and explicitly flagging one internal tension — streaks/daily-goal mechanics conflict with the founder's own anti-Instagram-dependency motivation for building the app at all.

10. **Architecture discussion opened.** The founder proposed a high-level design: common backend, vector-DB-backed cache-then-generate flow, an agentic generation pipeline (scraping + LLM generation + fact-checking), two vector DBs, local + server-side saves, a view-tracking DB, accounts, and a testing/deployment/monitoring stack — explicitly asking for refinement rather than tech-stack selection at that stage.

11. **Clarifying questions asked** on the genuinely underspecified parts: whether Topic and Scroll were the same concept; what each vector DB should actually store; whether cache-reuse was meant to work per-field or per-topic (surfacing the cross-field duplication problem); how fact-check failures and generation latency should be handled; how local saves related to server-side view tracking; and whether the backend should be one service or split.

12. **Answers given,** resolving each: one topic can map to multiple scrolls; the two-vector-DB split was confirmed; a request was made to explain the cross-field partial-match scenario in depth; failed cards are deleted outright and passing cards stream in as they clear fact-check; saves sync server-side as an array of scroll IDs; and the backend should be split into separate services.

13. **The cross-field matching mechanism explained in depth** (§6.4): decoupling Topic identity from Field via a many-to-many junction table, a worked example (HashMap reused across "Java Utils" and "Java Collections"), and a flagged polysemy risk (e.g. "Stack" meaning different things in different fields) — along with a simpler, strict-threshold-only v1 alternative that defers full disambiguation.

14. **Simplified matching approach chosen** — strict-threshold-only for v1, with disambiguation added later only if real bad merges appear, prioritizing shipping a working product over pre-solving a problem that may not materialize.

15. **Architecture visualized.** A detailed diagram was produced reflecting every decision made to that point — all services, all five pipeline agents (labeled LLM vs. non-LLM), all data stores with their actual field contents, the match/no-match branch, and the cross-cutting testing/deployment/monitoring layer.

16. **Tech stack selection opened.** Three high-leverage questions were asked first (backend language strategy, LLM provider, deployment target), since these decisions would shape everything downstream.

17. **Answers given:** best language per service (not one unified language); LLM provider deliberately left open, with a required fallback mechanism and swappability, defaulting to Gemini; deployment target left to be recommended.

18. **Full stack recommended,** grounded in a live pricing check for the deployment decision (GKE vs. EKS), and otherwise built around a mix of the founder's proven resume experience (Express, FastAPI-adjacent Python/LLM work, LangGraph, Firebase Auth) for the lower-risk parts of the stack, and deliberately new tools (Qdrant, LiteLLM, GCP) where they added genuine capability or portfolio breadth without threatening the "ship a working product first" priority.

19. **Stack accepted**, and this document was requested as the consolidated, final planning context for beginning implementation.
