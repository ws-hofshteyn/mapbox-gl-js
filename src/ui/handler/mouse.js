// @flow

import DOM from '../../util/dom';
import type Point from '@mapbox/point-geometry';
import type InertiaOptions from '../handler_inertia';

const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;

class MouseHandler {

    _enabled: boolean;
    _active: boolean;
    _lastPoint: Point;
    _eventButton: number;
    _options: InertiaOptions;
    _clickTolerance: number;

    constructor(options: { clickTolerance?: number }) {
        this.reset();
        this._clickTolerance = options.clickTolerance || 1;
    }

    reset() {
        this._active = false;
        this._notMoved = true;
        delete this._lastPoint;
        delete this._eventButton;
    }

    mousedown(e: MouseEvent, point: Point) {
        if (this._lastPoint) return;

        const eventButton = DOM.mouseButton(e);
        if (!this._correctButton(e, eventButton)) return;

        this._lastPoint = point;
        this._eventButton = eventButton;
    }

    mousemove(e: MouseEvent, point: Point) {
        const lastPoint = this._lastPoint;
        if (!lastPoint) return;

        if (this._notMoved && point.dist(lastPoint) < this._clickTolerance) return;
        this._notMoved = false;
        this._lastPoint = point;

        return this._move(lastPoint, point);
    }

    mouseup(e: MouseEvent, point: Point) {
        const eventButton = DOM.mouseButton(e);
        if (eventButton !== this._eventButton) return;
        this.reset();
    }

    enable(options?: InertiaOptions) {
        this._enabled = true;
        if (!!options) this._options = options;
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

export class MousePanHandler extends MouseHandler {
    _correctButton(e, button) {
        return button === LEFT_BUTTON && !e.ctrlKey;
    }

    mousedown(e: MouseEvent, point: Point) {
        super.mousedown(e, point);
        if (this._lastPoint) this._active = true;
    }

    _move(lastPoint, point) {
        return {
            around: point,
            panDelta: point.sub(lastPoint)
        };
    }
}

export class MouseRotateHandler extends MouseHandler {
    _correctButton(e, button) {
        return (button === LEFT_BUTTON && e.ctrlKey) || (button === RIGHT_BUTTON);
    }

    _move(lastPoint: Point, point: Point) {
        this._active = true;
        return {
            bearingDelta: (lastPoint.x - point.x) * -0.8
        }
    }

    contextmenu(e: MouseEvent, point: Point) {
        // prevent browser context menu when necessary; we don't allow it with rotation
        // because we can't discern rotation gesture start from contextmenu on Mac
        e.preventDefault();
    }
}

export class MousePitchHandler extends MouseHandler {
    _correctButton(e, button) {
        return (button === LEFT_BUTTON && e.ctrlKey) || (button === RIGHT_BUTTON);
    }

    _move(lastPoint: Point, point: Point) {
        this._active = true;
        return {
            pitchDelta: (lastPoint.y - point.y) * 0.5
        }
    }

    contextmenu(e: MouseEvent, point: Point) {
        // prevent browser context menu when necessary; we don't allow it with rotation
        // because we can't discern rotation gesture start from contextmenu on Mac
        e.preventDefault();
    }
}
