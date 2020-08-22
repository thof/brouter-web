BR.StreetView = L.Control.extend({
    options: {
        routing: null,
        layersControl: null,
        shortcut: {
            toggle: 87, // char code for 'w'
            disable: 27 // char code for 'ESC'
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

        this.drawButton = L.easyButton({
            id: 'street-view-toggle',
            states: [
                {
                    stateName: 'activate-street-view',
                    icon: 'fa-street-view',
                    onClick: function() {
                        self.activate(true);
                    },
                    title: i18next.t('map.street-view-start')
                },
                {
                    stateName: 'deactivate-street-view',
                    icon: 'fa-street-view active',
                    onClick: function() {
                        self.activate(false);
                    },
                    title: i18next.t('map.street-view-stop')
                }
            ]
        }).addTo(map);

        map.on('routing:draw-start', function() {
            self.activate(false);
        });

        var container = new L.DomUtil.create('div');
        // keys not working when map container does not have focus, use document instead
        L.DomEvent.removeListener(container, 'keyup', this._keyupListener);
        L.DomEvent.addListener(document, 'keyup', this._keyupListener, this);

        return container;
    },

    activate: function(enable) {
        this.drawButton.state(enable ? 'deactivate-street-view' : 'activate-street-view');
        if (enable) {
            this.options.routing.draw(false);
            this.map.on('click', this.onMapClick, this);
            // store the original active layer
            this._originalActiveLayer = this.options.layersControl.getActiveBaseLayer();
            // change the cursor to pointer
            L.DomUtil.addClass(this.map.getContainer(), 'streetview-enabled');
            // add Google Maps layer if necessary
            if (!this.options.layersControl.getLayer(this._googleMapsName)) {
                var layerData = BR.layerIndex[this.GOOGLE_MAPS_ID];
                var layer = this.options.layersControl.createLayer(layerData);
                var name = layerData.properties.name;
                this.options.layersControl.addBaseLayer(layer, name);
            }
            // replace the original active layer by Google Maps base layer
            if (this.options.layersControl.getActiveBaseLayer().layer.id !== this.GOOGLE_MAPS_ID) {
                this.map.removeLayer(this._originalActiveLayer.layer);
                googleMapsLayer = this.options.layersControl.getLayerById(this.GOOGLE_MAPS_ID);
                this.options.layersControl.activateLayer(googleMapsLayer);
            }
        } else {
            this.map.off('click', this.onMapClick, this);
            // restore the original active layer if it wasn't Google Maps layer
            activeLayer = this.options.layersControl.getActiveBaseLayer();
            if (
                activeLayer !== null &&
                activeLayer.layer.id === this.GOOGLE_MAPS_ID &&
                this._originalActiveLayer.layer.id !== this.GOOGLE_MAPS_ID
            ) {
                googleMapsLayer = this.options.layersControl.getLayerById(this.GOOGLE_MAPS_ID);
                this.map.removeLayer(googleMapsLayer.layer);
                this.options.layersControl.activateLayer(this._originalActiveLayer);
            }
            if (typeof this._streetViewLayer !== 'undefined') {
                this._streetViewLayer.remove();
            }
            if (typeof this._streetviewLine !== 'undefined') {
                this._streetviewLine.remove();
                this._arrowHead.remove();
            }
            this._streetView = [];
            // remove pointer cursor
            L.DomUtil.removeClass(this.map.getContainer(), 'streetview-enabled');
        }
    },

    _keyupListener: function(e) {
        // Suppress shortcut handling when a text input field is focussed
        if (document.activeElement.type == 'text' || document.activeElement.type == 'textarea') {
            return;
        }
        if (e.keyCode === this.options.shortcut.disable) {
            this.activate(false);
        } else if (e.keyCode === this.options.shortcut.toggle) {
            $('#street-view-toggle').click();
        }
    },

    onMapClick: function(e) {
        var self = this;
        // create overlay layer with Street View panorama
        var initialLatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
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

            if (typeof this._streetviewLine !== 'undefined') {
                this._streetviewLine.remove();
                this._arrowHead.remove();
            }
            var latlngs = [pointA, pointB];
            this._streetviewLine = L.polyline(latlngs, { color: 'red' });
            this._streetviewLine.addTo(this.map);
            this._arrowHead = L.polylineDecorator(this._streetviewLine, {
                patterns: [
                    {
                        offset: '100%',
                        repeat: 0,
                        symbol: L.Symbol.arrowHead({
                            pixelSize: 15,
                            polygon: false,
                            pathOptions: { stroke: true, color: 'red' }
                        })
                    }
                ]
            });
            this._arrowHead.addTo(this.map);

            if (typeof this._streetViewLayer !== 'undefined') {
                this._streetViewLayer.remove();
            }
            this._streetViewLayer = L.imageOverlay(imgUrl, imgBounds, { interactive: true });
            this._streetViewLayer.on('mouseover', this._mouseoverStreetViewLayer, this);
            this._streetViewLayer.on('mouseout', this._mouseoutStreetViewLayer, this);
            this._streetViewLayer.on('mousedown', this._mousedownStreetViewLayer, this);
            this._streetViewLayer.addTo(this.map);
        }
    },

    _mousedownStreetViewLayer: function(e) {
        if (typeof this._streetViewLayer !== 'undefined') {
            this._streetViewLayer.remove();
            this.map.on('click', this.onMapClick, this);
        }
    },

    _mouseoverStreetViewLayer: function(e) {
        this.map.off('click', this.onMapClick, this);
    },

    _mouseoutStreetViewLayer: function(e) {
        this.map.on('click', this.onMapClick, this);
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
