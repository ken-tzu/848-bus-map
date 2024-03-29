var markersArray = new Array();
var openedInfo;
var trafficLayer;
var showTraffic = false;
var map;

const loader = new google.maps.plugins.loader.Loader({
    apiKey: config.mapsApiKey, // read from external config.js file
    version: "weekly",
    libraries: ["geometry"]
});

const mapOptions = {
    center: {
        lat: 60.3377996461302,
        lng: 25.4599816182501
    },
    zoom: 10
};

// Promise
loader
    .load()
    .then(() => {
        map = new google.maps.Map(document.getElementById("map"), mapOptions);
        trafficLayer = new google.maps.TrafficLayer();
        getData(map);
        setInterval(function () {
            getData(map);
        }, 10000);
    })
    .catch(e => {
        console.log(e);
    });

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
                            existingMarker.getPosition(),
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
                    Departure: ${convertTimestamp(val.transportation.departure_time)}<br>
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

                    // update existing marker
                    existingMarker.setTitle(busTitle);
                    existingMarker.setPosition({ lat: val.location.lat, lng: val.location.lng });
                    existingMarker.timeStamp = val.location.timestamp;
                    existingMarker.setOpacity(val.restState.stopped ? 0.35 : 1.0);
                    existingMarker.setIcon(({
                        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                        scale: 5,
                        rotation: val.location.heading
                    }));
                    existingMarker.info.setContent(infoContent);

                }
                else {

                    // create new marker
                    var marker = new google.maps.Marker({
                        position: { lat: val.location.lat, lng: val.location.lng },
                        title: busTitle,
                        opacity: val.restState.stopped ? 0.35 : 1.0,
                        map: map,
                        id: val.id,
                        info: info,
                        speed: speed,
                        mainline: mainLine,
                        timeStamp: val.location.timestamp
                    });

                    // use arrow icon rotated by heading of bus
                    marker.setIcon(({
                        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                        scale: 5,
                        rotation: val.location.heading
                    }));

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

