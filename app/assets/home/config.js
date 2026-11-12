// Public settings for the home screen. Private links (the shared calendar, the sketch relay) are NOT here:
// they're sent to the TV with adb into Free My TV's private files and read through window.TV.secret().
window.HOME_CONFIG = {
  // Only used for previews in a browser. On the TV, the weather uses the city picked in
  // Free My TV's Settings > City, which stays on the TV.
  lat: 40.7128,
  lon: -74.0060,
  calendarUrl: "",
  calendarRefreshMinutes: 30,
  sketchUrl: "",
  sketchToken: ""
};
