/**
 * The field set the similarity threshold is calibrated against.
 *
 * Chosen, not sampled. It has to contain the failure the threshold exists to
 * prevent, so it deliberately mixes three kinds of field:
 *
 *   overlap   - genuinely share topics; those pairs must sit ABOVE the threshold
 *   collision - produce the same NAME for different concepts ("Stack" as a data
 *               structure vs "Stack" as a set of technologies); these must sit
 *               BELOW it, and they are the constraint that sets the number
 *   control   - share nothing; nothing here should match anything
 */
export interface CalibrationField {
  name: string;
  kind: "overlap" | "collision" | "control";
  note: string;
}

export const calibrationFields: CalibrationField[] = [
  { name: "Java Utils", kind: "overlap", note: "should share HashMap etc. with Java Collections" },
  { name: "Java Collections", kind: "overlap", note: "the same concepts under a different field name" },
  { name: "Data Structures", kind: "overlap", note: "language-agnostic version of the same concepts" },
  {
    name: "Data Structures and Algorithms",
    kind: "collision",
    note: "yields Stack, Queue, Heap as data structures",
  },
  {
    name: "Web Development",
    kind: "collision",
    note: "yields Stack meaning a set of technologies; must NOT merge with the data structure",
  },
  {
    name: "Frontend Frameworks",
    kind: "collision",
    note: "another source of overloaded words like State, Router, Hook",
  },
  { name: "Behavioural Economics", kind: "control", note: "shares nothing with the others" },
  { name: "Marine Biology", kind: "control", note: "shares nothing with the others" },
];
