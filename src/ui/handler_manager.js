// @flow

import {MapMouseEvent, MapTouchEvent, MapWheelEvent} from '../ui/events';
import {Event} from '../util/evented';
import DOM from '../util/dom';
import browser from '../util/browser';
import type Map from './map';
import HandlerInertia from './handler_inertia';
import {MapEventHandler, BlockableMapEventHandler} from './handler/map_event';
import BoxZoomHandler from './handler/box_zoom';
import TapZoomHandler from './handler/tap_zoom';
import {MousePanHandler, MouseRotateHandler, MousePitchHandler} from './handler/mouse';
import TouchPanHandler from './handler/touch_pan';
import {TouchZoomHandler, TouchRotateHandler} from './handler/touch_zoom_rotate';
import TouchPitchHandler from './handler/touch_pitch';
import KeyboardHandler from './handler/keyboard';
import ScrollZoomHandler from './handler/scroll_zoom';
import ClickZoomHandler from './handler/dblclick_zoom';
import SwipeZoomHandler from './handler/swipe_zoom';
import DragPanHandler from './handler/shim/drag_pan';
import DragRotateHandler from './handler/shim/drag_rotate';
import TouchZoomRotateHandler from './handler/shim/touch_zoom_rotate';
import {bezier, extend} from '../util/util';
import window from '../util/window';
import Point from '@mapbox/point-geometry';
import assert from 'assert';
import type {AnimationOptions} from './camera';

export type InputEvent = MouseEvent | TouchEvent | KeyboardEvent | WheelEvent;

class RenderFrameEvent extends Event {
    type: 'renderFrame';
    timeStamp: number;
}

// TODO
export interface Handler {
    enable(): void;
    disable(): void;
    isEnabled(): boolean;
    isActive(): boolean;
    reset(): void;
    +touchstart?: (e: TouchEvent, points: Array<Point>) => HandlerResult | void;
    +touchmove?: (e: TouchEvent, points: Array<Point>) => HandlerResult | void;
    +touchend?: (e: TouchEvent, points: Array<Point>) => HandlerResult | void;
    +touchcancel?: (e: TouchEvent, points: Array<Point>) => HandlerResult | void;
    +mousedown?: (e: MouseEvent, point: Point) => HandlerResult | void;
    +mousemove?: (e: MouseEvent, point: Point) => HandlerResult | void;
    +mouseup?: (e: MouseEvent, point: Point) => HandlerResult | void;
    +dblclick?: (e: MouseEvent, point: Point) => HandlerResult | void;
    +wheel?: (e: WheelEvent, point: Point) => HandlerResult | void;
    +keydown?: (e: KeyboardEvent) => HandlerResult | void;
    +keyup?: (e: KeyboardEvent) => HandlerResult | void;
    +renderFrame?: () => HandlerResult | void;
}

export type HandlerResult = {|
    panDelta?: Point,
    zoomDelta?: number,
    bearingDelta?: number,
    pitchDelta?: number,
    around?: Point | null,
    pinchAround?: Point | null,
    duration?: number,
    easing?: (number) => number,
    originalEvent?: any,
    delayEndEvents?: number,
    needsRenderFrame?: boolean,
    noInertia?: boolean
|};

function hasChange(result: HandlerResult) {
    return (result.panDelta && result.panDelta.mag()) || result.zoomDelta || result.bearingDelta || result.pitchDelta;
}

class HandlerManager {
    _map: Map;
    _el: HTMLElement;
    _handlers: Array<[string, Handler, any]>;
    eventsInProgress: Object;
    _frameId: number;
    inertia: HandlerInertia;
    _handlersById: { [string]: Handler };
    _updatingCamera: boolean;
    _changes: Array<[HandlerResult, Object, any]>;

