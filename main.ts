// Prelaunch Radar: a token-radar-01 entry (Node 22.18+, standard library only, no network).
//
// Reads the sealed snapshot, runs the value model in dashboard/model.js (the same file the page runs),
// and writes to /output: board.json, dashboard/ (the page plus snapshot-data.js, its copy of the
// snapshot), screenshots/ and dossier.json. Run it outside the grader with
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './dashboard/model.js';
import { buildDossier } from './vendor/makefun-board.ts';

interface Protocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  change_7d: number | null; mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }
interface BoardRow { slug: string; name: string; rank: number; implied_value_usd: number; farm_steps: string[] }
interface Model {
  buildRadar(s: Snapshot): {
    rows: unknown[]; trading: unknown[]; aside: unknown[];
    fit: { a: number; b: number; sigma: number; n: number; coef: Record<string, { prior: number; fit: number; se: number; post: number }> };
    test: { n: number; miss: number; q25: number; q75: number; within3: number; split: { train: number; test: number; cut: string; miss: number } };
  };
  boardRows(radar: unknown): BoardRow[];
}
const model = (globalThis as unknown as { RadarModel: Model }).RadarModel;

const here = fileURLToPath(new URL('.', import.meta.url));

function fail(message: string): never {
  process.stderr.write(`prelaunch radar: ${message}\n`);
  process.exit(1);
}

/** --name value, or --name=value, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

/** The snapshot, checked for the shape the model relies on. */
function readSnapshot(file: string): Snapshot {
  if (!existsSync(file)) fail(`no snapshot at ${file}: pass --input <snapshot.json|directory>`);
  const s = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist) || typeof s.floor_usd !== 'number') fail('the snapshot lacks protocols, watchlist or floor_usd');
  return s;
}

/** The gate's own conditions on a board, checked here so a bad board never leaves the program. */
function boardIssue(rows: BoardRow[], s: Snapshot): string | null {
  const known = new Set(s.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows, outside 100 to 4000`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `${r.slug} has rank ${r.rank} at position ${i + 1}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has no positive whole implied value`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `${r.slug} is worth more than the rank above it`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const step of r.farm_steps) if (step.trim().length < 20 || step.trim().length > 600) return `${r.slug} has a farm step of ${step.trim().length} characters`;
  }
  for (const slug of s.watchlist) if (!seen.has(slug)) return `the watchlist's ${slug} is not on the board`;
  if (rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) return 'every implied value is the same';
  return null;
}

/** Copy a directory's regular files (no dotfiles) and return their names, sorted. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}

const inputArg = arg('input', '/input');
const snapshot = readSnapshot(inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json'));
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const radar = model.buildRadar(snapshot);
const rows = model.boardRows(radar);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// The page's copy of the snapshot: the same objects, untouched, so the page's run of the model is this run.
// board_check is what board.json holds; the page compares its own totals against it and says so in its header.
const check = { rows: rows.length, value_sum_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0), top: rows[0]!.slug };
const head = { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, board_check: check };
const dataJs =
  '// Written by main.ts from /input/snapshot.json: the snapshot\'s own protocol objects, ten fields each, nothing\n' +
  '// derived and nothing ranked. model.js (buildRadar) turns them into the board in the browser; board_check is\n' +
  '// what board.json holds, and the page shows whether its own run matches. One protocol a line.\n' +
  `window.RADAR_DATA = ${JSON.stringify(head)};\n` +
  `window.RADAR_DATA.watchlist = ${JSON.stringify(snapshot.watchlist)};\n` +
  'window.RADAR_DATA.protocols = [\n' + snapshot.protocols.map((r) => JSON.stringify(r)).join(',\n') + '\n];\n';

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: 'prelaunch-radar/1', as_of: snapshot.as_of, fit: { intercept: radar.fit.a, slope: radar.fit.b, sigma: radar.fit.sigma, token_families: radar.fit.n, coefficients: radar.fit.coef }, blind_test: { leave_one_out_median_miss_x: radar.test.miss, band_log10: [radar.test.q25, radar.test.q75], within_3x: radar.test.within3, time_split: radar.test.split }, rows })}\n`);
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
writeFileSync(join(out, 'dashboard', 'snapshot-data.js'), dataJs);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: the board, a detail view and a filtered view are needed`);

// Last, the dossier: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(`prelaunch radar: ${snapshot.protocols.length} protocols, ${radar.trading.length} trading, ${radar.aside.length} set aside, ${rows.length} ranked (watchlist ${snapshot.watchlist.length} covered); wrote ${out}\n`);
