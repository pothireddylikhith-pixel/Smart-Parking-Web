// Safe LocalStorage wrapper for browsers that block it on local file:// access
const storage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn("Storage warning: localStorage blocked on file:// protocol. Using session fallback.", e);
      return this._memoryStore[key] || null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("Storage warning: localStorage blocked on file:// protocol. Using session fallback.", e);
      this._memoryStore[key] = value;
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("Storage warning: localStorage blocked on file:// protocol. Using session fallback.", e);
      delete this._memoryStore[key];
    }
  },
  _memoryStore: {}
};

// Indian Smart Parking App State
let cities = [];
let currentCity = null;
let currentHub = null;
let selectedSpotId = null;
let currentFloor = 1;
let selectedPayment = 'upi';
let simIntervalId = null;
let isSimActive = false;
let simSpeed = 3000; // ms
let backgroundSimIntervalId = null;

// Auth Session State
let currentUserEmail = null;
let currentUserRole = 'user';

// Premium Features Global Variables
let currentFilter = 'all';
let countdownIntervalId = null;
let ledgerHistory = [];

// Weather options per city (Rainy weather increases arrival ticks/demand)
const CITY_WEATHER = {
  delhi: { temp: '38°C', condition: 'Sunny', demand: 'HIGH', factor: 0.85 },
  mumbai: { temp: '31°C', condition: 'Humid', demand: 'NORMAL', factor: 1.0 },
  bengaluru: { temp: '22°C', condition: 'Rainy', demand: 'CRITICAL', factor: 0.5 }, // Rain doubles arrival rate (0.5 factor on interval speed)
  hyderabad: { temp: '33°C', condition: 'Cloudy', demand: 'HIGH', factor: 0.75 },
  chennai: { temp: '34°C', condition: 'Sunny', demand: 'HIGH', factor: 0.8 },
  pune: { temp: '26°C', condition: 'Pleasant', demand: 'NORMAL', factor: 1.0 }
};

// Car Colors Array
const CAR_COLORS = [
  { body: '#3b82f6', roof: 'rgba(59, 130, 246, 0.4)' }, // Neon Blue
  { body: '#e11d48', roof: 'rgba(225, 29, 72, 0.4)' },  // Ruby Red
  { body: '#f97316', roof: 'rgba(249, 115, 22, 0.4)' }, // Solar Orange
  { body: '#06b6d4', roof: 'rgba(6, 182, 212, 0.4)' },  // Electric Cyan
  { body: '#eab308', roof: 'rgba(234, 179, 8, 0.4)' },  // Amber Gold
  { body: '#a855f7', roof: 'rgba(168, 85, 247, 0.4)' }, // Electric Purple
  { body: '#9ca3af', roof: 'rgba(156, 163, 175, 0.4)' } // Metallic Silver
];

