/*
 * Weather In The Clock extension for Gnome Shell 3.34
 * Copyright 2020 Jason Gray (JasonLG1979)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * If this extension breaks your desktop you get to keep all of the pieces...
 */

const {Clutter, GLib, GObject, St} = imports.gi;

let panelWeather = null;

function enable() {
    if (!panelWeather) {
        let statusArea = imports.ui.main.panel.statusArea;
        let dateMenu = statusArea.dateMenu;
        let weather = dateMenu._weatherItem._weatherClient;
        let network = statusArea.aggregateMenu._network;
        let networkIcon = network ? network._primaryIndicator : null;
        panelWeather = new PanelWeather(weather, networkIcon);
        dateMenu.get_first_child().insert_child_above(panelWeather, dateMenu._clockDisplay);
    }
}

function disable() {
    if (panelWeather) {
        panelWeather.destroy();
        panelWeather = null;
    }
}

const PanelWeather = GObject.registerClass({
    GTypeName: 'PanelWeather'
}, class PanelWeather extends St.BoxLayout {
    _init(weather, networkIcon) {
        super._init({
            y_align: Clutter.ActorAlign.CENTER,
            visible: false
        });

        this._weather = weather;
        this._networkIcon = networkIcon;

        this._signals = [];

        this._icon = new St.Icon({
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'system-status-icon'
        });

        this.add_child(this._icon);

        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER
        });

        this.add_child(this._label);

        this._pushSignal(this._weather, 'changed', this._onWeatherInfoUpdate.bind(this));

        this._pushSignal(this, 'destroy', this._onDestroy.bind(this));

        if (this._networkIcon) {
            this._pushSignal(this._networkIcon, 'notify::icon-name', this._onNetworkIconNotifyEvents.bind(this));
            this._pushSignal(this._networkIcon, 'notify::visible', this._onNetworkIconNotifyEvents.bind(this));
            if (this._networkIcon.visible) {
                this._weather.update();
                this._StartLongTermUpdateTimeout();
            }
        } else {
            this._weather.update();
            this._StartLongTermUpdateTimeout();
        }
    }

    _pushSignal(obj, signalName, callback) {
        this._signals.push({
            obj: obj,
            signalId: obj.connect(signalName, callback)
        });
    }

    _onWeatherInfoUpdate(weather) {
        this._icon.icon_name = weather.info.get_symbolic_icon_name();
        // "--" is not a valid temp...
        this._label.text = weather.info.get_temp_summary().replace('--', '');
        this.visible = this._icon.icon_name && this._label.text;
    }

    _onNetworkIconNotifyEvents(networkIcon) {
        if (networkIcon.visible && !this.visible) {
            this._weather.update();
            this._StartLongTermUpdateTimeout();
        } else if (!networkIcon.visible) {
            this._canceLongTermUpdateTimeout();
            this.visible = false;
        }
    }

    _StartLongTermUpdateTimeout() {
        this._canceLongTermUpdateTimeout();
        this._weatherUpdateTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 600, () => {
            this._weather.update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _canceLongTermUpdateTimeout() {
        if (this._weatherUpdateTimeout) {
            GLib.source_remove(this._weatherUpdateTimeout);
        }
        this._weatherUpdateTimeout = null;
    }

    _onDestroy() {
        this._canceLongTermUpdateTimeout();
        this._signals.forEach(signal => signal.obj.disconnect(signal.signalId));
        this._signals = null;
        this._weather = null;
        this._networkIcon = null;
    }
});
