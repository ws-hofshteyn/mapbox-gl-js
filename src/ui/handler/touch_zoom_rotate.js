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
        delete this._lastPoints;
    }

    touchstart(e: TouchEvent, points: Array<Point>) {
        if (this._firstTwoTouches || e.targetTouches.length < 2) return;

        this._firstTwoTouches = [
            e.targetTouches[0].identifier,
            e.targetTouches[1].identifier
        ];

        this._lastPoints = getTouchesById(e, points, this._firstTwoTouches);
        this._start(this._lastPoints);
    }

    touchmove(e: TouchEvent, points: Array<Point>) {
        if (!this._firstTwoTouches) return;

        const lastPoints = this._lastPoints;
        const [a, b] = getTouchesById(e, points, this._firstTwoTouches);
        if (!a || !b) return;
        this._lastPoints = [a, b];
        const pinchAround = this._aroundCenter ? null : a.add(b).div(2);
        return this._move(this._lastPoints, lastPoints, pinchAround);

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
    }

    _start(points) {
        this._startVector = points[0].sub(points[1]);
        this._minDiameter = points[0].dist(points[1]);
    }

    _move(points, lastPoints, pinchAround) {
        const vector = points[0].sub(points[1]);

        if (!this._active && this._isBelowThreshold(vector)) return;
        this._active = true;

        const lastVector = lastPoints[0].sub(lastPoints[1]);
        const bearingDelta = getBearingDelta(vector, lastVector);

        return {
            pinchAround,
            bearingDelta
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

export class TouchZoomHandler extends TwoTouchHandler {

    _start(points) {}

    _move(points, lastPoints, pinchAround) {
        this._active = true;

        const distance = points[0].dist(points[1]);
        const lastDistance = lastPoints[0].dist(lastPoints[1]);
        const zoomDelta = Math.log(distance / lastDistance) / Math.LN2;

        return {
            pinchAround,
            zoomDelta
        };
    }
}
