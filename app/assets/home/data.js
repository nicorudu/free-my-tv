// Preview data. On the TV, the apps come from the stick, the weather from Open-Meteo, the calendar and the
// sketch from your Cloudflare worker; these only fill the screen when that isn't available (like here).
window.PREVIEW = {
  apps: [
    { pkg: "com.netflix.ninja", name: "Netflix", brand: "#e50914" },
    { pkg: "com.google.android.youtube.tv", name: "YouTube", brand: "#ff3b30" },
    { pkg: "com.amazon.amazonvideo.livingroom", name: "Prime Video", brand: "#1fa8ff" },
    { pkg: "com.apple.atve.androidtv.appletv", name: "Apple TV", brand: "#8e95a3" },
    { pkg: "com.peacocktv.peacockandroid", name: "Peacock", brand: "#f5c400" },
    { pkg: "com.spotify.tv.android", name: "Spotify", brand: "#1ed760" }
  ],
  sketch: { src: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20720%20720%22%3E%3Crect%20width%3D%22720%22%20height%3D%22720%22%20fill%3D%22%23fff%22/%3E%3Cpath%20d%3D%22M360%20560%20C%20200%20450%20150%20360%20175%20290%20C%20200%20215%20300%20205%20360%20285%20C%20420%20205%20520%20215%20545%20290%20C%20570%20360%20520%20450%20360%20560%20Z%22%20fill%3D%22none%22%20stroke%3D%22%23e5484d%22%20stroke-width%3D%2216%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3Cpath%20d%3D%22M250%20600%20q%2040%20-20%2080%200%22%20fill%3D%22none%22%20stroke%3D%22%231d2127%22%20stroke-width%3D%2210%22%20stroke-linecap%3D%22round%22/%3E%3C/svg%3E", from: "Nico", ago: 40 },
  weather: { temp: 59, text: "Mostly sunny", code: 1, isDay: true },
  events: [
    { day: 0, time: "6:30 PM", title: "Dinner at Mom's" },
    { day: 1, time: "7:00 AM", title: "Gym" },
    { day: 1, time: "12:30 PM", title: "Dentist" },
    { day: 2, time: "All day", title: "Trash day" },
    { day: 3, time: "8:00 PM", title: "Date night" },
    { day: 5, time: "10:00 AM", title: "Farmers market" }
  ]
};