// Initialize Multi-City Database
function initDatabase() {
  const cachedData = storage.getItem('omnipark_india_data');
  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].hubs) {
        cities = parsed;
        return;
      } else {
        console.warn("Legacy database schema detected. Resetting parking cache...");
        storage.removeItem('omnipark_india_data');
      }
    } catch (e) {
      console.error("Failed parsing storage", e);
    }
  }

  const cityData = [
    {
      id: 'delhi',
      name: 'Delhi NCR',
      hubs: [
        {
          id: 'delhi-cp',
          name: 'Connaught Place Hub',
          address: 'Block F, Inner Circle, Near Rajiv Chowk Metro, New Delhi, 110001',
          landmarks: ['Rajiv Chowk Metro (Gate 4) - 2 min walk', 'Palika Bazaar - 5 min walk'],
          mapsUrl: 'https://maps.google.com/?q=Connaught+Place+New+Delhi'
        },
        {
          id: 'delhi-cyber',
          name: 'Cyber City Hub',
          address: 'Building 10 Entrance, Near DLF CyberHub Promenade, Gurugram, 122002',
          landmarks: ['Cyber City Rapid Metro - 3 min walk', 'IndusInd Bank Cyber City Stn - 5 min walk'],
          mapsUrl: 'https://maps.google.com/?q=DLF+CyberHub+Gurugram'
        }
      ]
    },
    {
      id: 'mumbai',
      name: 'Mumbai',
      hubs: [
        {
          id: 'mumbai-bandra',
          name: 'Bandra West Hub',
          address: 'Linking Road, Near National College Signal, Bandra West, Mumbai, 400050',
          landmarks: ['National College - 1 min walk', 'Elco Arcade Shopping Market - 4 min walk'],
          mapsUrl: 'https://maps.google.com/?q=Linking+Road+Bandra+West+Mumbai'
        },
        {
          id: 'mumbai-nariman',
          name: 'Nariman Point Hub',
          address: 'Marine Drive Promenade, Opposite Air India Building, Mumbai, 400021',
          landmarks: ['NCPA - 3 min walk', 'Wankhede Stadium - 12 min walk'],
          mapsUrl: 'https://maps.google.com/?q=Air+India+Building+Nariman+Point+Mumbai'
        }
      ]
    },
    {
      id: 'bengaluru',
      name: 'Bengaluru',
      hubs: [
        {
          id: 'blr-koramangala',
          name: 'Koramangala Hub',
          address: '80 Feet Road, Near Sony World Signal, Koramangala 4th Block, Bengaluru, 560034',
          landmarks: ['Sony World Junction - 2 min walk', 'Koramangala Club - 6 min walk'],
          mapsUrl: 'https://maps.google.com/?q=Sony+World+Signal+Koramangala+Bengaluru'
        },
        {
          id: 'blr-indiranagar',
          name: 'Indiranagar Hub',
          address: '100 Feet Road, Adjacent to Indiranagar Metro Station, Bengaluru, 560038',
          landmarks: ['Indiranagar Metro (Gate B) - 1 min walk', 'Metro Pillar 80 - Front entrance'],
          mapsUrl: 'https://maps.google.com/?q=Indiranagar+Metro+Station+Bengaluru'
        }
      ]
    },
    {
      id: 'hyderabad',
      name: 'Hyderabad',
      hubs: [
        {
          id: 'hyd-hitec',
          name: 'HITEC City Hub',
          address: 'Madhapur Main Rd, Directly Opposite Cyber Towers, Hyderabad, 500081',
          landmarks: ['Cyber Towers Junction - 1 min walk', 'HITEC City Metro Station - 4 min walk'],
          mapsUrl: 'https://maps.google.com/?q=Cyber+Towers+Hitec+City+Hyderabad'
        },
        {
          id: 'hyd-banjara',
          name: 'Banjara Hills Hub',
          address: 'Road No. 1, Near GVK One Mall Plaza, Banjara Hills, Hyderabad, 500034',
          landmarks: ['GVK One Shopping Mall - 2 min walk', 'Care Hospital Banjara - 8 min walk'],
          mapsUrl: 'https://maps.google.com/?q=GVK+One+Mall+Banjara+Hills+Hyderabad'
        }
      ]
    },
    {
      id: 'chennai',
      name: 'Chennai',
      hubs: [
        {
          id: 'chennai-tnagar',
          name: 'T. Nagar Hub',
          address: 'Usman Road, Opposite Pondy Bazaar Shopping Complex, Chennai, 600017',
          landmarks: ['Pondy Bazaar Pedestrian Plaza - 2 min walk', 'T. Nagar Bus Terminus - 6 min walk'],
          mapsUrl: 'https://maps.google.com/?q=Pondy+Bazaar+T+Nagar+Chennai'
        },
        {
          id: 'chennai-omr',
          name: 'OMR IT Corridor Hub',
          address: 'Rajiv Gandhi Salai, Near Sholinganallur Junction Toll Plaza, Chennai, 600119',
          landmarks: ['Sholinganallur Toll Plaza - 2 min walk', 'ELCOT SEZ Entrance - 10 min walk'],
          mapsUrl: 'https://maps.google.com/?q=Sholinganallur+Junction+Chennai'
        }
      ]
    },
    {
      id: 'pune',
      name: 'Pune',
      hubs: [
        {
          id: 'pune-kp',
          name: 'Koregaon Park Hub',
          address: 'Lane 6, Adjacent to German Bakery, Koregaon Park, Pune, 411001',
          landmarks: ['German Bakery Koregaon - 1 min walk', 'Osho Teerth Park - 5 min walk'],
          mapsUrl: 'https://maps.google.com/?q=German+Bakery+Koregaon+Park+Pune'
        },
        {
          id: 'pune-viman',
          name: 'Viman Nagar Hub',
          address: 'Viman Nagar Road, Opposite Phoenix Marketcity Mall, Pune, 411014',
          landmarks: ['Phoenix Marketcity Pune - 3 min walk', 'Symbiosis Campus Viman Nagar - 8 min walk'],
          mapsUrl: 'https://maps.google.com/?q=Phoenix+Marketcity+Pune'
        }
      ]
    }
  ];

  // Build independent parking spot states (32 spots per hub)
  cities = cityData.map(city => {
    city.hubs = city.hubs.map(hub => {
      const spotsList = [];
      
      // Ground Floor Standard: A1 to A8
      for (let i = 1; i <= 8; i++) {
        spotsList.push({ id: `A${i}`, floor: 1, type: 'standard', state: 'vacant', plate: null, duration: null, carColor: null });
      }
      // Ground Floor EV: B1 to B4
      for (let i = 1; i <= 4; i++) {
        spotsList.push({ id: `B${i}`, floor: 1, type: 'ev', state: 'vacant', plate: null, duration: null, carColor: null });
      }
      // Ground Floor Accessible: C1 to C4
      for (let i = 1; i <= 4; i++) {
        spotsList.push({ id: `C${i}`, floor: 1, type: 'handicap', state: 'vacant', plate: null, duration: null, carColor: null });
      }
      // Level 2 Standard: A9 to A16
      for (let i = 9; i <= 16; i++) {
        spotsList.push({ id: `A${i}`, floor: 2, type: 'standard', state: 'vacant', plate: null, duration: null, carColor: null });
      }
      // Level 2 EV: B5 to B8
      for (let i = 5; i <= 8; i++) {
        spotsList.push({ id: `B${i}`, floor: 2, type: 'ev', state: 'vacant', plate: null, duration: null, carColor: null });
      }
      // Level 2 Accessible: C5 to C8
      for (let i = 5; i <= 8; i++) {
        spotsList.push({ id: `C${i}`, floor: 2, type: 'handicap', state: 'vacant', plate: null, duration: null, carColor: null });
      }

      // Seed initial occupants (Approx 40%-60% occupied per hub)
      const occupantsCount = 12 + Math.floor(Math.random() * 8); // 12 to 20 spots
      const indices = [];
      while(indices.length < occupantsCount) {
        const randIdx = Math.floor(Math.random() * 32);
        if(!indices.includes(randIdx)) indices.push(randIdx);
      }

      indices.forEach(idx => {
        const durationHrs = 1 + Math.floor(Math.random() * 8);
        const bookedAt = Date.now() - Math.floor(Math.random() * durationHrs * 3600 * 1000);
        spotsList[idx].state = 'occupied';
        spotsList[idx].plate = generateRandomPlate();
        spotsList[idx].carColor = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
        spotsList[idx].duration = durationHrs;
        spotsList[idx].bookedAt = bookedAt;
        spotsList[idx].expireAt = bookedAt + (durationHrs * 3600 * 1000);
      });

      return {
        ...hub,
        spots: spotsList,
        revenue: 1200 + Math.floor(Math.random() * 4000),
        occupancyHistory: Array.from({ length: 9 }, () => 30 + Math.floor(Math.random() * 50))
      };
    });
    return city;
  });
  saveToDatabase();
}

function saveToDatabase() {
  storage.setItem('omnipark_india_data', JSON.stringify(cities));
}

// Generate Indian License Plate Format
function generateRandomPlate() {
  const states = ['DL', 'MH', 'KA', 'TS', 'TN', 'MH', 'HR', 'UP'];
  const stateCode = states[Math.floor(Math.random() * states.length)];
  const districtCode = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letters = alphabet[Math.floor(Math.random() * 26)] + alphabet[Math.floor(Math.random() * 26)];
  
  const numbers = Math.floor(1000 + Math.random() * 9000);
  
  return `${stateCode}-${districtCode}-${letters}-${numbers}`;
}

// Render National Landing Portal UI
function renderNationalPortal() {
  const container = document.getElementById('cities-container');
  container.innerHTML = '';

  cities.forEach(city => {
    // Calculate total stats for the city
    const totalHubs = city.hubs.length;
    let totalSpots = 0;
    let occupiedSpots = 0;
    let evFree = 0;

    city.hubs.forEach(hub => {
      totalSpots += hub.spots.length;
      occupiedSpots += hub.spots.filter(s => s.state !== 'vacant').length;
      evFree += hub.spots.filter(s => s.type === 'ev' && s.state === 'vacant').length;
    });

    const occupancyPct = Math.round((occupiedSpots / totalSpots) * 100);
    const speedClass = occupancyPct > 75 ? 'high' : (occupancyPct > 50 ? 'med' : '');

    // Card element
    const card = document.createElement('div');
    card.className = 'glass-panel city-card';
    
    // Hubs list HTML
    let hubsListHtml = '';
    city.hubs.forEach(hub => {
      const hubOccupied = hub.spots.filter(s => s.state !== 'vacant').length;
      const hubVacant = hub.spots.length - hubOccupied;
      const isBusy = hubOccupied / hub.spots.length > 0.8;

      hubsListHtml += `
        <div class="hub-item-row" data-hub-id="${hub.id}">
          <div class="hub-item-details">
            <span class="hub-item-name">${hub.name}</span>
            <span class="hub-item-address">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
              </svg>
              ${hub.landmarks[0]}
            </span>
          </div>
          <span class="hub-item-bays ${isBusy ? 'busy' : ''}">${hubVacant} Free</span>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="city-card-header">
        <h3 class="city-name">${city.name}</h3>
        <span class="city-occupancy-pill ${speedClass}">${occupancyPct}% Full</span>
      </div>
      <div class="city-card-stats">
        <div>
          <span class="city-stat-label">Active Hubs</span>
          <div class="city-stat-val" style="font-size: 15px;">${totalHubs}</div>
        </div>
        <div>
          <span class="city-stat-label">Free EV Bays</span>
          <div class="city-stat-val text-gradient-neon" style="font-size: 15px; font-weight: 800;">${evFree}</div>
        </div>
      </div>
      <div class="city-hubs-list">
        <span class="city-hubs-title">Monitored Facilities</span>
        ${hubsListHtml}
      </div>
    `;

    // Click handler to open hubs directly
    card.querySelectorAll('.hub-item-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const hubId = row.getAttribute('data-hub-id');
        selectFacility(city, hubId);
      });
    });

    container.appendChild(card);
  });
}

