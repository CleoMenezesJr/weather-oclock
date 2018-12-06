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
const GLib = imports.gi.GLib;
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

// One sec.
const UPDATE_THRESHOLD = 1000000;

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
        this._weatherClient = new Weather.WeatherClient();
        this._lastUpdate = 0;
        this._weatherIntTimeoutId = null;
        this._weatherLongTermTimeoutId = null;
        this._weatherChangedId = this._weatherClient.connect('changed', () => {
            let now = GLib.get_monotonic_time();
            if ((now - this._lastUpdate) > UPDATE_THRESHOLD) {
                this._update(now);
            }
        });
        if (this._weatherClient.available && this._weatherClient.hasLocation) {
            // We don't want to rapid fire timeouts if there is no weatherClient
            // or it doesn't have a valid location.
            this._weatherIntTimeoutId = Mainloop.timeout_add_seconds(INT_UPDATE_INTERVAL, () => {
                this._weatherClient.update();
                return true;
            });
        }
        if (this._weatherClient._useAutoLocation) {
            this._weatherClient._updateAutoLocation();
        }
        this._weatherClient.update();
        
    }

    destroy() {
        if (this._weatherIntTimeoutId) {
            Mainloop.source_remove(this._weatherIntTimeoutId);
        }
        if (this._weatherLongTermTimeoutId) {
            Mainloop.source_remove(this._weatherLongTermTimeoutId);
        }
        if (this._weatherChangedId) {
            this._weatherClient.disconnect(this._weatherChangedId);
        }
        this.label.destroy();
        this.icon.destroy();
        this._weatherClient = null;
        this._weatherIntTimeoutId = null;
        this._weatherLongTermTimeoutId = null;
        this._weatherChangedId = null;
        this.label = null;
        this.icon = null;               
    }

    _update(now) {
        let iconName = null;
        let text = "";
        if (this._weatherClient.hasLocation && !this._weatherClient.loading) {
            let info = this._weatherClient.info;
            if (info.is_valid()) {
                this._lastUpdate = now;
                if (this._weatherIntTimeoutId) {
                    // Once we have valid weather info remove the int timeout...
                    Mainloop.source_remove(this._weatherIntTimeoutId);
                    this._weatherIntTimeoutId = null;
                }
                if (!this._weatherLongTermTimeoutId) {
                    // And start the long term timeout.
                    this._weatherLongTermTimeoutId = Mainloop.timeout_add_seconds(LONG_TERM_UPDATE_INTERVAL, () => {
                        this._weatherClient.update();
                        return true;
                    });
                }
                iconName = info.get_symbolic_icon_name();
                text = info.get_temp_summary();
            }
       }
       this.icon.icon_name = iconName;
       this.label.text = text;
       if (!text) {
           this.label.hide();
       } else {
           this.label.show();
       }
       if (!iconName) {
           this.icon.hide();
       } else {
           this.icon.show();
       }
    }
}
