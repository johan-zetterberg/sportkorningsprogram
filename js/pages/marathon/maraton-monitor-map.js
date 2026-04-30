import { t } from '../../utils/i18n.js';
import { getFlagHtml } from '../../services/flagsService.js';
import { getClubLogoHtml } from '../../services/logosService.js';
import { showAlert } from '../../ui/components.js';
import { getObstacleArray, formatMsLive, pausedMsSince } from '../../utils/marathonUtils.js';

let map = null;
let resizeObserver = null;
let markers = new Map(); // sn -> marker
let staticMarkers = []; // list of markers for obstacles/starts
let currentConfig = null;
let imageOverlay = null;

const DEFAULT_COORDS = {
    'stage_A': [855, 290],
    'transport': [700, 400],
    'stage_B': [180, 770],
    'finish': [180, 770],
    'hinder_1': [570, 260],
    'hinder_2': [865, 500],
    'hinder_3': [785, 685],
    'hinder_4': [615, 875],
    'hinder_5': [435, 590],
    'hinder_6': [420, 395],
    'hinder_7': [300, 160],
    'hinder_8': [165, 275]
};

const DEFAULT_IMAGE = 'img/marathon-course-new.png';

let hasInitiallyFitted = false;
let lastSidebarHash = ""; // Track state of sidebar to avoid full re-renders

export function renderMap(container, activeEquipages, mapConfig = null) {
    if (!container) return;

    // Use passed config or fallback
    currentConfig = mapConfig;

    const rawBounds = currentConfig?.bounds || [[0, 0], [1080, 1920]];
    let bounds = rawBounds;
    if (Array.isArray(rawBounds) && rawBounds.length === 4 && !Array.isArray(rawBounds[0])) {
        bounds = [[rawBounds[0], rawBounds[1]], [rawBounds[2], rawBounds[3]]];
    }

    // Robustness check: if map exists but its container is not in the DOM anymore, re-init
    const mapDiv = document.getElementById('maraton-live-map');
    if (!map || !mapDiv || !map.getContainer().isConnected) {
        destroyMap();
        initMap(container);
        hasInitiallyFitted = false; // Reset on re-init
    } else {
        // Update existing imageOverlay if config changed
        const imgUrl = currentConfig?.imageUrl || DEFAULT_IMAGE;
        if (imageOverlay) {
            imageOverlay.setUrl(imgUrl);
            imageOverlay.setBounds(bounds);
        }

        // Handle tab switching / visibility changes
        requestAnimationFrame(() => {
            if (map) {
                map.invalidateSize();

                // One-time fit if we have a visible container
                if (!hasInitiallyFitted) {
                    const size = map.getSize();
                    if (size.x > 50 && size.y > 50) { // Safety margin
                        map.fitBounds(bounds);
                        hasInitiallyFitted = true;
                    }
                }
            }
        });
    }

    updateStaticMarkers();
    updateMarkers(activeEquipages);
    updateLegend(activeEquipages);
    updateSidebar(activeEquipages);
}

