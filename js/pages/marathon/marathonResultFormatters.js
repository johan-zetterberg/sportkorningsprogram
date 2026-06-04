export const safeLower = (x) => (x == null ? '' : String(x)).toLowerCase();

export function formatMsMMSS(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function formatObstacleSeconds(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '\u2014';
  return value.toFixed(2).replace('.', ',');
}

export function formatObstacleClock(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '\u2014';
  const totalMs = Math.max(0, Math.round(value * 1000));
  const mm = String(Math.floor(totalMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, '0');
  const cs = String(Math.floor((totalMs % 1000) / 10)).padStart(2, '0');
  return `${mm}:${ss},${cs}`;
}

export function formatStartTimeLabel(val) {
  if (!val) return '\u2014';
  if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) return val;
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }
  } catch (_) { }
  return String(val);
}

export function statusClass(s) {
  if (s === 'Klar') return 'bg-green-100 text-green-800';
  if (s === 'P\u00e5g\u00e5r') return 'bg-amber-100 text-amber-800';
  if (s === 'Eliminerad') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-600';
}

export function getMomentHorseLabel(equipage, moment) {
  if (!equipage || typeof equipage !== 'object') return '\u2014';
  const allHorsesRaw = equipage.horses || equipage.horseNames || equipage.horse || [];
  let allHorses = [];

  if (Array.isArray(allHorsesRaw)) {
    allHorses = allHorsesRaw
      .map(h => (typeof h === 'string' ? { name: h } : h))
      .filter(h => h && h.name);
  } else if (typeof allHorsesRaw === 'string' && allHorsesRaw.trim()) {
    allHorses = allHorsesRaw
      .split(/[\/,&+]|(?:\s*&\s*)/)
      .map(name => ({ name: name.trim() }))
      .filter(h => h.name);
  } else if (typeof allHorsesRaw === 'object' && allHorsesRaw.name) {
    allHorses = [allHorsesRaw];
  }

  if (allHorses.length === 0) return '\u2014';

  const horseMap = new Map(allHorses.map(h => [h.id || h.name, h.name]));
  let horseIdsToShow = [];
  if (
    moment &&
    equipage.momentHorses &&
    Array.isArray(equipage.momentHorses[moment]) &&
    equipage.momentHorses[moment].length > 0
  ) {
    horseIdsToShow = equipage.momentHorses[moment];
  }

  if (horseIdsToShow.length > 0) {
    return horseIdsToShow.map(id => horseMap.get(id) || id).join(' & ');
  }

  return allHorses.map(h => h.name).filter(Boolean).join(' & ');
}

export function getMomentHorseLabelStacked(equipage, moment) {
  const label = getMomentHorseLabel(equipage, moment);
  if (label === '\u2014') return '\u2014';
  const names = label.split(/\s*&\s*/);
  return names.map(n => `<span class="block">${n}</span>`).join('');
}

export function shortClubOrCountry(eq) {
  const club = eq.club || eq.clubName || eq.association || eq.federation || eq.team || eq.organisation || '';
  const country = (eq.country || eq.nation || eq.nationality || '').toString().trim();
  const c3 = country ? country.slice(0, 3).toUpperCase() : '';
  const clubShort = (club || '').toString().trim();
  return clubShort || c3 || '\u2014';
}
