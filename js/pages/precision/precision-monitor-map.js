import { getFlagHtml } from '../../services/flagsService.js';

let map = null;
let resizeObserver = null;
let markers = new Map(); // sn -> marker
let staticMarkers = []; 
let currentConfig = null;
let imageOverlay = null;

const DEFAULT_IMAGE = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">
  <rect width="1920" height="1080" fill="#f1f5f9"/>
  <g stroke="#cbd5e1" stroke-width="2" opacity="0.8">
    <path d="M0 180H1920M0 360H1920M0 540H1920M0 720H1920M0 900H1920"/>
    <path d="M320 0V1080M640 0V1080M960 0V1080M1280 0V1080M1600 0V1080"/>
  </g>
  <text x="960" y="520" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="700" fill="#64748b">Precision</text>
  <text x="960" y="585" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="#94a3b8">Ingen banbild vald</text>
</svg>`);
let hasInitiallyFitted = false;
let lastSidebarHash = "";
let animationFrameId = null;
let currentActiveEquipages = new Map();
let currentMonitorDriver = null;
let currentFullConfig = null;
let currentOrderedGates = [];
let pathLinePassed = null;
let pathLineUpcoming = null;
let currentDensePath = [];

function renderLeafletFallback(container) {
    if (!container) return;
    container.innerHTML = `
        <div class="flex items-center justify-center w-full min-h-[260px] rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/60 px-4 text-center text-sm text-gray-500 dark:text-gray-300">
            Kartvyn är tillfälligt otillgänglig. Byt till listvy eller prova igen när kartbiblioteket har laddats.
        </div>
    `;
}

function safeInvalidateMapSize(mapRef = map, bounds = null) {
    if (!mapRef || mapRef !== map) return false;
    const mapContainer = mapRef.getContainer?.();
    if (!mapContainer?.isConnected) return false;

    mapRef.invalidateSize();
    if (bounds && !hasInitiallyFitted) {
        const size = mapRef.getSize();
        if (size.x > 50 && size.y > 50) {
            mapRef.fitBounds(bounds);
            hasInitiallyFitted = true;
        }
    }
    return true;
}

function generateSplinePath(gates, segments = 20) {
    if (!gates || gates.length < 2) return [];
    
    const pts = gates.map(g => g.coords);
    const densePath = [];
    
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = i === 0 ? pts[0] : pts[i - 1];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = i === pts.length - 2 ? pts[pts.length - 1] : pts[i + 2];
        
        for (let j = 0; j < segments; j++) {
            const t = j / segments;
            const t2 = t * t;
            const t3 = t2 * t;
            
            const x = 0.5 * (
                (2 * p1[0]) +
                (-p0[0] + p2[0]) * t +
                (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            );
            
            const y = 0.5 * (
                (2 * p1[1]) +
                (-p0[1] + p2[1]) * t +
                (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            );
            
            densePath.push({
                coords: [x, y],
                segmentIndex: i,
                localT: t
            });
        }
    }
    
    densePath.push({
        coords: pts[pts.length - 1],
        segmentIndex: pts.length - 2,
        localT: 1.0
    });
    
    return densePath;
}

function getOrderedGates(coordsMap, activeClasses = new Set()) {
    let allowedLabels = null;

    if (activeClasses.size > 0 && currentFullConfig?.courses) {
        const firstClass = Array.from(activeClasses)[0];
        const course = currentFullConfig.courses[firstClass];
        if (course && Array.isArray(course.obstacleLabels) && course.obstacleLabels.length > 0) {
            allowedLabels = course.obstacleLabels.map(l => String(l).trim());
        }
    }

    if (allowedLabels) {
        const path = [];
        if (coordsMap['start']) path.push({ id: 'start', coords: coordsMap['start'] });
        allowedLabels.forEach(lbl => {
            const key = `gate_${lbl}`;
            if (coordsMap[key]) path.push({ id: key, coords: coordsMap[key] });
        });
        if (coordsMap['finish']) path.push({ id: 'finish', coords: coordsMap['finish'] });
        return path;
    }

    // Fallback: show all mapped gates
    const keys = Object.keys(coordsMap);
    const gates = keys.filter(k => k.startsWith('gate_')).sort((a, b) => {
        const numA = parseInt(a.replace('gate_', '')) || 0;
        const numB = parseInt(b.replace('gate_', '')) || 0;
        if (numA !== numB) return numA - numB;
        return a.localeCompare(b);
    });
    const path = [];
    if (coordsMap['start']) path.push({ id: 'start', coords: coordsMap['start'] });
    gates.forEach(g => path.push({ id: g, coords: coordsMap[g] }));
    if (coordsMap['finish']) path.push({ id: 'finish', coords: coordsMap['finish'] });
    return path;
}

export function renderMap(container, activeEquipages, mapConfig = null, currentDriver = null, fullConfig = null) {
    if (!container) return;
    if (typeof window.L === 'undefined') {
        destroyMap();
        renderLeafletFallback(container);
        return;
    }
    currentConfig = mapConfig;
    currentActiveEquipages = activeEquipages;
    currentMonitorDriver = currentDriver;
    currentFullConfig = fullConfig;
    currentOrderedGates = getOrderedGates(currentConfig?.entities || {});

    const rawBounds = currentConfig?.bounds || [[0, 0], [1080, 1920]];
    let bounds = rawBounds;
    if (Array.isArray(rawBounds) && rawBounds.length === 4 && !Array.isArray(rawBounds[0])) {
        bounds = [[rawBounds[0], rawBounds[1]], [rawBounds[2], rawBounds[3]]];
    }

    const mapDiv = document.getElementById('precision-live-map');
    if (!map || !mapDiv || !map.getContainer().isConnected) {
        destroyMap();
        initMap(container);
        hasInitiallyFitted = false;
    } else {
        const hideBg = currentConfig?.hideBackground === true;
        const imgUrl = currentConfig?.imageUrl || DEFAULT_IMAGE;
        
        if (imageOverlay) {
            if (hideBg) {
                // If hideBackground is enabled, remove the image overlay and set a tactical background color on the map container
                imageOverlay.setUrl(''); 
                imageOverlay.setOpacity(0);
                map.getContainer().style.backgroundColor = '#0f172a'; // Tailwind slate-900
                map.getContainer().style.backgroundImage = 'linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px)';
                map.getContainer().style.backgroundSize = '40px 40px';
            } else {
                // Restore normal image
                imageOverlay.setUrl(imgUrl);
                imageOverlay.setOpacity(1);
                imageOverlay.setBounds(bounds);
                map.getContainer().style.backgroundColor = '';
                map.getContainer().style.backgroundImage = '';
            }
        }
        
        const mapRef = map;
        requestAnimationFrame(() => safeInvalidateMapSize(mapRef, bounds));
    }

    updateStaticMarkers();
    startAnimationLoop();
    updateLegend(activeEquipages);
    updateSidebar(activeEquipages);
}

function startAnimationLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    function loop() {
        if (!map) return;
        updateMarkersInterpolated();
        animationFrameId = requestAnimationFrame(loop);
    }
    loop();
}

function getInterpolatedCoords(active, orderedGates) {
    if (!orderedGates || orderedGates.length < 2) return { coords: getCoordsForActive(active), segmentIndex: 0, localT: 0 };
    const data = active.data || {};
    const splits = data.gateSplits || {};
    const startAbs = splits['start'] || data.liveStartEpoch;
    
    if (!startAbs) return { coords: getCoordsForActive(active), segmentIndex: 0, localT: 0 };

    let elapsedMs = 0;
    if (data.running && data.liveStartEpoch) {
        const receivedAt = data._receivedLocalAt || Date.now();
        elapsedMs = (data.livePausedMs || 0) + (receivedAt - data.liveStartEpoch) + (Date.now() - receivedAt);
    } else {
        elapsedMs = data.liveTimeMs || data.timeMs || 0;
    }

    if (!data.running && data.status !== 'Pågår') return { coords: getCoordsForActive(active), segmentIndex: -1, localT: 0 };

    const pathNodes = orderedGates.map(g => {
        let gateElapsed = null;
        if (splits[g.id]) gateElapsed = Math.max(0, splits[g.id] - startAbs);
        else if (g.id === 'start') gateElapsed = 0;
        return { ...g, time: gateElapsed };
    });

    let lastNodeIndex = -1;
    let maxTime = -1;
    for (let i = 0; i < pathNodes.length; i++) {
        if (pathNodes[i].time !== null && pathNodes[i].time > maxTime) {
            maxTime = pathNodes[i].time;
            lastNodeIndex = i;
        }
    }

    if (lastNodeIndex === -1) return { coords: pathNodes[0]?.coords || [500, 500], segmentIndex: 0, localT: 0 };
    if (lastNodeIndex === pathNodes.length - 1) return { coords: pathNodes[lastNodeIndex].coords, segmentIndex: pathNodes.length - 2, localT: 1.0 };

    const lastNode = pathNodes[lastNodeIndex];
    const nextNode = pathNodes[lastNodeIndex + 1];

    const timeSinceLastGate = elapsedMs - lastNode.time;
    if (timeSinceLastGate < 0) return { coords: lastNode.coords, segmentIndex: lastNodeIndex, localT: 0 }; 

    let speedPxPerMs = 0.05; 
    if (lastNodeIndex > 0) {
        const prevNode = pathNodes[lastNodeIndex - 1];
        if (prevNode.time !== null) {
            const timeDiff = lastNode.time - prevNode.time;
            if (timeDiff > 1000) {
                const prevDist = Math.hypot(lastNode.coords[0] - prevNode.coords[0], lastNode.coords[1] - prevNode.coords[1]);
                speedPxPerMs = prevDist / timeDiff;
            }
        }
    }
    speedPxPerMs = Math.max(0.01, Math.min(speedPxPerMs, 0.2)); 

    const dist = Math.hypot(nextNode.coords[0] - lastNode.coords[0], nextNode.coords[1] - lastNode.coords[1]);
    const estimatedTimeForSegment = dist / speedPxPerMs;

    let progress = timeSinceLastGate / estimatedTimeForSegment;
    if (progress > 0.95) progress = 0.95; 

    // Använd Catmull-Rom spline för exakt markör-position på den rundade kurvan
    const t = progress;
    const t2 = t * t;
    const t3 = t2 * t;

    const p0 = lastNodeIndex === 0 ? pathNodes[0].coords : pathNodes[lastNodeIndex - 1].coords;
    const p1 = pathNodes[lastNodeIndex].coords;
    const p2 = pathNodes[lastNodeIndex + 1].coords;
    const p3 = lastNodeIndex >= pathNodes.length - 2 ? pathNodes[pathNodes.length - 1].coords : pathNodes[lastNodeIndex + 2].coords;

    const x = 0.5 * (
        (2 * p1[0]) +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
    );
    const y = 0.5 * (
        (2 * p1[1]) +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
    );

    return { coords: [x, y], segmentIndex: lastNodeIndex, localT: progress };
}

function initMap(container) {
    const imgUrl = currentConfig?.imageUrl || DEFAULT_IMAGE;
    const rawBounds = currentConfig?.bounds || [[0, 0], [1080, 1920]];
    let bounds = rawBounds;
    if (Array.isArray(rawBounds) && rawBounds.length === 4 && !Array.isArray(rawBounds[0])) {
        bounds = [[rawBounds[0], rawBounds[1]], [rawBounds[2], rawBounds[3]]];
    }

    container.innerHTML = `
        <div class="flex w-full h-[400px] lg:h-[700px]">
            <div class="relative z-0 w-full h-full bg-gray-100 rounded-xl overflow-hidden shadow-inner border border-gray-200">
                <div id="precision-live-map" class="w-full h-full"></div>
                <div id="precision-map-legend" class="absolute top-4 right-4 z-[1000] bg-white/95 backdrop-blur-md p-3 rounded-xl shadow-xl border border-white/20 text-[10px] min-w-[120px]">
                    <h4 class="font-bold mb-2 uppercase tracking-tight text-gray-400 border-b pb-1 text-[9px]">Klasser</h4>
                    <div id="prec-legend-items" class="flex flex-col gap-2"></div>
                </div>
            </div>
        </div>
    `;

    map = L.map('precision-live-map', {
        crs: L.CRS.Simple,
        preferCanvas: true,
        minZoom: -4,
        maxZoom: 3,
        zoomSnap: 0,
        zoomDelta: 0.05,
        wheelPxPerZoomLevel: 150,
        zoomControl: true,
        attributionControl: false
    });

    const hideBg = currentConfig?.hideBackground === true;
    
    if (hideBg) {
        imageOverlay = L.imageOverlay('', bounds, { opacity: 0 }).addTo(map);
        map.getContainer().style.backgroundColor = '#0f172a'; // Tailwind slate-900
        map.getContainer().style.backgroundImage = 'linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px)';
        map.getContainer().style.backgroundSize = '40px 40px';
    } else {
        imageOverlay = L.imageOverlay(imgUrl, bounds).addTo(map);
        map.getContainer().style.backgroundColor = '';
        map.getContainer().style.backgroundImage = '';
    }
    
    map.fitBounds(bounds);

    const mapEl = document.getElementById('precision-live-map');
    if (mapEl && typeof ResizeObserver !== 'undefined' && !resizeObserver) {
        const mapRef = map;
        resizeObserver = new ResizeObserver(() => {
            safeInvalidateMapSize(mapRef, bounds);
        });
        resizeObserver.observe(mapEl);
    }
}

function updateLegend(activeEquipages) {
    const legendEl = document.getElementById('prec-legend-items');
    if (!legendEl) return;
    const activeClasses = new Set();
    activeEquipages.forEach(active => {
        if (active.equipageInfo.className) activeClasses.add(active.equipageInfo.className);
    });

    let html = '';
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
    if (c.includes('lätt b') || c.includes('lb')) return '#22c55e';
    if (c.includes('lätt a') || c.includes('la')) return '#3b82f6';
    if (c.includes('msv') || c.includes('medelsv')) return '#9333ea';
    if (c.includes('svår') || c.includes('elit')) return '#dc2626';
    return '#6366f1';
}

function updateMarkersInterpolated() {
    if (!map) return;
    const activeSns = new Set(currentActiveEquipages.keys());

    for (const [sn, marker] of markers.entries()) {
        if (!activeSns.has(sn)) {
            marker.remove();
            markers.delete(sn);
        }
    }

    const posGroups = new Map();
    let leadDriverPathUpdate = null;

    currentActiveEquipages.forEach((active, sn) => {
        const result = getInterpolatedCoords(active, currentOrderedGates);
        if (!result) return;
        
        // Save first active driver's progress for line updates
        if (!leadDriverPathUpdate) {
            leadDriverPathUpdate = result;
        }

        const coords = result.coords;
        const key = coords.map(c => Math.round(c)).join(',');
        if (!posGroups.has(key)) posGroups.set(key, []);
        posGroups.get(key).push({ sn, active, coords });
    });

    // Update lines
    if (leadDriverPathUpdate && currentDensePath.length > 0 && pathLinePassed && pathLineUpcoming) {
        const { coords, segmentIndex, localT } = leadDriverPathUpdate;
        
        // If segmentIndex is -1 (finished/not started), handle gracefully
        if (segmentIndex < 0) {
            pathLinePassed.setLatLngs(currentDensePath.map(p => p.coords));
            pathLineUpcoming.setLatLngs([]);
        } else {
            // Find split index
            let splitIndex = currentDensePath.findIndex(p => p.segmentIndex > segmentIndex || (p.segmentIndex === segmentIndex && p.localT >= localT));
            if (splitIndex === -1) splitIndex = currentDensePath.length;

            const passedPoints = currentDensePath.slice(0, splitIndex).map(p => p.coords);
            passedPoints.push(coords); // Anslut exakt till ikonen
            
            const upcomingPoints = [coords, ...currentDensePath.slice(splitIndex).map(p => p.coords)];

            pathLinePassed.setLatLngs(passedPoints);
            pathLineUpcoming.setLatLngs(upcomingPoints);
        }
        window._precisionMapLinesEmpty = false;
    } else if (pathLineUpcoming && pathLinePassed && currentActiveEquipages.size === 0) {
        if (!window._precisionMapLinesEmpty) {
            pathLineUpcoming.setLatLngs(currentDensePath.map(p => p.coords));
            pathLinePassed.setLatLngs([]);
            window._precisionMapLinesEmpty = true;
        }
    }

    posGroups.forEach((group) => {
        const count = group.length;
        group.forEach((item, index) => {
            const { sn, active, coords } = item;
            let finalCoords = [...coords];

            if (count > 1) {
                const angle = (index / count) * Math.PI * 2;
                const radius = 22;
                finalCoords[0] += Math.sin(angle) * radius;
                finalCoords[1] += Math.cos(angle) * radius;
            }

            let marker = markers.get(sn);
            const classColor = getColorForClass(active.equipageInfo.className);

            const iconHtml = `
                <div class="relative group" style="transition: transform 0.1s linear;">
                    <div class="map-marker-ping" style="background-color: ${classColor}"></div>
                    <div class="flex items-center justify-center w-10 h-10 rounded-full shadow-lg" style="background-color: ${classColor}; border: 2px solid white; transform: scale(0.9); transition: transform 0.2s;">
                        <span class="font-black text-white text-sm" style="text-shadow: 0 1px 2px rgba(0,0,0,0.5);">#${sn}</span>
                    </div>
                    <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-[5000]">
                        <div class="bg-gray-900/95 backdrop-blur text-white text-[11px] py-1.5 px-3 rounded-lg whitespace-nowrap shadow-2xl border border-white/20">
                            <div class="font-bold flex items-center gap-2">
                                ${sn}. ${active.equipageInfo.driverName}
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

            if (!marker) {
                marker = L.marker(finalCoords, { icon: customIcon }).addTo(map);
                markers.set(sn, marker);
            } else {
                marker.setLatLng(finalCoords);
                marker.setIcon(customIcon);
            }
        });
    });
}

