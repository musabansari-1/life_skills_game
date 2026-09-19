/**
 * Spoken-number parsing for Indian rupee amounts, used by deterministic
 * speech-inference in quests. Handles "9.7 lakh", "nine seven", "nine point
 * seven lakh", "ten lakh", "fifty to sixty thousand", "₹9,70,000", "40K".
 * Conservative: returns only amounts with an explicit or strongly implied unit.
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100,
};

export interface RupeeAmount {
  amount: number; // in rupees
  unit: "lakh" | "thousand" | "raw";
  /** Character index in the normalised source text, for ordering. */
  index: number;
  /** The matched text (normalised: lowercase, no commas). Lets callers rewrite the figure in place. */
  raw: string;
}

/** Convert a run of number words ("fifty five", "nine point seven", "nine seven") to a number. */
export function wordsToNumber(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let sawDecimal = false;
  let decimalDigits = "";
  let any = false;
  for (const w of words) {
    if (w === "point" || w === "and") {
      if (w === "point") sawDecimal = true;
      continue;
    }
    const v = ONES[w];
    if (v === undefined) return null;
    any = true;
    if (sawDecimal) {
      decimalDigits += String(v);
      continue;
    }
    if (v === 100) current = (current || 1) * 100;
    else if (v < 10 && current >= 10 && current % 10 === 0 && current < 100) current += v; // "twenty five"
    else if (v < 10 && current > 0 && current < 10) current = current * 10 + v; // "nine seven" → 97 (spoken digits)
    else current += v;
  }
  if (!any) return null;
  total = current;
  if (decimalDigits) total = parseFloat(`${total}.${decimalDigits}`);
  return total;
}

const NUMBER_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point|and)";

/** Text normalisation shared by amount extraction and callers that need matching indices. */
export function normalizeMoneyText(text: string): string {
  return text.toLowerCase().replace(/₹/g, " rs ").replace(/,/g, "");
}

export function extractRupeeAmounts(text: string, opts: { salaryContext?: boolean } = {}): RupeeAmount[] {
  const t = normalizeMoneyText(text);
  const out: RupeeAmount[] = [];

  // Numeric with unit: "9.7 lakh", "9.7l", "40k", "40 thousand"
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|l\b|k\b|thousand)/g)) {
    const n = parseFloat(m[1]);
    const u = m[2];
    if (u.startsWith("l")) out.push({ amount: Math.round(n * 100000), unit: "lakh", index: m.index ?? 0, raw: m[0] });
    else out.push({ amount: Math.round(n * 1000), unit: "thousand", index: m.index ?? 0, raw: m[0] });
  }
  // Raw rupee figures: "rs 970000", "970000" (6-7 digits)
  for (const m of t.matchAll(/(?:rs\s*)?\b(\d{5,8})\b/g)) {
    out.push({ amount: parseInt(m[1], 10), unit: "raw", index: m.index ?? 0, raw: m[1] });
  }
  // Spoken words with unit: "nine point seven lakh", "ten lakh", "fifty thousand", "fifty to sixty thousand"
  const wordRe = new RegExp(`((?:${NUMBER_WORD}\\s+)*${NUMBER_WORD})(?:\\s+(?:to|or)\\s+((?:${NUMBER_WORD}\\s+)*${NUMBER_WORD}))?\\s+(lakhs?|lacs?|thousand)`, "g");
  for (const m of t.matchAll(wordRe)) {
    const unit = m[3].startsWith("l") ? "lakh" : "thousand";
    const mult = unit === "lakh" ? 100000 : 1000;
    for (const g of [m[1], m[2]]) {
      if (!g) continue;
      const n = wordsToNumber(g.trim().split(/\s+/));
      if (n !== null && n > 0) out.push({ amount: Math.round(n * mult), unit, index: m.index ?? 0, raw: `${g.trim()} ${m[3]}` });
    }
  }
  // Unitless salary figures ("I can do nine point two five", "nine seven base", "9.25").
  // Only read as lakh when the caller says we're talking salary, or the text says so.
  const salary = opts.salaryContext || /\b(base|lakh|lakhs|salary|offer|band|package|ctc)\b/.test(t);
  const unitless: { n: number; index: number; raw: string }[] = [];
  const DIGIT = "(?:zero|one|two|three|four|five|six|seven|eight|nine)";
  const INT = "(?:five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
  const notUnit = "(?!\\s*(?:lakh|lac|thousand|percent|%|k\\b|years?|months?|x\\b))";
  // "nine point two five" → 9.25
  for (const m of t.matchAll(new RegExp(`\\b(${INT})\\s+point((?:\\s+${DIGIT})+)\\b${notUnit}`, "g"))) {
    const n = wordsToNumber([m[1], "point", ...m[2].trim().split(/\s+/)]);
    if (n !== null) unitless.push({ n, index: m.index ?? 0, raw: m[0] });
  }
  // "nine seven" → 9.7 (spoken digits, no "point")
  for (const m of t.matchAll(new RegExp(`\\b(six|seven|eight|nine)\\s+(${DIGIT})\\b(?!\\s+point)${notUnit}`, "g"))) {
    const raw = wordsToNumber([m[1], m[2]]);
    if (raw !== null) unitless.push({ n: raw / 10, index: m.index ?? 0, raw: m[0] });
  }
  // "9.25" → 9.25
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2}\\.\\d{1,2})\\b${notUnit}`, "g"))) {
    unitless.push({ n: parseFloat(m[1]), index: m.index ?? 0, raw: m[0] });
  }
  if (salary) for (const u of unitless) if (u.n >= 5 && u.n <= 30) out.push({ amount: Math.round(u.n * 100000), unit: "lakh", index: u.index, raw: u.raw });
  // Sort and de-dupe by (amount)
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.index - b.index)
    .filter((a) => {
      const k = `${a.amount}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

