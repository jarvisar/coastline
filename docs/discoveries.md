# Discovery Frequency

Discoveries are the landmarks that show up along each route. To change how often they appear, edit the `*_DISCOVERY_MILES` table in the route's file and reload:

| Route | File |
| --- | --- |
| Pacific Coast | [coastal-discoveries.js](../src/world/coastal-discoveries.js) |
| Red Rock Desert | [desert-discoveries.js](../src/world/desert-discoveries.js) |
| Midnight Alpine | [snow-discoveries.js](../src/world/snow-discoveries.js) |
| Emerald Jungle | [jungle-discoveries.js](../src/world/jungle-discoveries.js) |
| Golden Plains | [plains-discoveries.js](../src/world/plains-discoveries.js) |
| Rainy Downtown | [city-discoveries.js](../src/world/city-discoveries.js) |
| Volcanic Rift | [volcanic-discoveries.js](../src/world/volcanic-discoveries.js) |
| Salt Plains | [salt-discoveries.js](../src/world/salt-discoveries.js) |

For example, `'cable-car': 5` means about one every five miles. Lower numbers make it more common and `Infinity` turns it off. Zero or negative numbers aren't allowed.

The defaults work out to about one discovery every 2.5 miles. The actual gaps depend on terrain, the seed and minimum spacing, so changing one value can shift other discoveries around, but their average frequency stays the same.

Birds, Alpine lakeside cabins and normal road bridges are spawned separately. Smaller objects, like the boat at a dock, come with their parent discovery. On the salt flat, the ground under each discovery is kept dry and most cactus islands get a lagoon beside them.

## Checking placement

From the repo root:

```sh
node scripts/discovery-frequency.mjs
```

This compares the target and actual averages over 2,000 miles. Pass a different distance (e.g. `node scripts/discovery-frequency.mjs 500`) or set `TEST_WORLD_SEED` to check another world.

With the dev server running, `node scripts/volcanic-discoveries-test.mjs` checks the volcanic landmarks from both directions at desktop, tablet and phone sizes. Screenshots go to `.artifacts/volcanic-discoveries/`. `node scripts/salt-discoveries-test.mjs` saves close-up and road-level views of the salt flat landmarks to `.artifacts/salt-discoveries/`.
