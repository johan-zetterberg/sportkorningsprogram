import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getXmlElements,
  getXmlParseError,
  getXmlText,
  parseAdminXml
} from '../js/pages/admin/adminXmlUtils.js';

function createXmlStub(tags = {}) {
  return {
    getElementsByTagName(tagName) {
      return tags[tagName] || [];
    }
  };
}

test('getXmlElements and getXmlText tolerate missing nodes', () => {
  const node = createXmlStub({
    name: [{ textContent: '  Test competition  ' }]
  });

  assert.deepEqual(getXmlElements(node, 'missing'), []);
  assert.equal(getXmlText(node, 'name'), 'Test competition');
  assert.equal(getXmlText(node, 'missing'), '');
});

test('parseAdminXml returns parsed xml when required root exists', () => {
  const xml = createXmlStub({
    TInternetEntrys: [{}]
  });
  const parser = {
    parseFromString(text, type) {
      assert.equal(text, '<xml />');
      assert.equal(type, 'application/xml');
      return xml;
    }
  };

  assert.equal(parseAdminXml('<xml />', { requiredRootTag: 'TInternetEntrys', parser }), xml);
});

test('parseAdminXml throws clear errors for parser errors and missing roots', () => {
  const parserErrorXml = createXmlStub({
    parsererror: [{ textContent: ' broken at line 1 ' }]
  });
  assert.equal(getXmlParseError(parserErrorXml), 'broken at line 1');
  assert.throws(
    () => parseAdminXml('<bad', { parser: { parseFromString: () => parserErrorXml } }),
    /XML-filen kunde inte lasas: broken at line 1/
  );

  const wrongRootXml = createXmlStub({ SomethingElse: [{}] });
  assert.throws(
    () => parseAdminXml('<xml />', { requiredRootTag: 'TInternetEntrys', parser: { parseFromString: () => wrongRootXml } }),
    /saknar <TInternetEntrys>-taggen/
  );
});
