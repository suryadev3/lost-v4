const { scoreMatch, findMatches } = require("./utils/matching");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exitCode = 1;
  } else {
    console.log("PASS:", message);
  }
}

// Scenario 1: Genuinely the same item, described by two different people
const lost1 = {
  title: "Black Wildcraft Backpack",
  description: "Lost my black backpack near the library, has a water bottle inside",
  category: "Bag",
  location: "Library",
};
const found1 = {
  title: "Black backpack found",
  description: "Found a black bag near the library with a water bottle in the side pocket",
  category: "Bag",
  location: "Library, ground floor",
};
const score1 = scoreMatch(lost1, found1);
console.log("Scenario 1 (should match) score:", score1);
assert(score1 >= 40, "Genuinely matching items should score at least 40");

// Scenario 2: Completely unrelated items
const lost2 = {
  title: "Silver wristwatch",
  description: "Lost a silver Titan watch near the canteen",
  category: "Accessories",
  location: "Canteen",
};
const found2 = {
  title: "Blue umbrella",
  description: "Found a blue umbrella left in classroom 204",
  category: "Other",
  location: "Classroom 204",
};
const score2 = scoreMatch(lost2, found2);
console.log("Scenario 2 (should NOT match) score:", score2);
assert(score2 <= 25, "Unrelated items should score low");

// Scenario 3: Same category but different item (edge case - shouldn't over-match on category alone)
const lost3 = {
  title: "Red water bottle",
  description: "Lost my red Milton bottle in the workshop",
  category: "Other",
  location: "Workshop",
};
const found3 = {
  title: "Blue notebook",
  description: "Found a blue notebook in the workshop area",
  category: "Other",
  location: "Workshop",
};
const score3 = scoreMatch(lost3, found3);
console.log("Scenario 3 (same category, different item) score:", score3);
assert(score3 < score1, "Same-category-different-item should score lower than a genuine match");

// Scenario 4: findMatches filters and sorts correctly
const candidates = [found1, found2, found3];
const matches = findMatches(lost1, candidates, 30);
console.log("Scenario 4 - matches found:", matches.map((m) => ({ title: m.report.title, score: m.score })));
assert(matches.length >= 1, "findMatches should return at least the genuine match");
assert(matches[0].report.title === found1.title, "Best match should be ranked first");

// Scenario 5: empty/missing fields don't crash the scorer
const emptyScore = scoreMatch({ title: "", description: "", category: "", location: "" }, found1);
console.log("Scenario 5 (empty fields) score:", emptyScore);
assert(emptyScore === 0, "Empty report should score 0, not crash");

console.log("\nAll matching tests completed.");
