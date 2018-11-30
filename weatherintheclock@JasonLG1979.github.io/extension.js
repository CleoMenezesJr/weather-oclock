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
 * If this extension breaks your desktop you get to keep both pieces...
 */

"use strict";

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PanelMenu = imports.ui.panelMenu;
const Weather = imports.misc.weather;

// Update the weather every 10 min.
const UPDATE_TIMEOUT = 60 * 10;

let weatherItems = null;

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
    }
    weatherItems = null;
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
        if (this._weatherClient._useAutoLocation) {
            this._weatherClient._updateAutoLocation();
        }
        this._weatherChangedId = this._weatherClient.connect('changed', this._onUpdate.bind(this));
        this._weatherTimeoutId = Mainloop.timeout_add_seconds(UPDATE_TIMEOUT, () => {
            this._weatherClient.update();
            return true;
        });
        this._weatherClient.update();
        
    }

    destroy() {
        Mainloop.source_remove(this._weatherTimeoutId);
        this._weatherClient.disconnect(this._weatherChangedId);
        this.label.destroy();
        this.icon.destroy();
        this._weatherClient = null;
        this._weatherTimeoutId = null;
        this._weatherChangedId = null;
        this._label = null;
        this._icon = null;                
    }

    _onUpdate() {
        let iconName = null;
        let text = "";
        if (this._weatherClient.hasLocation && !this._weatherClient.loading) {
            let info = this._weatherClient.info;
            if (info.is_valid()) {
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
