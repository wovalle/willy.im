const skippedModules = ["next"].join("|")

module.exports = {
  clearMocks: true,
  transformIgnorePatterns: [`/node_modules/(?!${skippedModules})`],
  testEnvironment: "jest-environment-jsdom",
  transform: {
    "^.+\\.(t|j)sx?$": ["@swc/jest"],
  },
  setupFiles: ["<rootDir>/jest.setup.js"],
}
