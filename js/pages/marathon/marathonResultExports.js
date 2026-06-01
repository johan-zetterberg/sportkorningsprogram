import { getGlobalState } from '../../main.js';
import { generateMarathonListPdf } from '../../pdf/marathonPdf.js';
import {
  calculateMarathonResult,
  getObstacleArray,
  obstacleValues,
  prepareMarathonResults
} from '../../utils/marathonUtils.js';
import {
  downloadCsv,
  sanitizeForFilename,
  isNum
} from '../../utils/sharedUtils.js';
import {
  formatMarathonExternalOtherPenalty,
  formatMarathonPenaltyExportValue
} from '../../utils/marathonExportUtils.js';
import { getMomentHorseLabel } from './marathonResultFormatters.js';

export function setupMarathonResultExportButtons({
  getEquipages,
  getMarathonConfig,
  getMarathonMap,
  filteredSortedEquipages,
  getMaxObstacleNo,
  getActiveStages,
  buildPlacementsByClass,
  timingDocFor,
  startTimeFor,
  fmtClock
}) {
  const btnPdf = document.getElementById('marBtnExportMarathonPdf');
  if (btnPdf) {
    btnPdf.onclick = async () => {
      try {
        const freshComp = getGlobalState('currentCompetition') || {};
        const search = document.getElementById('marSearchBox')?.value.toLowerCase();
        const marathonMap = getMarathonMap();

        let list = prepareMarathonResults(getEquipages() || [], getMarathonConfig(), {
          timingMap: marathonMap,
          stateMap: marathonMap
        });

        if (search) {
          list = list.filter(e =>
            (e.driverName || '').toLowerCase().includes(search) ||
            String(e.startNumber).includes(search)
          );
        }
        list.sort((a, b) => (a.place || 9999) - (b.place || 9999));

        await generateMarathonListPdf(list, freshComp);
      } catch (err) {
        console.error(err);
        alert('Kunde inte skapa PDF: ' + err.message);
      }
    };
  }

  const btnCsv = document.getElementById('marBtnExportCsv');
  if (!btnCsv) return;

  btnCsv.onclick = () => {
    const comp = getGlobalState('currentCompetition');
    const date = new Date().toISOString().split('T')[0];
    const filename = `maraton_resultat_${sanitizeForFilename(comp?.name || 'tavling')}_${date}.csv`;

    const marathonMap = getMarathonMap();
    const list = filteredSortedEquipages();
    const maxObs = getMaxObstacleNo();
    const activeStages = getActiveStages();
    const placeMap = buildPlacementsByClass();

    const headers = [
      'Plac', 'Nr', 'Kusk', 'Hast', 'Klass', 'Klubb', 'Start', 'ETA'
    ];

    activeStages.forEach(st => headers.push(`Stracka ${st}`));
    for (let i = 1; i <= maxObs; i++) headers.push(`H${i}`);

    headers.push('H-Straff', 'Ovr-Straff', 'Totalt', 'Status');

    const rows = list.map(eq => {
      const sn = String(eq.startNumber);
      const d = marathonMap.get(sn) || {};
      const t = timingDocFor(sn);
      const res = calculateMarathonResult(eq, d, t);

      const startTimeValue = startTimeFor(sn);
      const startLabel = startTimeValue ? (startTimeValue.split('T')[1] || '-') : '-';
      const etaLabel = res.eta.B ? fmtClock(res.eta.B) : (res.eta.A ? fmtClock(res.eta.A) : '-');

      const place = placeMap.get(sn);
      const totalLabel = formatMarathonPenaltyExportValue(res.totalPenalty, {
        equipage: eq,
        marathonResult: res,
        empty: '-'
      });

      const row = [
        isNum(place) ? place : '-',
        sn,
        eq.driverName || '-',
        getMomentHorseLabel(eq, 'marathon'),
        eq._mergedLabel || eq.className || '-',
        eq.clubName || '-',
        startLabel,
        etaLabel
      ];

      activeStages.forEach(st => {
        const sData = res.stages[st];
        row.push(formatMarathonPenaltyExportValue(sData?.timePenalty, {
          equipage: eq,
          marathonResult: sData,
          empty: '-'
        }));
      });

      const obsArr = getObstacleArray(d);
      for (let i = 1; i <= maxObs; i++) {
        const o = obsArr.find(x => Number(x.number ?? x.no ?? x.nr ?? x.hinderNr) === i) || null;
        if (o) {
          const { penalty } = obstacleValues(o);
          const p = isNum(penalty) ? penalty : 0;
          row.push(p.toFixed(2));
        } else {
          row.push('0.00');
        }
      }

      row.push(
        formatMarathonPenaltyExportValue(res.obstacles.sum, { equipage: eq, marathonResult: res, empty: '0.00' }),
        formatMarathonExternalOtherPenalty(res, { equipage: eq, empty: '0.00' }),
        totalLabel,
        res.status || '-'
      );

      return row;
    });

    downloadCsv(filename, headers, rows);
  };
}
