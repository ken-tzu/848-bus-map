var markersArray = new Array();
var openedInfo;
var trafficLayer;
var showTraffic = false;
var map;

// How often to poll /api/buses for updated positions.
const REFRESH_INTERVAL_SECS = 10;

// Median of this many speed samples. One noisy poll should not flip the
// number the marker shows.
const SPEED_HISTORY = 6;
const STOPPED_KMH = 2;
// Ignore shorter jumps. GPS noise is often a few meters.
const MOVE_METERS = 5;
// Net east/west shift, in degrees, before we call a direction. About 20 m
// at this latitude, so a real move along the corridor clears it.
const DIRECTION_LNG_EPSILON = 0.00035;
const LNG_HISTORY = 3;

(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
    key: config.mapsApiKey,
    v: "weekly",
  });

async function initMap() {
    const { Map } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker");
    await google.maps.importLibrary("geometry");

    const mapOptions = {
        center: {
            lat: 60.3377996461302,
            lng: 25.4599816182501
        },
        zoom: 10,
        mapId: "BUS_MAP"
    };

    map = new google.maps.Map(document.getElementById("map"), mapOptions);
    trafficLayer = new google.maps.TrafficLayer();
    getData(map);
    setInterval(function () {
        getData(map);
    }, REFRESH_INTERVAL_SECS * 1000);
}

initMap();

// custom SVG marker (an arrow, rotated to the bus's heading)
const parser = new DOMParser();

function createIcon(color) {
    const pinSvgString =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24" viewBox="0 0 24 24" shape-rendering="geometricPrecision" text-rendering="geometricPrecision"><polygon fill="${color}" stroke="${color}" stroke-width="2" points="3.293,11.293 4.707,12.707 11,6.414 11,20 13,20 13,6.414 19.293,12.707 20.707,11.293 12,2.586 3.293,11.293"/></svg>`;

    return parser.parseFromString(
        pinSvgString,
        "image/svg+xml",
    ).documentElement;
}

function buildMarkerContent(color, labelText) {
    const wrap = document.createElement('div');
    wrap.className = 'bus-marker';
    const icon = createIcon(color);
    icon.classList.add('bus-marker-icon');
    wrap.appendChild(icon);
    if (labelText) {
        const label = document.createElement('div');
        label.className = 'bus-marker-label';
        label.textContent = labelText;
        wrap.appendChild(label);
    }
    return wrap;
}

function setMarkerAppearance(marker, color, labelText, heading, stopped) {
    let wrap = marker.content;
    if (!wrap || !wrap.classList || !wrap.classList.contains('bus-marker')) {
        wrap = buildMarkerContent(color, labelText);
        marker.content = wrap;
    } else {
        let labelEl = wrap.querySelector('.bus-marker-label');
        if (labelText) {
            if (!labelEl) {
                labelEl = document.createElement('div');
                labelEl.className = 'bus-marker-label';
                wrap.appendChild(labelEl);
            }
            labelEl.textContent = labelText;
        } else if (labelEl) {
            labelEl.remove();
        }
    }

    const icon = wrap.querySelector('.bus-marker-icon') || wrap;
    icon.style.opacity = stopped ? '0.35' : '1';
    icon.style.transform = `rotate(${heading == null ? 0 : heading}deg)`;
}

// Routes we care about by default. Anything not listed here is hidden
// unless "show all" is checked, and drawn in black.
// Add more OB-lines here as needed - the new API already gives us
// human-readable route numbers, so there's no numeric-line lookup table
// to maintain anymore.
const ROUTE_INFO = {
    'OB78': { color: '#000077', mainline: true },
    'OB79': { color: '#007700', mainline: true },
};

function getRouteInfo(routeNumber) {
    return ROUTE_INFO[routeNumber] || { color: '#000000', mainline: false };
}