function initMap(container) {
    const imgUrl = currentConfig?.imageUrl || DEFAULT_IMAGE;
    const rawBounds = currentConfig?.bounds || [[0, 0], [1000, 1000]];

    // Normalize bounds: Firestore doesn't like nested arrays, so we might get [0,0,y,x]
    let bounds = rawBounds;
    if (Array.isArray(rawBounds) && rawBounds.length === 4 && !Array.isArray(rawBounds[0])) {
        bounds = [[rawBounds[0], rawBounds[1]], [rawBounds[2], rawBounds[3]]];
    }

    container.innerHTML = `
        <div class="flex flex-col lg:flex-row gap-4 w-full h-[700px]">
            <div class="relative z-0 flex-1 bg-gray-100 rounded-xl overflow-hidden shadow-inner border border-gray-200">
                <div id="maraton-live-map" class="w-full h-full"></div>
                <div id="maraton-map-legend" class="absolute top-4 right-4 z-[1000] bg-white/95 backdrop-blur-md p-3 rounded-xl shadow-xl border border-white/20 text-[10px] min-w-[120px]">
                    <h4 class="font-bold mb-2 uppercase tracking-tight text-gray-400 border-b pb-1 text-[9px]">${t('map_legend_title') || 'Teckenförklaring'}</h4>
                    <div id="legend-items" class="flex flex-col gap-2">
                        <!-- Dynamic classes here -->
                    </div>
                </div>
            </div>
            
            <div id="maraton-map-sidebar" class="w-full lg:w-80 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-80 lg:h-full overflow-hidden">
                <div class="p-4 border-b bg-gray-50 flex items-center justify-between">
                    <h3 class="font-bold text-gray-800 text-sm italic uppercase tracking-wider">${t('equipages_on_course')}</h3>
                    <span id="active-count-badge" class="bg-brand-darkblue text-white text-[10px] font-black px-2 py-0.5 rounded-full">0</span>
                </div>
                <div id="maraton-active-list" class="flex-1 overflow-y-auto p-2 space-y-2 bg-gray-50/30">
                    <!-- Dynamic list items -->
                </div>
            </div>
        </div>
    `;

    // Initialize Leaflet with simple CRS (Cartesian) and smooth zoom
    map = L.map('maraton-live-map', {
        crs: L.CRS.Simple,
        minZoom: -4,
        maxZoom: 3,
        zoomSnap: 0,       // Full continuous zoom
        zoomDelta: 0.05,   // Extremely small increments for zoom buttons
        wheelPxPerZoomLevel: 150, // More pixels per level makes it feel slower/smoother
        zoomControl: true,
        attributionControl: false
    });

    imageOverlay = L.imageOverlay(imgUrl, bounds).addTo(map);

    imageOverlay.on('error', () => {
        showAlert(t('map_load_error'), false);
    });

    map.fitBounds(bounds);

    // Automaticaly handle visibility/size changes (Fix for "starts out of view" / "small map")
    const mapEl = document.getElementById('maraton-live-map');
    if (mapEl && typeof ResizeObserver !== 'undefined' && !resizeObserver) {
        resizeObserver = new ResizeObserver(() => {
            if (map && map.getContainer().isConnected) {
                map.invalidateSize();
                // Only fitBounds on resize if user hasn't moved the map significantly?
                // For now, let's keep it simple but ensure it doesn't break flyTo
            }
        });
        resizeObserver.observe(mapEl);
    }
}

function updateLegend(activeEquipages) {
    const legendEl = document.getElementById('legend-items');
    if (!legendEl) return;

    const activeClasses = new Set();
    activeEquipages.forEach(active => {
        if (active.equipageInfo.className) activeClasses.add(active.equipageInfo.className);
    });

    let html = `
        <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]"></span>
            <span class="font-semibold text-gray-700 uppercase tracking-wide">${t('in_obstacle') || 'I hinder'}</span>
        </div>
    `;

    Array.from(activeClasses).sort().forEach(className => {
        const color = getColorForClass(className);
        html += `
            <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full" style="background-color: ${color}"></span>
                <span class="text-gray-600 font-medium">${className}</span>
            </div>
        `;
    });

    legendEl.innerHTML = html;
}

function getColorForClass(className) {
    if (!className) return '#3b82f6';
    const c = className.toLowerCase().trim();
    if (c.includes('lätt b') || c.includes('lb')) return '#22c55e'; // Green
    if (c.includes('lätt a') || c.includes('la')) return '#3b82f6'; // Blue
    if (c.includes('msv') || c.includes('medelsv')) return '#9333ea'; // Distinct Vibrant Purple
    if (c.includes('svår') || c.includes('elit') || c.includes('svär')) return '#dc2626'; // Red
    return '#6366f1'; // Indigo default
}

