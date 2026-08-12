/**
 * The step list the CI gate runs, separated from the runner so it can be asserted
 * against `package.json` in a test.
 *
 * The gate invokes npm scripts by name. That means renaming or deleting a script
 * would not fail loudly — `npm run` on a missing script errors, but a step quietly
 * dropped from this list would just shrink what CI covers while still reporting
 * green. `scripts/__tests__/ci-steps.test.ts` pins both directions.
 */

export type Step = {
  readonly name: string;
  readonly command: string;
  /** Why this step exists, printed on failure so the fix is obvious. */
  readonly rationale: string;
};

/**
 * Order matters and is not arbitrary: `build` must precede `typecheck`, because
 * `next build` generates the RouteContext/PageProps/LayoutProps global types into
 * `.next/types`, which is gitignored and therefore absent on a fresh checkout.
 */
export const STEPS: readonly Step[] = [
  {
    name: "Lint",
    command: "npm run lint",
    rationale: "ESLint found a problem in the source.",
  },
  {
    name: "Test",
    command: "npm test",
    rationale: "The vitest suite has a failing test.",
  },
  {
    name: "Build",
    command: "npm run build",
    rationale: "`next build` failed — the app does not compile.",
  },
  {
    name: "Typecheck",
    command: "npm run typecheck",
    rationale: "`tsc --noEmit` found a type error.",
  },
  {
    name: "Evidence",
    command: "npm run evidence:chat",
    rationale:
      "The end-to-end chat evidence run failed — the context or a rate limit regressed.",
  },
];
