export const BASE_EXAMPLE = `name: Cross-platform test

on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: \${{ matrix.node }}
      - run: npm ci
      - run: npm test
`;

export const HEAD_EXAMPLE = `name: Cross-platform test

on:
  pull_request:

jobs:
  test:
    runs-on: macos-latest
    strategy:
      matrix:
        node: [20, 22, 24]
        architecture: [x64, arm64]
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: \${{ matrix.node }}
      - run: npm ci
      - run: npm test
`;
