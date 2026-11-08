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
