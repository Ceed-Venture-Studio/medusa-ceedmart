// Unit-test config for the Ceedmart application workspace.
//
// The repo-root jest.config.js only globs `packages/*`, so nothing under
// `app/ceedmart` was ever collected. Phase 3 needs a home for unit tests of
// pure logic — metadata merging, state transitions, compatibility rules,
// commission maths — so this config picks up `*.spec.ts` beside the source.
//
// Integration tests that need a real database still belong in the repo-root
// /integration-tests harness; this is for logic with no container.

const defineJestConfig = require("../../define_jest_config")

module.exports = defineJestConfig({
  rootDir: __dirname,
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
})
