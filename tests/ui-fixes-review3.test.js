// Pure helpers added for the UI fixes (review 3): vet strike chip, gate grid,
// public class chips, field message preview, mail sender preview, tab overflow.
import test from 'node:test';
import assert from 'node:assert/strict';

import { isVetStrikePending, vetStrikeChipHtml } from '../js/ui/vetStrikeChip.js';
import { gateGridColumns } from '../js/pages/precision/precisionInputUtils.js';
import { senderPreviewName } from '../js/pages/admin/adminMailCardUtils.js';
import { tabOverflowEdges } from '../js/ui/tabOverflowHint.js';
import { needsExpander, renderFieldMessagesHtml, pickFieldMessages } from '../js/ui/fieldMessagesView.js';
import { filterPublicByClass, publicClassOptions, renderPublicClassChips } from '../js/pages/admin/starttiderUtils.js';
import { DICTIONARY } from '../js/utils/i18n.js';

test('a vet strike chip only for a pending strike (a map on the equipage)', () => {
    assert.equal(isVetStrikePending({ vetStrikePending: { phase: 'initial' } }), true);
    assert.equal(isVetStrikePending({ vetStrikePending: null }), false);
    assert.equal(isVetStrikePending({}), false);
    assert.equal(isVetStrikePending(null), false);
    assert.equal(vetStrikeChipHtml({}), '');
    const staff = vetStrikeChipHtml({ vetStrikePending: { phase: 'initial' } });
    assert.match(staff, /data-vet-strike-pending/);
    assert.match(staff, /Veterinärstrykning avvaktar domarkollegiet/);
    const own = vetStrikeChipHtml({ vetStrikePending: { phase: 'initial' } }, { own: true });
    assert.match(own, /Veterinärbeslut avvaktar domarkollegiets beslut/);
});

test('gate buttons form an even grid of 3 or 4 columns', () => {
    assert.equal(gateGridColumns(0), 3);
    assert.equal(gateGridColumns(3), 3);
    assert.equal(gateGridColumns(4), 4);
    assert.equal(gateGridColumns(6), 3);
    assert.equal(gateGridColumns(8), 4);
    assert.equal(gateGridColumns(9), 3);
    assert.equal(gateGridColumns(12), 4);
    // 10: 4 columns leave 2 on the last row, 3 columns leave 1
    assert.equal(gateGridColumns(10), 4);
    // 13: 4 columns leave 1, 3 columns leave 1 (a tie goes to 4)
    assert.equal(gateGridColumns(13), 4);
    // 14: 4 columns leave 2, 3 columns leave 2
    assert.equal(gateGridColumns(14), 4);
    // 16 and 15 divide evenly
    assert.equal(gateGridColumns(16), 4);
    assert.equal(gateGridColumns(15), 3);
});

test('the mail sender preview does not repeat "via DriveLive"', () => {
    assert.equal(senderPreviewName('Seeder Club via DriveLive'), 'Seeder Club');
    assert.equal(senderPreviewName('Seeder Club via DriveLive via DriveLive'), 'Seeder Club');
    assert.equal(senderPreviewName('Seeder Club'), 'Seeder Club');
    assert.equal(senderPreviewName(null), '');
});

test('tab bars show a fade only on the edges with more tabs behind them', () => {
    assert.deepEqual(tabOverflowEdges({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 }), { left: false, right: false });
    assert.deepEqual(tabOverflowEdges({ scrollLeft: 0, clientWidth: 300, scrollWidth: 500 }), { left: false, right: true });
    assert.deepEqual(tabOverflowEdges({ scrollLeft: 100, clientWidth: 300, scrollWidth: 500 }), { left: true, right: true });
    assert.deepEqual(tabOverflowEdges({ scrollLeft: 200, clientWidth: 300, scrollWidth: 500 }), { left: true, right: false });
});

test('a field message shows a 2-line preview with "Visa mer" and a "+N fler" hint', () => {
    assert.equal(needsExpander('Kort'), false);
    assert.equal(needsExpander('a'.repeat(120)), true);
    assert.equal(needsExpander('a\nb\nc'), true);
    const long = { id: 'm1', type: 'info', title: 'Titel', body: 'x'.repeat(200), timestamp: new Date('2026-10-22T10:00:00Z'), audience: { officials: true } };
    const labels = { more: 'Visa mer', less: 'Visa mindre', more_count: '+{n} fler', dismiss: 'Dölj' };
    const html = renderFieldMessagesHtml([long], { labels, moreCount: 2 });
    assert.match(html, /line-clamp-2/);
    assert.match(html, /data-toggle-field-message/);
    assert.match(html, /Visa mer/);
    assert.match(html, /\+2 fler/);
    assert.match(html, /data-dismiss-field-message/);
    // Opened: no clamp, "Visa mindre"
    const key = html.match(/data-toggle-field-message="([^"]+)"/)[1];
    const open = renderFieldMessagesHtml([long], { labels, expanded: new Set([key]) });
    assert.doesNotMatch(open, /line-clamp-2/);
    assert.match(open, /Visa mindre/);
    // Text from the organiser is escaped
    const evil = { ...long, title: '<img src=x onerror=alert(1)>', body: '' };
    assert.doesNotMatch(renderFieldMessagesHtml([evil], { labels }), /<img/);
});

test('all field messages can be picked past the banner limit', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
        id, type: 'info', title: id, body: '', timestamp: new Date(2026, 9, 22, 10, i), audience: { officials: true }
    }));
    assert.equal(pickFieldMessages(list, { viewerKeys: [], competitionId: 'c1' }).length, 3);
    assert.equal(pickFieldMessages(list, { viewerKeys: [], competitionId: 'c1', limit: Infinity }).length, 5);
});

test('the public start list can be narrowed to one class', () => {
    const equipages = [
        { startNumber: 1, className: 'Lätt B' },
        { startNumber: 2, className: 'Msv', _mergedLabel: 'Msv + Lätt A' },
        { startNumber: 3, className: 'Lätt B' }
    ];
    assert.deepEqual(publicClassOptions(equipages), ['Lätt B', 'Msv + Lätt A']);
    assert.equal(filterPublicByClass(equipages, '').length, 3);
    assert.deepEqual(filterPublicByClass(equipages, 'Lätt B').map(e => e.startNumber), [1, 3]);
    assert.equal(renderPublicClassChips(['Lätt B'], ''), '');
    const chips = renderPublicClassChips(['Lätt B', 'Msv'], 'Msv', { allLabel: 'Alla klasser' });
    assert.match(chips, /Alla klasser/);
    assert.match(chips, /aria-pressed="true"/);
    assert.match(chips, /min-h-\[44px\]/);
    assert.doesNotMatch(chips, /onclick/);
});

test('every dictionary key is lower case (t() looks keys up in lower case)', () => {
    const upper = Object.keys(DICTIONARY).filter((key) => key !== key.toLowerCase());
    assert.deepEqual(upper, []);
});

test('the new UI texts exist in Swedish and English', () => {
    for (const key of ['pause_button_label', 'vet_strike_pending_chip', 'vet_strike_pending_driver', 'field_messages_more', 'sp_save', 'join_title', 'incident_new_btn', 'pushp_device_title']) {
        assert.ok(DICTIONARY[key]?.sv && DICTIONARY[key]?.en, key);
    }
    assert.match(DICTIONARY.push_status_not_available.sv, /arrangören har inte aktiverat/);
    assert.match(DICTIONARY.pushp_test_none.sv, /Slå först på notiser på den här enheten/);
});
