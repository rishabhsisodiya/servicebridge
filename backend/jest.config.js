/** Unit tests live next to the code as *.spec.ts. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!main.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