// Accept the { fetchedAt, buses } wrapper and a bare array, in case a
// cached response from before the wrapper is still in front of us.
function unwrapFeed(body) {
    if (Array.isArray(body)) {
        return { fetchedAt: Date.now(), buses: body };
    }
    if (body && Array.isArray(body.buses)) {
        const parsed = Date.parse(body.fetchedAt);
        return {
            fetchedAt: Number.isNaN(parsed) ? Date.now() : parsed,
            buses: body.buses,
        };
    }
    throw new Error('Bus feed returned an unexpected shape.');
}

function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
    return sorted[mid];
}

// Eastbound along this corridor is toward Porvoo, westbound toward Helsinki.
// Longitude is the main signal. Heading breaks a tie when the bus is
// moving mostly north or south.
function inferDirection(lngHistory, heading) {
    if (lngHistory.length >= 2) {
        const delta = lngHistory[lngHistory.length - 1] - lngHistory[0];
        if (delta > DIRECTION_LNG_EPSILON) return 'porvoo';
        if (delta < -DIRECTION_LNG_EPSILON) return 'helsinki';
    }
    if (heading == null || Number.isNaN(heading)) return null;
    if (heading > 20 && heading < 160) return 'porvoo';
    if (heading < -20 && heading > -160) return 'helsinki';
    return null;
}

function directionPhrase(direction) {
    if (direction === 'porvoo') return '→ Porvoo';
    if (direction === 'helsinki') return '→ Helsinki';
    return null;
}

// Trip names from the feed already end at the destination, for example
// "Porvoo - Söderkulla - Helsinki". That is the direction passengers care
// about, including while the coach is still standing. Movement is only
// the fallback when a name does not say.
function directionFromName(routeName) {
    if (routeName == null) return null;
    const end = String(routeName).trim().toLowerCase();
    if (end.endsWith('porvoo')) return 'porvoo';
    if (end.endsWith('helsinki')) return 'helsinki';
    return null;
}

function formatSpeed(speed) {
    if (speed == null || Number.isNaN(speed)) return 'Calculating...';
    return `${Math.round(speed)} km/h`;
}

function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    if (totalMinutes < 1) return 'under 1 min';
    return `${totalMinutes} min`;
}

function markerLabel(routeNumber, derived) {
    const dir = directionPhrase(derived.direction);
    const line1 = dir ? `${routeNumber} ${dir}` : routeNumber;
    const line2 = derived.stopped && derived.stoppedForMs != null
        ? `stopped ${formatDuration(derived.stoppedForMs)}`
        : formatSpeed(derived.speed);
    return `${line1}\n${line2}`;
}

function markerTitle(routeNumber, routeName, direction) {
    const dir = directionPhrase(direction);
    const head = dir ? `${routeNumber} ${dir}` : routeNumber;
    return `${head} - ${routeName}`;
}

// Speed, heading, direction, and dwell from consecutive snapshots.
// A repeated fetchedAt is the same cached body, so it must not look like
// the bus sat still for another poll interval.
function deriveMotion(existingMarker, newPosition, longitude, fetchedAt) {
    let speedSamples = existingMarker?.speedSamples ? existingMarker.speedSamples.slice() : [];
    let lngHistory = existingMarker?.lngHistory ? existingMarker.lngHistory.slice() : [];
    let heading = existingMarker?.heading ?? null;
    let lowSince = existingMarker?.lowSince ?? null;

    const sameSnapshot = existingMarker != null && existingMarker.timeStamp === fetchedAt;

    if (!sameSnapshot) {
        if (existingMarker != null) {
            const distance = google.maps.geometry.spherical.computeDistanceBetween(
                existingMarker.position, newPosition);
            const elapsedSeconds = (fetchedAt - existingMarker.timeStamp) / 1000;

            if (elapsedSeconds > 0) {
                if (distance > MOVE_METERS) {
                    speedSamples.push((distance / elapsedSeconds) * 3.6);
                    heading = google.maps.geometry.spherical.computeHeading(
                        existingMarker.position, newPosition);
                    lngHistory.push(longitude);
                } else {
                    speedSamples.push(0);
                }
                if (speedSamples.length > SPEED_HISTORY) {
                    speedSamples = speedSamples.slice(-SPEED_HISTORY);
                }
                if (lngHistory.length > LNG_HISTORY) {
                    lngHistory = lngHistory.slice(-LNG_HISTORY);
                }

                const latest = speedSamples[speedSamples.length - 1];
                if (latest < STOPPED_KMH) {
                    if (lowSince == null) lowSince = fetchedAt;
                } else {
                    lowSince = null;
                }
            }
        } else {
            lngHistory = [longitude];
        }
    }

    const speed = median(speedSamples);
    const direction = inferDirection(lngHistory, heading);
    const stopped = speed != null && speed < STOPPED_KMH;
    const stoppedForMs = stopped && lowSince != null ? fetchedAt - lowSince : null;

    return {
        speed,
        speedSamples,
        heading,
        lngHistory,
        lowSince,
        direction,
        stopped,
        stoppedForMs,
    };
}

