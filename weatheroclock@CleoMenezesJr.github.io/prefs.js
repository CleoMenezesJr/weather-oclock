/****************************************************************************
 ** Weather O'Clock extension for GNOME Shell 45+
 ** Copyright (C) 2024  Cleo Menezes Jr.
 **
 ** This program is free software: you can redistribute it and/or modify
 ** it under the terms of the GNU General Public License as published by
 ** the Free Software Foundation, either version 3 of the License, or
 ** (at your option) any later version.
 **
 ** This program is distributed in the hope that it will be useful,
 ** but WITHOUT ANY WARRANTY; without even the implied warranty of
 ** MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 ** GNU General Public License for more details.
 **
 ** You should have received a copy of the GNU General Public License
 ** along with this program.  If not, see <https://www.gnu.org/licenses/>.
 ****************************************************************************/
"use strict";

import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class WeatherOClockPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    window._settings = this.getSettings();
    window.set_default_size(360, 200);

    const builder = new Gtk.Builder();
    builder.add_from_file(`${this.path}/prefs.ui`);

    const weatherAfterClock = builder.get_object("WeatherAfterClock");
    weatherAfterClock.set_active(window._settings.get_boolean("weather-after-clock"));

    window._settings.bind(
      "weather-after-clock",
      weatherAfterClock,
      "active",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const page = builder.get_object("MainWidget");
    window.add(page);
  }
}
