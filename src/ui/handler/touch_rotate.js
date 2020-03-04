// @flow

import Point from '@mapbox/point-geometry';
import {log, getTouchesById} from './handler_util';

const THRESHOLD = 20; // pixels along circumference of touch circle

/*
 * The threshold before a rotation actually happens is configured in
 * pixels alongth circumference of the circle formed by the two fingers.
 * This makes the threshold in degrees larger when the fingers are close
 * together and smaller when the fingers are far apart.
 */
function getThreshold(diameter) {
    const circumference = Math.PI * diameter;
    return THRESHOLD / circumference * 360;
}

function getBearingDelta(a, b) {
    return a.angleWith(b) * 180 / Math.PI;
}

export default class TouchRotateHandler {

    _enabled: boolean;
    _active: boolean;
    _firstTwoTouches: [number, number];
    _vector: Point;
    _startVector: Point;
    _aroundCenter: boolean;
    _minDiameter: number;

    constructor() {
        this.reset();
    }

    reset() {
        this._active = false;
        delete this._firstTwoTouches;
        delete this._vector;
        delete this._startVector;
        delete this._minDiameter;
    }

    touchstart(e: TouchEvent, points: Array<Point>) {
        if (this._firstTwoTouches || e.targetTouches.length < 2) return;

        this._firstTwoTouches = [
            e.targetTouches[0].identifier,
            e.targetTouches[1].identifier
        ];

        const [a, b] = getTouchesById(e, points, this._firstTwoTouches);
        this._startVector = this._vector = a.sub(b);
        this._minDiameter = a.dist(b);
    }

    _isWithinThreshold(vector) {
        const bearingDeltaSinceStart = getBearingDelta(vector, this._startVector);

        // use the smallest diameter from the whole gesture to reduce sensitivity
        // when pinching in and out
        this._minDiameter = Math.min(this._minDiameter, vector.mag());

        return Math.abs(bearingDeltaSinceStart) < getThreshold(this._minDiameter);
    }

    touchmove(e: TouchEvent, points: Array<Point>) {
        if (!this._firstTwoTouches) return;

        const [a, b] = getTouchesById(e, points, this._firstTwoTouches);
        const vector = a.sub(b);
        const bearingDelta = getBearingDelta(vector, this._vector);
        const pinchAround = this._aroundCenter ? null : a.add(b).div(2);

        this._vector = vector;

        if (!this._active && this._isWithinThreshold(vector)) return;

        this._active = true;

        return {
            pinchAround,
            bearingDelta
        };
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
