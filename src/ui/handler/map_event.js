// @flow

import {MapMouseEvent, MapTouchEvent, MapWheelEvent} from '../events';

export class MapEventHandler {
    constructor(map, options) {
        this._map = map;
        this._clickTolerance = options.clickTolerance;
    }

    reset() {
        delete this._mouseDownPos;
    }

    wheel(e) {
        // If mapEvent.preventDefault() is called by the user, prevent handlers such as:
        // - ScrollZoom
        return this._firePreventable(new MapWheelEvent(e.type, map, e));
    }

    mousedown(e, point) {
        this._mouseDownPos = point;
        // If mapEvent.preventDefault() is called by the user, prevent handlers such as:
        // - MousePan
        // - MouseRotate
        // - MousePitch
        // - DblclickHandler
        return this._firePreventable(new MapMouseEvent(e.type, map, e));
    }

    mouseup(e) {
        this._map.fire(new MapMouseEvent(e.type, map, e));
    }

    click(e, point) {
        if (this._mouseDownPos && this._mouseDownPos.dist(point) > this._clickTolerance) return;
        this._map.fire(new MapMouseEvent(e.type, map, e));
    }

    dblclick(e) {
        // If mapEvent.preventDefault() is called by the user, prevent handlers such as:
        // - DblClickZoom
        return this._firePreventable(new MapMouseEvent(e.type, map, e));
    }

    mouseover(e) {
        this._map.fire(new MapMouseEvent(e.type, map, e));
    }

    mouseout(e) {
        this._map.fire(new MapMouseEvent(e.type, map, e));
    }


    touchstart(e) {
        // If mapEvent.preventDefault() is called by the user, prevent handlers such as:
        // - TouchPan
        // - TouchZoom
        // - TouchRotate
        // - TouchPitch
        // - TapZoom
        // - SwipeZoom
        return this._firePreventable(new MapTouchEvent(e.type, map, e));
    }

    touchend(e) {
        this._map.fire(new MapTouchEvent(e.type, map, e));
    }

    touchcancel(e) {
        this._map.fire(new MapTouchEvent(e.type, map, e));
    }

    _firePreventable(mapEvent: MapMouseEvent | MapTouchEvent | MapWheelEvent) {
        map.fire(mapEvent);
        if (mapEvent.defaultPrevented) {
            // returning an object marks the handler as active and resets other handlers
            return {};
        }
    }

    isEnabled() {
        return true;
    }

    isActive() {
        return false;
    }
    enable() {
    }
}

export class BlockableMapEventHandler {
    constructor(map, options) {
        this._map = map;
    }

    reset() {
        this._delayContextMenu = false;
        delete this._contextMenuEvent;
    }


    mousemove(e) {
        // mousemove map events should not be fired when interaction handlers (pan, rotate, etc) are active
        this._map.fire(new MapMouseEvent(e.type, map, e));
    }

    touchmove(e) {
        // touchmove map events should not be fired when interaction handlers (pan, rotate, etc) are active
        this._map.fire(new MapTouchEvent(e.type, map, e));
    }

    mousedown(e) {
        this._delayContextMenu = true;
        return {};
    }

    mouseup(e) {
        this._delayContextMenu = false;
        if (this._contextMenuEvent) {
            this._map.fire(new MapMouseEvent('contextmenu', map, this._contextMenuEvent));
            delete this._contextMenuEvent;
        }
    }
    contextmenu(e) {
        if (this._delayContextMenu) {
            // Mac: contextmenu fired on mousedown; we save it until mouseup for consistency's sake
            this._contextMenuEvent = e;
        } else {
            // Windows: contextmenu fired on mouseup, so fire event now
            this._map.fire(new MapMouseEvent(e.type, map, e));
        }

        // prevent browser context menu when necessary
        if (this._map.listens('contextmenu')) {
            e.preventDefault();
        }
    }

    isEnabled() {
        return true;
    }

    isActive() {
        return false;
    }
    enable() {
    }
}