const SMALL_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS_WORDS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0..99 as words ("forty five"). */
export function integerWords(n: number): string {
  n = Math.round(n);
  if (n < 20) return SMALL_WORDS[n];
  if (n < 100) return `${TENS_WORDS[Math.floor(n / 10)]}${n % 10 ? ` ${SMALL_WORDS[n % 10]}` : ""}`;
  return String(n);
}

/**
 * A rupee amount the way a person says it: 920000 → "nine point two lakh",
 * 925000 → "nine point two five lakh", 1000000 → "ten lakh", 60000 → "sixty thousand".
 */
export function spokenRupees(amount: number): string {
  if (amount >= 100000) {
    const lakh = amount / 100000;
    const whole = Math.floor(lakh);
    const dec = Math.round((lakh - whole) * 100);
    if (dec === 0) return `${integerWords(whole)} lakh`;
    const digits = dec % 10 === 0 ? String(dec / 10) : String(dec).padStart(2, "0");
    return `${integerWords(whole)} point ${[...digits].map((d) => SMALL_WORDS[Number(d)]).join(" ")} lakh`;
  }
  if (amount >= 1000 && amount % 1000 === 0) return `${integerWords(amount / 1000)} thousand`;
  return String(amount);
}

/**
 * Re-express `amount` in the same style as an existing match (`raw` from
 * extractRupeeAmounts): digits stay digits ("9.5 lakh" → "9.2 lakh", "950000" → "920000"),
 * words stay words ("nine point five" → "nine point two"), and a missing unit stays missing.
 */
export function formatAmountLike(amount: number, raw: string): string {
  const unitMatch = raw.match(/(\s*)(lakhs?|lacs?|l|k|thousand)$/);
  const unit = unitMatch?.[2] ?? "";
  if (/\d/.test(raw)) {
    if (/^\d{5,8}$/.test(raw)) return String(Math.round(amount));
    const isLakh = amount >= 100000 && !/^(k|thousand)$/.test(unit);
    const value = isLakh ? amount / 100000 : amount / 1000;
    const num = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
    return unit ? `${num}${unitMatch?.[1] ?? ""}${unit}` : num;
  }
  const spoken = spokenRupees(amount);
  // Keep the unit when dropping it would leave a bare whole number ("nine"), which no
  // listener (or parser) reads as a salary; "nine point two" alone is fine.
  if (unit || !/\bpoint\b/.test(spoken)) return spoken;
  return spoken.replace(/\s+(lakh|thousand)$/, "");
}