// Update Global Headers or Local Headers depending on context
function updateTelemetry() {
  if (currentHub) {
    // Local Hub Stats
    const total = currentHub.spots.length;
    const vacant = currentHub.spots.filter(s => s.state === 'vacant').length;
    const occupied = currentHub.spots.filter(s => s.state !== 'vacant').length;
    const evFree = currentHub.spots.filter(s => s.type === 'ev' && s.state === 'vacant').length;

    document.getElementById('label-total').innerText = 'Hub Bays';
    document.getElementById('count-total').innerText = total;
    document.getElementById('count-vacant').innerText = vacant;
    document.getElementById('count-occupied').innerText = occupied;
    document.getElementById('count-ev').innerText = evFree;
  } else {
    // National Stats
    let totalSpots = 0;
    let occupiedSpots = 0;
    let evFree = 0;

    cities.forEach(city => {
      city.hubs.forEach(hub => {
        totalSpots += hub.spots.length;
        occupiedSpots += hub.spots.filter(s => s.state !== 'vacant').length;
        evFree += hub.spots.filter(s => s.type === 'ev' && s.state === 'vacant').length;
      });
    });

    document.getElementById('label-total').innerText = 'Total Spots';
    document.getElementById('count-total').innerText = totalSpots;
    document.getElementById('count-vacant').innerText = totalSpots - occupiedSpots;
    document.getElementById('count-occupied').innerText = occupiedSpots;
    document.getElementById('count-ev').innerText = evFree;
  }
}

