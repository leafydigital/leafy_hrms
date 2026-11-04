// Current location for check-in / check-out. Needs HTTPS (or localhost) and the user's permission.
export function getLocation({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('This browser cannot share location.'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(
        err.code === 1 ? 'Location permission is blocked. Allow location for this site in your browser settings, then try again.'
          : err.code === 3 ? 'Getting your location took too long. Move near a window or turn on GPS and try again.'
            : 'Could not get your location. Turn on location services and try again.',
      )),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    )
  })
}

export const mapLink = (lat, lng) => (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null)
