// ---------------------------------------------------------------------------
// AI Matching Engine
// ---------------------------------------------------------------------------
// Compares a lost report against found reports (or vice versa) and scores
// how likely they describe the same item, using word-overlap similarity
// (a Jaccard-style comparison) across title, description, and location,
// plus a bonus for matching category. No external ML library required -
// this keeps the app dependency-light and the logic fully explainable.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "is", "was", "were", "in", "on", "at", "of", "to", "and",
  "or", "with", "near", "it", "my", "i", "found", "lost", "for", "this",
  "that", "has", "have", "had", "be", "been", "there", "some", "very",
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function jaccardSimilarity(textA, textB) {
  const setA = new Set(tokenize(textA));
  const setB = new Set(tokenize(textB));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionCount = 0;
  for (const word of setA) {
    if (setB.has(word)) intersectionCount++;
  }
  const unionCount = new Set([...setA, ...setB]).size;
  return intersectionCount / unionCount;
}

/**
 * Scores how likely two reports (one lost, one found) describe the same item.
 * Returns an integer percentage from 0 to 100.
 */
function scoreMatch(reportA, reportB) {
  const titleScore = jaccardSimilarity(reportA.title, reportB.title);
  const descScore = jaccardSimilarity(reportA.description, reportB.description);
  const locationScore = jaccardSimilarity(reportA.location, reportB.location);
  const categoryBonus =
    reportA.category && reportB.category &&
    reportA.category.toLowerCase() === reportB.category.toLowerCase()
      ? 0.2
      : 0;

  const combined = titleScore * 0.45 + descScore * 0.35 + locationScore * 0.15 + categoryBonus;
  return Math.round(Math.min(1, combined) * 100);
}

/**
 * Given a target report and a list of candidate reports (opposite type),
 * returns candidates scoring at or above minScore, sorted best-first.
 */
function findMatches(targetReport, candidateReports, minScore = 30) {
  return candidateReports
    .map((candidate) => ({ report: candidate, score: scoreMatch(targetReport, candidate) }))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

module.exports = { scoreMatch, findMatches, tokenize, jaccardSimilarity };