// Select city/hub and transition view
function selectFacility(city, hubId) {
  currentCity = city;
  currentHub = city.hubs.find(h => h.id === hubId);
  selectedSpotId = null;
  currentFloor = 1;
  currentFilter = 'all';

  // Reset active filter buttons in HTML
  document.querySelectorAll('.filter-btn').forEach(btn => {
    if (btn.getAttribute('data-filter') === 'all') btn.classList.add('active');
    else btn.classList.remove('active');
  });

  // Update Breadcrumbs
  document.getElementById('breadcrumb-city').innerText = city.name;
  document.getElementById('breadcrumb-hub').innerText = currentHub.name;
  document.getElementById('navigation-breadcrumbs').style.display = 'block';

  // Set Subtitle to Selected Hub
  document.getElementById('header-subtitle').innerText = `${currentHub.name} (Live)`;

  // Populate Location Card Details
  document.getElementById('hub-address-text').innerText = currentHub.address;
  const mapsLink = document.getElementById('btn-google-maps-link');
  mapsLink.href = currentHub.mapsUrl;

  const landmarksContainer = document.getElementById('hub-landmarks-list');
  landmarksContainer.innerHTML = '';
  currentHub.landmarks.forEach(lm => {
    const item = document.createElement('div');
    item.className = 'landmark-item';
    item.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>${lm}</span>
    `;
    landmarksContainer.appendChild(item);
  });

  // Update local weather badge
  const weather = CITY_WEATHER[city.id] || { temp: '28°C', condition: 'Clear', demand: 'NORMAL', factor: 1.0 };
  const demandClass = weather.demand === 'CRITICAL' || weather.demand === 'HIGH' ? 'demand-high' : 'demand-low';
  document.getElementById('hub-weather-badge').innerHTML = `${weather.condition} • ${weather.temp} <span class="demand-indicator ${demandClass}" style="margin-left: 6px;">${weather.demand} DEMAND</span>`;

  // Switch view displays
  document.getElementById('national-portal-view').style.display = 'none';
  document.getElementById('facility-dashboard-view').style.display = 'grid';

  // Toggle local floor selector buttons state to floor 1
  document.querySelectorAll('.floor-btn').forEach(btn => {
    if(parseInt(btn.getAttribute('data-floor')) === 1) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  // Load simulator log
  const logBox = document.getElementById('simulation-log');
  logBox.innerHTML = `
    <div class="log-entry">
      <span class="log-time">[${new Date().toTimeString().split(' ')[0]}]</span>
      <span class="log-msg">Loaded telemetry dashboard for ${currentHub.name}.</span>
    </div>
  `;

  // Start local simulator if auto-sim was active
  if (isSimActive) {
    runSimulatorLoop();
  }

  // Update layout, chart and counters
  applyRoleSecurity();
  renderMap();
  updateTelemetry();
  renderChart();
  resetBookingForm();
}

// Return to National Portal home view
function returnToNationalPortal() {
  currentCity = null;
  currentHub = null;
  selectedSpotId = null;

  document.getElementById('navigation-breadcrumbs').style.display = 'none';
  document.getElementById('header-subtitle').innerText = 'National IoT Parking Network';

  document.getElementById('facility-dashboard-view').style.display = 'none';
  document.getElementById('national-portal-view').style.display = 'block';

  // Stop active simulator loops
  if (simIntervalId) {
    clearInterval(simIntervalId);
    simIntervalId = null;
  }
  
  // Re-render national overview
  renderNationalPortal();
  updateTelemetry();
}

// Render local hub 2D grid
function renderMap() {
  if (!currentHub) return;

  const rowA = document.getElementById('row-zone-a');
  const rowBC = document.getElementById('row-zone-bc');

  rowA.innerHTML = '';
  rowBC.innerHTML = '';

  const floorSpots = currentHub.spots.filter(s => s.floor === currentFloor);

  floorSpots.forEach(spot => {
    const targetRow = spot.type === 'standard' ? rowA : rowBC;
    
    const spotEl = document.createElement('div');
    spotEl.className = `parking-spot state-${spot.state} type-${spot.type}`;
    spotEl.id = `spot-bay-${spot.id}`;
    if (selectedSpotId === spot.id) {
      spotEl.classList.add('selected');
    }

    // Spot ID label
    const spotIdEl = document.createElement('span');
    spotIdEl.className = 'spot-id';
    spotIdEl.innerText = spot.id;
    spotEl.appendChild(spotIdEl);

    // Indicator Light
    const lightEl = document.createElement('span');
    lightEl.className = 'spot-light';
    spotEl.appendChild(lightEl);

    // Vector Car Visual (SVG)
    const colorObj = spot.carColor || { body: '#ffffff', roof: 'rgba(255,255,255,0.4)' };
    const carSvg = `
      <svg class="parked-car" viewBox="0 0 40 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="12" width="3" height="10" rx="1" fill="#000" />
        <rect x="36" y="12" width="3" height="10" rx="1" fill="#000" />
        <rect x="1" y="58" width="3" height="10" rx="1" fill="#000" />
        <rect x="36" y="58" width="3" height="10" rx="1" fill="#000" />
        <rect x="3" y="4" width="34" height="72" rx="6" fill="${colorObj.body}" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" />
        <path d="M7 22C7 20 8 18 10 18H30C32 18 33 20 33 22V28H7V22Z" fill="#0f172a" />
        <path d="M7 58C7 60 8 62 10 62H30C32 62 33 60 33 58V54H7V58Z" fill="#0f172a" />
        <rect x="7" y="28" width="26" height="26" fill="${colorObj.roof}" />
        <rect x="6" y="1" width="5" height="3" rx="1" fill="#fbbf24" />
        <rect x="29" y="1" width="5" height="3" rx="1" fill="#fbbf24" />
      </svg>
    `;
    spotEl.insertAdjacentHTML('beforeend', carSvg);

    // Icons
    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'spot-icon-wrapper';
    
    if (spot.type === 'ev') {
      iconWrapper.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M11 6l-4 6h6l-4 6"/>
        </svg>
      `;
    } else if (spot.type === 'handicap') {
      iconWrapper.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v6h4m-4 0v6M10 9h4" />
          <path d="M8 12a4 4 0 0 1 8 0" />
        </svg>
      `;
    }
    
    spotEl.appendChild(iconWrapper);

    // Click trigger
    spotEl.addEventListener('click', () => handleSpotSelection(spot));

    targetRow.appendChild(spotEl);
  });

  applyMapFilter();
}

// Handle local Spot Click
function handleSpotSelection(spot) {
  if (selectedSpotId === spot.id) {
    selectedSpotId = null;
    document.getElementById(`spot-bay-${spot.id}`).classList.remove('selected');
    resetBookingForm();
    return;
  }

  if (selectedSpotId) {
    const prevSelected = document.getElementById(`spot-bay-${selectedSpotId}`);
    if (prevSelected) prevSelected.classList.remove('selected');
  }

  selectedSpotId = spot.id;
  const currentSpotEl = document.getElementById(`spot-bay-${spot.id}`);
  if (currentSpotEl) currentSpotEl.classList.add('selected');

  const spotIdLabel = document.getElementById('selected-spot-id');
  const spotTypeLabel = document.getElementById('selected-spot-type-label');
  const btnSubmit = document.getElementById('btn-submit-booking');

  spotIdLabel.innerText = spot.id;
  
  if (spot.state === 'vacant') {
    spotTypeLabel.innerText = `${spot.type.toUpperCase()} spot - Vacant`;
    spotTypeLabel.style.color = 'var(--color-vacant)';
    btnSubmit.disabled = false;
    btnSubmit.innerText = "Pay & Confirm Spot";
    btnSubmit.className = "btn";
    btnSubmit.style.display = 'flex';
    
    document.getElementById('plate-number').disabled = false;
    document.getElementById('duration').disabled = false;
    if (document.getElementById('spot-occupancy-info-card')) {
      document.getElementById('spot-occupancy-info-card').style.display = 'none';
    }
    calculateBookingCost();
  } else {
    // Occupied admin release options
    spotTypeLabel.innerText = `${spot.type.toUpperCase()} - OCCUPIED (${spot.plate || 'No Plate'})`;
    spotTypeLabel.style.color = 'var(--color-occupied)';
    
    document.getElementById('plate-number').value = spot.plate || '';
    document.getElementById('plate-number').disabled = true;
    document.getElementById('duration').disabled = true;
    
    if (currentUserRole === 'admin') {
      btnSubmit.disabled = false;
      btnSubmit.innerText = "Release Bay (Admin)";
      btnSubmit.className = "btn btn-secondary";
      btnSubmit.style.display = 'flex';
    } else {
      btnSubmit.disabled = true;
      btnSubmit.innerText = "Pay & Confirm Spot";
      btnSubmit.className = "btn";
      btnSubmit.style.display = 'none';
    }

    updateCountdownDisplay();
  }
}

// Reset booking form fields
function resetBookingForm() {
  selectedSpotId = null;
  document.getElementById('selected-spot-id').innerText = 'NONE';
  const label = document.getElementById('selected-spot-type-label');
  label.innerText = 'Select a vacant spot on the map';
  label.style.color = 'var(--text-secondary)';
  
  document.getElementById('plate-number').value = '';
  document.getElementById('plate-number').disabled = false;
  document.getElementById('duration').disabled = false;
  document.getElementById('duration').value = '1';
  
  const btn = document.getElementById('btn-submit-booking');
  btn.disabled = true;
  btn.innerText = "Pay & Confirm Spot";
  btn.className = "btn";
  btn.style.display = 'flex';

  if (document.getElementById('spot-occupancy-info-card')) {
    document.getElementById('spot-occupancy-info-card').style.display = 'none';
  }

  calculateBookingCost();
}

// Calculate Booking Cost dynamically in Indian Rupees
function calculateBookingCost() {
  if (!selectedSpotId || !currentHub) {
    document.getElementById('summary-base-rate').innerText = '₹0.00/hr';
    document.getElementById('summary-zone-premium').innerText = '₹0.00';
    document.getElementById('summary-total-price').innerText = '₹0.00';
    return;
  }

  const spot = currentHub.spots.find(s => s.id === selectedSpotId);
  const hours = parseInt(document.getElementById('duration').value);
  
  let baseRate = 40.00; // ₹40/hr standard
  let premium = 0.00;

  if (spot.type === 'ev') {
    baseRate = 60.00; // ₹60/hr
    premium = 20.00; // Charging surcharge
  } else if (spot.type === 'handicap') {
    baseRate = 30.00; // ₹30/hr
  }

  let total = baseRate * hours;
  if (hours === 2) total = baseRate * 2 * 0.95; 
  if (hours === 4) total = baseRate * 4 * 0.90; 
  if (hours === 8) total = baseRate * 8 * 0.80; 
  if (hours === 24) {
    // Flat rate models
    if (spot.type === 'ev') total = 600.00;
    else if (spot.type === 'handicap') total = 250.00;
    else total = 450.00;
  }

  document.getElementById('summary-base-rate').innerText = `₹${baseRate.toFixed(2)}/hr`;
  document.getElementById('summary-zone-premium').innerText = `₹${(premium * hours).toFixed(2)}`;
  document.getElementById('summary-total-price').innerText = `₹${total.toFixed(2)}`;
}

// Switch payment panes based on selection
function switchPaymentMethod(method) {
  selectedPayment = method;

  // Toggle active class on option buttons
  document.querySelectorAll('.payment-option').forEach(opt => {
    if (opt.getAttribute('data-payment') === method) {
      opt.classList.add('active');
    } else {
      opt.classList.remove('active');
    }
  });

  // Hide all details panes
  document.getElementById('pane-upi').style.display = 'none';
  document.getElementById('pane-fastag').style.display = 'none';
  document.getElementById('pane-card').style.display = 'none';

  // Show selected pane
  if (method === 'upi') {
    document.getElementById('pane-upi').style.display = 'block';
  } else if (method === 'fastag') {
    document.getElementById('pane-fastag').style.display = 'block';
  } else if (method === 'card') {
    document.getElementById('pane-card').style.display = 'block';
  }
}

// Booking submission handler (triggers payment loader modal)
function handleBookingSubmit() {
  if (!selectedSpotId || !currentHub) return;

  const spot = currentHub.spots.find(s => s.id === selectedSpotId);

  if (spot.state === 'vacant') {
    const plateInput = document.getElementById('plate-number').value.trim();
    if (!plateInput) {
      showToast('Error', 'Please enter a valid license plate.', 'error');
      return;
    }

    const price = parseFloat(document.getElementById('summary-total-price').innerText.replace('₹', ''));
    
    // Trigger animated overlay modal
    triggerCheckoutFlow(spot, plateInput, price);

  } else {
    // Admin Release spot
    const oldPlate = spot.plate;
    spot.state = 'vacant';
    spot.plate = null;
    spot.duration = null;
    spot.bookedAt = null;
    spot.expireAt = null;
    spot.carColor = null;

    logActivity(`Admin released spot ${spot.id} (previously vehicle ${oldPlate})`, 'in');
    showToast('Spot Released', `Stall ${spot.id} is now vacant.`, 'info');
    
    addTransaction(`Released Spot ${spot.id} (Admin)`, currentHub.name, 0, 'release');

    saveToDatabase();
    renderMap();
    updateTelemetry();
    resetBookingForm();
  }
}

// Checkout process simulator
function triggerCheckoutFlow(spot, plateNum, price) {
  const overlay = document.getElementById('checkout-overlay');
  const procModal = document.getElementById('modal-processing-state');
  const tktModal = document.getElementById('modal-ticket-state');
  const statusMsg = document.getElementById('payment-status-message');

  overlay.classList.add('active');
  procModal.style.display = 'flex';
  tktModal.style.display = 'none';

  statusMsg.innerText = "Connecting to secure billing API...";

  // Phase 2 of payment simulation
  setTimeout(() => {
    if (selectedPayment === 'upi') {
      statusMsg.innerText = `Requesting UPI transaction of ₹${price.toFixed(2)}...`;
    } else if (selectedPayment === 'fastag') {
      statusMsg.innerText = "Querying NHAI FASTag database for RFID registry...";
    } else {
      statusMsg.innerText = "Authorizing credit transaction...";
    }
  }, 1000);

  // Phase 3 of payment: success Check
  setTimeout(() => {
    statusMsg.innerHTML = `
      <div class="success-icon" style="margin-bottom: 12px; margin-top:-10px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <span>Payment Successful!</span>
    `;
  }, 2200);

  // Phase 4: show receipt
  setTimeout(() => {
    // Update hub state
    spot.state = 'reserved';
    spot.plate = plateNum.toUpperCase();
    spot.duration = parseInt(document.getElementById('duration').value);
    spot.bookedAt = Date.now();
    spot.expireAt = Date.now() + (spot.duration * 3600 * 1000);
    spot.carColor = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];

    currentHub.revenue += price;
    
    // Add point to analytics chart history
    currentHub.occupancyHistory.push(Math.round((currentHub.spots.filter(s => s.state !== 'vacant').length / 32) * 100));
    if (currentHub.occupancyHistory.length > 9) currentHub.occupancyHistory.shift();

    logActivity(`Spot ${spot.id} reserved by ${spot.plate} using ${selectedPayment.toUpperCase()} (₹${price.toFixed(2)})`, 'warn');
    addTransaction(`Booked Spot ${spot.id} (${spot.plate})`, currentHub.name, price, 'booking');
    
    // Build Ticket Modal details
    document.getElementById('ticket-city').innerText = currentCity.name;
    document.getElementById('ticket-facility').innerText = currentHub.name;
    document.getElementById('ticket-spot').innerText = spot.id;
    document.getElementById('ticket-plate').innerText = spot.plate;
    document.getElementById('ticket-duration').innerText = `${spot.duration} Hour${spot.duration > 1 ? 's' : ''}`;
    document.getElementById('ticket-method').innerText = selectedPayment.toUpperCase() === 'FASTAG' ? 'FASTag Autopay' : (selectedPayment.toUpperCase() === 'UPI' ? 'BHIM UPI' : 'Credit Card');
    document.getElementById('ticket-amount').innerHTML = `&#8377;${price.toFixed(2)}`;
    document.getElementById('ticket-ref').innerText = `OP-${100000 + Math.floor(Math.random() * 900000)}-IN`;

    procModal.style.display = 'none';
    tktModal.style.display = 'flex';
    
    saveToDatabase();
    renderMap();
    updateTelemetry();
    updateRevenueDisplay();
    renderChart();
  }, 3200);
}

