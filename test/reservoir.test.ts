import { describe, test, expect } from "@jest/globals";
import {
  ReservoirSampler, sample, shuffle, weightedSample,
  streamSample, choice, weightedChoice,
} from "../src/index.js";

// Seeded RNG for deterministic tests
function seededRng(seed: number): () => number {
  // Mulberry32 PRNG
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

describe("ReservoirSampler", () => {
  test("constructor rejects non-positive capacity", () => {
    expect(() => new ReservoirSampler(0)).toThrow(RangeError);
    expect(() => new ReservoirSampler(-1)).toThrow(RangeError);
    expect(() => new ReservoirSampler(1.5)).toThrow(RangeError);
  });

  test("sample is empty before any pushes", () => {
    const rs = new ReservoirSampler(5);
    expect(rs.sample).toHaveLength(0);
    expect(rs.seen).toBe(0);
    expect(rs.size).toBe(0);
    expect(rs.isFull).toBe(false);
  });

  test("fills reservoir up to capacity", () => {
    const rs = new ReservoirSampler<number>(3);
    rs.push(1).push(2).push(3);
    expect(rs.size).toBe(3);
    expect(rs.seen).toBe(3);
    expect(rs.isFull).toBe(true);
    expect(rs.sample).toHaveLength(3);
  });

  test("sample contains only items that were pushed", () => {
    const rs = new ReservoirSampler<number>(5);
    const pushed = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    rs.pushAll(pushed);
    expect(rs.seen).toBe(pushed.length);
    const s = rs.sample;
    expect(s).toHaveLength(5);
    s.forEach(item => expect(pushed).toContain(item));
  });

  test("when items ≤ capacity, sample contains all items", () => {
    const rs = new ReservoirSampler<string>(10);
    rs.push("a").push("b").push("c");
    const s = rs.sample;
    expect(s).toHaveLength(3);
    expect(new Set(s)).toEqual(new Set(["a", "b", "c"]));
  });

  test("sample size never exceeds capacity", () => {
    const rs = new ReservoirSampler<number>(3);
    for (let i = 0; i < 1000; i++) rs.push(i);
    expect(rs.sample).toHaveLength(3);
    expect(rs.seen).toBe(1000);
  });

  test("pushAll accepts any iterable", () => {
    const rs = new ReservoirSampler<number>(3);
    function* gen() { for (let i = 0; i < 10; i++) yield i; }
    rs.pushAll(gen());
    expect(rs.size).toBe(3);
    expect(rs.seen).toBe(10);
  });

  test("sample does not mutate the internal state", () => {
    const rs = new ReservoirSampler<number>(3);
    rs.pushAll([1, 2, 3]);
    const s1 = rs.sample;
    s1.push(99);
    expect(rs.sample).toHaveLength(3); // internal not mutated
  });

  test("reset clears state", () => {
    const rs = new ReservoirSampler<number>(3);
    rs.pushAll([1, 2, 3, 4, 5]);
    rs.reset();
    expect(rs.sample).toHaveLength(0);
    expect(rs.seen).toBe(0);
    expect(rs.isFull).toBe(false);
  });

  test("statistical: each element chosen with equal probability", () => {
    // Run many trials and check frequencies are approximately uniform
    const N = 10; // pool size
    const k = 1;  // sample size
    const trials = 10_000;
    const counts = new Array(N).fill(0);

    for (let t = 0; t < trials; t++) {
      const rs = new ReservoirSampler<number>(k);
      for (let i = 0; i < N; i++) rs.push(i);
      rs.sample.forEach(v => counts[v]++);
    }

    // Each item should appear ~1/N of the time. Allow ±3σ tolerance.
    const expected = trials / N;
    const sigma = Math.sqrt(expected * (1 - 1 / N));
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected - 4 * sigma);
      expect(count).toBeLessThan(expected + 4 * sigma);
    }
  });

  test("statistical: k=3 sample from 100 items is uniform", () => {
    const N = 100, k = 3, trials = 20_000;
    const counts = new Array(N).fill(0);
    for (let t = 0; t < trials; t++) {
      const rs = new ReservoirSampler<number>(k);
      for (let i = 0; i < N; i++) rs.push(i);
      rs.sample.forEach(v => counts[v]++);
    }
    const expected = (trials * k) / N;
    const sigma = Math.sqrt(expected * (1 - k / N));
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected - 4 * sigma);
      expect(count).toBeLessThan(expected + 4 * sigma);
    }
  });
});

