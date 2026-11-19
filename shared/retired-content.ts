/** Sections devShark no longer teaches on their own, and where their material
 * went instead.
 *
 * Three of them, retired for the same reason from three different directions:
 * each was a place where the *format* had become the subject. A Testing path
 * that spent six levels defining what a test is; an Abbreviations path that
 * asked what letters stand for; a Code Snippets path that collected language
 * tricks with nothing tying them to what the learner was building. In every
 * case the useful material belongs inside the topic it actually verifies, and
 * the standalone path was the part to remove.
 *
 * Retirement is not deletion. Three things survive it, deliberately:
 *
 *   1. **History.** A learner who passed Testing level 7 still passed it. The
 *      category stays in the subject catalogue, so old attempts, old progress
 *      and old receipts still resolve to devShark exactly as before. Only the
 *      *topic* is gone, which is what removes it from the map and the API.
 *   2. **Old links.** A bookmark to a retired topic explains where the material
 *      went and offers the destination, rather than 404ing or silently
 *      redirecting somewhere the learner did not ask for.
 *   3. **Prerequisites.** Nothing that used to depend on a retired topic is
 *      left pointing at it — see `shared/progression.ts`, where the plans name
 *      the destinations instead.
 *
 * What does not survive is delivery: nothing here may be served as a level, a
 * checkpoint, a practice pool or a recommendation. */

export type RetirementReason =
  /** The material was redistributed into the topics it verifies. */
  | 'redistributed'
  /** The material became contextual help rather than a subject. */
  | 'contextual'
  /** The material became a question format used across topics. */
  | 'integrated';

export interface RetiredSection {
  /** The topic id as it was. */
  id: string;
  reason: RetirementReason;
  /** Where a learner who followed an old link should be sent. */
  destinationTopic: string;
  /** The issue that recorded the decision, for anyone reading this later. */
  decision: string;
}

const RETIRED_TOPICS: Record<string, RetiredSection> = {
  testing: {
    id: 'testing',
    reason: 'redistributed',
    // Foundations became General levels 16-19; the applied material lives in
    // the topics whose behaviour it verifies.
    destinationTopic: 'general',
    decision: '#179',
  },
  abbreviations: {
    id: 'abbreviations',
    reason: 'contextual',
    // An abbreviation is explained where it appears, not memorised in advance.
    destinationTopic: 'general',
    decision: '#177',
  },
  'code-snippets': {
    id: 'code-snippets',
    reason: 'integrated',
    // Reading code became a question format available to every topic.
    destinationTopic: 'javascript',
    decision: '#178',
  },
};

export const isRetiredTopic = (topic: string): boolean =>
  Object.prototype.hasOwnProperty.call(RETIRED_TOPICS, topic);

export const retirementOf = (topic: string): RetiredSection | undefined => RETIRED_TOPICS[topic];

/** Retired topics still own their old questions for history and for scope
 * checks. This is the list the subject catalogue keeps as categories and the
 * roadmap no longer offers as topics. */
export const RETIRED_TOPIC_IDS: readonly string[] = Object.keys(RETIRED_TOPICS);