// Search Locator: Nationwide Search
function handleSearch(formId, inputId) {
  const query = document.getElementById(inputId).value.trim().toUpperCase().replace(/\s+/g, '');
  
  if (!query) return;

  let foundSpot = null;
  let foundHub = null;
  let foundCity = null;

  // Search across all spots, hubs, and cities
  for (let c = 0; c < cities.length; c++) {
    const city = cities[c];
    for (let h = 0; h < city.hubs.length; h++) {
      const hub = city.hubs[h];
      const spot = hub.spots.find(s => 
        s.id === query || 
        (s.plate && s.plate.replace(/[^A-Z0-9]/ig, '') === query) ||
        (s.plate && s.plate.includes(query))
      );

      if (spot) {
        foundSpot = spot;
        foundHub = hub;
        foundCity = city;
        break;
      }
    }
    if (foundSpot) break;
  }

  if (foundSpot) {
    if (foundSpot.state === 'vacant') {
      showToast('Stall Empty', `Spot ${foundSpot.id} at ${foundHub.name} (${foundCity.name}) is currently vacant.`, 'info');
      // If we are currently inside that hub, highlight it, else guide user to click it
      if (currentHub && currentHub.id === foundHub.id) {
        handleSpotSelection(foundSpot);
      } else {
        selectFacility(foundCity, foundHub.id);
        // Delay to allow rendering
        setTimeout(() => {
          const spotObj = currentHub.spots.find(s => s.id === foundSpot.id);
          if (spotObj) handleSpotSelection(spotObj);
        }, 150);
      }
      return;
    }

    // Switch view to target City & Hub
    if (!currentHub || currentHub.id !== foundHub.id) {
      selectFacility(foundCity, foundHub.id);
    }

    // Set correct floor
    if (foundSpot.floor !== currentFloor) {
      toggleFloor(foundSpot.floor);
    }

    // Delay a fraction of a second to select and highlight
    setTimeout(() => {
      const liveSpot = currentHub.spots.find(s => s.id === foundSpot.id);
      if (liveSpot) {
        handleSpotSelection(liveSpot);
        
        const spotEl = document.getElementById(`spot-bay-${liveSpot.id}`);
        if (spotEl) {
          spotEl.classList.add('pulsing-highlight');
          spotEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          setTimeout(() => {
            spotEl.classList.remove('pulsing-highlight');
          }, 6000);
        }
      }
    }, 150);

    showToast('Vehicle Located', `Spot ${foundSpot.id} found in ${foundHub.name} (${foundCity.name}).`, 'success');
  } else {
    showToast('Not Found', `No vehicle matching "${query}" found in India registry.`, 'error');
  }
}

