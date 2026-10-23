import { MOUSE, TOUCH } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Left-button and one-finger drag either turn the 3D camera (default) or move
 * it sideways. The other mouse button does the opposite, so both stay reachable.
 */
export function setDragMode(c: OrbitControls, pan: boolean) {
  c.screenSpacePanning = true;
  c.mouseButtons.LEFT = pan ? MOUSE.PAN : MOUSE.ROTATE;
  c.mouseButtons.RIGHT = pan ? MOUSE.ROTATE : MOUSE.PAN;
  c.touches.ONE = pan ? TOUCH.PAN : TOUCH.ROTATE;
}
