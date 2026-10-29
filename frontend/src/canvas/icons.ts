/**
 * The picture of each kind of device (UX-08, F46).
 *
 * Converted from the JPEGs in `icons/` by `scripts/icons_to_png.py`: the
 * originals are CMYK on an opaque white ground, which the dark theme showed as
 * a white box around every device. Imported rather than referenced by path so
 * that Vite fingerprints them into the build, and so into the wheel (F45).
 */

import type { DeviceKind } from "../types";
import pc from "./icons/pc.png";
import router from "./icons/router.png";
import server from "./icons/server.png";
import switchIcon from "./icons/switch.png";

export const DEVICE_ICONS: Record<DeviceKind, string> = {
  router,
  switch: switchIcon,
  pc,
  server,
};
