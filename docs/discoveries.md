# Discovery frequency

To change how often a landmark appears, edit its value in the route's `*_DISCOVERY_MILES` table and reload:

| Route | File |
| --- | --- |
| Pacific Coast | [coastal-discoveries.js](../src/world/coastal-discoveries.js) |
| Red Rock Desert | [desert-discoveries.js](../src/world/desert-discoveries.js) |
| Midnight Alpine | [snow-discoveries.js](../src/world/snow-discoveries.js) |
| Emerald Jungle | [jungle-discoveries.js](../src/world/jungle-discoveries.js) |
| Golden Plains | [plains-discoveries.js](../src/world/plains-discoveries.js) |
| Rainy Downtown | [city-discoveries.js](../src/world/city-discoveries.js) |
| Volcanic Rift | [volcanic-discoveries.js](../src/world/volcanic-discoveries.js) |

`'cable-car': 5` means roughly one cable car encounter every five miles. Lower values make it more frequent; higher values make it rarer. Use `Infinity` to disable a type. Zero and negative values are invalid.

Defaults add up to about one discovery every 2.5 miles per route. Changing one value doesn't rebalance the others. Terrain and the world seed affect placement, so gaps vary. The scheduler enforces minimum spacing even with very frequent settings. Changes can move other discoveries in the same route.

Birds, Alpine lakeside cabins, and ordinary road bridges use separate schedules. A discovery's smaller objects, such as a dock's boat or a farm's tractor, follow the parent discovery.

Volcanic Rift includes geothermal stations (9 miles), abandoned mines (11.25), research camps (9), and collapsed basalt arches (11.25). The scene's original lava flows, falls, and river bridges remain part of the terrain.

All four have placements on both sides. Mines follow the basalt scarps, and natural arches cross the existing lava channels. About 30% of arches span the road instead, with supports and fallen debris clear of traffic. Seeded offsets and small orientation changes keep the sites varied.

Run `node scripts/volcanic-discoveries-test.mjs` with the dev server running to review both sides, rear faces, animations, and the three normal overhead views at desktop, tablet, and phone sizes. Screenshots and reports go to `.artifacts/volcanic-discoveries`.

Check the resulting frequencies from the repo root:

```sh
node scripts/discovery-frequency.mjs
```

The report compares target and measured averages over 2,000 route miles. Pass a number to change the sample length, such as `node scripts/discovery-frequency.mjs 500`. Set `TEST_WORLD_SEED` to check another world. The automated frequency test covers five seeds.