function updateMarkers(activeEquipages) {
    if (!map) return;

    // 1. Identify which SNs are still active
    const activeSns = new Set(activeEquipages.keys());

    // 2. Remove markers for SNs no longer active
    for (const [sn, marker] of markers.entries()) {
        if (!activeSns.has(sn)) {
            marker.remove();
            markers.delete(sn);
        }
    }

    // 3. Group by calculated position for jitter
    const posGroups = new Map();
    activeEquipages.forEach((active, sn) => {
        const coords = getCoordsForActive(active);
        if (!coords) return;
        const key = coords.join(',');
        if (!posGroups.has(key)) posGroups.set(key, []);
        posGroups.get(key).push({ sn, active, coords });
    });

    // 4. Add or move markers with jitter
    posGroups.forEach((group) => {
        const count = group.length;

        group.forEach((item, index) => {
            const { sn, active, coords } = item;
            let finalCoords = [...coords];

            // Apply jitter if multiple markers at same calculated spot
            if (count > 1) {
                const angle = (index / count) * Math.PI * 2;
                const radius = 22;
                finalCoords[0] += Math.sin(angle) * radius;
                finalCoords[1] += Math.cos(angle) * radius;
            }

            let marker = markers.get(sn);
            const isObstacle = active.task.type === 'obstacle';
            const classColor = getColorForClass(active.equipageInfo.className);
            const color = isObstacle ? '#f59e0b' : classColor;

            const iconHtml = `
                <div class="relative group">
                    <div class="map-marker-ping" style="background-color: ${color}"></div>
                    <div class="map-marker-body" style="background-color: ${color}">
                        <span class="map-marker-sn">#${sn}</span>
                    </div>
                    <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-[5000]">
                        <div class="bg-gray-900/95 backdrop-blur text-white text-[11px] py-1.5 px-3 rounded-lg whitespace-nowrap shadow-2xl border border-white/20">
                            <div class="font-bold flex items-center gap-2">
                                ${sn}. ${active.equipageInfo.driverName}
                            </div>
                            <div class="text-white/70 text-[10px] uppercase tracking-wider mt-0.5">
                                ${active.task.name} • ${active.equipageInfo.className}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const customIcon = L.divIcon({
                html: iconHtml,
                className: 'custom-div-icon',
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });

            const penaltyVal = active.totalPenalty !== null ? (active.totalPenalty === Infinity ? 'ELIM' : active.totalPenalty.toFixed(1)) : '0.0';

            const popupHtml = `
                <div class="p-3 min-w-[200px] font-sans">
                    <div class="flex items-center gap-2 mb-3 border-b pb-2">
                       <span class="bg-gray-800 text-white font-black px-2 py-1 rounded text-xs shadow-sm">#${sn}</span>
                       <div class="truncate">
                           <div class="font-bold text-sm text-gray-900 leading-tight">${active.equipageInfo.driverName}</div>
                           <div class="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                               ${getFlagHtml(active.equipageInfo)}
                               ${active.equipageInfo.clubName || ''}
                           </div>
                       </div>
                    </div>
                    
                    <div class="space-y-2 mb-4">
                        <div class="flex justify-between items-end">
                            <div>
                                <div class="text-[9px] text-gray-400 uppercase font-black tracking-wider mb-0.5">${t('status') || 'Status'}</div>
                                <div class="text-xs font-bold ${isObstacle ? 'text-amber-600' : 'text-blue-600'} flex items-center gap-1">
                                    ${isObstacle ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>' : ''}
                                    ${active.task.name}
                                </div>
                            </div>
                            <div class="text-right">
                                <div class="text-[9px] text-gray-400 uppercase font-black tracking-wider mb-0.5">${t('penalty') || 'Straff'}</div>
                                <div class="text-sm font-black text-gray-900">${penaltyVal}</div>
                            </div>
                        </div>

                        ${active.equipageInfo.horseNames ? `
                        <div class="bg-gray-50 p-2 rounded border border-gray-100">
                           <div class="text-[9px] text-gray-400 uppercase font-black tracking-wider mb-1">${t('horses') || 'Hästar'}</div>
                           <div class="text-[10px] text-gray-700 leading-tight">${active.equipageInfo.horseNames}</div>
                        </div>
                        ` : ''}
                    </div>

                    <button onclick="window.openMarathonDetailsModal('${sn}')" class="w-full bg-gray-800 hover:bg-gray-700 text-white text-[11px] font-black py-2 rounded-lg transition-all shadow-md active:scale-95">
                        ${t('view_details') || 'VISA DETALJER'}
                    </button>
                    <div class="text-[9px] text-gray-400 text-center mt-2 italic text-gray-400 font-normal">${t('click_map_to_close') || 'Klicka på kartan för att stänga'}</div>
                </div>
            `;

            if (!marker) {
                marker = L.marker(finalCoords, { icon: customIcon }).addTo(map);
                markers.set(sn, marker);
                marker.bindPopup(popupHtml, { closeButton: false, offset: [0, -10], className: 'driver-popup' });
            } else {
                marker.setLatLng(finalCoords);
                marker.setIcon(customIcon);
                marker.setPopupContent(popupHtml);
            }
        });
    });
}

export function updateSidebar(activeEquipages, tickTimeNow = Date.now()) {
    const listEl = document.getElementById('maraton-active-list');
    const badgeEl = document.getElementById('active-count-badge');
    if (!listEl) return;

    if (badgeEl) badgeEl.textContent = activeEquipages.size;

    if (activeEquipages.size === 0) {
        listEl.innerHTML = `
            <div class="flex flex-col items-center justify-center h-20 text-gray-400 text-[11px] italic">
                ${t('no_active_equipages')}
            </div>
        `;
        lastSidebarHash = "empty";
        return;
    }

    // Sort by SN
    const sorted = Array.from(activeEquipages.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));

    // Create a hash of the current "structural" state (who is active and their status)
    const currentHash = sorted.map(([sn, active]) => `${sn}:${active.task.name}`).join('|');

    // ONLY rebuild the full list if structure changed
    if (currentHash !== lastSidebarHash) {
        let html = '';
        sorted.forEach(([sn, active]) => {
            const isObstacle = active.task.type === 'obstacle';
            const classColor = getColorForClass(active.equipageInfo.className);

            const timerClasses = isObstacle
                ? 'bg-amber-100 text-amber-700 animate-pulse border border-amber-200'
                : 'bg-blue-50 text-blue-700 border border-blue-100';

            html += `
                <div onclick="window.focusDriverOnMap('${sn}')" class="group flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-100 shadow-sm hover:border-gray-200 transition-all cursor-pointer active:scale-[0.98]">
                    <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm shadow-sm shrink-0" style="background-color: ${classColor}">
                        ${sn}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-start mb-1">
                            <div class="font-bold text-gray-900 text-[11px] truncate uppercase tracking-tight">${active.equipageInfo.driverName}</div>
                            <div id="sidebar-timer-${sn}" class="text-[10px] font-black font-mono px-1.5 py-0.5 rounded shadow-sm ${timerClasses}">00:00,00</div>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-[9px] font-bold uppercase tracking-tighter ${isObstacle ? 'text-amber-600' : 'text-gray-400'}">
                                ${active.task.name}
                            </span>
                            <span class="text-[9px] text-gray-400 truncate opacity-50">•</span>
                            <span class="text-[9px] text-gray-400 truncate">${active.equipageInfo.className}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        listEl.innerHTML = html;
        lastSidebarHash = currentHash;
    }

    // ALWAYS update just the timer text (Atomic update - keeps click handlers alive)
    sorted.forEach(([sn, active]) => {
        const timerEl = document.getElementById(`sidebar-timer-${sn}`);
        if (timerEl) {
            const timerBase = active.timerBaseMs;
            let liveTime = '00:00,00';
            if (timerBase) {
                const diff = tickTimeNow - timerBase;
                const pauseToSubtract = active.timerIsVirtual ? 0 : pausedMsSince(timerBase, tickTimeNow);
                const ms = diff - pauseToSubtract + (active.pausedMs || 0);
                liveTime = formatMsLive(ms);
            }
            if (timerEl.textContent !== liveTime) {
                timerEl.textContent = liveTime;
            }
        }
    });
}

// Global bridge to center map on a driver
window.focusDriverOnMap = (sn) => {
    if (!map) return;

    // Snug fit into string
    const snStr = String(sn);
    const marker = markers.get(snStr);

    if (marker) {
        // Ensure map size is correct before centering
        map.invalidateSize();

        // 1. Zoom to a predictable level if too far out
        const targetZoom = Math.max(map.getZoom(), 1.5);

        // 2. flyTo for smooth movement
        map.flyTo(marker.getLatLng(), targetZoom, {
            animate: true,
            duration: 0.6
        });

        // 3. Open the popup after movement starts
        setTimeout(() => {
            if (marker.getContainer && marker.getElement()) marker.openPopup();
            else if (marker.openPopup) marker.openPopup();
        }, 300);
    } else {
        console.warn(`[MaratonMap] Could not find marker for SN: ${snStr}`);
    }
};

function getCoordsForActive(active) {
    const type = active.task.type;
    const key = active.task.key;
    const coordsMap = currentConfig?.entities || DEFAULT_COORDS;

    // Position at obstacle
    if (type === 'obstacle') {
        const obsNum = active.data.currentObstacle;
        return coordsMap[`hinder_${obsNum}`] || coordsMap['stage_B'];
    }

    if (key === 'A') return coordsMap['stage_A'];
    if (key === 'transport') return coordsMap['transport'];

    // Stage B tracking: Distribute markers along the "Track"
    if (key === 'B') {
        let lastObs = Number(active.data.currentObstacle || 0);

        // If not currently in an obstacle, find the last finished one from history
        if (lastObs === 0) {
            const history = getObstacleArray(active.data);
            history.forEach(obs => {
                const num = Number(obs.number || obs.id || 0);
                if (num > lastObs) lastObs = num;
            });
        }

        // 1. Check if we have a specific "Path" point after this obstacle
        // Format: 'hinder_1_to_2'
        const pathKey = `hinder_${lastObs}_to_${lastObs + 1}`;
        if (coordsMap[pathKey]) return coordsMap[pathKey];

        // 2. Fallback: Interpolate between obstacle N and N+1
        const start = coordsMap[`hinder_${lastObs}`] || coordsMap['stage_B'];
        const end = coordsMap[`hinder_${lastObs + 1}`] || coordsMap['finish'] || coordsMap['stage_B'];

        // Offset a bit from the obstacle to show movement
        if (start && end && lastObs > 0) {
            return [
                start[0] + (end[0] - start[0]) * 0.4,
                start[1] + (end[1] - start[1]) * 0.4
            ];
        }

        return coordsMap['stage_B'];
    }

    return [500, 500]; // Center fallback
}

function updateStaticMarkers() {
    // Clear old
    staticMarkers.forEach(m => m.remove());
    staticMarkers = [];

    if (!map) return;

    const coordsMap = currentConfig?.entities || DEFAULT_COORDS;

    Object.entries(coordsMap).forEach(([key, coords]) => {
        // Only show actual points, not paths like hinder_1_to_2
        if (key.includes('_to_')) return;

        const label = getStaticLabel(key);
        if (!label) return;

        const isSpecial = ['stage_A', 'stage_B', 'transport', 'finish'].includes(key);
        const colorClass = key === 'finish' ? 'bg-red-600 text-white border-white scale-110' :
            (isSpecial ? 'bg-blue-600 text-white border-white' : 'bg-white text-gray-700 border-gray-400');

        const iconHtml = `
            <div class="static-marker">
                <div class="static-marker-bubble ${colorClass}">
                    ${label}
                </div>
            </div>
        `;

        const icon = L.divIcon({
            html: iconHtml,
            className: 'static-div-icon',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        const m = L.marker(coords, {
            icon,
            interactive: true,
            zIndexOffset: -100 // Behind active drivers
        }).addTo(map);

        m.bindTooltip(getStaticFullName(key), { direction: 'top', offset: [0, -10] });
        staticMarkers.push(m);
    });
}

function getStaticLabel(key) {
    if (key.startsWith('hinder_')) return key.replace('hinder_', '');
    if (key === 'stage_A') return 'A';
    if (key === 'stage_B') return 'B';
    if (key === 'transport') return 'T';
    if (key === 'finish') return 'M';
    return null;
}

function getStaticFullName(key) {
    if (key.startsWith('hinder_')) return t('obstacle') + ' ' + key.replace('hinder_', '');
    if (key === 'stage_A') return t('marathon_start_stage_a');
    if (key === 'stage_B') return t('marathon_start_stage_b');
    if (key === 'transport') return t('marathon_start_transport');
    if (key === 'finish') return t('finish');
    return key;
}

export function destroyMap() {
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    if (map) {
        map.remove();
        map = null;
        imageOverlay = null;
        markers.clear();
        staticMarkers = [];
        currentConfig = null;
        lastSidebarHash = "";
    }
}
