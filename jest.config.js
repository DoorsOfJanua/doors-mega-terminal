module.exports = {
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/renderer/dist/', '/.worktrees/'],
  modulePathIgnorePatterns: ['<rootDir>/.worktrees/']
};
