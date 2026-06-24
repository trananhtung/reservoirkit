# reservoirkit

Zero-dependency reservoir sampling for TypeScript: Algorithm L (Vitter), weighted sampling (Efraimidis-Spirakis), Fisher-Yates shuffle, stream sampling. Drop-in replacement for the abandoned `reservoir` package (103k/week).

[![npm](https://img.shields.io/npm/v/reservoirkit)](https://www.npmjs.com/package/reservoirkit)
[![license](https://img.shields.io/npm/l/reservoirkit)](LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)

## Install

```bash
npm install reservoirkit
```

## Why?

- `reservoir` npm package — 103k downloads/week — abandoned since 2015
- Python `random.sample()` on iterables, Go `rand.Perm()` — used everywhere
- reservoirkit brings Algorithm L (faster than classic Algorithm R) with full TypeScript types

**Reservoir sampling** lets you draw a statistically uniform random sample of `k` items from a stream of unknown size, using only O(k) memory regardless of stream length.

## Quick start

```typescript
import { ReservoirSampler, sample, shuffle, streamSample } from "reservoirkit";

// One-shot array sampling (no mutation)
const picked = sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
// e.g. [4, 9, 2] — uniformly random, no duplicates

// Stream sampling — O(k) memory regardless of stream size
const rs = new ReservoirSampler<string>(100);
for (const line of logFileLines) {
  rs.push(line);
}
rs.sample; // 100 uniformly random log lines

// Fisher-Yates shuffle in-place
const arr = [1, 2, 3, 4, 5];
shuffle(arr); // arr is now shuffled
```

## API

### `ReservoirSampler<T>` — streaming sampler

Maintains a fixed-size reservoir using **Vitter's Algorithm L** — the fastest known reservoir sampling algorithm, with expected O(k·log(n/k)) items examined (vs O(n) for the classic Algorithm R).

```typescript
const rs = new ReservoirSampler<number>(100); // keep 100 items

// Stream items one at a time
for (const item of hugeDataset) {
  rs.push(item); // O(1) amortized
}

rs.sample  // T[]  — current uniform sample (copy, never mutates internal state)
rs.seen    // number — total items processed
rs.size    // number — items in current sample (≤ capacity)
rs.isFull  // boolean — true once seen ≥ capacity
rs.reset() // clear all state

// Push multiple at once
rs.pushAll([10, 20, 30]); // accepts any iterable
rs.pushAll(generator());
```

### `sample(arr, k, rng?): T[]`

Draw `k` items uniformly at random from an array **without replacement** (partial Fisher-Yates, O(k) time).

```typescript
sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3); // e.g. [7, 2, 9]
sample(["a", "b", "c"], 2);                   // e.g. ["c", "a"]
sample(arr, arr.length);                        // shuffled copy of arr
```

Source array is **never mutated**. Pass a custom `rng` for reproducible tests.

### `shuffle(arr, rng?): T[]`

Shuffle array **in-place** using Fisher-Yates. Returns the same array reference.

```typescript
const arr = [1, 2, 3, 4, 5];
shuffle(arr); // arr is now shuffled, e.g. [3, 1, 5, 2, 4]
```

### `weightedSample(arr, weights, k, rng?): T[]`

Draw `k` items from an array **without replacement** with probability proportional to weights (Efraimidis-Spirakis key method, O(n log k)).

```typescript
const items   = ["A", "B", "C", "D"];
const weights = [10,   20,   5,  65]; // sum doesn't need to be 100

weightedSample(items, weights, 2);
// "D" is 13× more likely to appear than "C"
```

Items with `weight = 0` are never selected.

### `streamSample(source, k): T[]`

Sample `k` items from any iterable (generator, file lines, etc.) without loading everything into memory.

```typescript
function* logLines() {
  // yields millions of log lines from a file
}

const sample = streamSample(logLines(), 500);
// 500 uniformly random log lines, used O(500) memory throughout
```

### `choice(arr, rng?): T`

Pick a single item uniformly at random.

```typescript
choice(["rock", "paper", "scissors"]); // "paper"
```

### `weightedChoice(arr, weights, rng?): T`

Pick a single item with probability proportional to weights.

```typescript
const loot = ["common", "rare", "epic", "legendary"];
const odds = [700, 200, 80, 20]; // out of 1000

weightedChoice(loot, odds); // "common" 70% of the time
```

## Use cases

### Sample log lines from a production stream

```typescript
import { ReservoirSampler } from "reservoirkit";

const rs = new ReservoirSampler<string>(1000);

httpServer.on("request", (req) => {
  rs.push(`${req.method} ${req.url} ${req.headers["user-agent"]}`);
});

// Every hour: analyze a representative sample of the last N requests
setInterval(() => {
  const snapshot = rs.sample; // 1000 uniform random requests
  analyzeRequests(snapshot);
  rs.reset();
}, 3_600_000);
```

### A/B test with stratified sampling

```typescript
import { sample } from "reservoirkit";

const premium = users.filter(u => u.plan === "premium"); // 200 users
const free    = users.filter(u => u.plan === "free");    // 800 users

// Sample 10% from each group (stratified, not random)
const experiment = [
  ...sample(premium, 20),
  ...sample(free,    80),
];
```

### Weighted loot drops

```typescript
import { weightedChoice } from "reservoirkit";

const DROP_TABLE = [
  { item: "Gold",     weight: 500 },
  { item: "Silver",   weight: 300 },
  { item: "Potion",   weight: 150 },
  { item: "Rare Gem", weight: 45  },
  { item: "Artifact", weight: 5   },
];

function rollDrop() {
  return weightedChoice(
    DROP_TABLE.map(d => d.item),
    DROP_TABLE.map(d => d.weight),
  );
}
```

### Random playlist shuffle

```typescript
import { shuffle } from "reservoirkit";

const playlist = ["Song A", "Song B", "Song C", "Song D", "Song E"];
shuffle(playlist); // in-place Fisher-Yates, equal probability for all permutations
```

### Feature flag rollout

```typescript
import { sample } from "reservoirkit";

// Expose new feature to a random 5% of users
function getExperimentGroup(allUsers: string[]): Set<string> {
  const k = Math.ceil(allUsers.length * 0.05);
  return new Set(sample(allUsers, k));
}
```

## Algorithms

| Function | Algorithm | Time | Space |
|---|---|---|---|
| `ReservoirSampler` | Vitter's Algorithm L | O(k log(n/k)) | O(k) |
| `sample()` | Partial Fisher-Yates | O(k) | O(n) |
| `shuffle()` | Fisher-Yates | O(n) | O(1) |
| `weightedSample()` | Efraimidis-Spirakis key method | O(n log k) | O(n) |
| `weightedChoice()` | Linear scan | O(n) | O(1) |

**Algorithm L** (Vitter 1987): instead of checking every item, computes how many items to _skip_ before the next reservoir replacement, using only a few arithmetic operations per accepted item. For k=100 sampling from n=1,000,000, this is ~3,000× fewer random number calls than Algorithm R.

**Efraimidis-Spirakis (2006)**: assigns `key_i = u^(1/w_i)` to each item (where `u` is uniform [0,1]), then selects the top-k by key. Provably equivalent to weighted sampling without replacement.

## License

MIT
