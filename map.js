
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoiYW5uMDc4IiwiYSI6ImNtd2hlY2hpNzAzaXYyem9ucDVlcmprZ3EifQ.NMH-QAs23w0dGVTnS3erJw';

// Step 5.4: Create minute buckets for departures and arrivals
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Create Mapbox map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Bike lane styling
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 3,
  'line-opacity': 0.6,
};

// Create SVG overlay
const svg = d3.select('#map')
  .append('svg');

// Convert station coordinates to map coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(
    +station.lon,
    +station.lat
  );

  const { x, y } = map.project(point);

  return { cx: x, cy: y };
}

// Convert timestamps into minutes since midnight
const parseTime = d3.timeParse('%Y-%m-%d %H:%M:%S');

function minutesSinceMidnight(timestamp) {
  const time = parseTime(timestamp);

  if (!time) return null;

  return time.getHours() * 60 + time.getMinutes();
}

// Step 5.4: Retrieve trips from minute buckets
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  // Normalize time range to [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);

    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Load map layers and data
map.on('load', async () => {

  // Step 2: Add Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'boston-bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // Add Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://services3.arcgis.com/iuNbZYJOrAYBrPyC/ArcGIS/rest/services/Cambridge_BLC_Line_Data_WFL1/FeatureServer/1/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // Step 3: Load Bluebikes station data
  const jsonurl =
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

  const jsonData = await d3.json(jsonurl);

  let stations = jsonData.data.stations;

  console.log('Loaded stations:', stations);

  // Step 4: Load Bluebikes trip data
  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv'
  );

  console.log('Loaded trips:', trips);

  // Step 5.4: Sort trips into minute buckets
  trips.forEach((trip) => {
    let startedMinutes = minutesSinceMidnight(trip.started_at);
    let endedMinutes = minutesSinceMidnight(trip.ended_at);

    if (startedMinutes !== null) {
      departuresByMinute[startedMinutes].push(trip);
    }

    if (endedMinutes !== null) {
      arrivalsByMinute[endedMinutes].push(trip);
    }
  });

  // Calculate station traffic using minute buckets
  function computeStationTraffic(stations, timeFilter = -1) {

    const departures = d3.rollup(
      filterByMinute(departuresByMinute, timeFilter),
      (v) => v.length,
      (d) => d.start_station_id
    );

    const arrivals = d3.rollup(
      filterByMinute(arrivalsByMinute, timeFilter),
      (v) => v.length,
      (d) => d.end_station_id
    );

    return stations.map((station) => {
      const id = station.short_name;

      const stationDepartures = departures.get(id) ?? 0;
      const stationArrivals = arrivals.get(id) ?? 0;

      return {
        ...station,
        departures: stationDepartures,
        arrivals: stationArrivals,
        totalTraffic: stationDepartures + stationArrivals,
      };
    });
  }

  // Calculate initial all-day traffic
  stations = computeStationTraffic(stations);

  // Create circle radius scale
  const maxTraffic = d3.max(
    stations,
    (d) => d.totalTraffic
  );

    const radiusScale = d3.scaleSqrt()
    .domain([0, maxTraffic])
    .range([0, 25]);

  // Step 6.1: Create traffic flow color scale
  const stationFlow = d3
    .scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  console.log('Maximum traffic:', maxTraffic);

  // Calculate departure ratio
  function departureRatio(d) {
    return d.totalTraffic === 0
      ? 0.5
      : d.departures / d.totalTraffic;
  }

  // Create station circles
  const circles = svg
    .selectAll('circle')
    .data(stations)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .attr('cx', (d) => getCoords(d).cx)
    .attr('cy', (d) => getCoords(d).cy)
    .style('--departure-ratio', (d) =>
      stationFlow(departureRatio(d))
    )
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  // Update station circles for selected time
    function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(
        stations,
        timeFilter
    );

    const currentMax = d3.max(
        filteredStations,
        (d) => d.totalTraffic
    );

    radiusScale
        .domain([0, currentMax || 1])
        .range([0, timeFilter === -1 ? 25 : 15]);

    circles
        .data(filteredStations)
        .attr('r', (d) => radiusScale(d.totalTraffic))
        .style('--departure-ratio', (d) =>
        stationFlow(departureRatio(d))
        )
        .select('title')
        .text(
        (d) =>
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    }
  // Format slider time
  function formatTime(minutes) {
    if (minutes === -1) return 'All day';
    if (minutes === 1440) return '24:00';

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  // Connect slider to visualization
  const timeSlider = document.querySelector('#time-slider');
  const selectedTimeDisplay = document.querySelector('#selected-time');

  timeSlider.addEventListener('input', () => {
    const time = Number(timeSlider.value);

    selectedTimeDisplay.textContent = formatTime(time);

    updateScatterPlot(time);
  });

  // Initialize all-day visualization
  updateScatterPlot(-1);

  // Update circle positions when map moves or resizes
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

});