describe("sample()", () => {
  test("returns k items from arr", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const s = sample(arr, 3);
    expect(s).toHaveLength(3);
    s.forEach(item => expect(arr).toContain(item));
  });

  test("k=0 returns empty array", () => {
    expect(sample([1, 2, 3], 0)).toEqual([]);
  });

  test("k=arr.length returns all items", () => {
    const arr = [1, 2, 3, 4];
    const s = sample(arr, 4);
    expect(s).toHaveLength(4);
    expect(new Set(s)).toEqual(new Set(arr));
  });

  test("no duplicates in result", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (let trial = 0; trial < 100; trial++) {
      const s = sample(arr, 5);
      expect(new Set(s).size).toBe(5); // all unique
    }
  });

  test("does not mutate the source array", () => {
    const arr = [1, 2, 3, 4, 5];
    const original = [...arr];
    sample(arr, 3);
    expect(arr).toEqual(original);
  });

  test("rejects k > arr.length", () => {
    expect(() => sample([1, 2], 3)).toThrow(RangeError);
  });

  test("rejects negative k", () => {
    expect(() => sample([1, 2, 3], -1)).toThrow(RangeError);
  });

  test("statistical uniformity", () => {
    const arr = [0, 1, 2, 3, 4];
    const trials = 10_000;
    const counts = new Array(arr.length).fill(0);
    for (let t = 0; t < trials; t++) {
      const s = sample(arr, 2);
      s.forEach(v => counts[v]++);
    }
    const expected = (trials * 2) / arr.length;
    const sigma = Math.sqrt(expected * (1 - 2 / arr.length));
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected - 4 * sigma);
      expect(count).toBeLessThan(expected + 4 * sigma);
    }
  });
});

describe("shuffle()", () => {
  test("returns the same array reference", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffle(arr)).toBe(arr);
  });

  test("mutates the array", () => {
    const rng = seededRng(42);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const original = [...arr];
    shuffle(arr, rng);
    expect(arr).not.toEqual(original); // almost certainly true with seeded rng
    expect(new Set(arr)).toEqual(new Set(original)); // same elements
  });

  test("preserves all elements", () => {
    const arr = [1, 2, 3, 4, 5];
    shuffle(arr);
    expect(arr.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test("empty array is safe", () => {
    expect(() => shuffle([])).not.toThrow();
  });

  test("statistical: each permutation equally likely (n=3)", () => {
    // For n=3, there are 6 permutations. Each should appear 1/6 of the time.
    const trials = 30_000;
    const counts = new Map<string, number>();
    const rng = seededRng(999);
    for (let t = 0; t < trials; t++) {
      const arr = [1, 2, 3];
      shuffle(arr, rng);
      const key = arr.join(",");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6); // all 6 permutations seen
    const expected = trials / 6;
    const sigma = Math.sqrt(expected * (1 - 1 / 6));
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected - 4 * sigma);
      expect(count).toBeLessThan(expected + 4 * sigma);
    }
  });
});

describe("weightedSample()", () => {
  test("returns k items with correct types", () => {
    const items = ["a", "b", "c", "d"];
    const weights = [1, 2, 3, 4];
    const s = weightedSample(items, weights, 2);
    expect(s).toHaveLength(2);
    s.forEach(item => expect(items).toContain(item));
  });

  test("no duplicates in result", () => {
    const items = [1, 2, 3, 4, 5];
    const weights = [1, 1, 1, 1, 1];
    for (let trial = 0; trial < 100; trial++) {
      const s = weightedSample(items, weights, 3);
      expect(new Set(s).size).toBe(3);
    }
  });

  test("k=0 returns empty", () => {
    expect(weightedSample([1, 2, 3], [1, 1, 1], 0)).toEqual([]);
  });

  test("rejects mismatched lengths", () => {
    expect(() => weightedSample([1, 2], [1, 2, 3], 1)).toThrow(RangeError);
  });

  test("rejects negative weights", () => {
    expect(() => weightedSample([1, 2, 3], [1, -1, 1], 1)).toThrow(RangeError);
  });

  test("weight=0 items are never selected", () => {
    const items = [1, 2, 3];
    const weights = [0, 1, 0]; // only item 2 can be selected
    for (let trial = 0; trial < 100; trial++) {
      const s = weightedSample(items, weights, 1);
      expect(s).toEqual([2]);
    }
  });

  test("statistical: higher weight → selected more often", () => {
    const items = [0, 1];
    // item 1 has 3× weight, so should be selected ~3× as often as item 0
    const weights = [1, 3];
    const counts = [0, 0];
    const trials = 10_000;
    for (let t = 0; t < trials; t++) {
      const s = weightedSample(items, weights, 1);
      counts[s[0]]++;
    }
    // ratio should be ~3:1
    const ratio = counts[1] / counts[0];
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });
});