export function updateSidebar(activeEquipages) {
    // Sidebar borttagen
}

function getCoordsForActive(active) {
    const coordsMap = currentConfig?.entities || {};
    const splits = active.data?.gateSplits || {};
    
    // Find the gate with the highest timestamp
    let latestGate = 'start';
    let latestTime = 0;

    for (const [gateId, time] of Object.entries(splits)) {
        if (time > latestTime) {
            latestTime = time;
            latestGate = gateId;
        }
    }

    if (coordsMap[latestGate]) {
        return coordsMap[latestGate];
    }
    if (coordsMap['start']) {
        return coordsMap['start'];
    }
    return [500, 500];
}

function updateStaticMarkers() {
    staticMarkers.forEach(m => m.remove());
    staticMarkers = [];
    if (pathLineUpcoming) {
        pathLineUpcoming.remove();
        pathLineUpcoming = null;
    }
    if (pathLinePassed) {
        pathLinePassed.remove();
        pathLinePassed = null;
    }
    if (!map) return;

    const coordsMap = currentConfig?.entities || {};
    
    const activeClasses = new Set();
    currentActiveEquipages.forEach(active => {
        if (active.equipageInfo?.className) {
            activeClasses.add(active.equipageInfo.className);
        }
    });

    if (activeClasses.size === 0 && currentMonitorDriver?.eq?.className) {
        activeClasses.add(currentMonitorDriver.eq.className);
    }
    
    if (activeClasses.size === 0 && currentFullConfig?.courses) {
        const keys = Object.keys(currentFullConfig.courses);
        if (keys.length > 0) activeClasses.add(keys[0]);
    }
    
    currentOrderedGates = getOrderedGates(coordsMap, activeClasses);
    currentDensePath = generateSplinePath(currentOrderedGates, 20);

    // Initial rita hela som upcoming
    if (currentDensePath.length > 1) {
        const latlngs = currentDensePath.map(p => p.coords);
        
        pathLinePassed = L.polyline([], {
            color: '#3b82f6', 
            weight: 4,
            opacity: 1.0,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false
        }).addTo(map);

        pathLineUpcoming = L.polyline(latlngs, {
            color: '#3b82f6', 
            weight: 3,
            dashArray: '10, 10',
            opacity: 0.5,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false
        }).addTo(map);
    }

    let activeData = null;
    if (currentActiveEquipages.size > 0) {
        activeData = Array.from(currentActiveEquipages.values())[0].data;
    } else if (currentMonitorDriver?.data) {
        activeData = currentMonitorDriver.data;
    }
    const gateSplits = activeData?.gateSplits || {};
    const knocks = activeData?.knocks || [];

    currentOrderedGates.forEach((gate) => {
        let label = gate.id;
        if (gate.id === 'start') label = 'S';
        else if (gate.id === 'finish') label = 'M';
        else if (gate.id.startsWith('gate_')) label = gate.id.replace('gate_','');

        const isPassed = !!gateSplits[gate.id] || (gate.id === 'start' && activeData?.liveStartEpoch);
        const cleanId = gate.id.replace('gate_', '');
        const isKnocked = knocks.includes(cleanId);

        let colorClass = 'bg-white/95 text-gray-800 border-gray-400';
        if (gate.id === 'start') {
            colorClass = 'bg-blue-600 text-white border-white scale-110';
        } else if (gate.id === 'finish') {
            colorClass = 'bg-red-600 text-white border-white scale-110';
        } else if (isKnocked) {
            colorClass = 'bg-red-500 text-white border-red-700 font-bold';
        } else if (isPassed) {
            colorClass = 'bg-green-500 text-white border-green-700 font-bold';
        }

        const iconHtml = `
            <div class="flex items-center justify-center w-full h-full">
                <div class="flex items-center justify-center w-7 h-7 rounded-full border-2 shadow-md font-bold text-[11px] ${colorClass} transition-transform hover:scale-125">
                    ${label}
                </div>
            </div>
        `;

        const icon = L.divIcon({
            html: iconHtml,
            className: 'static-div-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        const m = L.marker(gate.coords, {
            icon,
            interactive: false,
            zIndexOffset: -100
        }).addTo(map);

        staticMarkers.push(m);
    });
}

export function destroyMap() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    if (map) {
        map.remove();
        map = null;
        imageOverlay = null;
        pathLinePassed = null;
        pathLineUpcoming = null;
        markers.clear();
        staticMarkers = [];
        currentConfig = null;
        lastSidebarHash = "";
    }
}
