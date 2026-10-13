import test from 'node:test';
import assert from 'node:assert/strict';

import { safeLinkUrl } from '../js/utils/sharedUtils.js';

test('links: web, mail and site paths only; //host and /\\host are other sites', () => {
    assert.equal(safeLinkUrl('https://ridsport.se/x'), 'https://ridsport.se/x');
    assert.equal(safeLinkUrl('mailto:a@b.se'), 'mailto:a@b.se');
    assert.equal(safeLinkUrl('/assets/karta.pdf'), '/assets/karta.pdf');
    assert.equal(safeLinkUrl('//evil.example'), '#');
    assert.equal(safeLinkUrl('/\\evil.example'), '#');
    assert.equal(safeLinkUrl('javascript:alert(1)'), '#');
    assert.equal(safeLinkUrl(' JavaScript:alert(1)'), '#');
});