function assignDerived(marker, derived, fetchedAt) {
    marker.timeStamp = fetchedAt;
    marker.speed = derived.speed;
    marker.speedSamples = derived.speedSamples;
    marker.heading = derived.heading;
    marker.lngHistory = derived.lngHistory;
    marker.lowSince = derived.lowSince;
    marker.direction = derived.direction;
}

function getData(map) {

    var showAll = document.getElementById('show-all').checked;
    if (!showAll) {
        // remove any non-mainline markers if showAll is not checked
        for (var i = 0; i < markersArray.length; i++) {
            if (!markersArray[i].mainline) {
                markersArray[i].setMap(null);
            }
        }
        markersArray = markersArray.filter(function (value) {
            return value.mainline;
        });
    }

    fetch("/api/buses")
        .then(async res => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                const message =
                    body.message ||
                    `Bus feed failed (HTTP ${res.status}).`;
                throw Object.assign(new Error(message), {
                    code: body.error,
                    status: res.status,
                });
            }
            return body;
        })
        .then(body => {
            const { fetchedAt, buses } = unwrapFeed(body);
            setFeedStatus(null);

            buses.forEach(val => {
                const routeNumber = val.routeNumber;
                const routeInfo = getRouteInfo(routeNumber);

                if (!routeInfo.mainline && !showAll) return; // skip others if showAll not checked

                // find possible existing marker for this bus/trip
                let existingMarker = markersArray.find(obj => {
                    return obj.id === val.tripTrackId;
                });

                const newPosition = new google.maps.LatLng(val.latitude, val.longitude);
                const derived = deriveMotion(existingMarker, newPosition, val.longitude, fetchedAt);
                derived.direction = directionFromName(val.routeName) || derived.direction;
                const labelText = routeInfo.mainline ? markerLabel(routeNumber, derived) : null;
                const fullContent = buildInfoContent(val, derived, fetchedAt);
                const title = markerTitle(routeNumber, val.routeName, derived.direction);

                if (existingMarker != null) {
                    existingMarker.title = title;
                    existingMarker.position = newPosition;
                    assignDerived(existingMarker, derived, fetchedAt);
                    setMarkerAppearance(
                        existingMarker,
                        routeInfo.color,
                        labelText,
                        derived.heading,
                        derived.stopped);
                    existingMarker.info.setContent(fullContent);
                }
                else {
                    const info = new google.maps.InfoWindow({
                        content: fullContent,
                    });

                    // AdvancedMarker defaults to bottom-center anchoring
                    // (pin tip). Center the arrow on the bus lat/lng instead.
                    // The label hangs below that box and does not move the anchor.
                    const marker = new google.maps.marker.AdvancedMarkerElement({
                        position: newPosition,
                        title: title,
                        map: map,
                        content: buildMarkerContent(routeInfo.color, labelText),
                        anchorLeft: '-50%',
                        anchorTop: '-50%',
                    });

                    marker.id = val.tripTrackId;
                    marker.info = info;
                    marker.mainline = routeInfo.mainline;
                    assignDerived(marker, derived, fetchedAt);
                    setMarkerAppearance(
                        marker,
                        routeInfo.color,
                        labelText,
                        derived.heading,
                        derived.stopped);

                    marker.addListener("click", () => {
                        if (openedInfo != null) openedInfo.close();
                        info.open({
                            anchor: marker,
                            map,
                            shouldFocus: false,
                        });
                        openedInfo = info;
                    });

                    markersArray.push(marker);
                }
            });

            // drop markers for buses that are no longer in the feed
            // (finished their trip, went out of service, etc.)
            const seenIds = new Set(buses.map(b => b.tripTrackId));
            markersArray = markersArray.filter(marker => {
                if (!seenIds.has(marker.id)) {
                    marker.setMap(null);
                    return false;
                }
                return true;
            });
        })
        .catch(error => {
            console.error('Bus feed error', error);
            setFeedStatus(error.message || String(error));
        });
}

