import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Corrige les icônes de marqueur par défaut de React Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

// Recentre la carte quand les coordonnées changent
function ChangeView({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, zoom)
  }, [center, zoom, map])
  return null
}

// Marqueur : point plein coloré, bordure blanche (pas d'emoji, pas de halo)
const createCustomIcon = (color: string) => L.divIcon({
  html: `
    <div style="
      background: ${color};
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
      cursor: pointer;
      transition: transform 0.2s;
    " class="marker-hover"></div>
  `,
  className: 'custom-div-icon',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

export default function TripMap({ destination, hotels = [], focusedLocation = null }: { destination: string, hotels?: any[], focusedLocation?: [number, number] | null }) {
  const [center, setCenter] = useState<[number, number] | null>(null)
  const [markers, setMarkers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function initPoints() {
      if (!destination) return
      setLoading(true)
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination)}&limit=1`)
        const data = await res.json()
        
        let mainCoords = null
        if (data && data.length > 0) {
          mainCoords = [parseFloat(data[0].lat), parseFloat(data[0].lon)] as [number, number]
          setCenter(mainCoords)
        }

        const hotelMarkers = []
        for (const hotel of hotels.slice(0, 3)) {
          const hRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(hotel.name + ' ' + destination)}&limit=1`)
          const hData = await hRes.json()
          if (hData && hData.length > 0) {
            hotelMarkers.push({
              id: hotel.name,
              coords: [parseFloat(hData[0].lat), parseFloat(hData[0].lon)] as [number, number],
              name: hotel.name,
              type: 'hotel',
            })
          }
        }
        setMarkers(hotelMarkers)
      } catch (err) {
        console.error("Erreur de cartographie :", err)
      } finally {
        setLoading(false)
      }
    }
    initPoints()
  }, [destination, hotels])

  useEffect(() => {
    if (focusedLocation) {
      setCenter(focusedLocation)
    }
  }, [focusedLocation])

  if (loading) {
    return (
      <div className="w-full h-[400px] bg-ink/20 animate-pulse rounded-sm flex items-center justify-center border border-white/5">
        <p className="text-muted text-sm">Chargement de la carte...</p>
      </div>
    )
  }

  if (!center) return null

  return (
    <div className="w-full h-[400px] rounded-sm overflow-hidden border border-white/10 relative z-0">
      <style>{`
        .leaflet-popup-content-wrapper {
          background: rgba(28, 28, 30, 0.8) !important;
          backdrop-filter: blur(10px);
          color: #F2F2F7 !important;
          border-radius: 12px !important;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .leaflet-popup-tip {
          background: rgba(28, 28, 30, 0.8) !important;
        }
        .marker-hover:hover {
          transform: scale(1.2) translateY(-5px);
        }
      `}</style>
      <MapContainer 
        center={center} 
        zoom={13} 
        scrollWheelZoom={false}
        className="w-full h-full"
      >
        <ChangeView center={center} zoom={13} />
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com">Esri</a> · Imagerie satellite'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
        
        {/* Marqueur ville */}
        <Marker position={center} icon={createCustomIcon('#E3A72C')}>
          <Popup>
            <div className="p-1">
              <p className="font-bold text-sm">{destination}</p>
              <p className="text-[10px] opacity-70">Destination</p>
            </div>
          </Popup>
        </Marker>

        {/* Marqueurs hôtels */}
        {markers.map(m => (
          <Marker key={m.id} position={m.coords} icon={createCustomIcon('#5A7A5E')}>
            <Popup>
              <div className="p-1">
                <p className="font-bold text-sm">{m.name}</p>
                <p className="text-[10px] text-sage">Hébergement sélectionné</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
