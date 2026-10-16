import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.get(key) ?? null; },
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); }
};

const { getCurrentLanguage, setCompetitionLanguageContext, t } = await import('../js/utils/i18n.js');

test('international competition is the language default without a user preference', () => {
  localStorage.values.clear();
  setCompetitionLanguageContext({ meta: { isInternational: true } });
  assert.equal(getCurrentLanguage(), 'en');
  assert.equal(t('search'), 'Search');

  setCompetitionLanguageContext({ meta: { isInternational: false } });
  assert.equal(getCurrentLanguage(), 'sv');
  assert.equal(t('search'), 'Sök');
});

test('explicit language preference overrides the competition default', () => {
  setCompetitionLanguageContext({ meta: { isInternational: true } });
  localStorage.setItem('user_lang_pref', 'sv');
  assert.equal(getCurrentLanguage(), 'sv');
  assert.equal(t('search'), 'Sök');
  localStorage.values.clear();
});
