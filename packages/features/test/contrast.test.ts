import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contrast regression guard for the `-ink` fixes in docs/UI-AUDIT.md §2.2-G.
 *
 * Why a table of selector → token pairs, and not a CSS cascade simulation:
 * resolving which declaration wins needs a real cascade (layers, specificity,
 * inheritance, `:hover`). A hand-rolled approximation would go red on layout
 * edits or, worse, go green while the browser paints something else. So the
 * test pins the two facts that can silently regress:
 *
 *   1. the *token pair* clears the WCAG floor in all six palette × theme
 *      combinations (values come from packages/ui/src/tokens.css);
 *   2. the *selector in the real stylesheet* still names that token — if
 *      someone edits `.up__error { color: var(--tl-danger) }` back, this fails
 *      even though the token pair itself is fine.
 *
 * The surface stack is explicit per row (background layers, bottom-up), and
 * alpha tints (editorial's rgba tints) are composited over their parent —
 * that composite is exactly what made the data-transfer danger button fail.
 */

// ---------------------------------------------------------------- CSS parsing

type Decls = Map<string, string>;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Splits a stylesheet into `{ selector, decls }` blocks (flat, no @media). */
function ruleBlocks(css: string): { selector: string; decls: Decls }[] {
  const out: { selector: string; decls: Decls }[] = [];
  const body = stripComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const decls: Decls = new Map();
    const declRe = /(--[\w-]+|[a-z-]+)\s*:\s*([^;]+);/g;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(match[2] ?? ''))) {
      decls.set(d[1]!.trim(), d[2]!.replace(/\s+/g, ' ').trim());
    }
    out.push({ selector: (match[1] ?? '').replace(/\s+/g, ' ').trim(), decls });
  }
  return out;
}

/** Last declaration of `prop` among blocks whose selector list contains `selector`. */
function declaredValue(css: string, selector: string, prop: string): string | undefined {
  let found: string | undefined;
  for (const block of ruleBlocks(css)) {
    const selectors = block.selector.split(',').map((s) => s.trim());
    if (selectors.includes(selector)) {
      const v = block.decls.get(prop);
      if (v !== undefined) found = v;
    }
  }
  return found;
}

// ---------------------------------------------------------------- color maths

type Color = [number, number, number, number]; // r,g,b in 0–255, alpha 0–1

function parseHex(hex: string): Color {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    1,
  ];
}

function parseRgbFunction(value: string): Color | undefined {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return undefined;
  const body = m[1] ?? '';
  const [colorPart, alphaPart] = body.includes('/') ? body.split('/') : [body, undefined];
  const parts = (colorPart ?? '').split(/[\s,]+/).filter(Boolean);
  const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
  const alpha = alphaPart
    ? alphaPart.trim().endsWith('%')
      ? parseFloat(alphaPart) / 100
      : parseFloat(alphaPart)
    : parts.length > 3
      ? parseFloat(parts[3]!)
      : 1;
  return [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!), alpha];
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

function relativeLuminance([r, g, b]: Color): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio. */
function contrastRatio(a: Color, b: Color): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Source-over composite of `top` on opaque `bottom`. */
function over(top: Color, bottom: Color): Color {
  const a = top[3];
  if (a === 1) return top;
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

// oklab color-mix. Only needed because some tokens (--tl-block-time-ink, the
// heat ramp) are defined as mixes; the pairs asserted below are plain values,
// but resolving a token map must not throw on the ones it does not touch.
function srgbToOklab([r, g, b]: Color): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function oklabToSrgb([L, a, b]: [number, number, number]): Color {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    1,
  ];
}

function mixOklab(a: Color, b: Color, shareOfA: number): Color {
  const oa = srgbToOklab(a);
  const ob = srgbToOklab(b);
  return oklabToSrgb([
    oa[0] * shareOfA + ob[0] * (1 - shareOfA),
    oa[1] * shareOfA + ob[1] * (1 - shareOfA),
    oa[2] * shareOfA + ob[2] * (1 - shareOfA),
  ]);
}

// ---------------------------------------------------------------- token sources

// This file lives at packages/features/test/, so three levels up is the repo root.
function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');
}

