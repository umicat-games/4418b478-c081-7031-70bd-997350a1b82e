/**
 * The save guard, against the shapes that actually broke it.
 *
 * The crashing row was not junk — it was `{y, z, gold}`: a perfectly ordinary
 * object with one key missing, because `JSON.stringify` drops a key whose value
 * is `undefined` instead of writing `null`. That is why `saved ?? SPAWN` looked
 * correct for months. Every case below is a shape the database can really hold.
 *
 *   npx esbuild src/save.ts --bundle --format=esm --outfile=/tmp/save.mjs
 *   node tools/save-test.mjs /tmp/save.mjs
 */
const S = await import(process.argv[2] ?? '/tmp/save.mjs');
const SPAWN = { x: 0, y: 0.4, z: 1.7 };
let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } else console.log(`  ok   ${name}`);
};
const atSpawn = (r) => r.x === SPAWN.x && r.y === SPAWN.y && r.z === SPAWN.z;

console.log('reading');
ok('a good row is trusted', (() => {
  const r = S.readSave({ x: 3, y: 1, z: -2, gold: 40, bestClock: 90, bestKills: 12 }, SPAWN);
  return r.x === 3 && r.y === 1 && r.z === -2 && r.gold === 40 && r.bestClock === 90 && r.bestKills === 12;
})());
ok('no save at all falls back to SPAWN', atSpawn(S.readSave(null, SPAWN)));
ok('undefined too', atSpawn(S.readSave(undefined, SPAWN)));
// The one that crashed the game: stringify dropped `x` because it was undefined.
ok('a row with a dropped axis falls back', atSpawn(S.readSave({ y: 1, z: -2, gold: 40 }, SPAWN)),
  JSON.stringify(S.readSave({ y: 1, z: -2, gold: 40 }, SPAWN)));
ok('...and keeps the gold that was in it', S.readSave({ y: 1, z: -2, gold: 40 }, SPAWN).gold === 40);
ok('NaN is not a position', atSpawn(S.readSave({ x: NaN, y: 1, z: 2 }, SPAWN)));
ok('Infinity is not either', atSpawn(S.readSave({ x: Infinity, y: 1, z: 2 }, SPAWN)));
ok('nor is a numeric string', atSpawn(S.readSave({ x: '3', y: 1, z: 2 }, SPAWN)));
ok('nor null coordinates', atSpawn(S.readSave({ x: null, y: 1, z: 2 }, SPAWN)));
ok('a NaN gold reads as 0', S.readSave({ x: 1, y: 1, z: 1, gold: NaN }, SPAWN).gold === 0);
ok('a missing record reads as 0',
  S.readSave({ x: 1, y: 1, z: 1 }, SPAWN).bestKills === 0);

console.log('writing');
{
  const good = S.writeSave({ x: 1, y: 2, z: 3 }, { gold: 5, bestClock: 6, bestKills: 7 });
  ok('a good position is written', good.x === 1 && good.y === 2 && good.z === 3);
  ok('with the progress', good.gold === 5 && good.bestClock === 6 && good.bestKills === 7);

  const torn = S.writeSave({ x: undefined, y: 2, z: 3 }, { gold: 5, bestClock: 6, bestKills: 7 });
  ok('a torn-down position is left out entirely',
    !('x' in torn) && !('y' in torn) && !('z' in torn), JSON.stringify(torn));
  ok('...but the run\'s gold is still saved', torn.gold === 5,
    'refusing the whole write would throw away the session');

  ok('a NaN position is left out', !('x' in S.writeSave({ x: NaN, y: 2, z: 3 }, { gold: 1, bestClock: 0, bestKills: 0 })));
  ok('a missing position object is left out', !('x' in S.writeSave(null, { gold: 1, bestClock: 0, bestKills: 0 })));
  ok('a NaN gold is written as 0', S.writeSave(null, { gold: NaN, bestClock: 0, bestKills: 0 }).gold === 0);
}

console.log('round trip');
{
  // The full failure, end to end: a bad write followed by a load.
  const row = JSON.parse(JSON.stringify(
    S.writeSave({ x: undefined, y: 2, z: 3 }, { gold: 99, bestClock: 12, bestKills: 3 }),
  ));
  const back = S.readSave(row, SPAWN);
  ok('a torn-down save still boots, at SPAWN, with progress intact',
    atSpawn(back) && back.gold === 99 && back.bestClock === 12, JSON.stringify(back));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