    /**
     * @private
     * options.inertiaOptions - linearity, easing, duration, maxSpeed
     */
    constructor(map: Map, options?: { clickTolerance?: number }) {
        this._map = map;
        this._el = this._map.getCanvasContainer();
        this._handlers = [];
        this._handlersById = {};
        this._changes = [];

        this.inertia = new HandlerInertia(map, options);
        this.options = options;
        this.previousActiveHandlers = {};

        // Track whether map is currently moving, to compute start/move/end events
        this.eventsInProgress = {};

        this._addDefaultHandlers();

        // Bind touchstart and touchmove with passive: false because, even though
        // they only fire a map events and therefore could theoretically be
        // passive, binding with passive: true causes iOS not to respect
        // e.preventDefault() in _other_ handlers, even if they are non-passive
        // (see https://bugs.webkit.org/show_bug.cgi?id=184251)
        this._addListener(this._el, 'touchstart', {passive: false});
        this._addListener(this._el, 'touchmove', {passive: false});
        this._addListener(this._el, 'touchend');
        this._addListener(this._el, 'touchcancel');

        this._addListener(this._el, 'mousedown');
        this._addListener(window, 'mousemove');
        this._addListener(window, 'mouseup');
        this._addListener(this._el, 'mouseover');
        this._addListener(this._el, 'mouseout');
        this._addListener(this._el, 'dblclick');
        this._addListener(this._el, 'click');

        this._addListener(this._el, 'keydown', { capture: false });
        this._addListener(this._el, 'keyup');

        this._addListener(this._el, 'wheel', {passive: false});
        this._addListener(this._el, 'contextmenu');

        DOM.addEventListener(window, 'blur', () => this.stop());
    }


    _addListener(element, eventType, options, name_) {
        const name = name_ || eventType;
        DOM.addEventListener(element, eventType, e => this.processInputEvent(e, name), options);
    }

    _addDefaultHandlers() {
        const el = this._map.getCanvasContainer();
        this.add('mapEvent', new MapEventHandler(this._map, this.options));
        const boxZoom = this._map.boxZoom = new BoxZoomHandler(this._map, this.options);
        this.add('boxZoom', boxZoom);
        this.add('tapZoom', new TapZoomHandler());
        this.add('swipeZoom', new SwipeZoomHandler());
        this.add('clickZoom', new ClickZoomHandler());
        const mouseRotate = new MouseRotateHandler(this.options);
        this.add('mouseRotate', mouseRotate, ['mousePitch']);
        const mousePitch = new MousePitchHandler(this.options);
        this.add('mousePitch', mousePitch, ['mouseRotate']);
        const mousePan = new MousePanHandler(this.options);
        this.add('mousePan', mousePan);
        const touchPitch = this._map.touchPitch = new TouchPitchHandler();
        this.add('touchPitch', touchPitch);
        const touchPan = new TouchPanHandler(this.options);
        this.add('touchPan', touchPan, ['touchZoom','touchRotate']);
        const touchRotate = new TouchRotateHandler();
        this.add('touchRotate', touchRotate, ['touchPan', 'touchZoom']);
        const touchZoom = new TouchZoomHandler();
        this.add('touchZoom', touchZoom, ['touchPan', 'touchRotate']);
        this.add('scrollzoom', new ScrollZoomHandler(this._map, this));
        this.add('keyboard', new KeyboardHandler());
        this.add('blockableMapEvent', new BlockableMapEventHandler(this._map));

        this._map.dragRotate = new DragRotateHandler(this.options, mouseRotate, mousePitch);
        mouseRotate.disable();
        mousePitch.disable();
        this._map.dragRotate.enable();

        this._map.dragPan = new DragPanHandler(mousePan, touchPan);
        this._map.dragPan.enable(this.options.dragPan);
        this._map.touchZoomRotate = new TouchZoomRotateHandler(touchZoom, touchRotate);
    }

    add(handlerName: string, handler: Handler, allowed?: Array<string>) {
        if (this._handlersById[handlerName]) {
            throw new Error(`Cannot add ${handlerName}: a handler with that name already exists`);
        }
        this._handlers.push([handlerName, handler, allowed]);
        this._handlersById[handlerName] = handler;
        handler.enable();
    }

    stop() {
        // do nothing if this method was triggered by a gesture update
        if (this._updatingCamera) return;

        for (const [name, handler] of this._handlers) {
            handler.reset();
        }
        this.inertia.clear();
        this.fireEvents({});
        this._changes = [];
    }

    isActive() {
        for (const [name, handler] of this._handlers) {
            if (handler.isActive()) return true;
        }
        return false;
    }

    isZooming() {
        return !!this.eventsInProgress.zoom;
    }
    isRotating() {
        return !!this.eventsInProgress.rotate;
    }

