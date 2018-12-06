/*
 * Weather In The Clock extension for Gnome Shell 3.26+
 * Copyright 2018 Jason Gray (JasonLG1979)
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

"use strict";

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PanelMenu = imports.ui.panelMenu;
const Weather = imports.misc.weather;

// Until we get valid weather info try every
// 3 secs if a weather client is available and
// has a valid location.
const INT_UPDATE_INTERVAL = 3;

// Update the weather every 10 min in the long term.
const LONG_TERM_UPDATE_INTERVAL = 60 * 10;

var weatherItems = null;

function enable() {
    if (!weatherItems) {
        let dateMenuLayout = Main.panel.statusArea.dateMenu.actor.get_children()[0];
        weatherItems = new WeatherItems();
        dateMenuLayout.insert_child_at_index(weatherItems.icon, 2);
        dateMenuLayout.insert_child_at_index(weatherItems.label, 3);
    }
}

function disable() {
    if (weatherItems) {
        weatherItems.destroy();
        weatherItems = null;
    }
}

class WeatherItems {
    constructor() {
        this.icon = new St.Icon({
            y_align: Clutter.ActorAlign.CENTER,
            style_class: "system-status-icon"
        });
        this.icon.hide();
        this.label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER
        });
        this.label.hide();
        this._timeoutId = null;
        this._weatherClient = new Weather.WeatherClient();
        if (this._weatherClient._useAutoLocation) {
            this._weatherClient._updateAutoLocation();
        }
        if (this._weatherClient.available && this._weatherClient.hasLocation) {
            this._createNewUpdateTimeout(INT_UPDATE_INTERVAL);
        }
        this._weatherChangedId = this._weatherClient.connect('changed', this._update.bind(this));
        this._weatherClient.update();
        
    }

    destroy() {
        this._weatherClient.disconnect(this._weatherChangedId);
        this._cancelUpdateTimeout();
        this.label.destroy();
        this.icon.destroy();
        this._weatherClient = null;
        this._weatherChangedId = null;
        this.label = null;
        this.icon = null;               
    }

    _createNewUpdateTimeout(interval) {
        this._cancelUpdateTimeout();
        this._timeoutId = Mainloop.timeout_add_seconds(interval, () => {
            this._weatherClient.update();
            return true;
        }); 
    }

    _cancelUpdateTimeout() {
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    _update() {
        let iconName = null;
        let text = "";
        if (this._weatherClient.hasLocation && !this._weatherClient.loading) {
            let info = this._weatherClient.info;
            if (info.is_valid()) {
                this._createNewUpdateTimeout(LONG_TERM_UPDATE_INTERVAL);
                iconName = info.get_symbolic_icon_name();
                text = info.get_temp_summary();
                // "--" is not a valid temp...
                text = text ? text.replace("--", "") : "";
            }
       }
       this.icon.icon_name = iconName;
       this.label.text = text;
       this.icon.visible = this.label.visible = (iconName && text) ? true : false;
    }
}