function buildInfoContent(val, derived, fetchedAt) {
    const dir = directionPhrase(derived.direction) || 'calculating...';
    const stoppedLine = derived.stopped && derived.stoppedForMs != null
        ? `Stopped: ${formatDuration(derived.stoppedForMs)}<br>`
        : '';

    let infoContent = `
        <b>${val.routeNumber} - ${val.routeName}</b><br>
        Direction: ${dir}<br>
        First stop departure: ${formatDepartureAgo(val.firstStopDepartureDate, fetchedAt)}<br>
        Speed: ${formatSpeed(derived.speed)}<br>
        ${stoppedLine}Updated: ${formatPositionAge(fetchedAt, Date.now())}<br>
    `;

    if (document.getElementById('debug').checked) {
        const headingText = derived.heading == null ? 'n/a' : Math.round(derived.heading);
        infoContent +=
            '<br/>' +
            'tripTrackId: ' + val.tripTrackId + '<br>' +
            'routeNumber: ' + val.routeNumber + '<br>' +
            'routeName: ' + val.routeName + '<br>' +
            'firstStopDepartureDate: ' + val.firstStopDepartureDate + '<br>' +
            'lat/lng: ' + val.latitude + ', ' + val.longitude + '<br>' +
            'fetchedAt: ' + new Date(fetchedAt).toISOString() + '<br>' +
            'heading (derived): ' + headingText + '<br>' +
            'direction: ' + (derived.direction || 'n/a') + '<br>' +
            'speed samples: ' + derived.speedSamples.map(s => Math.round(s)).join(', ') + '<br>' +
            'stopped (derived): ' + derived.stopped;
    }

    return infoContent;
}

function setFeedStatus(message) {
    const el = document.getElementById('status');
    if (!el) return;
    if (message) {
        el.textContent = message;
        el.hidden = false;
    } else {
        el.textContent = '';
        el.hidden = true;
    }
}

function formatDeparture(isoString) {
    if (isoString == null) return 'unknown';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'unknown';
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return hours + ':' + minutes;
}

function formatDepartureAgo(isoString, nowMs) {
    const clock = formatDeparture(isoString);
    if (isoString == null) return clock;
    const then = Date.parse(isoString);
    if (Number.isNaN(then)) return clock;
    const minutes = Math.round((nowMs - then) / 60000);
    if (minutes === 0) return `${clock}, left just now`;
    if (minutes > 0) return `${clock}, left ${minutes} min ago`;
    return `${clock}, departs in ${Math.abs(minutes)} min`;
}

function formatPositionAge(fetchedAt, nowMs) {
    const seconds = Math.max(0, Math.round((nowMs - fetchedAt) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return `${minutes} min ago`;
}

document.addEventListener("DOMContentLoaded", function () {
    const trafficDiv = document.getElementById('trafficlayer');
    trafficDiv.onclick = () => {
        if(showTraffic) {
            trafficLayer.setMap(null);
            showTraffic = false;
            trafficDiv.style.fontWeight = 'normal';
        } else {
            trafficLayer.setMap(map);
            showTraffic = true;
            trafficDiv.style.fontWeight = 'bold';
        }
    }
});
