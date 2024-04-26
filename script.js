var markersArray = new Array();
var openedInfo;
var trafficLayer;
var showTraffic = false;
var map;

(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
    key: "AIzaSyAImnNjxpejsKlQewkCwtBUhyAb560iDSM",
    v: "weekly",
  });

async function initMap() {
    const { Map } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement, PinElement } = google.maps.importLibrary("marker");
    const { Geometry } = google.maps.importLibrary("geometry");

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
    }, 10000);
}

initMap();

// custom SVG marker
const parser = new DOMParser();
const pinSvgString =
'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24" viewBox="0 0 24 24" shape-rendering="geometricPrecision" text-rendering="geometricPrecision"><polygon stroke-width="3" points="3.293,11.293 4.707,12.707 11,6.414 11,20 13,20 13,6.414 19.293,12.707 20.707,11.293 12,2.586 3.293,11.293" stroke="#000"/></svg>';
const pinSvgElement = parser.parseFromString(pinSvgString, 'image/svg+xml').documentElement;

function createIcon() {
    return pinSvgElement.cloneNode(true);
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

    const busTitleLookup = {
        '6101': '848 Porvoo - Hki',
        '6102': '848 Hki - Porvoo',
        '6241': 'Hki - Loviisa',
        '6242': 'Loviisa - Hki',
        '6243': 'Hki - Kotka',
        '6244': 'Kotka - Hki'
      };

    fetch("https://www.koivistonauto.fi/wp-json/ka/v1/busses")
        .then(res => res.json())
        .then(res => {
            res.forEach(val => {
                let mainLine = true; // is this one of the bus lines we want to see on map?
                const { transportation, name } = val;
                let line = transportation?.line?.toString().trim(); 
    
                let busTitle = busTitleLookup[line];
                if (busTitle === undefined) {
                    if (!showAll) return true; // skip others if showAll not checked
                    busTitle = name;
                    mainLine = false;
                }

                // find possible existing marker for bus
                let existingMarker = markersArray.find(obj => {
                    return obj.id === val.id
                });

                // compute speed for bus
                // => distance between now and previous location divided by time
                let distance, speed; 
                if (val.location != null) {
                    if (existingMarker != null) {
                        distance = google.maps.geometry.spherical.computeDistanceBetween(
                            existingMarker.position,
                            new google.maps.LatLng(val.location.lat, val.location.lng));
                    }
                    if (distance > 0) {
                        speed = distance / (val.location.timestamp - existingMarker.timeStamp) * 3.6;
                        existingMarker.speed = speed;
                    } else {
                        speed = existingMarker?.speed;
                    }
                } else {    
                    speed = existingMarker.speed;
                }

                // build info popup content
                let infoContent = `
                    <b>${busTitle}</b><br>
                    Departure: ${convertTimestamp(val.transportation?.departure_time)}<br>
                    Speed: ${isNaN(speed) ? 'Calculating...' : `${Math.round(speed)} km/h`}<br>
                `;

                // if debug checked, show everything we get from API in info popup
                if (document.getElementById('debug').checked) {
                    var transportationInfo = val.transportation == null ? 'transportation: null <br>' :
                        'transportation.shift: ' + val.transportation.shift + '<br>' +
                        'transportation.line: ' + val.transportation.line + '<br>' +
                        'transportation.departure_time: ' + val.transportation.departure_time + '<br>';

                    infoContent +=
                        '<br/>' +
                        'id: ' + val.id + '<br>' +
                        'timestamp: ' + val.location.timestamp + '<br>' +
                        'name: ' + val.name + '<br>' +
                        'mapcode: ' + val.mapCode + '<br>' +
                        transportationInfo +
                        'reststate.stopped: ' + val.restState.stopped + '<br>' +
                        'reststate.time: ' + val.restState.time + '<br>' +
                        'reststate.duration: ' + val.restState.duration;
                }

                let info = new google.maps.InfoWindow({
                    content: infoContent,
                });

                if (existingMarker != null) {
                    console.log('Updating existing marker', val.id, val.location.lat, val.location.lng, val.location.heading, val.restState.stopped, val.location.timestamp, speed);

                    existingMarker.title = busTitle;
                    existingMarker.position = { lat: val.location.lat, lng: val.location.lng };
                    existingMarker.timeStamp = val.location.timestamp;
                    existingMarker.content = createIcon();
                    existingMarker.content.style.opacity = val.restState.stopped ? "0.35" : "1.0";
                    existingMarker.content.style.transform = `rotate(${val.location.heading}deg)`;
                    existingMarker.info.setContent(infoContent);
                }
                else {
                    console.log('Creating new marker', val.id, val.location.lat, val.location.lng, val.location.heading, val.restState.stopped, val.location.timestamp, speed);

                    // create new marker
                    var marker = new google.maps.marker.AdvancedMarkerElement({
                        position: { lat: val.location.lat, lng: val.location.lng },
                        title: busTitle,
                        map: map,
                        content: createIcon()
                    });

                    marker.id = val.id
                    marker.content.style.opacity = val.restState.stopped ? "0.35" : "1.0";
                    // rotate the marker icon by heading of bus
                    marker.content.style.transform = `rotate(${val.location.heading}deg)`;
                    marker.info = info;
                    marker.speed = speed;
                    marker.mainline = mainLine;
                    marker.timeStamp = val.location.timestamp;

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
        })
        .catch(error => {
            console.log('Fetch error', error);
        });
}

function convertTimestamp(timeStamp) {
    if (timeStamp == null) return 'null';
    var date = new Date(timeStamp * 1000);
    var hours = date.getHours();
    var minutes = String(date.getMinutes()).padStart(2, '0');
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