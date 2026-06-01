function formatPanelPenalty(value) {
  if (value === Infinity) return 'ELIM';
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

export function renderPrecisionLiveStatusPanel({
  equipage,
  totalPenalty,
  overallRank = null,
  toBeat = null,
  horseLabelHtml = '',
  flagHtml = ''
}) {
  const sn = String(equipage.startNumber);
  const toBeatLabel = toBeat
    ? `<div class="text-[10px] text-emerald-500 font-bold mt-1">För ${toBeat.targetP < 0 ? 'vinst' : 'nästa'}: < ${toBeat.targetP.toFixed(1)}</div>`
    : '';

  return `
    <div class="bg-slate-900 rounded-lg md:rounded-xl p-3 md:p-6 shadow-xl border border-slate-700 relative overflow-hidden text-white">
      <div class="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full mix-blend-overlay filter blur-3xl opacity-10 -translate-y-1/2 translate-x-1/2"></div>

      <div class="relative z-10 hidden md:flex flex-row items-center justify-between gap-6">
        <div class="flex items-center gap-4 md:gap-6 flex-1 min-w-0">
           <div class="flex flex-col items-center justify-center bg-white/10 w-16 h-16 rounded-lg backdrop-blur-sm border border-white/10 shrink-0">
              <span class="text-xs text-gray-400 uppercase font-bold tracking-wider">Start</span>
              <span class="text-3xl font-bold font-mono leading-none">${equipage.startNumber}</span>
           </div>

           <div class="min-w-0">
             <div class="flex items-center gap-2 mb-1">
               <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase tracking-wider border border-emerald-500/30">
                 <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                 På banan
               </span>
               <span class="text-slate-400 text-sm truncate">${equipage.className}</span>
             </div>
             <h2 class="text-2xl md:text-3xl font-bold truncate leading-tight">${equipage.driverName}</h2>
             <p class="text-slate-400 text-sm md:text-base truncate">${horseLabelHtml}</p>
             <div class="flex items-center gap-2 mt-2 text-xs text-slate-500">
               ${flagHtml} ${equipage.clubName || ''}
             </div>
           </div>
        </div>

        <div class="flex items-center gap-4 md:gap-8 shrink-0">
           <div class="text-center px-4 border-r border-white/10 hidden lg:block">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Totalplac.</div>
             <div class="text-3xl font-bold text-emerald-400 tabular-nums">${overallRank || '-'}</div>
             ${toBeatLabel}
           </div>

           <div class="text-center px-4 border-r border-white/10 hidden md:block">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Delplac.</div>
             <div class="text-3xl font-bold text-yellow-400 tabular-nums" id="livePanelRank-${sn}">-</div>
           </div>

           <div class="text-center px-4 border-r border-white/10">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Straff</div>
             <div class="text-3xl font-bold text-blue-300 tabular-nums" id="livePanelPenalty-${sn}">${formatPanelPenalty(totalPenalty)}</div>
           </div>

           <div class="text-center min-w-[140px]">
             <div class="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Tid</div>
             <div class="text-5xl md:text-6xl font-black tabular-nums leading-none tracking-tight" id="livePanelTimer-${sn}">
               00:00,00
             </div>
           </div>
        </div>
      </div>

      <div class="relative z-10 flex md:hidden flex-col gap-3">
        <div class="flex items-center justify-between">
           <div class="flex items-center gap-3 min-w-0">
             <div class="bg-white/10 px-2 py-1 rounded border border-white/10 font-bold font-mono text-xl">#${equipage.startNumber}</div>
             <div class="min-w-0">
               <h2 class="text-lg font-bold truncate leading-tight">${equipage.driverName}</h2>
               <div class="flex items-center gap-2">
                 <span class="inline-flex items-center gap-1 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold uppercase tracking-wider border border-emerald-500/30 px-1">
                   <span class="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                   Live
                 </span>
                 <span class="text-slate-400 text-[10px] truncate">${equipage.className}</span>
               </div>
             </div>
           </div>
           <div class="text-right">
             <div id="livePanelTimer-mob-${sn}" class="text-3xl font-black tabular-nums leading-none text-white tracking-tight">00:00,00</div>
             <div class="text-[9px] text-slate-400 uppercase font-bold tracking-widest mt-0.5">Löpande tid</div>
           </div>
        </div>

        <div class="grid grid-cols-3 gap-2 pt-2 border-t border-white/10">
           <div class="bg-white/5 p-2 rounded text-center">
             <div class="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Straff</div>
             <div class="text-lg font-bold text-blue-300" id="livePanelPenalty-mob-${sn}">${formatPanelPenalty(totalPenalty)}</div>
           </div>
           <div class="bg-white/5 p-2 rounded text-center">
             <div class="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Delplac.</div>
             <div class="text-lg font-bold text-yellow-400" id="livePanelRank-mob-${sn}">-</div>
           </div>
           <div class="bg-white/5 p-2 rounded text-center">
             <div class="text-[9px] text-slate-400 uppercase font-bold mb-0.5">Totalp.</div>
             <div class="text-lg font-bold text-emerald-400">${overallRank || '-'}</div>
           </div>
        </div>
      </div>
    </div>
  `;
}

export function updatePrecisionLivePanelTimer(sn, label, penalty, rank, root = document) {
  const ids = [
    [`livePanelTimer-${sn}`, label],
    [`livePanelTimer-mob-${sn}`, label],
    [`livePanelPenalty-${sn}`, penalty],
    [`livePanelPenalty-mob-${sn}`, penalty],
    [`livePanelRank-${sn}`, rank],
    [`livePanelRank-mob-${sn}`, rank]
  ];

  ids.forEach(([id, value]) => {
    if (!value) return;
    const el = root.getElementById(id);
    if (el) el.textContent = value;
  });
}
