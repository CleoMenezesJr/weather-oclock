/*
 * Weather O'Clock extension for GNOME Shell 45+
 * Copyright 2022-2026 Cleo Menezes Jr.
 *
 * This software is released under the GNU General Public License v3 or later.
 * See <http://www.gnu.org/licenses/> for details.
 */
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
