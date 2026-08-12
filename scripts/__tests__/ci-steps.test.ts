/**
 * The CI gate invokes npm scripts by name, and `.github/workflows/ci.yml` delegates
 * to it. Three things can silently reduce what CI covers without anything going red:
 *
 *   1. A step is dropped from STEPS — the gate still exits 0, just testing less.
 *   2. An npm script is renamed — the step fails, but only when someone runs it.
 *   3. The workflow stops calling `npm run ci` and drifts back to its own step list.
 *
 * These pin all three.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STEPS } from "../ci-steps";

const ROOT = join(import.meta.dirname, "..", "..");

const packageJson = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

describe("the CI gate's step list", () => {
  it("only invokes npm scripts that actually exist", () => {
    for (const step of STEPS) {
      const scriptName = step.command.replace(/^npm (run )?/, "");
      expect(
        packageJson.scripts,
        `step "${step.name}" runs "${step.command}", but there is no such npm script`,
      ).toHaveProperty(scriptName);
    }
  });

  it("covers every check the project can fail", () => {
    // If you add a verification script, add it to STEPS too — or CI stops
    // covering it. `dev`/`start` are excluded: they are servers, not checks.
    const commands = STEPS.map((s) => s.command);
    expect(commands).toEqual([
      "npm run lint",
      "npm test",
      "npm run build",
      "npm run typecheck",
      "npm run evidence:chat",
    ]);
  });

  it("builds before it typechecks, since next build emits .next/types", () => {
    const names = STEPS.map((s) => s.name);
    expect(names.indexOf("Build")).toBeLessThan(names.indexOf("Typecheck"));
  });

  it("gives every step a rationale to print on failure", () => {
    for (const step of STEPS) {
      expect(step.rationale.length, `step "${step.name}" has no rationale`).toBeGreaterThan(0);
    }
  });
});

describe("the GitHub workflow", () => {
  it("delegates to the same gate rather than repeating the steps", () => {
    expect(workflow).toContain("npm run ci");
  });

  it("does not run the individual checks itself, which would let the two drift", () => {
    // `npm run ci` is the single entry point. A workflow that also ran, say,
    // `npm test` directly could pass while the shared gate was broken.
    for (const command of ["npm run lint", "npm test", "npm run typecheck"]) {
      expect(
        workflow.includes(`run: ${command}\n`),
        `the workflow runs "${command}" directly instead of going through npm run ci`,
      ).toBe(false);
    }
  });
});
