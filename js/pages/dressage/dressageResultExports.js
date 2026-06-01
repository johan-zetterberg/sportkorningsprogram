import { getGlobalState } from '../../main.js';
import { generateDressageListPdf } from '../../pdf/dressagePdf.js';
import {
  downloadCsv,
  sanitizeForFilename
} from '../../utils/sharedUtils.js';
import { getMomentHorseLabel } from '../../utils/dressageUtils.js';
import { t } from '../../utils/i18n.js';
import {
  formatDressageCsvScore,
  formatDressageCsvStatus
} from './dressageResultExportUtils.js';

export function setupDressageResultExportButtons({
  getVisibleSortedResults,
  getCurrentClassLabel,
  getJudges,
  formatStartTimeLabel,
  statusBadgeForDressage
}) {
  const pbtn = document.getElementById('btnPrintResultsList');
  if (pbtn) {
    pbtn.addEventListener('click', async () => {
      const origText = pbtn.innerHTML;
      pbtn.disabled = true;
      pbtn.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" ...>...</svg>${t('generating_pdf')}`;

      const list = getVisibleSortedResults();
      const currentClass = getCurrentClassLabel();
      const comp = getGlobalState('currentCompetition');
      const judges = getJudges();

      try {
        await generateDressageListPdf(list, currentClass, comp, judges);
      } catch (e) {
        console.error(e);
        alert('Fel vid PDF-generering: ' + e.message);
      } finally {
        pbtn.innerHTML = origText;
        pbtn.disabled = false;
      }
    });
  }

  const btnCsv = document.getElementById('btnExportDressageCsv');
  if (!btnCsv) return;

  btnCsv.addEventListener('click', () => {
    const comp = getGlobalState('currentCompetition');
    const date = new Date().toISOString().split('T')[0];
    const filename = `dressyr_resultat_${sanitizeForFilename(comp?.name || 'tavling')}_${date}.csv`;

    const list = getVisibleSortedResults();
    const judges = getJudges();
    const headers = [
      t('rank'), t('startno'), t('driver'), t('horse'), t('class'), t('club'), t('start_time')
    ];

    judges.forEach(j => {
      const pos = (j.position || j.id).toUpperCase();
      headers.push(`${pos} %`, `${pos} ${t('penalty')}`);
    });

    headers.push(t('dressage_avg_percent'), t('mistakes'), t('total_penalty'), t('status'));

    const rows = list.map(res => {
      const row = [
        res.plac || '-',
        String(res.startNumber),
        res.driverName || '-',
        getMomentHorseLabel(res, 'dressage'),
        res._mergedLabel || res.className || '-',
        res.clubName || '-',
        res.startTime ? formatStartTimeLabel(res.startTime) : '-'
      ];

      judges.forEach(j => {
        const jp = res.judges[j.id];
        if (jp) {
          row.push(
            formatDressageCsvScore(jp.percent, { eliminated: jp.eliminated }),
            formatDressageCsvScore(jp.penalty, { eliminated: jp.eliminated, decimals: 1 })
          );
        } else {
          row.push('-', '-');
        }
      });

      row.push(
        formatDressageCsvScore(res.avgPercent, { eliminated: res.eliminated }),
        formatDressageCsvScore(res.errorPoints, { decimals: 1, empty: '0.0' }),
        formatDressageCsvScore(res.finalPenalty, { eliminated: res.eliminated }),
        formatDressageCsvStatus(res, statusBadgeForDressage(res.startNumber))
      );
      return row;
    });

    downloadCsv(filename, headers, rows);
  });
}
