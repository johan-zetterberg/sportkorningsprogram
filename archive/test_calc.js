import { deduplicateAndFilterProtocols } from './js/utils/dressageUtils.js';
import { calculateDressageResult } from './js/services/calculationService.js';

const protocols = [
    { id: '1', judgeId: '1', movements: [{ momentNo: 1, score: 7 }] },
    { id: 'general', errorPoints: 5 }
];
const programs = { 'Test': { name: 'Test', movements: [{ no: 1, coeff: 1 }] } };
const eq = { startNumber: '1', className: 'Test' };
const validJudges = [{ id: '1' }];

const validProtos = deduplicateAndFilterProtocols(protocols, validJudges);
console.log('Valid protos length:', validProtos.length);
console.log('Valid protos includes general:', validProtos.some(p => p.id === 'general'));

const result = calculateDressageResult(eq, validProtos, validJudges, programs);
console.log('Result:', result);
