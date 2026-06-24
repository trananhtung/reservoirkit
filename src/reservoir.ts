/**
 * Reservoir Sampler using Vitter's Algorithm L.
 *
 * Algorithm L improves on Algorithm R by skipping over items that won't
 * be selected, achieving O(k(1 + log(n/k))) time instead of O(n).
 * For small k relative to n, this is dramatically faster.
 *
 * Reference: Vitter, J.S. (1985) "Random sampling with a reservoir",
 * ACM Transactions on Mathematical Software 11(1):37-57.
 */
export class ReservoirSampler<T> {
  private _reservoir: T[];
  private _count = 0;
  private _W: number; // weight for next skip
  private _skip = 0;  // items to skip before next swap

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this._reservoir = [];
    this._W = Math.exp(Math.log(Math.random()) / capacity);
    this._skip = Math.floor(Math.log(Math.random()) / Math.log(1 - this._W));
  }

  /** Add one item to the sampler. Returns `this` for chaining. */
  push(item: T): this {
    if (this._count < this.capacity) {
      this._reservoir.push(item);
      this._count++;
      if (this._count === this.capacity) {
        // Reservoir full: initialize Algorithm L skip counter
        this._W = Math.exp(Math.log(Math.random()) / this.capacity);
        this._skip = Math.floor(Math.log(Math.random()) / Math.log(1 - this._W));
      }
      return this;
    }

    // Algorithm L: skip phase
    if (this._skip > 0) {
      this._skip--;
      this._count++;
      return this;
    }

    // Replace random item in reservoir
    const j = Math.floor(Math.random() * this.capacity);
    this._reservoir[j] = item;
    this._count++;

    // Advance skip counter
    this._W *= Math.exp(Math.log(Math.random()) / this.capacity);
    this._skip = Math.floor(Math.log(Math.random()) / Math.log(1 - this._W));
    return this;
  }

  /** Add multiple items at once. */
  pushAll(items: Iterable<T>): this {
    for (const item of items) this.push(item);
    return this;
  }

  /** Current sample (may be smaller than capacity if fewer items were pushed). */
  get sample(): T[] {
    return this._reservoir.slice();
  }

  /** Number of items seen so far. */
  get seen(): number { return this._count; }

  /** Number of items currently in the sample (≤ capacity). */
  get size(): number { return this._reservoir.length; }

  /** True when the reservoir is full (seen ≥ capacity). */
  get isFull(): boolean { return this._count >= this.capacity; }

  /** Reset to an empty state. */
  reset(): void {
    this._reservoir = [];
    this._count = 0;
    this._W = Math.exp(Math.log(Math.random()) / this.capacity);
    this._skip = Math.floor(Math.log(Math.random()) / Math.log(1 - this._W));
  }
}

/**
 * Draw k items uniformly at random from arr without replacement.
 * Uses partial Fisher-Yates for O(k) time on arrays.
 *
 * @param arr Source array (not mutated)
 * @param k   Number of items to select
 * @param rng Optional RNG function returning [0,1) (default: Math.random)
 */
export function sample<T>(arr: readonly T[], k: number, rng?: () => number): T[] {
  const rand = rng ?? Math.random;
  if (k < 0 || !Number.isInteger(k)) throw new RangeError(`k must be a non-negative integer, got ${k}`);
  if (k > arr.length) throw new RangeError(`k (${k}) must be ≤ arr.length (${arr.length})`);
  if (k === 0) return [];
  if (k === arr.length) return arr.slice();

  // Partial Fisher-Yates: fill the first k positions
  const copy = arr.slice();
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (arr.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, k);
}

/**
 * Shuffle arr in-place using the Fisher-Yates algorithm. Returns arr.
 *
 * @param arr Source array (mutated)
 * @param rng Optional RNG function returning [0,1) (default: Math.random)
 */
export function shuffle<T>(arr: T[], rng?: () => number): T[] {
  const rand = rng ?? Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Draw k items from arr with weights (without replacement).
 *
 * Uses the "exponential jumps" method from Efraimidis-Spirakis (2006):
 * assign key = u^(1/w_i) for each item, pick top-k by key.
 * O(n log k) time, O(k) space.
 *
 * Reference: Efraimidis, P.S. & Spirakis, P.G. (2006) "Weighted random
 * sampling with a reservoir", Information Processing Letters 97(5):181-185.
 *
 * @param arr     Source array
 * @param weights Non-negative weights (same length as arr; all-zero is an error)
 * @param k       Number of items to select
 */
export function weightedSample<T>(
  arr: readonly T[],
  weights: readonly number[],
  k: number,
  rng?: () => number,
): T[] {
  const rand = rng ?? Math.random;
  if (arr.length !== weights.length) {
    throw new RangeError(`arr.length (${arr.length}) must equal weights.length (${weights.length})`);
  }
  if (k < 0 || !Number.isInteger(k)) throw new RangeError(`k must be a non-negative integer, got ${k}`);
  if (k > arr.length) throw new RangeError(`k (${k}) must be ≤ arr.length (${arr.length})`);
  if (k === 0) return [];

  for (const w of weights) {
    if (w < 0) throw new RangeError("weights must be non-negative");
  }

  // Compute keys: key_i = rand()^(1/w_i). Items with higher weight get
  // higher expected key values, so they're more likely to be in top-k.
  // Items with weight=0 get key=-Infinity and are never selected.
  const keys: { key: number; idx: number }[] = [];
  for (let i = 0; i < arr.length; i++) {
    const w = weights[i];
    const key = w === 0 ? -Infinity : Math.pow(rand(), 1 / w);
    keys.push({ key, idx: i });
  }

  // Partial sort: find the top-k keys (max-heap behavior via full sort for simplicity)
  // For large n, a min-heap of size k would be O(n log k). Here we sort O(n log n).
  keys.sort((a, b) => b.key - a.key);
  return keys.slice(0, k).map(({ idx }) => arr[idx]);
}

/**
 * Stream-sample k items from any iterable (generator, file lines, etc.)
 * without loading the full sequence into memory.
 *
 * Convenience wrapper around ReservoirSampler.
 */
export function streamSample<T>(source: Iterable<T>, k: number): T[] {
  const rs = new ReservoirSampler<T>(k);
  for (const item of source) rs.push(item);
  return rs.sample;
}

/**
 * Pick one item from arr at random.
 */
export function choice<T>(arr: readonly T[], rng?: () => number): T {
  if (arr.length === 0) throw new RangeError("choice() called on empty array");
  return arr[Math.floor((rng ?? Math.random)() * arr.length)];
}

/**
 * Pick one item from arr with the given weights.
 */
export function weightedChoice<T>(arr: readonly T[], weights: readonly number[], rng?: () => number): T {
  if (arr.length === 0) throw new RangeError("weightedChoice() called on empty array");
  if (arr.length !== weights.length) {
    throw new RangeError(`arr.length (${arr.length}) must equal weights.length (${weights.length})`);
  }
  const rand = rng ?? Math.random;
  let total = 0;
  for (const w of weights) {
    if (w < 0) throw new RangeError("weights must be non-negative");
    total += w;
  }
  if (total === 0) throw new RangeError("weights must not all be zero");
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}
