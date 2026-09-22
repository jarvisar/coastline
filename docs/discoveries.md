# Discovery frequency

Edit the route's `*_DISCOVERY_MILES` table and reload:

| Route | File |
| --- | --- |
| Pacific Coast | [coastal-discoveries.js](../src/world/coastal-discoveries.js) |
| Red Rock Desert | [desert-discoveries.js](../src/world/desert-discoveries.js) |
| Midnight Alpine | [snow-discoveries.js](../src/world/snow-discoveries.js) |
| Emerald Jungle | [jungle-discoveries.js](../src/world/jungle-discoveries.js) |
| Golden Plains | [plains-discoveries.js](../src/world/plains-discoveries.js) |
| Rainy Downtown | [city-discoveries.js](../src/world/city-discoveries.js) |
| Volcanic Rift | [volcanic-discoveries.js](../src/world/volcanic-discoveries.js) |

`'cable-car': 5` means roughly one encounter every five miles. Lower values make it more common. Use `Infinity` to disable it. Zero and negative values are invalid.

Defaults average about one discovery every 2.5 miles per route. Terrain, seed, and minimum spacing affect the gaps. Changing one value can move other discoveries but doesn't change their target frequency.

Birds, Alpine lakeside cabins, and ordinary road bridges have separate schedules. Smaller objects, such as a dock's boat, follow their parent discovery.

## Check placement

From the repo root:

```sh
node scripts/discovery-frequency.mjs
```

This compares target and measured averages over 2,000 miles. Pass a sample length, such as `node scripts/discovery-frequency.mjs 500`, or set `TEST_WORLD_SEED` to check another world.

With the dev server running, `node scripts/volcanic-discoveries-test.mjs` checks volcanic landmarks from both sides at desktop, tablet, and phone sizes. Screenshots and reports go to `.artifacts/volcanic-discoveries/`.