// Toggle local floors
function toggleFloor(floor) {
  currentFloor = parseInt(floor);
  document.querySelectorAll('.floor-btn').forEach(btn => {
    const btnFloor = parseInt(btn.getAttribute('data-floor'));
    if (btnFloor === currentFloor) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (selectedSpotId) {
    const selectedSpot = currentHub.spots.find(s => s.id === selectedSpotId);
    if (selectedSpot && selectedSpot.floor !== currentFloor) {
      selectedSpotId = null;
      resetBookingForm();
    }
  }

  renderMap();
}

// Log logs into simulation log box
function logActivity(message, type = 'default') {
  const logBox = document.getElementById('simulation-log');
  if(!logBox) return;

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${timeStr}]</span>
    <span class="log-msg ${type}">${message}</span>
  `;

  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

// Toast Alert System
function showToast(title, desc, type = 'info') {
  const container = document.getElementById('toast-container');
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  `;
  
  if (type === 'success') {
    icon = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    `;
  } else if (type === 'error') {
    icon = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    `;
  }

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-desc">${desc}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%) scale(0.9)';
    toast.style.transition = 'all 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// Local simulation arrivals
function simulateArrival() {
  if (!currentHub) return;

  const vacantSpots = currentHub.spots.filter(s => s.state === 'vacant');
  if (vacantSpots.length === 0) {
    logActivity('Simulation: Arrival skipped (hub 100% full)', 'warn');
    return;
  }

  const spot = vacantSpots[Math.floor(Math.random() * vacantSpots.length)];
  const plate = generateRandomPlate();
  const durationHrs = 1 + Math.floor(Math.random() * 4);
  
  spot.state = 'occupied';
  spot.plate = plate;
  spot.duration = durationHrs;
  spot.bookedAt = Date.now();
  spot.expireAt = Date.now() + (durationHrs * 3600 * 1000);
  spot.carColor = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];

  // Fastag simulated deduction
  const fee = spot.type === 'ev' ? 120.00 : 80.00;
  currentHub.revenue += fee;

  logActivity(`Vehicle ${plate} arrived in Spot ${spot.id} (FASTag auto-billed ₹${fee.toFixed(2)})`, 'in');
  showToast('Vehicle Entry', `FASTag read. Spot ${spot.id} occupied.`, 'info');
  
  addTransaction(`FASTag Auto-pay Spot ${spot.id}`, currentHub.name, fee, 'booking');

  saveToDatabase();
  if (spot.floor === currentFloor) {
    renderMap();
  }
  updateTelemetry();
  updateRevenueDisplay();
  updateLocalAnalyticsTick();
}

// Local simulation departures
function simulateDeparture() {
  if (!currentHub) return;

  const occupiedSpots = currentHub.spots.filter(s => s.state === 'occupied');
  if (occupiedSpots.length === 0) {
    logActivity('Simulation: Departure skipped (hub empty)', 'warn');
    return;
  }

  const spot = occupiedSpots[Math.floor(Math.random() * occupiedSpots.length)];
  const plate = spot.plate;

  spot.state = 'vacant';
  spot.plate = null;
  spot.duration = null;
  spot.bookedAt = null;
  spot.expireAt = null;
  spot.carColor = null;

  logActivity(`Vehicle ${plate} departed from Spot ${spot.id}`, 'out');
  showToast('Vehicle Exit', `Vehicle ${plate} departed from stall ${spot.id}.`, 'info');
  
  addTransaction(`Exit cleared Spot ${spot.id}`, currentHub.name, 0, 'release');

  saveToDatabase();
  if (spot.floor === currentFloor) {
    renderMap();
  }
  updateTelemetry();
  updateLocalAnalyticsTick();
}

// Toggle simulation interval loop
function toggleSimulation() {
  const btn = document.getElementById('btn-toggle-sim');
  const dot = document.getElementById('sim-status-dot');
  const text = document.getElementById('sim-status-text');

  isSimActive = !isSimActive;

  if (isSimActive) {
    btn.innerText = 'Pause Auto-Sim';
    btn.className = "btn";
    dot.classList.add('active');
    text.innerText = 'Simulator Active';
    logActivity('Local auto-simulation active.');
    
    runSimulatorLoop();
  } else {
    btn.innerText = 'Start Auto-Sim';
    btn.className = "btn btn-secondary";
    dot.classList.remove('active');
    text.innerText = 'Simulator Idle';
    logActivity('Local auto-simulation paused.');

    if (simIntervalId) {
      clearInterval(simIntervalId);
      simIntervalId = null;
    }
  }
}

// Run simulation tick loop with weather adjustment
function runSimulatorLoop() {
  if (simIntervalId) clearInterval(simIntervalId);

  const weather = currentCity ? (CITY_WEATHER[currentCity.id] || { factor: 1.0 }) : { factor: 1.0 };
  const adjustedSpeed = simSpeed * weather.factor;

  simIntervalId = setInterval(() => {
    const action = Math.random() < 0.65 ? simulateArrival : simulateDeparture;
    action();
  }, adjustedSpeed);
}

// Handle simulation speed selector changes
function handleSimSpeedChange() {
  simSpeed = parseInt(document.getElementById('sim-speed').value);
  if (isSimActive) {
    runSimulatorLoop();
    logActivity(`Sim rate adjusted to every ${(simSpeed / 1000).toFixed(1)}s.`);
  }
}

// Background simulator nationwide process (runs every 6s)
// Simulates background traffic in other facilities to make city occupancy cards update dynamically!
function initBackgroundSim() {
  if (backgroundSimIntervalId) clearInterval(backgroundSimIntervalId);

  backgroundSimIntervalId = setInterval(() => {
    // Pick a random hub across the database
    const randomCity = cities[Math.floor(Math.random() * cities.length)];
    const randomHub = randomCity.hubs[Math.floor(Math.random() * randomCity.hubs.length)];

    // Skip if it's the currently focused hub (that handles its own local simulation)
    if (currentHub && currentHub.id === randomHub.id) return;

    // Simulate entry or exit
    const occupied = randomHub.spots.filter(s => s.state !== 'vacant');
    const vacant = randomHub.spots.filter(s => s.state === 'vacant');

    if (Math.random() < 0.55 && vacant.length > 0) {
      // Arrive
      const targetSpot = vacant[Math.floor(Math.random() * vacant.length)];
      targetSpot.state = 'occupied';
      targetSpot.plate = generateRandomPlate();
      targetSpot.carColor = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
      randomHub.revenue += targetSpot.type === 'ev' ? 120.00 : 80.00;
    } else if (occupied.length > 0) {
      // Depart
      const targetSpot = occupied[Math.floor(Math.random() * occupied.length)];
      targetSpot.state = 'vacant';
      targetSpot.plate = null;
      targetSpot.carColor = null;
    }

    // Record point in telemetry history
    const occupiedCount = randomHub.spots.filter(s => s.state !== 'vacant').length;
    randomHub.occupancyHistory.push(Math.round((occupiedCount / 32) * 100));
    if (randomHub.occupancyHistory.length > 9) randomHub.occupancyHistory.shift();

    saveToDatabase();
    // If home screen is active, update it
    if (!currentHub) {
      renderNationalPortal();
      updateTelemetry();
    }
  }, 5000);
}

// Local analytics UI helpers
function updateRevenueDisplay() {
  if (!currentHub) return;
  document.getElementById('analytics-revenue').innerHTML = `&#8377;${currentHub.revenue.toLocaleString('en-IN')}.00`;
}

function updateLocalAnalyticsTick() {
  if (!currentHub) return;

  const total = currentHub.spots.length;
  const occupied = currentHub.spots.filter(s => s.state !== 'vacant').length;
  const pct = Math.round((occupied / total) * 100);

  currentHub.occupancyHistory.push(pct);
  if (currentHub.occupancyHistory.length > 9) {
    currentHub.occupancyHistory.shift();
  }

  const peak = Math.max(...currentHub.occupancyHistory);
  document.getElementById('analytics-peak').innerText = `${peak}%`;

  renderChart();
}

// Draw the local occupancy SVG chart curves
function renderChart() {
  if (!currentHub) return;

  const linePath = document.getElementById('chart-line-path');
  const filledPath = document.getElementById('chart-filled-path');

  if (!linePath || !filledPath) return;

  const xStart = 40;
  const xEnd = 280;
  const yBase = 125; 
  const yHeight = 105; 

  const points = currentHub.occupancyHistory.map((val, idx) => {
    const x = xStart + (idx * (xEnd - xStart) / (currentHub.occupancyHistory.length - 1));
    const y = yBase - ((val / 100) * yHeight);
    return { x, y };
  });

  let lineStr = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const cpX1 = points[i-1].x + (points[i].x - points[i-1].x) / 2;
    const cpY1 = points[i-1].y;
    const cpX2 = points[i-1].x + (points[i].x - points[i-1].x) / 2;
    const cpY2 = points[i].y;
    lineStr += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${points[i].x} ${points[i].y}`;
  }

  const areaStr = `${lineStr} L ${points[points.length-1].x} ${yBase} L ${points[0].x} ${yBase} Z`;

  linePath.setAttribute('d', lineStr);
  filledPath.setAttribute('d', areaStr);

  // Trigger draw animation
  linePath.style.animation = 'none';
  linePath.offsetHeight;
  linePath.style.animation = 'draw-chart 2s ease-out forwards';
}

// Update clock timestamp
function updateTimeBadge() {
  const indicator = document.getElementById('live-time-indicator');
  if (!indicator) return;
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  indicator.innerText = `LIVE MONITORING • ${timeStr}`;
}

// --- USER AUTHENTICATION MODULE ---

function applyRoleSecurity() {
  const simPanel = document.querySelector('.simulator-panel');
  if (currentUserRole === 'admin') {
    if (simPanel) simPanel.classList.remove('role-admin-only');
  } else {
    if (simPanel) simPanel.classList.add('role-admin-only');
  }
}

function handleLogin(e) {
  e.preventDefault();
  
  const emailInput = document.getElementById('login-email').value.trim();
  const roleInput = document.getElementById('login-role').value;

  if (!emailInput) {
    showToast('Error', 'Please enter a valid email address.', 'error');
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailInput)) {
    showToast('Error', 'Please enter a valid email address format (e.g. user@domain.com).', 'error');
    return;
  }

  currentUserEmail = emailInput;
  currentUserRole = roleInput;

  // Save Session
  storage.setItem('omnipark_active_session', JSON.stringify({ email: currentUserEmail, role: currentUserRole }));

  // Update Profile Badges
  document.getElementById('user-email-display').innerText = currentUserEmail;
  document.getElementById('user-role-display').innerText = currentUserRole.toUpperCase();

  // Switch display
  document.getElementById('login-screen-view').style.opacity = '0';
  setTimeout(() => {
    document.getElementById('login-screen-view').style.display = 'none';
    document.getElementById('app-main-content').style.display = 'block';
    
    // Trigger chart reflow
    if (currentHub) {
      renderChart();
    }
  }, 350);

  applyRoleSecurity();
  showToast('Access Authorized', `Welcome to OmniPark, ${currentUserEmail}!`, 'success');
  
  renderNationalPortal();
  updateTelemetry();
}

function handleLogout() {
  storage.removeItem('omnipark_active_session');
  currentUserEmail = null;
  currentUserRole = 'user';

  if (isSimActive) {
    toggleSimulation();
  }

  document.getElementById('login-email').value = '';
  document.getElementById('login-role').value = 'user';

  document.getElementById('app-main-content').style.display = 'none';
  document.getElementById('login-screen-view').style.display = 'flex';
  document.getElementById('login-screen-view').style.opacity = '1';

  returnToNationalPortal();
  showToast('Logged Out', 'Your session has been securely closed.', 'info');
}

function checkActiveSession() {
  const cachedSession = storage.getItem('omnipark_active_session');
  if (cachedSession) {
    try {
      const session = JSON.parse(cachedSession);
      currentUserEmail = session.email;
      currentUserRole = session.role;

      document.getElementById('user-email-display').innerText = currentUserEmail;
      document.getElementById('user-role-display').innerText = currentUserRole.toUpperCase();

      document.getElementById('login-screen-view').style.display = 'none';
      document.getElementById('app-main-content').style.display = 'block';

      applyRoleSecurity();
    } catch (e) {
      console.error("Failed to restore active session", e);
    }
  }
}

// --- PREMIUM EXTRA MODULES ---

function applyMapFilter() {
  if (!currentHub) return;
  
  currentHub.spots.forEach(spot => {
    const spotEl = document.getElementById(`spot-bay-${spot.id}`);
    if (!spotEl) return;
    
    let matches = false;
    if (currentFilter === 'all') {
      matches = true;
    } else if (currentFilter === 'vacant') {
      matches = (spot.state === 'vacant');
    } else if (currentFilter === 'ev') {
      matches = (spot.type === 'ev');
    } else if (currentFilter === 'handicap') {
      matches = (spot.type === 'handicap');
    }
    
    if (matches) {
      spotEl.classList.remove('filtered-out');
    } else {
      spotEl.classList.add('filtered-out');
      if (selectedSpotId === spot.id) {
        selectedSpotId = null;
        spotEl.classList.remove('selected');
        resetBookingForm();
      }
    }
  });
}

function startCountdownTicker() {
  if (countdownIntervalId) clearInterval(countdownIntervalId);
  countdownIntervalId = setInterval(() => {
    updateCountdownDisplay();
  }, 1000);
}

function updateCountdownDisplay() {
  const infoCard = document.getElementById('spot-occupancy-info-card');
  if (!selectedSpotId || !currentHub || !infoCard) {
    if (infoCard) infoCard.style.display = 'none';
    return;
  }
  
  const spot = currentHub.spots.find(s => s.id === selectedSpotId);
  if (!spot || spot.state === 'vacant') {
    infoCard.style.display = 'none';
    return;
  }
  
  infoCard.style.display = 'flex';
  
  const now = Date.now();
  const remainingMs = Math.max(0, spot.expireAt - now);
  
  if (remainingMs === 0) {
    // Release spot
    spot.state = 'vacant';
    spot.plate = null;
    spot.duration = null;
    spot.bookedAt = null;
    spot.expireAt = null;
    spot.carColor = null;
    
    logActivity(`Reservation expired for spot ${spot.id}. Bay auto-released.`, 'in');
    showToast('Spot Released', `Stall ${spot.id} reservation expired.`, 'info');
    addTransaction(`Auto-expired Spot ${spot.id}`, currentHub.name, 0, 'release');

    saveToDatabase();
    renderMap();
    updateTelemetry();
    resetBookingForm();
    return;
  }
  
  const secs = Math.floor((remainingMs / 1000) % 60);
  const mins = Math.floor((remainingMs / (1000 * 60)) % 60);
  const hours = Math.floor((remainingMs / (1000 * 60 * 60)) % 24);
  
  const timeLabel = document.getElementById('spot-timer-countdown');
  if (timeLabel) {
    timeLabel.innerText = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  
  const checkinTime = new Date(spot.bookedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('spot-info-checkin').innerText = checkinTime;
  document.getElementById('spot-info-duration').innerText = `${spot.duration} Hr${spot.duration > 1 ? 's' : ''}`;
  document.getElementById('spot-info-plate').innerText = spot.plate || 'No Plate';
  document.getElementById('spot-info-type').innerText = spot.type.toUpperCase();
}

function loadLedger() {
  const cached = storage.getItem('omnipark_ledger_history');
  if (cached) {
    try {
      ledgerHistory = JSON.parse(cached);
    } catch (e) {
      console.error("Failed loading ledger", e);
    }
  }
  renderLedger();
}

function addTransaction(desc, facility, amount, type = 'booking') {
  const tx = {
    id: `TX-${100000 + Math.floor(Math.random() * 900000)}`,
    timestamp: Date.now(),
    desc,
    facility,
    amount,
    type
  };
  ledgerHistory.unshift(tx);
  if (ledgerHistory.length > 20) ledgerHistory.pop();
  
  storage.setItem('omnipark_ledger_history', JSON.stringify(ledgerHistory));
  renderLedger();
}

function renderLedger() {
  const container = document.getElementById('ledger-log-container');
  if (!container) return;
  
  container.innerHTML = '';
  if (ledgerHistory.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); font-size: 11px; text-align: center; margin-top: 60px;" id="ledger-empty-msg">No transactions recorded yet.</div>`;
    return;
  }
  
  ledgerHistory.forEach(tx => {
    const row = document.createElement('div');
    row.className = 'ledger-entry-row';
    
    const timeStr = new Date(tx.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isRelease = tx.type === 'release';
    const amountStr = isRelease ? 'Clear' : `₹${tx.amount.toFixed(2)}`;
    const amountClass = isRelease ? 'ledger-amount release' : 'ledger-amount';
    
    row.innerHTML = `
      <span class="ledger-time">${timeStr}</span>
      <div class="ledger-details">
        <span class="ledger-desc">${tx.desc}</span>
        <span class="ledger-meta">${tx.facility} • ${tx.id}</span>
      </div>
      <span class="${amountClass}">${amountStr}</span>
    `;
    container.appendChild(row);
  });
}

// Page Bindings
document.addEventListener('DOMContentLoaded', () => {
  initDatabase();
  checkActiveSession();
  loadLedger();
  startCountdownTicker();
  renderNationalPortal();
  updateTelemetry();
  initBackgroundSim();

  // Login event listeners
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', handleLogout);

  // Map Filter bindings
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.getAttribute('data-filter');
      applyMapFilter();
    });
  });

  // Unified Nationwide Car Search Form
  document.getElementById('national-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handleSearch('national-search-form', 'national-search-plate');
  });

  // Back Button Navigation
  document.getElementById('btn-back-to-portal').addEventListener('click', returnToNationalPortal);

  // Floor toggling
  document.querySelectorAll('.floor-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      toggleFloor(e.target.getAttribute('data-floor'));
    });
  });

  // Local booking form submits
  document.getElementById('booking-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handleBookingSubmit();
  });

  // Checkout modal done close button
  document.getElementById('btn-close-ticket').addEventListener('click', () => {
    document.getElementById('checkout-overlay').classList.remove('active');
    resetBookingForm();
  });

  // Payment Options selectors switching
  document.querySelectorAll('.payment-option').forEach(opt => {
    opt.addEventListener('click', () => {
      switchPaymentMethod(opt.getAttribute('data-payment'));
    });
  });

  // Simulator Triggers
  document.getElementById('btn-toggle-sim').addEventListener('click', toggleSimulation);
  document.getElementById('btn-trigger-arrival').addEventListener('click', simulateArrival);
  document.getElementById('btn-trigger-departure').addEventListener('click', simulateDeparture);
  document.getElementById('sim-speed').addEventListener('change', handleSimSpeedChange);

  // Cost recalculation when duration slider changes
  document.getElementById('duration').addEventListener('change', calculateBookingCost);

  // Timestamp trigger
  setInterval(updateTimeBadge, 1000);
  updateTimeBadge();
});
