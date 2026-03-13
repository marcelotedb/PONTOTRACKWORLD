// ============================================================
// PontoTrack - Geolocation Module (geo.js)
// Geolocalização com validação de proximidade
// ============================================================

class GeoManager {
  constructor() {
    this.currentPosition = null;
    this.watchId = null;
    this.map = null;
    this.markers = [];
    this.circles = [];
  }

  async getCurrentPosition(highAccuracy = true) {
    if (!navigator.geolocation) {
      return { error: 'Geolocalização não suportada neste dispositivo' };
    }

    try {
      const position = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
        navigator.geolocation.getCurrentPosition(
          (pos) => { clearTimeout(timeout); resolve(pos); },
          (err) => { clearTimeout(timeout); reject(err); },
          {
            enableHighAccuracy: highAccuracy,
            timeout: 15000,
            maximumAge: highAccuracy ? 0 : 30000
          }
        );
      });

      this.currentPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        speed: position.coords.speed,
        timestamp: new Date().toISOString()
      };

      return this.currentPosition;
    } catch (error) {
      const messages = {
        1: 'Permissão de localização negada. Ative o GPS.',
        2: 'Localização não disponível. Verifique o GPS.',
        3: 'Tempo esgotado. Tente novamente em local aberto.'
      };
      return { error: messages[error.code] || error.message || 'Erro ao obter localização' };
    }
  }

  // Calcular distância entre dois pontos (fórmula de Haversine)
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // raio da Terra em metros
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // retorna distância em metros
  }

  // Verificar se posição está dentro do raio de uma obra
  isWithinRadius(position, obra) {
    if (!obra.lat || !obra.lng || !obra.radius) return { within: true, distance: 0 };
    
    const distance = GeoManager.calculateDistance(
      position.lat, position.lng,
      obra.lat, obra.lng
    );

    return {
      within: distance <= obra.radius,
      distance: Math.round(distance)
    };
  }

  // Formatar coordenadas para exibição
  formatPosition(position) {
    if (!position || position.error) return 'Não disponível';
    return `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
  }

  formatAccuracy(meters) {
    if (!meters) return '';
    if (meters < 10) return '(GPS preciso)';
    if (meters < 50) return `(±${Math.round(meters)}m)`;
    if (meters < 200) return `(±${Math.round(meters)}m - médio)`;
    return `(±${Math.round(meters)}m - baixa precisão)`;
  }

  // Atualizar info de localização na UI
  updateLocationUI(position) {
    const el = document.getElementById('locationInfo');
    if (!el) return;

    if (position.error) {
      el.className = 'location-info error';
      el.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <span>${position.error}</span>`;
    } else {
      el.className = 'location-info success';
      el.innerHTML = `
        <i class="fas fa-map-marker-alt"></i>
        <span>${this.formatPosition(position)} ${this.formatAccuracy(position.accuracy)}</span>
      `;
      el.dataset.lat = position.lat;
      el.dataset.lng = position.lng;
      el.dataset.accuracy = position.accuracy;
    }
  }

  // Inicializar mapa Leaflet (para admin)
  initMap(containerId, center = [-6.4111, -48.5361], zoom = 14) {
    if (typeof L === 'undefined') {
      console.warn('[Geo] Leaflet não carregado');
      return null;
    }

    // Camadas de Mapa
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    });

    const esriSatelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 20,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
    });

    const googleStreets = L.tileLayer('http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '© Google Maps'
    });

    const googleHybrid = L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
      maxZoom: 22,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '© Google Maps'
    });

    const openTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: 'Map data: &copy; OSM partners, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
    });

    this.map = L.map(containerId, {
      zoomControl: true,
      attributionControl: false,
      layers: [googleHybrid] // Default layer
    }).setView(center, zoom);

    // Controle de Camadas
    const baseMaps = {
      "Padrão (Ruas)": googleStreets,
      "Satélite": esriSatelite,
      "Híbrido": googleHybrid,
      "Terreno (OSM)": osm,
      "Topográfico": openTopo
    };

    L.control.layers(baseMaps).addTo(this.map);

    return this.map;
  }

  // Adicionar marcadores de registros no mapa
  addRecordMarkers(records, employees) {
    if (!this.map) return;

    // Limpar marcadores antigos
    this.markers.forEach(m => this.map.removeLayer(m));
    this.markers = [];

    const bounds = [];

    records.forEach(record => {
      if (!record.lat || !record.lng) return;

      const lat = parseFloat(record.lat);
      const lng = parseFloat(record.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      const emp = employees.find(e => e.id === record.employeeId) || { name: 'Desconhecido' };
      const isEntry = record.type === 'entry' || record.type === 'break_end';
      
      const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          width: 32px; height: 32px; border-radius: 50%;
          background: ${isEntry ? '#22c55e' : '#ef4444'};
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          border: 3px solid #fff;
          font-size: 14px; color: #fff;
        "><i class="fas fa-${isEntry ? 'arrow-up' : 'arrow-down'}"></i></div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([lat, lng], { icon })
        .bindPopup(`
          <div style="padding: 4px;">
            <strong>${emp.name}</strong><br>
            <span style="color: ${isEntry ? '#22c55e' : '#ef4444'}; font-weight: 700;">
              ${record.type === 'entry' ? '⬆ Entrada' : 
                record.type === 'exit' ? '⬇ Saída' :
                record.type === 'break' ? '☕ Pausa' : '▶ Retorno'}
            </span><br>
            <small>${record.time} - ${record.date}</small>
          </div>
        `)
        .addTo(this.map);

      this.markers.push(marker);
      bounds.push([lat, lng]);
    });

    if (bounds.length > 0) {
      this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    }
  }

  // Adicionar círculos de obras/fazendas
  addObraCircles(obras) {
    if (!this.map) return;

    // Limpar círculos antigos
    this.circles.forEach(c => this.map.removeLayer(c));
    this.circles = [];

    obras.forEach(obra => {
      if (!obra.lat || !obra.lng || !obra.radius) return;

      const circle = L.circle([obra.lat, obra.lng], {
        radius: obra.radius,
        color: '#6366f1',
        fillColor: '#6366f1',
        fillOpacity: 0.1,
        weight: 2,
        dashArray: '5, 5'
      }).bindPopup(`
        <strong>${obra.name}</strong><br>
        Raio: ${obra.radius}m
      `).addTo(this.map);

      this.circles.push(circle);
    });
  }

  startWatching(callback) {
    if (!navigator.geolocation) return;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.currentPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: new Date().toISOString()
        };
        callback?.(this.currentPosition);
      },
      (err) => console.warn('[Geo] Watch error:', err),
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
  }

  stopWatching() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  destroyMap() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    this.markers = [];
    this.circles = [];
  }
}

window.geoManager = new GeoManager();
