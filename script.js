var markersArray = new Array();
var openedInfo;
var trafficLayer;
var showTraffic = false;
var map;

// How often to poll /api/buses for updated positions.
const REFRESH_INTERVAL_SECS = 10;

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
        .then(res => res.json())
        .then(buses => {
            const now = Date.now();

            buses.forEach(val => {
                const routeNumber = val.routeNumber;
                const routeInfo = getRouteInfo(routeNumber);

                if (!routeInfo.mainline && !showAll) return; // skip others if showAll not checked

                // find possible existing marker for this bus/trip
                let existingMarker = markersArray.find(obj => {
                    return obj.id === val.tripTrackId;
                });

                const newPosition = new google.maps.LatLng(val.latitude, val.longitude);

                // compute speed and heading from movement since the last poll.
                // The API doesn't give us either directly, so we derive them
                // ourselves from consecutive positions - this is an
                // approximation and will be noisy right after a bus first
                // appears (no previous position yet) or if it's barely moved.
                let speed = existingMarker?.speed;
                let heading = existingMarker?.heading ?? 0;

                if (existingMarker != null) {
                    const distance = google.maps.geometry.spherical.computeDistanceBetween(
                        existingMarker.position, newPosition);
                    const elapsedSeconds = (now - existingMarker.timeStamp) / 1000;

                    if (distance > 5 && elapsedSeconds > 0) {
                        speed = (distance / elapsedSeconds) * 3.6; // m/s -> km/h
                        heading = google.maps.geometry.spherical.computeHeading(
                            existingMarker.position, newPosition);
                    }
                    // if it barely moved, keep the previous speed/heading
                    // rather than jumping to ~0 from GPS noise
                }

                // approximate "stopped" - the old API told us this directly,
                // the new one doesn't, so we infer it from speed instead.
                const stopped = speed != null && speed < 2;

                const infoContent = `
                    <b>${routeNumber} - ${val.routeName}</b><br>
                    First stop departure: ${formatDeparture(val.firstStopDepartureDate)}<br>
                    Speed: ${speed == null || isNaN(speed) ? 'Calculating...' : `${Math.round(speed)} km/h`}<br>
                `;

                let debugContent = '';
                if (document.getElementById('debug').checked) {
                    debugContent =
                        '<br/>' +
                        'tripTrackId: ' + val.tripTrackId + '<br>' +
                        'routeNumber: ' + val.routeNumber + '<br>' +
                        'routeName: ' + val.routeName + '<br>' +
                        'firstStopDepartureDate: ' + val.firstStopDepartureDate + '<br>' +
                        'lat/lng: ' + val.latitude + ', ' + val.longitude + '<br>' +
                        'heading (derived): ' + Math.round(heading) + '<br>' +
                        'stopped (derived): ' + stopped;
                }

                const fullContent = infoContent + debugContent;

                if (existingMarker != null) {
                    existingMarker.title = `${routeNumber} - ${val.routeName}`;
                    existingMarker.position = newPosition;
                    existingMarker.timeStamp = now;
                    existingMarker.speed = speed;
                    existingMarker.heading = heading;
                    existingMarker.content = createIcon(routeInfo.color);
                    existingMarker.content.style.opacity = stopped ? "0.35" : "1.0";
                    existingMarker.content.style.transform = `rotate(${heading}deg)`;
                    existingMarker.info.setContent(fullContent);
                }
                else {
                    const info = new google.maps.InfoWindow({
                        content: fullContent,
                    });

                    // AdvancedMarker defaults to bottom-center anchoring
                    // (pin tip). Center the arrow on the bus lat/lng instead.
                    const marker = new google.maps.marker.AdvancedMarkerElement({
                        position: newPosition,
                        title: `${routeNumber} - ${val.routeName}`,
                        map: map,
                        content: createIcon(routeInfo.color),
                        anchorLeft: '-50%',
                        anchorTop: '-50%',
                    });

                    marker.id = val.tripTrackId;
                    marker.content.style.opacity = stopped ? "0.35" : "1.0";
                    marker.content.style.transform = `rotate(${heading}deg)`;
                    marker.info = info;
                    marker.speed = speed;
                    marker.heading = heading;
                    marker.mainline = routeInfo.mainline;
                    marker.timeStamp = now;

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
            console.log('Fetch error', error);
        });
}

function formatDeparture(isoString) {
    if (isoString == null) return 'unknown';
    const date = new Date(isoString);
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return hours + ':' + minutes;
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