    blockedByActive(activeHandlers: { [string]: Handler }, allowed: Array<string>, myName: string) { 
        for (const name in activeHandlers) {
            if (name === myName) continue;
            if (!allowed || allowed.indexOf(name) < 0) {
                return name;
                return true;
            }
        }
        return false;
    }

    processInputEvent(e: InputEvent | RenderFrameEvent) {

        this._updatingCamera = true;
        assert(e.timeStamp !== undefined);

        // TODO
        if (e && e.cancelable && (e instanceof MouseEvent ? e.type === 'mousemove' : true)) ((e: any): MouseEvent).preventDefault();

        const mergedHandlerResult: HandlerResult = {needsRenderFrame: false};
        const eventsInProgress = {};
        const activeHandlers = {};

        const points = e ? (e.targetTouches ?
            DOM.touchPos(this._el, ((e: any): TouchEvent).targetTouches) :
            DOM.mousePos(this._el, ((e: any): MouseEvent))) : null;

        for (const [name, handler, allowed] of this._handlers) {
            if (!handler.isEnabled()) continue;

            let data: HandlerResult | void;
            if (this.blockedByActive(activeHandlers, allowed, name)) {
                handler.reset(this.blockedByActive(activeHandlers, allowed, name));

            } else {
                if ((handler: any)[e.type]) {
                    data = (handler: any)[e.type](e, points);
                    this.mergeHandlerResult(mergedHandlerResult, eventsInProgress, data, name);
                    if (data && data.needsRenderFrame) {
                        this.triggerRenderFrame();
                    }
                }
            }

            if (data || handler.isActive()) {
                activeHandlers[name] = handler;
            } else {
                delete activeHandlers[name];
            }
        }

        let handlersChanged = false;
        for (const name in this.previousActiveHandlers) {
            if (!activeHandlers[name]) {
                handlersChanged = true;
                break;
            }
        }
        this.previousActiveHandlers = activeHandlers;

        if (handlersChanged || hasChange(mergedHandlerResult)) {
            this._changes.push([mergedHandlerResult, eventsInProgress, e]);
            this.triggerRenderFrame();
        }


        this._updatingCamera = false;
    }

    mergeHandlerResult(mergedHandlerResult: HandlerResult, eventsInProgress: Object, handlerResult: HandlerResult, name: string) {
        if (!handlerResult) return;

        extend(mergedHandlerResult, handlerResult);

        // track which handler changed which camera property
        if (handlerResult.zoomDelta !== undefined) {
            eventsInProgress.zoom = name;
        }
        if (handlerResult.panDelta !== undefined) {
            eventsInProgress.drag = name;
        }
        if (handlerResult.pitchDelta !== undefined) {
            eventsInProgress.pitch = name;
        }
        if (handlerResult.bearingDelta !== undefined) {
            eventsInProgress.rotate = name;
        }

    }

    applyChanges() {
        let combined = {};
        let combinedEventsInProgress = {};

        for (const [change, eventsInProgress, e] of this._changes) {

            if (change.duration && combined.duration) {
                // an animated change overrides all previous changes
                combined = {};
                combinedEventsInProgress = {};
            }

            if (change.duration) combined.duration = change.duration;
            if (change.easing) combined.easing = change.easing;
            if (change.panDelta) combined.panDelta = (combined.panDelta || new Point(0, 0))._add(change.panDelta);
            if (change.zoomDelta) combined.zoomDelta = (combined.zoomDelta || 0) + change.zoomDelta;
            if (change.bearingDelta) combined.bearingDelta = (combined.bearingDelta || 0) + change.bearingDelta;
            if (change.pitchDelta) combined.pitchDelta = (combined.pitchDelta || 0) + change.pitchDelta;
            if (change.around !== undefined) combined.around = change.around;
            if (change.pinchAround !== undefined) combined.pinchAround = change.pinchAround;
            if (change.noInertia) combined.noInertia = change.noInertia;

            extend(combinedEventsInProgress, eventsInProgress);
        }
        
        // TODO pass original event
        this.updateMapTransform(combined, combinedEventsInProgress);
        this._changes = [];
    }

