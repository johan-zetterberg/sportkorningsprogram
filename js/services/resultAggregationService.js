/**
 * Legacy compatibility stub.
 *
 * This module previously contained a simplified aggregation path that no longer
 * matched the main calculation pipeline. It is intentionally disabled to avoid
 * reintroducing inconsistent PDF/finalization results.
 *
 * Use `calculateTotalResult()` from `calculationService.js` together with the
 * same source data flow used by reports/total results instead.
 */

export function aggregateResults() {
    throw new Error(
        "resultAggregationService.aggregateResults is deprecated. " +
        "Use calculationService.calculateTotalResult with the shared report/finalization data pipeline instead."
    );
}
