var markersArray = new Array();
var locationArray = new Array();
var openedInfo;

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
    .then((gmap) => {
        const map = new google.maps.Map(document.getElementById("map"), mapOptions);
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
        markersArray = markersArray.filter(function (value, index, arr) {
            return value.mainline;
        });
    }

    fetch("https://www.koivistonauto.fi/wp-json/ka/v1/busses")
        .then(res => res.json())
        .then(async res => {

            res.forEach(function (val) {

                var mainLine = true; // is this one of the bus lines we want to see on map?

                var busTitle;
                switch (val.transportation?.line) {
                    case '6101':
                        busTitle = '848 Porvoo - Hki';
                        break;
                    case '6102':
                        busTitle = '848 Hki - Porvoo';
                        break;
                    case '6241':
                        busTitle = 'Hki - Loviisa';
                        break;
                    case '6242':
                        busTitle = 'Loviisa - Hki';
                        break;
                    default:
                        if (!showAll) { return true; } // skip others if showAll not checked
                        busTitle = val.name;
                        mainLine = false;
                        break;
                }

                // find possible existing marker for bus
                var existingMarker = markersArray.find(obj => {
                    return obj.id === val.id
                });

                // compute speed for bus
                // => distance between now and previous location divided by time
                var distance, speed;
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
                var infoContent =
                    '<b>' + busTitle + '</b><br>' +
                    'Departure: ' + convertTimestamp(val.transportation?.departure_time) + '<br>' +
                    'Speed: ' + (isNaN(speed) ? 'Calculating...' : Math.round(speed) + ' km/h') + '<br>';

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

                var info = new google.maps.InfoWindow({
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