    updateMapTransform(combinedResult: any, combinedEventsInProgress: Object, e?: InputEvent | RenderFrameEvent) {
        
        if (!hasChange(combinedResult)) {
            return this.fireEvents(combinedEventsInProgress);
        }

        const map = this._map;
        const tr = map.transform;

        let { panDelta, zoomDelta, bearingDelta, pitchDelta, around, pinchAround } = combinedResult;

        if (pinchAround !== undefined) {
            around = pinchAround;
        }

        if (combinedResult.duration) {
            const easeOptions = {};
            easeOptions.duration = combinedResult.duration;
            if (combinedResult.delayEndEvents) easeOptions.delayEndEvents = combinedResult.delayEndEvents;
            if (combinedResult.easing) easeOptions.easing = combinedResult.easing;

            if (panDelta) easeOptions.center = map.unproject(tr.centerPoint.sub(panDelta));
            if (zoomDelta) easeOptions.zoom = tr.zoom + zoomDelta;
            if (bearingDelta) easeOptions.bearing = tr.bearing + bearingDelta;
            if (pitchDelta) easeOptions.pitch = tr.pitch + pitchDelta;
            if (around) easeOptions.around = map.unproject(around);

            this.inertia.clear('ease clear', combinedResult);
            map.easeTo(easeOptions);

        } else {

            // stop any ongoing camera animations (easeTo, flyTo)
            map._stop(true);

            around = around || map.transform.centerPoint;
            const loc = tr.pointLocation(panDelta ? around.sub(panDelta) : around);
            if (bearingDelta) tr.bearing += bearingDelta;
            if (pitchDelta) tr.pitch += pitchDelta;
            if (zoomDelta) tr.zoom += zoomDelta;
            tr.setLocationAtPoint(loc, around);

            this._map._update();
            if (!combinedResult.noInertia) this.inertia.record(combinedResult);
            this.fireEvents(combinedEventsInProgress);
        }

    }


    fireEvents(newEventsInProgress: { [string]: string }, e?: InputEvent) {
        const isMoving = p => p.zoom || p.drag || p.pitch || p.rotate;

        const wasMoving = isMoving(this.eventsInProgress);
        const nowMoving = isMoving(newEventsInProgress);

        if (!wasMoving && nowMoving) {
            this._fireEvent('movestart', e);
        }

        for (const eventName in newEventsInProgress) {
            const handlerName = newEventsInProgress[eventName];
            if (!this.eventsInProgress[eventName]) {
                this._fireEvent(eventName + 'start', e);
            }
            this.eventsInProgress[eventName] = handlerName;
        }

        if (newEventsInProgress.rotate) this._bearingChanged = true;

        if (nowMoving) {
            this._fireEvent('move', e);
        }

        for (const eventName in newEventsInProgress) {
            this._fireEvent(eventName, e);
        }

        for (const eventName in this.eventsInProgress) {
            const handlerName = this.eventsInProgress[eventName];
            if (!this._handlersById[handlerName].isActive()) {
                delete this.eventsInProgress[eventName];
                this._fireEvent(eventName + 'end', e);
            }
        }

        const stillMoving = isMoving(this.eventsInProgress);
        if ((wasMoving || nowMoving) && !stillMoving) {
            this._updatingCamera = true;
            const inertialEase = this.inertia._onMoveEnd(e, this._bearingChanged);

            const shouldSnapToNorth = bearing => -this.options.bearingSnap < bearing && bearing < this.options.bearingSnap;

            if (inertialEase) {
                if (shouldSnapToNorth(inertialEase.bearing || this._map.getBearing())) {
                    inertialEase.bearing = 0;
                }
                this._map.easeTo(inertialEase, { originalEvent: e });
            } else {
                this._map.fire(new Event('moveend', { originalEvent: e }));
                if (shouldSnapToNorth(this._map.getBearing())) {
                    this._map.resetNorth();
                }
            }
            this._bearingChanged = false;
            this._updatingCamera = false;
        }

    }

    _fireEvent(type: string, e: *) {
        this._map.fire(new Event(type, e ? {originalEvent: e} : {}));
    }

    triggerRenderFrame() {
        if (this._frameId === undefined) {
            this._frameId = this._map._requestRenderFrame(timeStamp => {
                delete this._frameId;
                this.processInputEvent(new RenderFrameEvent('renderFrame', { timeStamp }));
                this.applyChanges();
            });
        }
    }

}


export default HandlerManager;
