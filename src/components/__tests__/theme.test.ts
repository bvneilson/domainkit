import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Two guarantees that are easy to state and easy to lose:
 *
 *  1. Every app surface renders in *both* colour schemes. The acceptance
 *     criterion asks for a screenshot in light and dark mode, and the app was
 *     previously authored dark-only — every colour a dark literal, `color-scheme`
 *     pinned to dark. Light mode produced a pixel-identical dark screenshot.
 *
 *  2. No hand-rolled lookalikes of components the vendored Catalyst kit already
 *     provides. That kit is licensed material we ship; a reimplementation is
 *     both a licence-material defect and, as it turned out, the reason light
 *     mode was broken (real Catalyst is authored light-first with `dark:`
 *     variants; the copies kept only the dark half).
 *
 * These are asserted against the source rather than a render because they are
 * properties of how the UI is *written*, which is exactly where the regression
 * would reappear.
 */

const SRC = path.resolve(import.meta.dirname, "../..");
const KIT = path.join(SRC, "components/ui");

/** Every .tsx we author, excluding the vendored kit (not ours to rewrite). */
function appSources(): string[] {
  const found: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full === KIT) continue;
        walk(full);
      } else if (entry.name.endsWith(".tsx")) {
        found.push(full);
      }
    }
  }

  walk(SRC);
  return found;
}

/**
 * Colour utilities that only make sense on a dark surface. Each needs a light
 * counterpart to be legible when `prefers-color-scheme: light`.
 *
 * A "utility" here is the whole token including its variant chain, so we can
 * tell `dark:text-zinc-100` (fine) from a bare `text-zinc-100` (not), and
 * `dark:hover:text-white` (fine) from `hover:text-white` (not).
 *
 * Two things are deliberately *not* flagged:
 *
 *  - Opacity modifiers (`bg-zinc-950/5`, `border-zinc-950/10`). Those are
 *    translucent tints that read as a faint wash over whatever is behind them,
 *    which is exactly how Catalyst builds light-mode borders and surfaces.
 *  - Solid light-mode values that happen to sit at a dark end of the ramp only
 *    in the dark variant, e.g. `text-zinc-400 dark:text-zinc-600`.
 */
const OFFENDING_UTILITIES = [
  // Light text: invisible on a light background.
  /^text-white$/,
  /^text-zinc-(100|200|300)$/,
  // Solid dark surfaces: a dark card on a light page.
  /^bg-zinc-(800|900|950)$/,
  /^border-zinc-(700|800)$/,
  // Light-on-dark accent text, too low-contrast on white.
  /^text-(emerald|red|amber|sky)-(200|300)$/,
];

/** Split a line into Tailwind-ish tokens and keep the ones with no `dark:`. */
function lightModeUtilities(line: string): string[] {
  return (line.match(/[\w:/[\].-]+/g) ?? [])
    .filter((token) => !token.split(":").slice(0, -1).includes("dark"))
    .map((token) => token.split(":").at(-1) ?? token);
}

describe("colour scheme", () => {
  it("pins no app surface to a dark-only palette", () => {
    const offenders: string[] = [];

    for (const file of appSources()) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        for (const utility of lightModeUtilities(line)) {
          if (OFFENDING_UTILITIES.some((pattern) => pattern.test(utility))) {
            offenders.push(`${path.relative(SRC, file)}:${index + 1} — ${utility}`);
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it("lets the OS preference choose the scheme rather than forcing dark", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");

    // `color-scheme: dark` on its own tells the browser this document is dark
    // in every case, which is what made light mode unreachable.
    expect(css).not.toMatch(/color-scheme:\s*dark\s*;/);
    expect(css).toMatch(/color-scheme:\s*light dark\s*;/);
  });
});

describe("licensed components", () => {
  it("has no hand-rolled module shadowing the Catalyst kit", () => {
    const shim = path.join(SRC, "components/ui.tsx");
    // A sibling `ui.tsx` next to the `ui/` kit directory also makes
    // "@/components/ui" ambiguous to a reader — the import looks like the kit.
    expect(() => readFileSync(shim, "utf8")).toThrow();
  });

  it("imports primitives the kit provides from the kit", () => {
    // Each of these exists in src/components/ui/ and must not be reimplemented.
    const provided = ["Button", "Input", "Badge", "Heading", "Subheading", "Text"];
    const offenders: string[] = [];

    for (const file of appSources()) {
      const source = readFileSync(file, "utf8");

      // Anything imported from the bare "@/components/ui" specifier is coming
      // from a shim, not the kit — the kit's modules are "@/components/ui/x".
      const shimImport = source.match(/import\s*\{([^}]*)\}\s*from\s*["']@\/components\/ui["']/);
      if (shimImport) {
        offenders.push(`${path.relative(SRC, file)} imports {${shimImport[1].trim()}} from a shim`);
      }

      // A local re-declaration of a kit component is the same defect by another route.
      for (const name of provided) {
        if (new RegExp(`^\\s*(export\\s+)?function\\s+${name}\\s*\\(`, "m").test(source)) {
          offenders.push(`${path.relative(SRC, file)} declares its own ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
