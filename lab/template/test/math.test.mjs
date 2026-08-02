import assert from 'node:assert/strict';
import test from 'node:test';
import { sum } from '../src/math.mjs';

test('sum adds two numbers', () => {
  assert.equal(sum(20, 22), 42);
});
