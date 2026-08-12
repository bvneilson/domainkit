/**
 * The CI gate, as one executable command.
 *
 * This repo's hosted CI cannot run: `bvneilson/domainkit` is private, so
 * Actions consumes paid minutes, and every dispatch on the account is currently
 * rejected before a single step exists (`steps: []`, no log, dead in 3s). That
 * is a billing condition only the CEO can clear — see
 * `docs/plans/2026-08-11-ci-that-runs-without-actions.md`.
 *
 * A repo with live users still needs something that actually tests a diff. So
 * the gate lives here, in code that runs anywhere, and `.github/workflows/ci.yml`
 * invokes THIS script rather than repeating the step list. That way hosted CI and
 * local CI cannot drift into disagreeing about what "green" means — when billing
 * clears, the workflow starts running the exact sequence already verified locally.
 *
 * The step list lives in `./ci-steps.ts` so a test can assert it against the npm
 * scripts it invokes.
 *
 * Run with: npm run ci
 */
import { spawn } from "node:child_process";

import { STEPS, type Step } from "./ci-steps";

const BAR = "─".repeat(72);

/** Runs one step, streaming its output, and resolves the exit code. */
function run(step: Step): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(step.command, {
      shell: true,
      stdio: "inherit",
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    // 'close' rather than 'exit': it waits for the inherited stdio to flush, so a
    // failing step's last lines can't be cut off before the summary prints.
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main(): Promise<void> {
  const started = Date.now();
  const results: { step: Step; ok: boolean; ms: number }[] = [];

  for (const step of STEPS) {
    console.log(`\n${BAR}\n${step.name}: ${step.command}\n${BAR}`);
    const stepStarted = Date.now();
    const code = await run(step);
    const ms = Date.now() - stepStarted;
    results.push({ step, ok: code === 0, ms });

    // Fail fast. A red build makes every later step's output noise, and the
    // first failure is nearly always the one worth reading.
    if (code !== 0) {
      console.log(`\n${BAR}\nFAILED at ${step.name}\n${BAR}`);
      console.log(`  ${step.rationale}`);
      console.log(`  Reproduce with: ${step.command}\n`);
      for (const r of results) {
        console.log(`  ${r.ok ? "✓" : "✗"} ${r.step.name} (${r.ms}ms)`);
      }
      for (const skipped of STEPS.slice(results.length)) {
        console.log(`  – ${skipped.name} (skipped)`);
      }
      console.log("");
      process.exit(code);
    }
  }

  console.log(`\n${BAR}\nAll checks passed in ${Date.now() - started}ms\n${BAR}`);
  for (const r of results) {
    console.log(`  ✓ ${r.step.name} (${r.ms}ms)`);
  }
  console.log("");
}

main();
