// Who enters errors of course (TR 518 / FEI 957): the judge at C. The error
// points are one value per equipage (protocols/general) that each save
// overwrites, so two judges entering the same error would replace or double
// it. A class judged by one judge, or without a judge at C, has that judge
// enter them.

/**
 * judgePosition: the position of the judge on this device ('C', 'E', ...);
 * classPositions: the positions judging the equipage's class (the judge
 * schedule), or of all dressage judges when the class has none.
 */
export function mayEnterErrorPoints({ judgePosition, classPositions = [] } = {}) {
  const pos = String(judgePosition || '').toUpperCase();
  if (pos === 'C') return true;
  const positions = [...new Set((Array.isArray(classPositions) ? classPositions : [])
    .map(p => String(p || '').toUpperCase())
    .filter(Boolean))];
  return positions.length <= 1 || !positions.includes('C');
}
