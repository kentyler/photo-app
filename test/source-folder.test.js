const { test } = require('node:test');
const assert = require('node:assert');
const { sourceFolder } = require('../src/source-folder');

test('extracts top-level folder from nested path', () => {
  assert.strictEqual(
    sourceFolder('D:/Bridget_Geoff_Toni/Toni_at_interplay/file.jpg', 'D:/'),
    'Bridget_Geoff_Toni'
  );
});

test('extracts folder for file at root of source folder', () => {
  assert.strictEqual(
    sourceFolder('D:/Bridget_Geoff_Toni/20181122_085010_001.jpg', 'D:/'),
    'Bridget_Geoff_Toni'
  );
});

test('handles backslash paths', () => {
  assert.strictEqual(
    sourceFolder('D:\\Bridget_Geoff_Toni\\sub\\file.jpg', 'D:\\'),
    'Bridget_Geoff_Toni'
  );
});

test('handles root with trailing slash variations', () => {
  assert.strictEqual(
    sourceFolder('D:/Bridget_Geoff_Toni/file.jpg', 'D:'),
    'Bridget_Geoff_Toni'
  );
});
