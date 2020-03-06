// @flow

import Point from '@mapbox/point-geometry';
import {log, getTouchesById} from './handler_util';


class TwoTouchHandler {

    _enabled: boolean;
    _active: boolean;
    _firstTwoTouches: [number, number];
    _vector: Point;
    _startVector: Point;
    _aroundCenter: boolean;

    constructor() {
        this.reset();
    }

    reset() {
        this._active = false;
        delete this._firstTwoTouches;
    }

    touchstart(e: TouchEvent, points: Array<Point>) {
        if (this._firstTwoTouches || e.targetTouches.length < 2) return;

        this._firstTwoTouches = [
            e.targetTouches[0].identifier,
            e.targetTouches[1].identifier
        ];

        // implemented by child classes
        this._start([points[0], points[1]]);
    }

    touchmove(e: TouchEvent, points: Array<Point>) {
        if (!this._firstTwoTouches) return;

        const touchPoints = getTouchesById(e, points, this._firstTwoTouches);

        const [a, b] = touchPoints;
        if (!a || !b) return;
        const pinchAround = this._aroundCenter ? null : a.add(b).div(2);

        // implemented by child classes
        return this._move(touchPoints, pinchAround, e);

    }

    touchend(e: TouchEvent, points: Array<Point>) {
        if (!this._firstTwoTouches) return;

        const [a, b] = getTouchesById(e, points, this._firstTwoTouches);
        if (a && b) return;

        this.reset();
    }

    enable(options: ?{around?: 'center'}) {
        this._enabled = true;
        this._aroundCenter = !!options && options.around === 'center';
    }

    disable() {
        this._enabled = false;
        this.reset();
    }

    isEnabled() {
        return this._enabled;
    }

    isActive() {
        return this._active;
    }
}

/* ZOOM */

export class TouchZoomHandler extends TwoTouchHandler {

    reset() {
        super.reset();
        delete this._distance;
    }

    _start(points) {
        this._distance = points[0].dist(points[1]);
    }

    _move(points, pinchAround) {
        this._active = true;
        const lastDistance = this._distance;
        this._distance = points[0].dist(points[1]);
        return {
            zoomDelta: Math.log(this._distance / lastDistance) / Math.LN2,
            pinchAround
        };
    }
}


/* ROTATE */

const THRESHOLD = 20; // pixels along circumference of touch circle

function getBearingDelta(a, b) {
    return a.angleWith(b) * 180 / Math.PI;
}

export class TouchRotateHandler extends TwoTouchHandler {
    _minDiameter: number;

    reset() {
        super.reset();
        delete this._minDiameter;
        delete this._startVector;
        delete this._vector;
    }

    _start(points) {
        this._startVector = this._vector = points[0].sub(points[1]);
        this._minDiameter = points[0].dist(points[1]);
    }

    _move(points, pinchAround) {
        const lastVector = this._vector;
        this._vector = points[0].sub(points[1]);

        if (!this._active && this._isBelowThreshold(this._vector)) return;
        this._active = true;

        return {
            bearingDelta: getBearingDelta(this._vector, lastVector),
            pinchAround
        };
    }

    _isBelowThreshold(vector) {
        /*
         * The threshold before a rotation actually happens is configured in
         * pixels alongth circumference of the circle formed by the two fingers.
         * This makes the threshold in degrees larger when the fingers are close
         * together and smaller when the fingers are far apart.
         *
         * Use the smallest diameter from the whole gesture to reduce sensitivity
         * when pinching in and out.
         */

        this._minDiameter = Math.min(this._minDiameter, vector.mag());
        const circumference = Math.PI * this._minDiameter;
        const threshold = THRESHOLD / circumference * 360;

        const bearingDeltaSinceStart = getBearingDelta(vector, this._startVector);
        return Math.abs(bearingDeltaSinceStart) < threshold;
    }
}

/* PITCH */

function isVertical(vector) {
    return Math.abs(vector.y) > Math.abs(vector.x);
}

const ALLOWED_SINGLE_TOUCH_TIME = 100;

export class TouchPitchHandler extends TwoTouchHandler {

    reset() {
        super.reset();
        this._valid = undefined;
        delete this._firstMove;
        delete this._lastPoints;
    }

    _start(points) {
        this._lastPoints = points;
        if (isVertical(points[0].sub(points[1]))) {
            // fingers are more horizontal than vertical
            this._valid = false;
            return;
        }
    }

    _move(points, center, e) {
        const vectorA = points[0].sub(this._lastPoints[0]);
        const vectorB = points[1].sub(this._lastPoints[1]);

        this._valid = this.gestureBeginsVertically(vectorA, vectorB, e.timeStamp);
        if (!this._valid) return;

        this._lastPoints = points;
        this._active = true;
        return {
            pitchDelta: ((vectorA.y + vectorB.y) / 2) * -0.5
        };
    }

    gestureBeginsVertically(vectorA: Point, vectorB: Point, timeStamp: number) {
        if (this._valid !== undefined) return this._valid;

        if (vectorA.mag() === 0 || vectorB.mag() === 0) {

            if (this._firstMove === undefined) {
                this._firstMove = timeStamp;
            }

            if (timeStamp - this._firstMove < ALLOWED_SINGLE_TOUCH_TIME) { 
                // still waiting for a movement from the second finger
                return undefined;
            } else {
                return false;
            }
        }

        const isSameDirection = vectorA.y > 0 === vectorB.y > 0;
        return isVertical(vectorA) && isVertical(vectorB) && isSameDirection;
    }
}
