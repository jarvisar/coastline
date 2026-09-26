// Node tests read the seed from the URL like the browser does.
// Set TEST_WORLD_SEED to run the suite against another world.
globalThis.location = new URL(`http://localhost/?seed=${process.env.TEST_WORLD_SEED ?? 4817}`);
