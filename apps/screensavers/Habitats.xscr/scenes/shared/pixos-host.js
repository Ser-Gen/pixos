// PixOS's half of the host contract. Not part of Desktop Habitats: added by PixOS, see
// ../../README.md.
//
// wallpaper.html says `data-motion="host"`: its host decides when it moves, and a scene in that
// mode draws nothing at all until it is given a frame rate. PixOS pauses a background by calling
// the page's own `pixosPause` / `pixosResume`, so both are mapped onto `habitatRate`: rate 0 stops
// the scene's loop with no frame and no timer left (and the time it was stopped is not simulated
// afterwards), and 60 lets the quality profile pick its own rate, 30 on Balanced.
//
// start.js runs before this and holds the last rate it is given until the scene has loaded, so a
// pause that arrives first is not lost. `habitatPower` is the battery switch, not a pause.

const RATE = 60;

window.habitatRate(RATE);
window.pixosPause = () => window.habitatRate(0);
window.pixosResume = () => window.habitatRate(RATE);
