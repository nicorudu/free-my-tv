// Public settings for the home screen. Private links (the shared calendar, the sketch relay) are NOT here:
// they're sent to the TV with adb into Free My TV's private files and read through window.TV.secret().
window.HOME_CONFIG = {
  lat: 38.5904,          // White Plains, MD
  lon: -76.9403,
  calendarUrl: "",
  calendarRefreshMinutes: 30,
  sketchUrl: "",
  sketchToken: ""
};
