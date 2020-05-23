BR.StreetView = L.Control.extend({
    options: {
        routing: null,
        layersControl: null,
        shortcut: {
            draw: {
                enable: 80, // char code for 'p'
                disable: 27 // char code for 'ESC'
            },
            ctrl: 17 // char code for 'ctrl'
        },
        photo: {
            width: 640,
            height: 480,
            pitch: -20,
            fov: 105
        }
    },

    onAdd: function(map) {
        var self = this;
        this.map = map;
        this._streetView = [];
        this._drawState = false;
        this._originalActiveLayer = null;
        this.GOOGLE_MAPS_ID = 'googlemaps';
        if (!(this.GOOGLE_MAPS_ID in BR.layerIndex)) {
            return;
        }
        this._googleMapsName = BR.layerIndex[this.GOOGLE_MAPS_ID].properties.name;

        var container = new L.DomUtil.create('div');
        // keys not working when map container does not have focus, use document instead
        L.DomEvent.removeListener(container, 'keyup', this._keyupListener);
        L.DomEvent.addListener(document, 'keyup', this._keyupListener, this);

        L.DomEvent.removeListener(container, 'keydown', this._keydownListener);
        L.DomEvent.addListener(document, 'keydown', this._keydownListener, this);

        L.DomEvent.addListener(container, 'click', this._clickListener);
        L.DomEvent.addListener(document, 'click', this._clickListener, this);

        return container;
    },

    // press and hold 'ctrl' to activate streetview
    _keydownListener: function(e) {
        if (e.keyCode === this.options.shortcut.ctrl && this.options.layersControl.getLayer(this._googleMapsName)) {
            // change the cursor to pointer
            L.DomUtil.addClass(this.map.getContainer(), 'streetview-enabled');
            // store the original active layer
            this._originalActiveLayer = this.options.layersControl.getActiveBaseLayer();
            // store the current drawing state and disable drawing if it's enabled
            this._drawState = this.options.routing._draw._enabled;
            if (this._drawState) {
                this.options.routing.draw(false);
            }
        }
    },

    // release 'ctrl' to deactivate streeview
    _keyupListener: function(e) {
        if (e.keyCode === this.options.shortcut.ctrl && this.options.layersControl.getLayer(this._googleMapsName)) {
            // restore the original active layer if it wasn't Google Maps layer
            if (
                this.options.layersControl.getActiveBaseLayer().layer.id === this.GOOGLE_MAPS_ID &&
                this._originalActiveLayer.layer.id !== this.GOOGLE_MAPS_ID
            ) {
                googleMapsLayer = this.options.layersControl.getLayerById(this.GOOGLE_MAPS_ID);
                this.map.removeLayer(googleMapsLayer.layer);
                this.options.layersControl.activateLayer(this._originalActiveLayer);
                this._streetViewLayer.remove();
            }
            this._streetView = [];
            // reset the pointer cursor and drawing state
            L.DomUtil.removeClass(this.map.getContainer(), 'streetview-enabled');
            if (this._drawState) {
                this.options.routing.draw(true);
            }
        }
    },

    _clickListener: function(e) {
        if (e.ctrlKey && this.options.layersControl.getLayer(this._googleMapsName)) {
            // replace the original active layer by Google Maps base layer
            if (this.options.layersControl.getActiveBaseLayer().layer.id !== this.GOOGLE_MAPS_ID) {
                this.map.removeLayer(this._originalActiveLayer.layer);
                googleMapsLayer = this.options.layersControl.getLayerById(this.GOOGLE_MAPS_ID);
                this.options.layersControl.activateLayer(googleMapsLayer);
            }
            // create overlay layer with Street View panorama
            var initialLatLng = this.map.mouseEventToLatLng(e);
            this._streetView.push(initialLatLng);
            if (this._streetView.length > 1 && BR.keys.googleStreetView) {
                var pointA = this._streetView[this._streetView.length - 2];
                var pointB = this._streetView[this._streetView.length - 1];
                var angle = this.calculateHeadingAngle(pointA, pointB);
                var imgUrl = this.getImage(pointA, angle);
                var geoCoordSW = this.map.getBounds()['_southWest'];
                var pixCoord = this.map.latLngToLayerPoint(geoCoordSW);
                pixCoord['x'] = pixCoord['x'] + this.options.photo.width;
                pixCoord['y'] = pixCoord['y'] - this.options.photo.height;
                var getCoordNE = this.map.layerPointToLatLng(pixCoord);
                var imgBounds = L.latLngBounds(geoCoordSW, getCoordNE);
                if (typeof this._streetViewLayer !== 'undefined') {
                    this._streetViewLayer.remove();
                }
                this._streetViewLayer = L.imageOverlay(imgUrl, imgBounds, { interactive: true });
                this._streetViewLayer.on('mouseover', this._mouseoverStreetViewLayer, this);
                this._streetViewLayer.on('mouseout', this._mouseoutStreetViewLayer, this);
                this._streetViewLayer.on('mousedown', this._mousedownStreetViewLayer, this);
                this._streetViewLayer.addTo(this.map);
            }
        }
    },

    _mousedownStreetViewLayer: function(e) {
        if (e.originalEvent.ctrlKey) {
            return;
        }
        this._streetViewLayer.remove();
        if (this._drawState) {
            this.options.routing.draw(true);
        }
    },

    _mouseoverStreetViewLayer: function(e) {
        if (e.originalEvent.ctrlKey) {
            return;
        }
        this._drawState = this.options.routing._draw._enabled;
        if (this._drawState) {
            this.options.routing.draw(false);
        }
    },

    _mouseoutStreetViewLayer: function(e) {
        if (e.originalEvent.ctrlKey) {
            return;
        }
        this.options.routing.draw(true);
        if (this._drawState) {
            this.options.routing.draw(true);
        }
    },

    calculateHeadingAngle: function(pointA, pointB) {
        var vectorA = [];
        var vectorB = [];
        vectorA.push(pointB['lng'] * 10000 - pointA['lng'] * 10000);
        vectorA.push(pointB['lat'] * 10000 - pointA['lat'] * 10000);
        vectorB.push(0);
        vectorB.push(Math.abs(vectorA[1]));
        var dotProduct = vectorA[1] * vectorB[1];
        var lenA = Math.sqrt(vectorA[0] * vectorA[0] + vectorA[1] * vectorA[1]);
        var lenB = Math.sqrt(vectorB[1] * vectorB[1]);
        var cos = dotProduct / (lenA * lenB);
        var angle = (Math.acos(cos) * 180) / 3.14;
        if (vectorA[0] < 0) {
            angle = 360 - angle;
        }
        return angle;
    },

    getImage: function(point, angle) {
        url =
            'https://maps.googleapis.com/maps/api/streetview?size=' +
            this.options.photo.width +
            'x' +
            this.options.photo.height +
            '&location=' +
            point['lat'] +
            ',' +
            point['lng'] +
            '&fov=' +
            this.options.photo.fov +
            '&pitch=' +
            this.options.photo.pitch +
            '&heading=' +
            angle +
            '&key=' +
            BR.keys.googleStreetView;
        // console.log(url);
        return url;
    }
});