const TOKENS_CSS = readRepoFile('packages/ui/src/tokens.css');

/** `data-palette` and `data-theme` compose; these are the six shipped combos. */
const COMBOS: { name: string; selectors: string[] }[] = [
  { name: 'default/light', selectors: [':root'] },
  { name: 'default/dark', selectors: [':root', '[data-theme="dark"]'] },
  { name: 'protool/light', selectors: [':root', '[data-palette="protool"]'] },
  {
    name: 'protool/dark',
    selectors: [':root', '[data-palette="protool"]', '[data-palette="protool"][data-theme="dark"]'],
  },
  { name: 'editorial/light', selectors: [':root', '[data-palette="editorial"]'] },
  {
    name: 'editorial/dark',
    selectors: [':root', '[data-palette="editorial"]', '[data-palette="editorial"][data-theme="dark"]'],
  },
];

/** Raw `--tl-*` declarations per combo, later blocks overriding earlier ones. */
function rawTokenMap(selectors: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const block of ruleBlocks(TOKENS_CSS)) {
    if (!selectors.includes(block.selector)) continue;
    for (const [name, value] of block.decls) {
      if (name.startsWith('--tl-')) map.set(name, value);
    }
  }
  return map;
}

const tokenMaps = new Map(COMBOS.map((combo) => [combo.name, rawTokenMap(combo.selectors)]));

function resolveToken(combo: string, name: string, depth = 0): Color {
  const map = tokenMaps.get(combo);
  if (!map) throw new Error(`unknown combo ${combo}`);
  const raw = map.get(name);
  if (raw === undefined) throw new Error(`${name} is not defined for ${combo}`);
  return resolveExpr(raw, combo, depth);
}

function resolveExpr(expression: string, combo: string, depth: number): Color {
  if (depth > 30) throw new Error(`cycle while resolving ${expression} (${combo})`);
  const expr = expression.trim();

  const varMatch = expr.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (varMatch) {
    const name = varMatch[1]!;
    const fallback = varMatch[2];
    const map = tokenMaps.get(combo)!;
    if (map.has(name)) return resolveToken(combo, name, depth + 1);
    if (fallback !== undefined) return resolveExpr(fallback, combo, depth + 1);
    throw new Error(`unresolved ${name} (${combo})`);
  }

  const mixMatch = expr.match(
    /^color-mix\(in\s+oklab,\s*([\s\S]+?)\s+([\d.]+)%\s*,\s*([\s\S]+)\)$/,
  );
  if (mixMatch) {
    const a = resolveExpr(mixMatch[1]!, combo, depth + 1);
    const share = parseFloat(mixMatch[2]!) / 100;
    const b = resolveExpr(mixMatch[3]!, combo, depth + 1);
    return mixOklab(a, b, share);
  }

  if (expr.startsWith('#')) return parseHex(expr);
  const rgb = parseRgbFunction(expr);
  if (rgb) return rgb;
  if (expr === 'transparent') return [0, 0, 0, 0];
  throw new Error(`cannot parse colour ${expr} (${combo})`);
}

/** Composite a bottom-up stack of tokens into one opaque ground. */
function surfaceOf(combo: string, stack: string[]): Color {
  let color: Color | undefined;
  for (const token of stack) {
    const layer = resolveToken(combo, token);
    color = color === undefined ? layer : over(layer, color);
  }
  if (!color) throw new Error('empty background stack');
  return color;
}

// ---------------------------------------------------------------- the table

interface Pair {
  /** Human label, printed on failure. */
  label: string;
  file: string;
  selector: string;
  /** Declaration in `selector` that must name `token`. */
  property: 'color' | 'background';
  token: string;
  /** Background layers, bottom-up; each is a token name. */
  surface: string[];
  /** WCAG floor: 4.5 for text, 3 for non-text UI. */
  min: number;
  /**
   * Set only where no shipped token clears 4.5 on the real ground yet. The
   * value is the floor this row is allowed to sit at until the token is added;
   * it still guards against falling back to the original failing value.
   */
  acceptedGap?: string;
}

