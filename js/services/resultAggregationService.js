/**
 * resultAggregationService.js
 * 
 * Aggregates results from all disciplines (Dressage, Marathon, Precision)
 * to produce a consolidated leaderboard.
 * 
 * Used by:
 * - total-resultat.js (Leaderboard view)
 * - pdfGenerator.js (Batch PDF generation)
 */

import { calculatePrecisionResult } from '../utils/precisionUtils.js';
import { calculateMarathonResult } from '../utils/marathonUtils.js';
import { computeFinalFromSaved, getPrograms } from '../utils/dressageUtils.js';

/**
 * Aggregates all results for a list of equipages.
 * 
 * @param {Array} equipages - List of equipage objects.
 * @param {Map} dressageMap - Map of startNumber -> protocols[].
 * @param {Map} marathonTimeMap - Map of startNumber -> timing object.
 * @param {Map} marathonObstacleMap - Map of startNumber -> obstacle results.
 * @param {Map} precisionMap - Map of startNumber -> precision results.
 * @param {Object} config - { marathonConfig, precisionConfig, etc }
 * @returns {Array} List of equipages with .totalPenalty, .plac, and discipline sub-results.
 */
export function aggregateResults(equipages, dressageMap, marathonTimeMap, marathonObstacleMap, precisionMap, config = {}) {
    const computed = equipages.map(eq => {
        const sn = String(eq.startNumber);
        const res = { ...eq };

        // 1. Dressage
        const protocols = dressageMap.get(sn) || [];
        const programKey = eq.dressageProgramKey || protocols[0]?.programKey || protocols[0]?.testKey;
        const program = programKey ? (getPrograms()[programKey] || null) : null;

        // If we have saved results on equipage (legacy or direct), use them preference?
        // Actually, let's recalculate if possible to be safe, or use saved if protocols missing.
        let dRes = null;
        if (program && protocols.length > 0) {
            dRes = computeFinalFromSaved(eq, protocols, program);
        } else if (eq.dressageResult) {
            dRes = eq.dressageResult; // Fallback
        }

        res.dressage = {
            penalty: dRes?.penalty || 0,
            percent: dRes?.percentAvg || 0,
            eliminated: dRes?.isEliminated || false
        };

        // 2. Marathon
        // Need timeMap + obstacleMap
        const mTime = marathonTimeMap.get(sn);
        const mObs = marathonObstacleMap.get(sn);
        // calculateMarathonResult needs structured inputs
        // This relies on `calculateMarathonResult` signature from marathonUtils.
        // It's complex. Let's create a simplified aggregator if we don't have the full maps.
        // Or assume the caller provides calculated values?
        // Admin Batch PDF might not have live maps!

        // If we are calling this from Admin "Finalize", we might need to fetch all collections first.
        // Or assume they are passed in.

        // For now, let's assume we can pass simple objects if we have them.
        res.marathon = {
            totalPenalty: (mTime?.penalty || 0) + (mObs?.penalty || 0),
            eliminated: mTime?.eliminated || mObs?.eliminated || false
        };

        // 3. Precision
        const pRes = precisionMap.get(sn);
        res.precision = {
            pen: pRes?.penalty || 0,
            time: pRes?.time || 0,
            eliminated: pRes?.eliminated || false
        };

        // Total
        res.isEliminated = res.dressage.eliminated || res.marathon.eliminated || res.precision.eliminated;
        res.totalPenalty = res.isEliminated ? 9999 : (res.dressage.penalty + res.marathon.totalPenalty + res.precision.pen);

        return res;
    });

    // Sort by Total Penalty
    computed.sort((a, b) => {
        if (a.isEliminated && !b.isEliminated) return 1;
        if (!a.isEliminated && b.isEliminated) return -1;
        if (a.isEliminated && b.isEliminated) return 0;
        return a.totalPenalty - b.totalPenalty;
    });

    // Assign Placements (per class)
    const byClass = {};
    computed.forEach(c => {
        if (!byClass[c.className]) byClass[c.className] = [];
        byClass[c.className].push(c);
    });

    Object.values(byClass).forEach(list => {
        list.forEach((item, idx) => {
            item.plac = item.isEliminated ? '' : (idx + 1);
        });
    });

    return computed;
}