describe("streamSample()", () => {
  test("samples from a generator", () => {
    function* range(n: number) { for (let i = 0; i < n; i++) yield i; }
    const s = streamSample(range(100), 5);
    expect(s).toHaveLength(5);
    s.forEach(item => {
      expect(item).toBeGreaterThanOrEqual(0);
      expect(item).toBeLessThan(100);
    });
  });

  test("samples from an array", () => {
    const arr = [10, 20, 30, 40, 50];
    const s = streamSample(arr, 3);
    expect(s).toHaveLength(3);
    s.forEach(item => expect(arr).toContain(item));
  });

  test("returns all items if source < k", () => {
    const s = streamSample([1, 2], 5);
    expect(s).toHaveLength(2);
    expect(new Set(s)).toEqual(new Set([1, 2]));
  });
});

describe("choice()", () => {
  test("returns a value from the array", () => {
    const arr = [1, 2, 3, 4, 5];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(choice(arr));
    }
  });

  test("rejects empty array", () => {
    expect(() => choice([])).toThrow(RangeError);
  });

  test("single element always returns that element", () => {
    expect(choice([42])).toBe(42);
  });
});

describe("weightedChoice()", () => {
  test("always returns item with 100% weight", () => {
    const arr = ["x", "y", "z"];
    const weights = [0, 100, 0];
    for (let i = 0; i < 100; i++) {
      expect(weightedChoice(arr, weights)).toBe("y");
    }
  });

  test("rejects empty array", () => {
    expect(() => weightedChoice([], [])).toThrow(RangeError);
  });

  test("rejects all-zero weights", () => {
    expect(() => weightedChoice([1, 2], [0, 0])).toThrow(RangeError);
  });

  test("statistical: probability proportional to weight", () => {
    const arr = ["a", "b", "c"];
    const weights = [1, 2, 7]; // 10%, 20%, 70%
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const trials = 10_000;
    for (let t = 0; t < trials; t++) {
      counts[weightedChoice(arr, weights)]++;
    }
    // "c" should be ~70% of the time
    expect(counts.c / trials).toBeGreaterThan(0.65);
    expect(counts.c / trials).toBeLessThan(0.75);
    expect(counts.a / trials).toBeGreaterThan(0.07);
    expect(counts.a / trials).toBeLessThan(0.13);
  });
});

describe("Real-world: A/B test assignment", () => {
  test("stratified sampling — same representation in each stratum", () => {
    // Select a representative sample from user segments
    const users = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      tier: i < 200 ? "premium" : i < 500 ? "regular" : "free",
    }));

    const premium = users.filter(u => u.tier === "premium");
    const regular = users.filter(u => u.tier === "regular");
    const free    = users.filter(u => u.tier === "free");

    // Sample proportionally: 10% from each tier
    const sampled = [
      ...sample(premium, Math.round(premium.length * 0.1)),
      ...sample(regular, Math.round(regular.length * 0.1)),
      ...sample(free,    Math.round(free.length * 0.1)),
    ];

    expect(sampled.length).toBeGreaterThan(0);
    const sampledPremium = sampled.filter(u => u.tier === "premium").length;
    const sampledFree    = sampled.filter(u => u.tier === "free").length;
    // Free tier is 50% of pool, premium is 20% — stratified preserves this
    expect(sampledFree).toBeGreaterThan(sampledPremium);
  });
});

describe("Real-world: stream sampling log lines", () => {
  test("samples from a large log stream", () => {
    function* logLines(n: number) {
      for (let i = 0; i < n; i++) {
        yield `2026-06-24T12:${String(i % 60).padStart(2,"0")}:00 INFO request_${i}`;
      }
    }

    const sampled = streamSample(logLines(100_000), 100);
    expect(sampled).toHaveLength(100);
    sampled.forEach(line => expect(line).toMatch(/INFO request_\d+/));
  });
});
