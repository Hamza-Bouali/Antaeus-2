"use client"

import { useEffect, useRef, useState } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

// Mapbox access token
export const MAPBOX_ACCESS_TOKEN =
  "pk.eyJ1IjoibW91YWRlbm5hIiwiYSI6ImNseDB1d2VuczA0Y3gyaXM0Y2E5Z3A2OWoifQ.nnDPc-c8ndn7lpfEqukeXA"

// Define the marker structure
export interface MapMarker {
  id: number
  title: string
  coordinates: [number, number] // [longitude, latitude]
  type: "shelter" | "danger" | "evacuation" | "resource" | "general"
  details?: string
  severity?: "low" | "medium" | "high"
  capacity?: number
  status?: "open" | "closed" | "full" | "limited"
}

interface MapComponentProps {
  markers: MapMarker[]
  currentDisaster: string | null
  onMarkerClick: (marker: MapMarker) => void
  onClose?: () => void
  geometryCode?: string
}

export function MapComponent({ markers, currentDisaster, onMarkerClick, onClose, geometryCode }: MapComponentProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const markersRef = useRef<{ [key: number]: mapboxgl.Marker }>({})
  const routeLayerRef = useRef<boolean>(false)

  // Initialize the map
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN

    const newMap = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [-74.5, 40], // Default center (New York area)
      zoom: 9,
      // Add animation options
      animate: true,
      fadeDuration: 1000,
    })

    newMap.on("load", () => {
      console.log("Full map loaded")
      setMapLoaded(true)
    })

    map.current = newMap

    // Add navigation controls
    newMap.addControl(new mapboxgl.NavigationControl(), "top-right")

    // Cleanup on unmount
    return () => {
      if (map.current) {
        map.current.remove()
        map.current = null
      }
    }
  }, [])

  // Add markers to the map
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    // Clear existing markers
    Object.values(markersRef.current).forEach((marker) => marker.remove())
    markersRef.current = {}

    // Add new markers
    markers.forEach((marker) => {
      // Create custom marker element
      const el = document.createElement("div")
      el.className = "custom-marker"
      el.style.width = "36px"
      el.style.height = "36px"
      el.style.borderRadius = "50%"
      el.style.display = "flex"
      el.style.alignItems = "center"
      el.style.justifyContent = "center"
      el.style.cursor = "pointer"

      // Set background color based on marker type
      if (marker.type === "shelter") {
        el.style.backgroundColor = "#dbeafe" // blue-100
      } else if (marker.type === "danger") {
        el.style.backgroundColor = "#fee2e2" // red-100
      } else if (marker.type === "evacuation") {
        el.style.backgroundColor = "#e0f2fe" // sky-100
      } else if (marker.type === "resource") {
        el.style.backgroundColor = "#f3e8ff" // purple-100
      } else {
        el.style.backgroundColor = "#f3f4f6" // gray-100
      }

      // Add icon based on marker type
      const iconElement = document.createElement("div")
      iconElement.innerHTML = getMarkerIcon(marker.type)
      iconElement.style.width = "24px"
      iconElement.style.height = "24px"
      el.appendChild(iconElement)

      // Create popup
      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="padding: 8px;">
          <h3 style="font-weight: 600; margin-bottom: 4px;">${marker.title}</h3>
          ${marker.details ? `<p style="margin-bottom: 4px;">${marker.details}</p>` : ""}
          ${marker.severity ? `<p style="margin-bottom: 4px;"><strong>Severity:</strong> ${marker.severity}</p>` : ""}
          ${marker.capacity ? `<p style="margin-bottom: 4px;"><strong>Capacity:</strong> ${marker.capacity}</p>` : ""}
          ${marker.status ? `<p style="margin-bottom: 4px;"><strong>Status:</strong> ${marker.status}</p>` : ""}
        </div>
      `)

      // Create marker
      const mapboxMarker = new mapboxgl.Marker(el).setLngLat(marker.coordinates).setPopup(popup).addTo(map.current!)

      // Add click event
      el.addEventListener("click", () => {
        onMarkerClick(marker)
      })

      // Store marker reference
      markersRef.current[marker.id] = mapboxMarker
    })

    // If we have markers but no polyline, fit bounds to markers
    if (markers.length > 0 && !geometryCode) {
      const bounds = new mapboxgl.LngLatBounds()
      markers.forEach((marker) => {
        bounds.extend(marker.coordinates)
      })
      map.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: 15,
        duration: 1500, // Add animation duration in milliseconds
        essential: true, // Make animation smoother
      })
    }
  }, [markers, mapLoaded, onMarkerClick])

  // Add polyline to the map when geometryCode changes
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    try {
      // Remove existing route layer if it exists and no geometryCode is provided
      if (!geometryCode) {
        if (routeLayerRef.current && map.current.getLayer("route")) {
          map.current.removeLayer("route")
          if (map.current.getLayer("route-glow")) {
            map.current.removeLayer("route-glow")
          }
          map.current.removeSource("route")
          routeLayerRef.current = false
          console.log("Removed route layer due to empty geometryCode")
        }
        return
      }

      // Import polyline dynamically to avoid server-side rendering issues
      import("@mapbox/polyline").then((polylineModule) => {
        const polyline = polylineModule.default

        try {
          console.log("Processing geometryCode:", geometryCode.substring(0, 20) + "...")

          // Decode the polyline
          const decodedCoordinates = polyline.decode(geometryCode)
          console.log(`Decoded ${decodedCoordinates.length} coordinates`)

          if (decodedCoordinates.length === 0) {
            console.warn("No coordinates decoded from geometryCode")
            return
          }

          // Convert [lat, lng] to [lng, lat] for Mapbox
          // This is critical - Mapbox expects [longitude, latitude] order
          const mapboxCoordinates = decodedCoordinates
            .map(([lat, lng]) => {
              // Validate coordinates
              if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
                console.warn("Invalid coordinate detected:", lat, lng)
                return null
              }

              // Ensure coordinates are within valid ranges
              const validLat = Math.max(-90, Math.min(90, lat))
              const validLng = Math.max(-180, Math.min(180, lng))

              return [validLng, validLat] // Mapbox uses [lng, lat] order
            })
            .filter((coord) => coord !== null) as [number, number][]

          console.log("Transformed coordinates for Mapbox:", mapboxCoordinates.slice(0, 3))

          // Wait for map to be fully loaded
          if (!map.current!.loaded()) {
            map.current!.once("load", () => {
              // Add a slight delay before adding the polyline for better visual transition
              setTimeout(() => addPolylineToMap(mapboxCoordinates), 300)
            })
          } else {
            // Add a slight delay before adding the polyline for better visual transition
            setTimeout(() => addPolylineToMap(mapboxCoordinates), 300)
          }
        } catch (decodeError) {
          console.error("Error decoding polyline:", decodeError)
        }
      })
    } catch (error) {
      console.error("Error processing polyline:", error)
    }
  }, [geometryCode, mapLoaded])

  // Helper function to add polyline to map
  const addPolylineToMap = (coordinates: [number, number][]) => {
    if (!map.current || coordinates.length < 2) {
      console.warn("Cannot add polyline: map not initialized or insufficient coordinates")
      return
    }

    try {
      // Remove existing route layer if it exists
      if (routeLayerRef.current) {
        if (map.current.getLayer("route")) {
          map.current.removeLayer("route")
        }
        if (map.current.getLayer("route-glow")) {
          map.current.removeLayer("route-glow")
        }
        if (map.current.getSource("route")) {
          map.current.removeSource("route")
        }
        routeLayerRef.current = false
      }

      // Add new source and layer
      map.current.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: coordinates,
          },
        },
      })

      // Add a glow effect by adding multiple layers
      // First add a wider background layer for the glow effect
      map.current.addLayer({
        id: "route-glow",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#ff6666",
          "line-width": 8,
          "line-opacity": 0.4,
          "line-blur": 3,
        },
      })

      // Then add the main route line
      map.current.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#ff0000",
          "line-width": 4,
          "line-opacity": 0.9,
        },
      })

      routeLayerRef.current = true
      console.log("Added new route source and layers")

      // Fit the map to the bounds of the polyline with smooth animation
      const bounds = new mapboxgl.LngLatBounds()
      coordinates.forEach((coord) => bounds.extend(coord))

      // Check if bounds are valid before fitting
      if (bounds.isEmpty()) {
        console.warn("Cannot fit to empty bounds")
        return
      }

      map.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: 15,
        duration: 2000, // 2 seconds animation
        essential: true,
        animate: true,
      })
      console.log("Fitted map to polyline bounds with smooth animation")
    } catch (error) {
      console.error("Error adding polyline to map:", error)
    }
  }

  // Helper function to get marker icon SVG
  const getMarkerIcon = (type: string) => {
    switch (type) {
      case "shelter":
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke  width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20H7a2 2 0 0 1-2-2v-7.08A2 2 0 0 1 7 9h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-2"/><path d="M9 9V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/><path d="M13 20v-5a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v5"/></svg>`
      case "danger":
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`
      case "evacuation":
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-6 9h12Z"/><path d="M12 12v9"/></svg>`
      case "resource":
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9333ea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.94 11A8.94 8.94 0 0 0 13 3.06M14.5 21.59A9 9 0 0 1 3.41 10.5"/><path d="M12 12H3"/><path d="m16 16-4-4 4-4"/></svg>`
      default:
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`
    }
  }

  return (
    <div className="relative w-full h-full bg-white">
      <div className="absolute top-4 left-4 right-4 z-10 bg-white/90 rounded-lg p-3 shadow-md">
        <div>
          <h2 className="font-medium text-lg">Disaster Response Map</h2>
          <p className="text-sm text-gray-600">
            {currentDisaster ? `Current disaster: ${currentDisaster}` : "No active disaster"}
          </p>
        </div>
      </div>

      <div ref={mapContainer} className="w-full h-full" />

      <div className="absolute bottom-4 left-4 z-10">
        <div className="bg-white/90 p-3 rounded-lg shadow-md">
          <h3 className="font-medium mb-2">Map Legend</h3>
          <div className="space-y-2">
            <div className="flex items-center">
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center mr-2">
                <div dangerouslySetInnerHTML={{ __html: getMarkerIcon("shelter") }} />
              </div>
              <span className="text-sm">Shelter</span>
            </div>
            <div className="flex items-center">
              <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center mr-2">
                <div dangerouslySetInnerHTML={{ __html: getMarkerIcon("danger") }} />
              </div>
              <span className="text-sm">Danger Zone</span>
            </div>
            <div className="flex items-center">
              <div className="w-6 h-6 rounded-full bg-sky-100 flex items-center justify-center mr-2">
                <div dangerouslySetInnerHTML={{ __html: getMarkerIcon("evacuation") }} />
              </div>
              <span className="text-sm">Evacuation Point</span>
            </div>
            <div className="flex items-center">
              <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center mr-2">
                <div dangerouslySetInnerHTML={{ __html: getMarkerIcon("resource") }} />
              </div>
              <span className="text-sm">Resource Center</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

