/**
 * Lexical inventories used by the stylometric critic.
 * These are deliberately broad; the bands in the voice specs decide what is
 * acceptable, not the lists themselves.
 */

/** Epistemic residue: だろう / かもしれない / ようだ / なんとなく, rendered. */
export const HEDGES = [
  "perhaps", "probably", "maybe", "somehow", "somewhat", "rather", "quite",
  "it seemed", "seemed", "it seems", "seems", "it might", "might have",
  "I wonder", "wondered", "wonder", "for some reason", "for no particular reason",
  "after all", "at any rate", "in any case", "as if", "as though",
  "apparently", "evidently", "no doubt", "surely", "I suppose", "suppose",
  "it appeared", "appeared to", "a little", "a bit", "kind of", "sort of",
  "or something", "I imagine", "no particular", "in a way",
];

/** Perception and cognition verbs that English craft advice tells you to cut. */
export const FILTER_VERBS = [
  "saw", "see", "seen", "watching", "watched", "looked", "look",
  "heard", "hear", "listened", "listening",
  "felt", "feel", "feeling",
  "noticed", "notice", "realized", "realised", "recognized",
  "seemed", "seems", "appeared", "appears",
  "smelled", "smelt", "tasted", "sensed",
  "thought", "knew", "wondered", "remembered",
];

/** Nominalisations. The register prefers concrete nouns; abstractions arrive late and flat. */
export const ABSTRACT_SUFFIXES = [
  "tion", "sion", "ment", "ness", "ity", "ance", "ence", "ism", "acy", "ship",
];

export const CONCRETE_HINTS = [
  "cup", "glass", "cigarette", "train", "window", "hand", "door", "coat",
  "tea", "rice", "street", "snow", "rain", "light", "stair", "towel",
];

/** Said-bookisms and register-breaking tags. */
export const EXOTIC_TAGS = [
  "exclaimed", "declared", "intoned", "mused", "chuckled", "snarled",
  "breathed", "hissed", "growled", "purred", "barked", "interjected",
  "retorted", "opined", "articulated", "enunciated", "countered",
];

/** Phrases that almost never survive translation from Japanese, and that models reach for by default. */
export const REGISTER_BREAKERS: Array<{ phrase: string; why: string }> = [
  { phrase: "a wave of", why: "abstract emotional surge" },
  { phrase: "the weight of", why: "abstract emotional surge" },
  { phrase: "couldn't help but", why: "English idiom" },
  { phrase: "could not help but", why: "English idiom" },
  { phrase: "couldn't bring herself", why: "English idiom" },
  { phrase: "couldn't bring himself", why: "English idiom" },
  { phrase: "could not bring herself", why: "English idiom" },
  { phrase: "could not bring himself", why: "English idiom" },
  { phrase: "washed over", why: "abstract emotional surge" },
  { phrase: "heart pounding", why: "interiority by cliché" },
  { phrase: "a chill ran down", why: "thriller gesture" },
  { phrase: "chill ran down", why: "thriller gesture" },
  { phrase: "let out a breath", why: "thriller gesture" },
  { phrase: "exhaled slowly", why: "thriller gesture" },
  { phrase: "heart pounded", why: "interiority by cliché" },
  { phrase: "heart hammered", why: "interiority by cliché" },
  { phrase: "breath hitched", why: "interiority by cliché" },
  { phrase: "made her way", why: "English idiom" },
  { phrase: "made his way", why: "English idiom" },
  { phrase: "in that moment", why: "rhetorical framing" },
  { phrase: "all at once", why: "rhetorical framing" },
  { phrase: "before she knew it", why: "English idiom" },
  { phrase: "before he knew it", why: "English idiom" },
  { phrase: "a ghost of a smile", why: "literary cliché" },
  { phrase: "the air was thick", why: "atmospheric cliché" },
  { phrase: "eyes locked", why: "cinematic gesture" },
  { phrase: "voice barely above a whisper", why: "cinematic gesture" },
  { phrase: "a mix of", why: "abstract summary" },
  { phrase: "couldn't shake the feeling", why: "English idiom" },
  { phrase: "a pang of", why: "abstract emotional surge" },
  { phrase: "a flicker of", why: "abstract emotional surge" },
  { phrase: "shivers down", why: "thriller gesture" },
  { phrase: "choked back", why: "thriller gesture" },
  { phrase: "time seemed to slow", why: "cinematic cliché" },
  { phrase: "the world tilted", why: "cinematic cliché" },
  { phrase: "some part of her", why: "explanatory interiority" },
  { phrase: "some part of him", why: "explanatory interiority" },
  { phrase: "she found herself", why: "explanatory interiority" },
  { phrase: "he found himself", why: "explanatory interiority" },
  { phrase: "little did", why: "narrator intrusion" },
  { phrase: "unbeknownst", why: "narrator intrusion" },
  { phrase: "as if on cue", why: "cinematic cliché" },
  { phrase: "a beat passed", why: "screenplay residue" },
  { phrase: "the silence stretched", why: "atmospheric cliché" },
];

export const PRONOUNS_THIRD = [
  "he", "she", "they", "him", "her", "them", "his", "hers", "their",
  "theirs", "himself", "herself", "themselves",
];

export const STOPWORD_NAMES = new Set([
  "The", "A", "An", "And", "But", "He", "She", "They", "It", "I", "We",
  "You", "His", "Her", "Their", "Its", "My", "Our", "Your", "There",
  "Then", "When", "After", "Before", "For", "So", "If", "As", "At",
  "On", "In", "Of", "To", "That", "This", "What", "Who", "Why", "How",
  "Chapter", "Part", "One", "Two", "Three", "Yes", "No", "Not", "Now",
  "Some", "Nothing", "Everything", "Something", "Nobody", "Everyone",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  "Sunday", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

export const TIME_ANCHORS = [
  "the next morning", "the following morning", "that night", "that evening",
  "the next day", "in the morning", "in the afternoon", "in the evening",
  "at night", "for a while", "for a moment", "after a time", "later",
  "two days later", "a week later", "at three", "at four", "at five",
  "at six", "at seven", "at eight", "at nine", "at ten", "at eleven",
  "at noon", "at midnight", "before dawn", "after dark", "on Sunday",
];