const INK_PAIRS: Pair[] = [
  {
    label: '.up__error',
    file: 'apps/desktop/src/shell/update-panel.css',
    selector: '.up__error',
    property: 'color',
    token: '--tl-danger-ink',
    surface: ['--tl-surface'],
    min: 4.5,
  },
  {
    label: '.up__ok',
    file: 'apps/desktop/src/shell/update-panel.css',
    selector: '.up__ok',
    property: 'color',
    token: '--tl-success-ink',
    surface: ['--tl-surface'],
    min: 4.5,
  },
  {
    // Decorative glyph (aria-hidden) beside the title: non-text UI, 3:1.
    label: '.sh-error__icon',
    file: 'apps/desktop/src/shell/shell.css',
    selector: '.sh-error__icon',
    property: 'color',
    token: '--tl-danger-ink',
    surface: ['--tl-danger-tint', '--tl-surface'],
    min: 3,
  },
  {
    label: '.undo-toast__action:hover',
    file: 'packages/features/src/undo/undo.css',
    selector: '.undo-toast__action:hover:not(:disabled)',
    property: 'color',
    token: '--tl-accent-ink',
    surface: ['--tl-surface-hover', '--tl-surface-raised'],
    min: 4.5,
  },
  {
    label: '.dt-btn--danger',
    file: 'packages/features/src/data/data-transfer.css',
    selector: '.dt-btn--danger',
    property: 'color',
    token: '--tl-danger-ink',
    surface: ['--tl-surface'],
    min: 4.5,
  },
  {
    label: '.mv__cell--out .mv__date',
    file: 'packages/features/src/styles.css',
    selector: '.mv__cell--out .mv__date',
    property: 'color',
    token: '--tl-text-tertiary',
    surface: ['--tl-surface-sunken'],
    // No shipped token clears 4.5 on this ground. tertiary is 4.09–5.26 (the
    // light palettes fall short: 4.09 / 4.12 / 4.35); secondary would pass at
    // 4.46–7.91 but is the same ink as in-month dates, which erases the
    // "receded" state. Pinned at 4.0 so a revert to --tl-text-disabled
    // (1.45–2.74) fails; the real fix is a --tl-text-muted token (DEFERRED).
    min: 4.0,
    acceptedGap: 'tertiary on sunken: 4.09–4.35 in the light palettes, under the 4.5 text floor',
  },
  {
    label: '.flat-group__count',
    file: 'packages/features/src/task/task-list.css',
    selector: '.flat-group__count',
    property: 'color',
    token: '--tl-text-secondary',
    surface: ['--tl-surface-subtle'],
    min: 4.5,
  },
  {
    // The overlay is an 82% surface wash; the grid ground below is --tl-bg.
    label: '.mv > .tl-empty',
    file: 'packages/features/src/styles.css',
    selector: '.mv > .tl-empty',
    property: 'color',
    token: '--tl-text-secondary',
    surface: ['--tl-surface', '--tl-bg'],
    min: 4.5,
  },
  {
    label: '.flat-empty .tl-empty',
    file: 'packages/features/src/task/task-list.css',
    selector: '.flat-empty .tl-empty',
    property: 'color',
    token: '--tl-text-secondary',
    surface: ['--tl-bg'],
    min: 4.5,
  },
];

/**
 * Filled controls: the *text* sits on a coloured fill, so the pair to measure
 * is (foreground ink token, fill token) rather than (declaration, surface).
 */
interface FillPair {
  label: string;
  file: string;
  selector: string;
  /** Declaration in `selector` that must name `fillToken`. */
  property: 'color' | 'background';
  fillToken: string;
  inkToken: string;
  min: number;
}

const FILL_PAIRS: FillPair[] = [
  {
    // static state
    label: '.sh-error__btn--primary (fill)',
    file: 'apps/desktop/src/shell/shell.css',
    selector: '.sh-error__btn--primary',
    property: 'background',
    fillToken: '--tl-accent-strong',
    inkToken: '--tl-accent-contrast',
    min: 4.5,
  },
  {
    label: '.sh-error__btn--primary:hover (fill)',
    file: 'apps/desktop/src/shell/shell.css',
    selector: '.sh-error__btn--primary:hover',
    property: 'background',
    fillToken: '--tl-accent-strong-hover',
    inkToken: '--tl-accent-contrast',
    min: 4.5,
  },
  {
    // Hover turns the destructive button solid.
    label: '.dt-btn--danger:hover (fill)',
    file: 'packages/features/src/data/data-transfer.css',
    selector: '.dt-btn--danger:hover:not(:disabled)',
    property: 'background',
    fillToken: '--tl-danger',
    inkToken: '--tl-danger-contrast',
    min: 4.5,
  },
];

const HOOK_PAIRS: { label: string; selector: string; hookToken: string; sourceTokens: string[] }[] = [
  {
    label: '.undo-toast__action:hover ground',
    selector: '.undo-toast__action:hover:not(:disabled)',
    hookToken: '--tl-accent-tint',
    sourceTokens: ['--tl-surface-hover'],
  },
];

// ---------------------------------------------------------------- assertions

describe('token sources', () => {
  it('resolves all six palette × theme combinations', () => {
    expect([...tokenMaps.keys()]).toEqual(COMBOS.map((c) => c.name));
    for (const combo of COMBOS) {
      const map = tokenMaps.get(combo.name)!;
      // Every combo must define the inks and grounds the table leans on.
      for (const token of ['--tl-surface', '--tl-bg', '--tl-text-secondary']) {
        expect(map.has(token), `${token} missing in ${combo.name}`).toBe(true);
      }
    }
  });
});

describe('ink pairs clear WCAG in every palette and theme', () => {
  for (const pair of INK_PAIRS) {
    it(`${pair.label} uses ${pair.token}${pair.acceptedGap ? ' (accepted gap)' : ''}`, () => {
      const css = readRepoFile(pair.file);
      const declared = declaredValue(css, pair.selector, pair.property);
      expect(
        declared,
        `${pair.label}: ${pair.property} is "${declared ?? '<missing>'}", expected var(${pair.token})`,
      ).toBe(`var(${pair.token})`);

      // An accepted gap must name itself, so it cannot be mistaken for a pass.
      if (pair.acceptedGap) expect(pair.min).toBeLessThan(4.5);

      for (const combo of COMBOS) {
        const fg = resolveToken(combo.name, pair.token);
        const bg = surfaceOf(combo.name, pair.surface);
        const ratio = contrastRatio(fg, bg);
        const required = pair.min;
        expect(
          ratio,
          `${pair.selector} [${combo.name}] ${pair.token} on ${pair.surface.join(' over ')} = ${ratio.toFixed(2)}:1, needs ≥ ${required}:1${pair.acceptedGap ? ` — ${pair.acceptedGap}` : ''}`,
        ).toBeGreaterThanOrEqual(required);
      }
    });
  }
});

describe('filled controls keep their ink legible', () => {
  for (const pair of FILL_PAIRS) {
    it(`${pair.label} fills ${pair.fillToken}`, () => {
      const css = readRepoFile(pair.file);
      const declared = declaredValue(css, pair.selector, pair.property);
      expect(
        declared,
        `${pair.label}: ${pair.property} is "${declared ?? '<missing>'}", expected var(${pair.fillToken})`,
      ).toBe(`var(${pair.fillToken})`);

      for (const combo of COMBOS) {
        const ink = resolveToken(combo.name, pair.inkToken);
        const fill = resolveToken(combo.name, pair.fillToken);
        const ratio = contrastRatio(ink, fill);
        expect(
          ratio,
          `${pair.selector} [${combo.name}] ${pair.inkToken} on ${pair.fillToken} = ${ratio.toFixed(2)}:1, needs ≥ ${pair.min}:1`,
        ).toBeGreaterThanOrEqual(pair.min);
      }
    });
  }
});

describe('hover grounds stay neutral where the tint would fail', () => {
  for (const hook of HOOK_PAIRS) {
    it(`${hook.label} no longer uses ${hook.hookToken}`, () => {
      const css = readRepoFile('packages/features/src/undo/undo.css');
      const declared = declaredValue(css, hook.selector, 'background');
      expect(
        declared,
        `${hook.selector}: background is "${declared ?? '<missing>'}", expected var(${hook.sourceTokens[0]})`,
      ).toBe(`var(${hook.sourceTokens[0]})`);
      expect(declared).not.toContain(hook.hookToken);
    });
  }
});
